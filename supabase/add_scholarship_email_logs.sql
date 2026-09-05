-- 寄送紀錄表：學生送件確認信、補正通知信、系所重新送出通知。

create table if not exists public.scholarship_email_logs (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.scholarship_applications(id) on delete cascade,
  recipient_email   text not null default '',
  email_type        text not null,
  sent_at           timestamptz not null default now(),
  resend_message_id text,
  status            text not null,
  failure_reason    text,
  metadata          jsonb not null default '{}'::jsonb
);

alter table public.scholarship_email_logs
  drop constraint if exists scholarship_email_logs_email_type_check,
  add constraint scholarship_email_logs_email_type_check
    check (
      email_type in (
        'student_submission_confirmation',
        'student_correction_notice',
        'department_resubmission_notice'
      )
    ),
  drop constraint if exists scholarship_email_logs_status_check,
  add constraint scholarship_email_logs_status_check
    check (status in ('success', 'failed'));

alter table public.scholarship_email_logs
  alter column recipient_email set not null,
  alter column recipient_email set default '',
  alter column sent_at set not null,
  alter column sent_at set default now(),
  alter column metadata set not null,
  alter column metadata set default '{}'::jsonb;

comment on table public.scholarship_email_logs is '獎學金系統寄信成功或失敗的可查詢紀錄';
comment on column public.scholarship_email_logs.recipient_email is '當次寄送收件者；多收件者以逗號分隔';
comment on column public.scholarship_email_logs.email_type is '寄信類型：學生送件確認、補正通知、系所重新送出通知';
comment on column public.scholarship_email_logs.sent_at is '當次寄送嘗試完成並寫入紀錄的時間';
comment on column public.scholarship_email_logs.resend_message_id is 'Resend 回傳的 message ID；失敗時為空';
comment on column public.scholarship_email_logs.failure_reason is '寄送失敗原因；成功時為空';
comment on column public.scholarship_email_logs.metadata is '重寄所需的附加資料，例如補正紀錄 ID 或系所收件帳號';

create index if not exists idx_email_logs_application_id
  on public.scholarship_email_logs(application_id);
create index if not exists idx_email_logs_sent_at
  on public.scholarship_email_logs(sent_at desc);
create index if not exists idx_email_logs_email_type
  on public.scholarship_email_logs(email_type);

alter table public.scholarship_email_logs enable row level security;

drop policy if exists "Teachers can view email logs"
  on public.scholarship_email_logs;
create policy "Teachers can view email logs"
  on public.scholarship_email_logs for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('teacher', 'admin')
    )
  );

drop policy if exists "Service role can manage email logs"
  on public.scholarship_email_logs;
create policy "Service role can manage email logs"
  on public.scholarship_email_logs for all
  to service_role
  using (true)
  with check (true);

grant select on public.scholarship_email_logs to authenticated;
grant select, insert, update, delete on public.scholarship_email_logs to service_role;

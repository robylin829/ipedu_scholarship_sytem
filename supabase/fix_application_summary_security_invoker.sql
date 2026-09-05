-- 修正 Supabase Security Advisor 0010 security definer view：
-- public.application_summary 不需要用 view owner 權限查詢，應以呼叫者權限套用底層 RLS。

alter view public.application_summary
  set (security_invoker = true);

comment on view public.application_summary is '教師 Dashboard 用的申請案摘要，包含從 payload 提取的常用欄位；以查詢者權限套用底層 RLS';

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MultiOptionSelect } from "@/components/multi-option-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DashboardActionPermissions } from "@/lib/dashboard-permissions";
import type {
  DashboardRole,
  Conference,
  Journal,
  PlannedResearch,
  PublicationVerification,
  ResearchAward,
  ResearchExperience,
  ScholarshipApplication,
  ScholarshipCorrectionRecord,
  ScholarshipEmailLog,
  ScholarshipPayload,
  ScholarshipEmailStatus,
} from "@/lib/types";
import { SCHOLARSHIP_EMAIL_TYPE_LABELS } from "@/lib/types";
import {
  ADMISSION_CHANNEL_OPTIONS,
  DATABASE_OPTIONS,
  DEPARTMENT_OPTIONS,
  DASHBOARD_EMPLOYMENT_STATUS_OPTIONS,
  FULL_TIME_APPLICATION_TYPES,
  FULL_TIME_APPLICATION_TYPE_MATCHING_FUND,
  FULL_TIME_STUDY_STATUS_NEW,
  FULL_TIME_STUDY_STATUS_OLD,
  FULL_TIME_STUDY_STATUS_OPTIONS,
  GPA_SCALE_OPTIONS,
  MATCHING_FUND_SOURCE_OPTIONS,
  OTHER_AID_STATUS_NONE,
  OTHER_AID_STATUS_OPTIONS,
  OTHER_AID_STATUS_RECEIVING,
  STUDY_STATUS_NEW,
  STUDY_STATUS_OPTIONS,
  STUDY_STATUS_RENEWAL,
  parseMultiOptionValues,
} from "@/lib/scholarship-form-options";
import {
  formatSubmittedAt,
  getAcademicDisplayRows,
  getEligibilityDisplayRows,
  isFullTimeDoctoralGrant,
  isNstcDoctoralProgram,
} from "@/lib/dashboard-application-display";
import {
  getIndexedNonEmptyConferences,
  getIndexedNonEmptyJournals,
} from "@/lib/publication-records";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  Download,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type ApplicationDetailProps = {
  application: ScholarshipApplication | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (application: ScholarshipApplication) => void;
  permissions: DashboardActionPermissions;
  role: DashboardRole;
  onDeleted?: (applicationId: string) => void;
};

/* ------------------------------------------------------------------ */
/*  Blank templates for newly-added repeatable rows                    */
/* ------------------------------------------------------------------ */

const EMPTY_JOURNAL: Journal = {
  doi: "",
  date: "",
  author: "",
  applicantAuthorName: "",
  doiAuthorNames: [],
  issns: [],
  title: "",
  journal: "",
  reviewUnit: "",
  journalLevel: "",
  indexSource: "",
  isCorrespondingAuthor: false,
  hasTrustedDatabase: "",
  database: "",
  authorOrder: "",
  authorOrderOriginal: "",
  authorOrderModified: false,
  authorOrderChangeNote: "",
  publicationAutofillBaseline: {},
  publicationChangeNotes: [],
  attachmentNote: "",
};

const EMPTY_CONFERENCE: Conference = {
  date: "",
  author: "",
  title: "",
  conference: "",
  organizer: "",
  type: "",
  database: "",
  authorOrder: "",
};

const EMPTY_RESEARCH_EXPERIENCE: ResearchExperience = {
  institution: "",
  role: "",
  nature: "",
  duration: "",
};

const EMPTY_RESEARCH_AWARD: ResearchAward = {
  name: "",
  projectNumber: "",
  amountOrItem: "",
  contribution: "",
};

const EMPTY_PLANNED_RESEARCH: PlannedResearch = {
  title: "",
  expectedDate: "",
  targetVenue: "",
  hasTrustedDatabase: "",
  database: "",
  advisor: "",
};

/* ------------------------------------------------------------------ */
/*  Immutable array helpers                                            */
/* ------------------------------------------------------------------ */

function updateAt<T>(list: T[], idx: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === idx ? { ...item, ...patch } : item));
}

function removeAt<T>(list: T[], idx: number): T[] {
  return list.filter((_, i) => i !== idx);
}

function formatPublicationChangeValue(value: string) {
  return value.trim() || "（空白）";
}

function normalizeJournalFieldValue(value: unknown): string {
  if (Array.isArray(value)) return value.join("、").trim();
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeFullTimeStudyStatus(value: string) {
  if (value === STUDY_STATUS_NEW) return FULL_TIME_STUDY_STATUS_NEW;
  if (value === STUDY_STATUS_RENEWAL) return FULL_TIME_STUDY_STATUS_OLD;
  return value;
}

/**
 * Where a journal field's value came from, for reviewer colour-coding:
 *  - "auto":    auto-filled by the DOI lookup and left unchanged
 *  - "student": entered by the student, or modified from the auto-filled value
 */
function journalFieldOrigin(
  journal: Journal,
  field: keyof Journal
): "auto" | "student" {
  const baseline = journal.publicationAutofillBaseline ?? {};
  const original = baseline[field as string];
  if (!original) return "student";
  return normalizeJournalFieldValue(journal[field]) === original
    ? "auto"
    : "student";
}

function journalOriginClass(journal: Journal, field: keyof Journal) {
  return journalFieldOrigin(journal, field) === "auto"
    ? "text-emerald-700"
    : "text-amber-700";
}

/* ------------------------------------------------------------------ */
/*  Verification status helpers                                        */
/* ------------------------------------------------------------------ */

const CHECK_ICONS = {
  pass: <CheckCircle2 className="size-3.5 text-emerald-600" />,
  fail: <XCircle className="size-3.5 text-red-600" />,
  timeout: <Clock className="size-3.5 text-amber-500" />,
  skipped: <Clock className="size-3.5 text-slate-400" />,
} as const;

const CHECK_LABELS: Record<string, string> = {
  pass: "通過",
  fail: "不通過",
  timeout: "逾時",
  skipped: "跳過",
};

function VerificationBadge({ v }: { v: PublicationVerification | undefined }) {
  if (!v) return null;
  const color =
    v.status === "pass"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : v.status === "fail"
        ? "bg-red-50 text-red-700 border-red-200"
        : v.status === "timeout"
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-slate-50 text-slate-500 border-slate-200";

  const label =
    v.status === "pass"
      ? "自動驗證通過"
      : v.status === "fail"
        ? "驗證異常"
        : v.status === "timeout"
          ? "驗證逾時"
          : "待驗證";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${color}`}
    >
      {v.status === "pass" ? (
        <CheckCircle2 className="size-3" />
      ) : v.status === "fail" ? (
        <CircleAlert className="size-3" />
      ) : (
        <Clock className="size-3" />
      )}
      {label}
    </span>
  );
}

function VerificationChecks({ v }: { v: PublicationVerification }) {
  return (
    <div className="mt-2 space-y-1 rounded-md bg-slate-50 p-2">
      <div className="flex items-center gap-1.5 text-xs">
        {CHECK_ICONS[v.doiExists]}
        <span className="text-slate-600">DOI 存在性：</span>
        <span className="font-medium">
          {CHECK_LABELS[v.doiExists]}
          {v.doiRegistrationAgency && ` (${v.doiRegistrationAgency})`}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {CHECK_ICONS[v.authorFound]}
        <span className="text-slate-600">作者比對：</span>
        <span className="font-medium">{CHECK_LABELS[v.authorFound]}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        {CHECK_ICONS[v.authorOrderCorrect]}
        <span className="text-slate-600">作者順序：</span>
        <span className="font-medium">
          {CHECK_LABELS[v.authorOrderCorrect]}
          {v.actualAuthorPosition &&
            ` (實際第 ${v.actualAuthorPosition}/${v.totalAuthors} 位)`}
        </span>
      </div>
      {v.citedByCount !== null && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="size-3.5 text-center text-blue-600 font-bold">
            #
          </span>
          <span className="text-slate-600">被引用次數：</span>
          <span className="font-medium">{v.citedByCount}</span>
        </div>
      )}
      {v.message && (
        <p
          className={`text-xs mt-1 ${v.status === "fail" ? "text-red-600" : "text-slate-500"}`}
        >
          {v.message}
        </p>
      )}
      <p className="text-xs text-slate-400 mt-1">
        驗證時間：{new Date(v.verifiedAt).toLocaleString("zh-TW")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Read-only / editable field rows                                    */
/* ------------------------------------------------------------------ */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <span className="text-sm text-slate-900">{value || "—"}</span>
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  textarea?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="pt-1.5 text-sm font-medium text-slate-500">{label}</span>
      {textarea ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-16"
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
  placeholder = "請選擇",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function MultiSelectRow({
  label,
  value,
  onChange,
  options,
  placeholder = "選擇資料庫",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <MultiOptionSelect
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
      />
    </div>
  );
}

const BOOL_OPTIONS = ["是", "否"] as const;

function BoolRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-2 py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-sm font-medium text-slate-500">{label}</span>
      <Select
        value={value ? "是" : "否"}
        onValueChange={(v) => onChange(v === "是")}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {BOOL_OPTIONS.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function formatCorrectionCreatedAt(value: string) {
  return new Date(value).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEmailSentAt(value: string) {
  return new Date(value).toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmailStatusBadge({ status }: { status: ScholarshipEmailStatus }) {
  return status === "success" ? (
    <Badge className="bg-emerald-100 text-emerald-800">成功</Badge>
  ) : (
    <Badge className="bg-red-100 text-red-700">失敗</Badge>
  );
}

function CorrectionRecordsCard({
  loading,
  records,
}: {
  loading: boolean;
  records: ScholarshipCorrectionRecord[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Mail className="size-4 text-amber-600" />
          補正紀錄
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-500">正在載入補正紀錄...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-slate-500">尚無補正紀錄。</p>
        ) : (
          records.map((record) => {
            const notifier =
              record.notifier_display_name ||
              (record.notifier_role === "admin" ? "管理員" : "系所");

            return (
              <div
                key={record.id}
                className="rounded-md border border-amber-200 bg-amber-50/50 p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge className="bg-amber-100 text-amber-800">
                    第 {record.correction_number} 次補正
                  </Badge>
                  <span>{formatCorrectionCreatedAt(record.created_at)}</span>
                  <span>通知人：{notifier}</span>
                  <span>
                    角色：
                    {record.notifier_role === "admin" ? "管理員" : "系所"}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {record.message}
                </p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function EmailLogsCard({
  canResend,
  loading,
  records,
  resendingId,
  onResend,
}: {
  canResend: boolean;
  loading: boolean;
  records: ScholarshipEmailLog[];
  resendingId: string | null;
  onResend: (logId: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Mail className="size-4 text-sky-600" />
          寄送紀錄
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-500">正在載入寄送紀錄...</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-slate-500">尚無寄送紀錄。</p>
        ) : (
          records.map((record) => (
            <div
              key={record.id}
              className="rounded-md border border-slate-200 bg-slate-50/70 p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <EmailStatusBadge status={record.status} />
                <Badge variant="outline">
                  {SCHOLARSHIP_EMAIL_TYPE_LABELS[record.email_type]}
                </Badge>
                <span>{formatEmailSentAt(record.sent_at)}</span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-[72px_1fr]">
                <span className="font-medium text-slate-500">收件者</span>
                <span className="break-all">
                  {record.recipient_email || "未設定"}
                </span>
                <span className="font-medium text-slate-500">Resend ID</span>
                <span className="break-all font-mono">
                  {record.resend_message_id || "—"}
                </span>
                {record.failure_reason ? (
                  <>
                    <span className="font-medium text-slate-500">原因</span>
                    <span className="text-red-600">
                      {record.failure_reason}
                    </span>
                  </>
                ) : null}
              </div>
              {canResend ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    disabled={resendingId === record.id}
                    onClick={() => onResend(record.id)}
                  >
                    {resendingId === record.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    重寄
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function ApplicationDetail({
  application,
  open,
  onOpenChange,
  onUpdated,
  permissions,
  role,
  onDeleted,
}: ApplicationDetailProps) {
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [verifyingIdx, setVerifyingIdx] = useState<number | null>(null);
  const [liveJournals, setLiveJournals] = useState<Journal[] | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [draft, setDraft] = useState<ScholarshipPayload | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState("");
  const [sendingCorrection, setSendingCorrection] = useState(false);
  const [correctionRecords, setCorrectionRecords] = useState<
    ScholarshipCorrectionRecord[]
  >([]);
  const [loadingCorrectionRecords, setLoadingCorrectionRecords] =
    useState(false);
  const [emailLogs, setEmailLogs] = useState<ScholarshipEmailLog[]>([]);
  const [loadingEmailLogs, setLoadingEmailLogs] = useState(false);
  const [resendingEmailLogId, setResendingEmailLogId] = useState<string | null>(
    null
  );

  // Reset local state when switching to a different application
  useEffect(() => {
    setLiveJournals(null);
    setIsEditing(false);
    setDraft(null);
    setCorrectionOpen(false);
    setCorrectionMessage("");
    setSendingCorrection(false);
    setExportingPdf(false);
    setCorrectionRecords([]);
    setLoadingCorrectionRecords(false);
    setEmailLogs([]);
    setLoadingEmailLogs(false);
    setResendingEmailLogId(null);
  }, [application?.id]);

  const loadCorrectionRecords = useCallback(async (applicationId: string) => {
    setLoadingCorrectionRecords(true);
    try {
      const res = await fetch(
        `/api/dashboard/correction-records?applicationId=${encodeURIComponent(
          applicationId
        )}`
      );
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.records)) {
        toast.error(data.error || "補正紀錄載入失敗。");
        setCorrectionRecords([]);
        return;
      }

      setCorrectionRecords(data.records as ScholarshipCorrectionRecord[]);
    } catch {
      toast.error("補正紀錄載入失敗。");
      setCorrectionRecords([]);
    } finally {
      setLoadingCorrectionRecords(false);
    }
  }, []);

  const loadEmailLogs = useCallback(async (applicationId: string) => {
    setLoadingEmailLogs(true);
    try {
      const res = await fetch(
        `/api/dashboard/email-logs?applicationId=${encodeURIComponent(
          applicationId
        )}`
      );
      const data = await res.json();
      if (!res.ok || !data.success || !Array.isArray(data.records)) {
        toast.error(data.error || "寄送紀錄載入失敗。");
        setEmailLogs([]);
        return;
      }

      setEmailLogs(data.records as ScholarshipEmailLog[]);
    } catch {
      toast.error("寄送紀錄載入失敗。");
      setEmailLogs([]);
    } finally {
      setLoadingEmailLogs(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !application?.id) {
      return;
    }

    loadCorrectionRecords(application.id);
    loadEmailLogs(application.id);
  }, [application?.id, loadCorrectionRecords, loadEmailLogs, open]);

  const triggerVerify = useCallback(
    async (journalIndex?: number) => {
      if (!application) return;
      if (journalIndex !== undefined) {
        setVerifyingIdx(journalIndex);
      } else {
        setVerifyingAll(true);
      }
      try {
        const res = await fetch("/api/dashboard/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            applicationId: application.id,
            ...(journalIndex !== undefined ? { journalIndex } : {}),
          }),
        });
        const data = await res.json();
        if (data.success && data.journals) {
          // Update local journal state with verification results
          const newJournals = [
            ...(liveJournals ?? application.payload.journals ?? []),
          ];
          for (const item of data.journals as {
            index: number;
            verification: PublicationVerification;
          }[]) {
            if (newJournals[item.index]) {
              newJournals[item.index] = {
                ...newJournals[item.index],
                verification: item.verification,
              };
            }
          }
          setLiveJournals(newJournals);
          toast.success(
            journalIndex !== undefined ? "單篇驗證完成" : "全部驗證完成"
          );
        } else {
          toast.error(data.error || "驗證失敗");
        }
      } catch {
        toast.error("驗證請求失敗");
      } finally {
        setVerifyingAll(false);
        setVerifyingIdx(null);
      }
    },
    [application, liveJournals]
  );

  const startEditing = useCallback(() => {
    if (!application) return;
    // Deep clone so edits don't mutate the source; keep already-run
    // verification by preferring liveJournals.
    const base: ScholarshipPayload = {
      ...application.payload,
      applicantInfo: {
        ...application.payload.applicantInfo,
        studyStatus: isFullTimeDoctoralGrant(application)
          ? normalizeFullTimeStudyStatus(
              application.payload.applicantInfo.studyStatus
            )
          : application.payload.applicantInfo.studyStatus,
      },
      journals: liveJournals ?? application.payload.journals ?? [],
    };
    setDraft(structuredClone(base));
    setIsEditing(true);
  }, [application, liveJournals]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setDraft(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!application || !draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/dashboard", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: application.id,
          payload: draft,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "儲存失敗，請重試。");
        return;
      }
      const updated: ScholarshipApplication =
        (data.application as ScholarshipApplication | undefined) ?? {
          ...application,
          payload: draft,
        };
      // Reflect saved verification back into the live view.
      setLiveJournals(updated.payload.journals ?? []);
      onUpdated?.(updated);
      setIsEditing(false);
      setDraft(null);
      toast.success("已儲存申請表變更。");
    } catch {
      toast.error("儲存請求失敗，請重試。");
    } finally {
      setSaving(false);
    }
  }, [application, draft, onUpdated]);

  const handleSendCorrection = useCallback(async () => {
    if (!application) return;
    const message = correctionMessage.trim();
    if (!message) {
      toast.error("請填寫需補正內容。");
      return;
    }

    setSendingCorrection(true);
    try {
      const res = await fetch("/api/dashboard/correction-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicationId: application.id,
          message,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "補正通知寄送失敗，請重試。");
        return;
      }

      const updated = data.application as ScholarshipApplication | undefined;
      if (updated) {
        onUpdated?.(updated);
      }
      await loadCorrectionRecords(application.id);
      setTimeout(() => {
        loadEmailLogs(application.id);
      }, 1500);
      setCorrectionOpen(false);
      setCorrectionMessage("");
      toast.success("申請案已退回可修改，補正通知信將寄出。");
    } catch {
      toast.error("補正通知請求失敗，請重試。");
    } finally {
      setSendingCorrection(false);
    }
  }, [
    application,
    correctionMessage,
    loadCorrectionRecords,
    loadEmailLogs,
    onUpdated,
  ]);

  const handleResendEmail = useCallback(
    async (logId: string) => {
      if (!application) return;
      setResendingEmailLogId(logId);
      try {
        const res = await fetch("/api/dashboard/email-logs/resend", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ logId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          toast.error(data.error || "重寄通知信失敗。");
          return;
        }

        toast.success("已排入背景重寄。");
        setTimeout(() => {
          loadEmailLogs(application.id);
        }, 1500);
      } catch {
        toast.error("重寄通知信請求失敗。");
      } finally {
        setResendingEmailLogId(null);
      }
    },
    [application, loadEmailLogs]
  );

  const handleDelete = useCallback(async () => {
    if (!application) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/dashboard", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: application.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        toast.error(data.error || "刪除失敗，請重試。");
        return;
      }
      toast.success("已刪除申請紀錄。");
      onDeleted?.(application.id);
      onOpenChange(false);
    } catch {
      toast.error("刪除請求失敗，請重試。");
    } finally {
      setDeleting(false);
    }
  }, [application, onDeleted, onOpenChange]);

  const handleExportPdf = useCallback(async () => {
    if (!application) return;
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/dashboard/applications/${application.id}/pdf`);
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/pdf")) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || "PDF 匯出失敗，請稍後再試。");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${application.student_id}_${application.applicant_name}_申請資料詳情.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("PDF 匯出請求失敗，請稍後再試。");
    } finally {
      setExportingPdf(false);
    }
  }, [application]);

  if (!application) return null;

  const { payload, files } = application;
  const { applicantInfo } = payload;
  const journals = liveJournals ?? payload.journals ?? [];
  const conferences = payload.conferences ?? [];
  const visibleJournals = getIndexedNonEmptyJournals(journals);
  const visibleConferences = getIndexedNonEmptyConferences(conferences);
  const researchExperiences = payload.researchExperiences ?? [];
  const researchAwards = payload.researchAwards ?? [];
  const plannedResearch = payload.plannedResearch ?? [];
  const correctionRecipientEmail =
    applicantInfo.email || `${application.applicant_name} 的 Email 未填寫`;
  const eligibilityDisplayRows = getEligibilityDisplayRows(application);
  const academicDisplayRows = getAcademicDisplayRows(application);
  const isFullTimeGrant = isFullTimeDoctoralGrant(application);
  const requiresMatchingFundDetails =
    application.program_key === "moe-doctoral" ||
    application.program_key === "presidential-new-student";
  const hasAdvisorMatchingFund = parseMultiOptionValues(
    applicantInfo.applicationType
  ).includes(FULL_TIME_APPLICATION_TYPE_MATCHING_FUND);
  const showEmploymentRows = !isNstcDoctoralProgram(application);
  const studyStatusOptions = isFullTimeGrant
    ? FULL_TIME_STUDY_STATUS_OPTIONS
    : STUDY_STATUS_OPTIONS;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-2xl overflow-y-auto bg-white"
      >
        <SheetHeader className="border-b border-slate-200 pb-4">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle className="text-lg">
                {applicantInfo.applicantName} — 申請資料詳情
              </SheetTitle>
              <SheetDescription>
                {applicantInfo.department} / {applicantInfo.studentId} /
                指導教授：{applicantInfo.advisorName}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-xs h-8"
                    disabled={saving}
                    onClick={cancelEditing}
                  >
                    <X className="size-3.5" />
                    取消
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1 text-xs h-8"
                    disabled={saving}
                    onClick={handleSave}
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    儲存
                  </Button>
                </>
              ) : (
                <>
                  {permissions.exportPdf ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs h-8"
                      disabled={exportingPdf}
                      onClick={handleExportPdf}
                    >
                      {exportingPdf ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Download className="size-3.5" />
                      )}
                      匯出 PDF
                    </Button>
                  ) : null}
                  {permissions.sendCorrection ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs h-8"
                      onClick={() => setCorrectionOpen(true)}
                    >
                      <Mail className="size-3.5" />
                      通知補正
                    </Button>
                  ) : null}
                  {permissions.editApplication ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs h-8"
                      onClick={startEditing}
                    >
                      <Pencil className="size-3.5" />
                      編輯
                    </Button>
                  ) : null}
                  {permissions.deleteApplication ? (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1 text-xs h-8 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                            disabled={deleting}
                          >
                            {deleting ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                            刪除
                          </Button>
                        }
                      />
                      <AlertDialogContent className="bg-white text-slate-900">
                        <AlertDialogHeader>
                          <AlertDialogTitle>確認刪除申請紀錄</AlertDialogTitle>
                          <AlertDialogDescription>
                            確定要刪除「{applicantInfo.applicantName}」的這筆申請紀錄嗎？
                            此操作會一併刪除上傳的附件與審核紀錄，且無法復原。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={handleDelete}
                          >
                            確認刪除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </SheetHeader>

        <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
          <DialogContent className="sm:max-w-lg bg-white">
            <DialogHeader>
              <DialogTitle>通知學生補正申請資料</DialogTitle>
              <DialogDescription>
                系統會寄出通知信，並將申請案退回可修改狀態。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div className="grid grid-cols-[80px_1fr] gap-2">
                  <span className="font-medium text-slate-500">收件人</span>
                  <span className="break-all text-slate-900">
                    {correctionRecipientEmail}
                  </span>
                  <span className="font-medium text-slate-500">申請人</span>
                  <span className="text-slate-900">
                    {applicantInfo.applicantName || application.applicant_name}
                  </span>
                  <span className="font-medium text-slate-500">申請項目</span>
                  <span className="text-slate-900">
                    {application.scholarship_program}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="correction-message"
                  className="text-sm font-medium text-slate-700"
                >
                  需補正內容
                </label>
                <Textarea
                  id="correction-message"
                  value={correctionMessage}
                  onChange={(e) => setCorrectionMessage(e.target.value)}
                  maxLength={2000}
                  className="min-h-36"
                  placeholder="請說明申請資料哪裡需要更正，例如：成績單缺少頁面、期刊 DOI 資料不一致、附件需重新上傳。"
                />
                <p className="text-right text-xs text-slate-400">
                  {correctionMessage.length}/2000
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={sendingCorrection}
                onClick={() => setCorrectionOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                className="gap-1"
                disabled={sendingCorrection || !correctionMessage.trim()}
                onClick={handleSendCorrection}
              >
                {sendingCorrection ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Mail className="size-4" />
                )}
                寄出並退回
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="px-4 pb-6">
          <div className="mb-4 mt-4">
            <div className="space-y-4">
              <CorrectionRecordsCard
                loading={loadingCorrectionRecords}
                records={correctionRecords}
              />
              <EmailLogsCard
                canResend={role === "admin"}
                loading={loadingEmailLogs}
                records={emailLogs}
                resendingId={resendingEmailLogId}
                onResend={handleResendEmail}
              />
            </div>
          </div>

          <Tabs defaultValue="basic" className="flex-col">
            <TabsList className="mt-2 mb-4">
              <TabsTrigger value="basic">基本資料</TabsTrigger>
              <TabsTrigger value="academic">學術表現</TabsTrigger>
              <TabsTrigger value="research">研究經歷</TabsTrigger>
              <TabsTrigger value="plan">計畫與其他</TabsTrigger>
            </TabsList>

            {/* ── Tab 1: 基本資料 ── */}
            <TabsContent value="basic" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">申請人資訊</CardTitle>
                </CardHeader>
                <CardContent className="space-y-0">
                  {isEditing && draft ? (
                    <>
                      <InfoRow
                        label="申請項目"
                        value={application.scholarship_program}
                      />
                      <InfoRow
                        label="送出時間"
                        value={formatSubmittedAt(application.submitted_at)}
                      />
                      <TextRow
                        label="姓名"
                        value={draft.applicantInfo.applicantName}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    applicantName: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="學號"
                        value={draft.applicantInfo.studentId}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    studentId: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <SelectRow
                        label="系所"
                        value={draft.applicantInfo.department}
                        options={DEPARTMENT_OPTIONS}
                        placeholder="請選擇所屬學系所"
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    department: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="Email"
                        value={draft.applicantInfo.email}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    email: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="手機"
                        value={draft.applicantInfo.phone}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    phone: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="指導教授"
                        value={draft.applicantInfo.advisorName}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    advisorName: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="入學學年度"
                        value={draft.applicantInfo.admissionAcademicYear}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    admissionAcademicYear: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <SelectRow
                        label="入學管道"
                        value={draft.academicPerformance.admissionChannel}
                        options={ADMISSION_CHANNEL_OPTIONS}
                        placeholder="請選擇入學管道"
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    admissionChannel: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <SelectRow
                        label="請領別"
                        value={draft.applicantInfo.studyStatus}
                        options={studyStatusOptions}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  applicantInfo: {
                                    ...d.applicantInfo,
                                    studyStatus: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      {isFullTimeGrant ? (
                        <MultiSelectRow
                          label="申請類別（可複選）"
                          value={draft.applicantInfo.applicationType}
                          options={FULL_TIME_APPLICATION_TYPES}
                          placeholder="請選擇申請類別（可複選）"
                          onChange={(v) =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    applicantInfo: {
                                      ...d.applicantInfo,
                                      applicationType: v,
                                    },
                                  }
                                : d
                            )
                          }
                        />
                      ) : (
                        <TextRow
                          label="申請類別"
                          value={draft.applicantInfo.applicationType}
                          onChange={(v) =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    applicantInfo: {
                                      ...d.applicantInfo,
                                      applicationType: v,
                                    },
                                  }
                                : d
                            )
                          }
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <InfoRow
                        label="申請項目"
                        value={application.scholarship_program}
                      />
                      <InfoRow
                        label="送出時間"
                        value={formatSubmittedAt(application.submitted_at)}
                      />
                      <InfoRow label="姓名" value={applicantInfo.applicantName} />
                      <InfoRow label="學號" value={applicantInfo.studentId} />
                      <InfoRow label="系所" value={applicantInfo.department} />
                      <InfoRow label="Email" value={applicantInfo.email} />
                      <InfoRow label="手機" value={applicantInfo.phone} />
                      <InfoRow
                        label="指導教授"
                        value={applicantInfo.advisorName}
                      />
                      <InfoRow
                        label="入學學年度"
                        value={applicantInfo.admissionAcademicYear}
                      />
                      <InfoRow
                        label="入學管道"
                        value={payload.academicPerformance.admissionChannel}
                      />
                      <InfoRow
                        label="請領別"
                        value={
                          isFullTimeGrant
                            ? normalizeFullTimeStudyStatus(
                                applicantInfo.studyStatus
                              )
                            : applicantInfo.studyStatus
                        }
                      />
                      <InfoRow
                        label="申請類別"
                        value={applicantInfo.applicationType}
                      />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">請領資格</CardTitle>
                </CardHeader>
                <CardContent className="space-y-0">
                  {isEditing && draft ? (
                    <>
                      <TextRow
                        label="學士班排名(%)"
                        value={draft.eligibility.bachelorRankPercent}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    bachelorRankPercent: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="碩士班 GPA"
                        value={draft.eligibility.masterGpa}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    masterGpa: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <SelectRow
                        label="GPA 級距"
                        value={draft.eligibility.gpaScale}
                        options={GPA_SCALE_OPTIONS}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    gpaScale: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="碩士百分制"
                        value={draft.eligibility.masterPercentScore}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    masterPercentScore: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <BoolRow
                        label="內容屬實"
                        value={draft.eligibility.hasSpecialRecommendation}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    hasSpecialRecommendation: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <BoolRow
                        label="無專職工作"
                        value={draft.eligibility.noFullTimeJob}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    noFullTimeJob: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <BoolRow
                        label="已詳閱辦法"
                        value={draft.eligibility.notReceivingOtherScholarship}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    notReceivingOtherScholarship: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      {showEmploymentRows ? (
                        <>
                          <MultiSelectRow
                            label="兼職與留職停薪情形"
                            value={draft.eligibility.employmentStatus}
                            options={DASHBOARD_EMPLOYMENT_STATUS_OPTIONS}
                            placeholder="請選擇（可複選）"
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        employmentStatus: v,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="留職停薪起日"
                            value={draft.eligibility.unpaidLeaveStartDate ?? ""}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        unpaidLeaveStartDate: v,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="留職停薪迄日"
                            value={draft.eligibility.unpaidLeaveEndDate ?? ""}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        unpaidLeaveEndDate: v,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                          {/* 舊版單選「擔任校內外教學助理」才有月薪，僅在既有資料上顯示。 */}
                          {draft.eligibility.taMonthlyIncome ? (
                            <TextRow
                              label="教學助理月薪"
                              value={draft.eligibility.taMonthlyIncome}
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        eligibility: {
                                          ...d.eligibility,
                                          taMonthlyIncome: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                          ) : null}
                          <TextRow
                            label="兼職工作"
                            value={draft.eligibility.employmentDescription}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        employmentDescription: v,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="兼職平均月薪"
                            value={draft.eligibility.employmentMonthlyIncome}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        employmentMonthlyIncome: v,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                        </>
                      ) : null}
                      {isFullTimeGrant ? (
                        <>
                          {hasAdvisorMatchingFund ? (
                            <TextRow
                              label="會計計畫編號"
                              value={
                                draft.eligibility
                                  .matchingFundAccountingProjectNumber ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        eligibility: {
                                        ...d.eligibility,
                                          matchingFundAccountingProjectNumber:
                                            v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                          ) : null}
                          <SelectRow
                            label="獎助調查"
                            value={draft.eligibility.otherAidStatus ?? ""}
                            options={OTHER_AID_STATUS_OPTIONS}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        otherAidStatus: v,
                                        otherAidOrganization:
                                          v === OTHER_AID_STATUS_NONE
                                            ? ""
                                            : d.eligibility
                                                .otherAidOrganization,
                                        otherAidMonthlyAmount:
                                          v === OTHER_AID_STATUS_NONE
                                            ? ""
                                            : d.eligibility
                                                .otherAidMonthlyAmount,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                          {draft.eligibility.otherAidStatus ===
                          OTHER_AID_STATUS_RECEIVING ? (
                            <>
                              <TextRow
                                label="核發單位"
                                value={
                                  draft.eligibility.otherAidOrganization ?? ""
                                }
                                onChange={(v) =>
                                  setDraft((d) =>
                                    d
                                      ? {
                                          ...d,
                                          eligibility: {
                                            ...d.eligibility,
                                            otherAidOrganization: v,
                                          },
                                        }
                                      : d
                                  )
                                }
                              />
                              <TextRow
                                label="每月支領"
                                value={
                                  draft.eligibility.otherAidMonthlyAmount ?? ""
                                }
                                onChange={(v) =>
                                  setDraft((d) =>
                                    d
                                      ? {
                                          ...d,
                                          eligibility: {
                                            ...d.eligibility,
                                            otherAidMonthlyAmount: v,
                                          },
                                        }
                                      : d
                                  )
                                }
                              />
                            </>
                          ) : null}
                        </>
                      ) : null}
                      {requiresMatchingFundDetails ? (
                        <>
                          <SelectRow
                            label="配合款來源"
                            value={draft.eligibility.matchingFundSource ?? ""}
                            options={MATCHING_FUND_SOURCE_OPTIONS}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        matchingFundSource: v,
                                        matchingFundAccountingProjectNumber:
                                          v === "無"
                                            ? ""
                                            : d.eligibility
                                                .matchingFundAccountingProjectNumber,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="會計計畫編號"
                            value={
                              draft.eligibility
                                .matchingFundAccountingProjectNumber ?? ""
                            }
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      eligibility: {
                                        ...d.eligibility,
                                        matchingFundAccountingProjectNumber: v,
                                      },
                                    }
                                  : d
                              )
                            }
                          />
                        </>
                      ) : null}
                      <TextRow
                        label="補充說明"
                        textarea
                        value={draft.eligibility.eligibilityNotes}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  eligibility: {
                                    ...d.eligibility,
                                    eligibilityNotes: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                    </>
                  ) : (
                    <>
                      {eligibilityDisplayRows.map((row) => (
                        <InfoRow
                          key={row.label}
                          label={row.label}
                          value={row.value}
                        />
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {isFullTimeGrant ? "成績" : "學業表現"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-0">
                  {isEditing && draft ? (
                    isFullTimeGrant ? (
                      <>
                        {draft.applicantInfo.studyStatus === "新生" ||
                        draft.applicantInfo.studyStatus === "新領" ? (
                          <>
                            <InfoRow
                              label="成績類別"
                              value="前一學制畢業總平均"
                            />
                            <TextRow
                              label="總學分數"
                              value={
                                draft.academicPerformance
                                  .fullTimePreviousDegreeCredits ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        academicPerformance: {
                                          ...d.academicPerformance,
                                          fullTimePreviousDegreeCredits: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                            <TextRow
                              label="GPA"
                              value={
                                draft.academicPerformance
                                  .fullTimePreviousDegreeGpa ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        academicPerformance: {
                                          ...d.academicPerformance,
                                          fullTimePreviousDegreeGpa: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                            <TextRow
                              label="系或班排名"
                              value={
                                draft.academicPerformance
                                  .fullTimePreviousDegreeRank ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        academicPerformance: {
                                          ...d.academicPerformance,
                                          fullTimePreviousDegreeRank: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                          </>
                        ) : (
                          <>
                            <InfoRow label="成績類別" value="前一學年成績" />
                            <TextRow
                              label="總學分數"
                              value={
                                draft.academicPerformance
                                  .fullTimePreviousYearCredits ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        academicPerformance: {
                                          ...d.academicPerformance,
                                          fullTimePreviousYearCredits: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                            <TextRow
                              label="GPA"
                              value={
                                draft.academicPerformance
                                  .fullTimePreviousYearGpa ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        academicPerformance: {
                                          ...d.academicPerformance,
                                          fullTimePreviousYearGpa: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                            <TextRow
                              label="系或班排名"
                              value={
                                draft.academicPerformance
                                  .fullTimePreviousYearRank ?? ""
                              }
                              onChange={(v) =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        academicPerformance: {
                                          ...d.academicPerformance,
                                          fullTimePreviousYearRank: v,
                                        },
                                      }
                                    : d
                                )
                              }
                            />
                          </>
                        )}
                      </>
                    ) : (
                      <>
                      <TextRow
                        label="累計 GPA"
                        value={draft.academicPerformance.cumulativeGpa}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    cumulativeGpa: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <SelectRow
                        label="累計 GPA 級距"
                        value={draft.academicPerformance.cumulativeGpaScale}
                        options={GPA_SCALE_OPTIONS}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    cumulativeGpaScale: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="班排名(%)"
                        value={draft.academicPerformance.classRankPercent}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    classRankPercent: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="已修學分"
                        value={draft.academicPerformance.completedCredits}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    completedCredits: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="操行成績"
                        value={draft.academicPerformance.conductScore}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    conductScore: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      <TextRow
                        label="成績備註"
                        textarea
                        value={draft.academicPerformance.transcriptNotes}
                        onChange={(v) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  academicPerformance: {
                                    ...d.academicPerformance,
                                    transcriptNotes: v,
                                  },
                                }
                              : d
                          )
                        }
                      />
                      </>
                    )
                  ) : (
                    <>
                      {academicDisplayRows.map((row) => (
                        <InfoRow
                          key={row.label}
                          label={row.label}
                          value={row.value}
                        />
                      ))}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 2: 學術表現 ── */}
            <TabsContent value="academic" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      期刊發表
                      <Badge variant="secondary">
                        {isEditing && draft
                          ? draft.journals.length
                          : visibleJournals.length}{" "}
                        篇
                      </Badge>
                    </span>
                    {!isEditing && visibleJournals.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs h-7"
                        disabled={verifyingAll}
                        onClick={() => triggerVerify()}
                      >
                        {verifyingAll ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3" />
                        )}
                        全部重新驗證
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing && draft ? (
                    <div className="space-y-3">
                      {draft.journals.map((j, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500">
                              第 {idx + 1} 篇
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6 text-red-500 hover:text-red-600"
                              onClick={() =>
                                setDraft((d) =>
                                  d
                                    ? { ...d, journals: removeAt(d.journals, idx) }
                                    : d
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <TextRow
                            label="題目"
                            value={j.title}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        title: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="期刊名稱"
                            value={j.journal}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        journal: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="作者"
                            value={j.author}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        author: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="作者順位"
                            value={j.authorOrder}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        authorOrder: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="期刊等級"
                            value={j.journalLevel}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        journalLevel: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <MultiSelectRow
                            label="Edition / 資料庫別"
                            value={j.database}
                            options={DATABASE_OPTIONS}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        database: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="DOI"
                            value={j.doi}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        doi: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="日期"
                            value={j.date}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      journals: updateAt(d.journals, idx, {
                                        date: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  journals: [...d.journals, { ...EMPTY_JOURNAL }],
                                }
                              : d
                          )
                        }
                      >
                        <Plus className="size-3.5" />
                        新增期刊
                      </Button>
                    </div>
                  ) : visibleJournals.length === 0 ? (
                    <p className="text-sm text-slate-400">無期刊發表紀錄</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span className="font-medium">欄位顏色說明：</span>
                        <span className="ml-1 font-medium text-emerald-700">
                          綠色＝由 DOI 自動帶入（未修改）
                        </span>
                        <span className="mx-1">、</span>
                        <span className="font-medium text-amber-700">
                          琥珀色＝學生自行填寫或修改自動帶入內容
                        </span>
                        <span className="mt-1 block">
                          審查提示：請特別留意琥珀色欄位是否與佐證資料相符。
                        </span>
                      </div>
                      {visibleJournals.map(({ journal: j, index: idx }) => (
                        <div
                          key={j.doi || idx}
                          className={`rounded-md border p-3 space-y-1.5 ${
                            j.verification?.status === "fail"
                              ? "border-red-300 bg-red-50/30"
                              : j.verification?.status === "pass"
                                ? "border-emerald-200"
                                : "border-slate-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={`text-sm font-medium flex-1 ${journalOriginClass(j, "title")}`}
                            >
                              {j.title}
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <VerificationBadge v={j.verification} />
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="size-6"
                                disabled={verifyingIdx === idx}
                                onClick={() => triggerVerify(idx)}
                                title="重新驗證此篇"
                              >
                                {verifyingIdx === idx ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-3" />
                                )}
                              </Button>
                            </div>
                          </div>
                          <p
                            className={`text-xs ${journalOriginClass(j, "journal")}`}
                          >
                            {j.journal}
                          </p>
                          <p className="text-xs text-slate-500">
                            作者：
                            <span className={journalOriginClass(j, "author")}>
                              {j.author}
                            </span>
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge
                              variant="outline"
                              className={`text-xs ${journalOriginClass(j, "authorOrder")}`}
                            >
                              {j.authorOrder}
                            </Badge>
                            {j.isCorrespondingAuthor && (
                              <Badge variant="outline" className="text-xs">
                                通訊作者
                              </Badge>
                            )}
                            {j.database && (
                              <Badge
                                variant="outline"
                                className={`text-xs ${journalOriginClass(j, "database")}`}
                              >
                                {j.database}
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className={`text-xs ${journalOriginClass(j, "journalLevel")}`}
                            >
                              {j.journalLevel}
                            </Badge>
                            {j.hasTrustedDatabase === "是" && (
                              <Badge
                                variant="outline"
                                className="text-xs text-emerald-600 border-emerald-200"
                              >
                                具公信力資料庫
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">
                            DOI: {j.doi} | 日期:{" "}
                            <span className={journalOriginClass(j, "date")}>
                              {j.date}
                            </span>
                          </p>
                          {j.indexSource && (
                            <p className="text-xs text-slate-400">
                              判別來源：{j.indexSource}
                            </p>
                          )}
                          {j.authorOrderModified && j.authorOrderChangeNote && (
                            <p className="text-xs text-amber-600">
                              作者順位變更：{j.authorOrderChangeNote}
                            </p>
                          )}
                          {j.publicationChangeNotes &&
                            j.publicationChangeNotes.length > 0 && (
                              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                <p className="mb-1 font-semibold">學生修改</p>
                                <div className="space-y-1">
                                  {j.publicationChangeNotes.map((note) => (
                                    <p key={`${note.field}-${note.label}`}>
                                      {note.label}：原為「
                                      {formatPublicationChangeValue(
                                        note.original
                                      )}
                                      」，改為「
                                      {formatPublicationChangeValue(note.current)}
                                      」
                                    </p>
                                  ))}
                                </div>
                              </div>
                            )}
                          {/* ── Verification details ── */}
                          {j.verification && (
                            <VerificationChecks v={j.verification} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    研討會發表
                    <Badge variant="secondary">
                      {isEditing && draft
                        ? draft.conferences.length
                        : visibleConferences.length}{" "}
                      篇
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing && draft ? (
                    <div className="space-y-3">
                      {draft.conferences.map((c, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500">
                              第 {idx + 1} 篇
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6 text-red-500 hover:text-red-600"
                              onClick={() =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        conferences: removeAt(d.conferences, idx),
                                      }
                                    : d
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <TextRow
                            label="題目"
                            value={c.title}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        title: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="研討會"
                            value={c.conference}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        conference: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="主辦單位"
                            value={c.organizer}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        organizer: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="作者"
                            value={c.author}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        author: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="作者順位"
                            value={c.authorOrder}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        authorOrder: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="類型"
                            value={c.type}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        type: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <SelectRow
                            label="資料庫別"
                            value={c.database}
                            options={DATABASE_OPTIONS}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        database: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="日期"
                            value={c.date}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      conferences: updateAt(d.conferences, idx, {
                                        date: v,
                                      }),
                                    }
                                  : d
                              )
                            }
                          />
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  conferences: [
                                    ...d.conferences,
                                    { ...EMPTY_CONFERENCE },
                                  ],
                                }
                              : d
                          )
                        }
                      >
                        <Plus className="size-3.5" />
                        新增研討會
                      </Button>
                    </div>
                  ) : visibleConferences.length === 0 ? (
                    <p className="text-sm text-slate-400">無研討會發表紀錄</p>
                  ) : (
                    <div className="space-y-3">
                      {visibleConferences.map(({ conference: c, index: idx }) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-1.5"
                        >
                          <p className="text-sm font-medium text-slate-900">
                            {c.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {c.conference}
                          </p>
                          <p className="text-xs text-slate-500">
                            主辦單位：{c.organizer} | 作者：{c.author}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="text-xs">
                              {c.authorOrder}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {c.type}
                            </Badge>
                            {c.database && (
                              <Badge className="text-xs">{c.database}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">
                            日期: {c.date}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 3: 研究經歷 ── */}
            <TabsContent value="research" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">相關研究參與</CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing && draft ? (
                    <div className="space-y-3">
                      {draft.researchExperiences.map((r, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500">
                              第 {idx + 1} 筆
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6 text-red-500 hover:text-red-600"
                              onClick={() =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        researchExperiences: removeAt(
                                          d.researchExperiences,
                                          idx
                                        ),
                                      }
                                    : d
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <TextRow
                            label="機構/主持人"
                            value={r.institution}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchExperiences: updateAt(
                                        d.researchExperiences,
                                        idx,
                                        { institution: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="職稱"
                            value={r.role}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchExperiences: updateAt(
                                        d.researchExperiences,
                                        idx,
                                        { role: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="性質"
                            value={r.nature}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchExperiences: updateAt(
                                        d.researchExperiences,
                                        idx,
                                        { nature: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="期間"
                            value={r.duration}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchExperiences: updateAt(
                                        d.researchExperiences,
                                        idx,
                                        { duration: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  researchExperiences: [
                                    ...d.researchExperiences,
                                    { ...EMPTY_RESEARCH_EXPERIENCE },
                                  ],
                                }
                              : d
                          )
                        }
                      >
                        <Plus className="size-3.5" />
                        新增研究參與
                      </Button>
                    </div>
                  ) : researchExperiences.length === 0 ? (
                    <p className="text-sm text-slate-400">無研究參與紀錄</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>機構/主持人</TableHead>
                          <TableHead>職稱</TableHead>
                          <TableHead>性質</TableHead>
                          <TableHead>期間</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {researchExperiences.map((r, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs max-w-[180px] whitespace-normal">
                              {r.institution}
                            </TableCell>
                            <TableCell className="text-xs">{r.role}</TableCell>
                            <TableCell className="text-xs">{r.nature}</TableCell>
                            <TableCell className="text-xs">
                              {r.duration}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">研究獲獎/獎助</CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing && draft ? (
                    <div className="space-y-3">
                      {draft.researchAwards.map((a, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500">
                              第 {idx + 1} 筆
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6 text-red-500 hover:text-red-600"
                              onClick={() =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        researchAwards: removeAt(
                                          d.researchAwards,
                                          idx
                                        ),
                                      }
                                    : d
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <TextRow
                            label="名稱"
                            value={a.name}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchAwards: updateAt(
                                        d.researchAwards,
                                        idx,
                                        { name: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="編號"
                            value={a.projectNumber}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchAwards: updateAt(
                                        d.researchAwards,
                                        idx,
                                        { projectNumber: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="金額/項目"
                            value={a.amountOrItem}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchAwards: updateAt(
                                        d.researchAwards,
                                        idx,
                                        { amountOrItem: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="貢獻"
                            value={a.contribution}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      researchAwards: updateAt(
                                        d.researchAwards,
                                        idx,
                                        { contribution: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  researchAwards: [
                                    ...d.researchAwards,
                                    { ...EMPTY_RESEARCH_AWARD },
                                  ],
                                }
                              : d
                          )
                        }
                      >
                        <Plus className="size-3.5" />
                        新增獲獎
                      </Button>
                    </div>
                  ) : researchAwards.length === 0 ? (
                    <p className="text-sm text-slate-400">無獲獎紀錄</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>名稱</TableHead>
                          <TableHead>編號</TableHead>
                          <TableHead>金額/項目</TableHead>
                          <TableHead>貢獻</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {researchAwards.map((a, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs max-w-[200px] whitespace-normal">
                              {a.name}
                            </TableCell>
                            <TableCell className="text-xs">
                              {a.projectNumber || "—"}
                            </TableCell>
                            <TableCell className="text-xs">
                              {a.amountOrItem}
                            </TableCell>
                            <TableCell className="text-xs">
                              {a.contribution}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Tab 4: 計畫與其他 ── */}
            <TabsContent value="plan" className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    獲獎當學年預計研究議題
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing && draft ? (
                    <div className="space-y-3">
                      {draft.plannedResearch.map((p, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-slate-500">
                              第 {idx + 1} 筆
                            </span>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6 text-red-500 hover:text-red-600"
                              onClick={() =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        plannedResearch: removeAt(
                                          d.plannedResearch,
                                          idx
                                        ),
                                      }
                                    : d
                                )
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                          <TextRow
                            label="議題"
                            value={p.title}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      plannedResearch: updateAt(
                                        d.plannedResearch,
                                        idx,
                                        { title: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="預計投稿"
                            value={p.targetVenue}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      plannedResearch: updateAt(
                                        d.plannedResearch,
                                        idx,
                                        { targetVenue: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="預計時間"
                            value={p.expectedDate}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      plannedResearch: updateAt(
                                        d.plannedResearch,
                                        idx,
                                        { expectedDate: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <TextRow
                            label="指導教授"
                            value={p.advisor}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      plannedResearch: updateAt(
                                        d.plannedResearch,
                                        idx,
                                        { advisor: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                          <SelectRow
                            label="資料庫別"
                            value={p.database}
                            options={DATABASE_OPTIONS}
                            onChange={(v) =>
                              setDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      plannedResearch: updateAt(
                                        d.plannedResearch,
                                        idx,
                                        { database: v }
                                      ),
                                    }
                                  : d
                              )
                            }
                          />
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-xs"
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  plannedResearch: [
                                    ...d.plannedResearch,
                                    { ...EMPTY_PLANNED_RESEARCH },
                                  ],
                                }
                              : d
                          )
                        }
                      >
                        <Plus className="size-3.5" />
                        新增預計研究
                      </Button>
                    </div>
                  ) : plannedResearch.length === 0 ? (
                    <p className="text-sm text-slate-400">無預計研究議題</p>
                  ) : (
                    <div className="space-y-3">
                      {plannedResearch.map((p, idx) => (
                        <div
                          key={idx}
                          className="rounded-md border border-slate-200 p-3 space-y-1"
                        >
                          <p className="text-sm font-medium">{p.title}</p>
                          <p className="text-xs text-slate-500">
                            預計投稿：{p.targetVenue}
                          </p>
                          <p className="text-xs text-slate-500">
                            預計時間：{p.expectedDate} | 指導教授：{p.advisor}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {p.hasTrustedDatabase === "是" && (
                              <Badge
                                variant="outline"
                                className="text-xs text-emerald-600 border-emerald-200"
                              >
                                具公信力資料庫
                              </Badge>
                            )}
                            {p.database && (
                              <Badge variant="outline" className="text-xs">
                                {p.database}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">其他優秀事蹟</CardTitle>
                </CardHeader>
                <CardContent>
                  {isEditing && draft ? (
                    <Textarea
                      value={draft.otherAchievements}
                      onChange={(e) =>
                        setDraft((d) =>
                          d ? { ...d, otherAchievements: e.target.value } : d
                        )
                      }
                      className="min-h-24"
                    />
                  ) : payload.otherAchievements ? (
                    <p className="text-sm text-slate-700">
                      {payload.otherAchievements}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400">無</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">上傳檔案</CardTitle>
                </CardHeader>
                <CardContent>
                  {files.length === 0 ? (
                    <p className="text-sm text-slate-400">無上傳檔案</p>
                  ) : (
                    <div className="space-y-2">
                      {files.map((f, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded-md border border-slate-100 px-3 py-2"
                        >
                          <FileText className="size-4 text-slate-400 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-700 truncate">
                              {f.name}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {(f.size / 1024).toFixed(0)} KB
                            </p>
                          </div>
                          <a
                            href={`/api/dashboard/download?path=${encodeURIComponent(f.path)}&name=${encodeURIComponent(f.name)}`}
                            download
                            className="shrink-0"
                          >
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-slate-400 hover:text-emerald-600"
                            >
                              <Download className="size-4" />
                            </Button>
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

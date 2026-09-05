"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  CircleDot,
  Clock,
  Download,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { DashboardRole, ReviewStatus, ScholarshipApplication } from "@/lib/types";
import type { DashboardActionPermissions } from "@/lib/dashboard-permissions";
import { REVIEW_STATUS_LABELS } from "@/lib/types";
import {
  formatSubmittedAt,
  getDashboardGpaSummary,
} from "@/lib/dashboard-application-display";
import { useDashboardReviewState } from "./dashboard-review-state";
import {
  getNonEmptyConferences,
  getNonEmptyJournals,
} from "@/lib/publication-records";
import { ApplicationDetail } from "./application-detail";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SortColumn =
  | "rowNumber"
  | "reviewSortOrder"
  | "department"
  | "studentId"
  | "name"
  | "submittedAt"
  | "gpa"
  | "journalCount"
  | "levelOneJournalCount"
  | "conferenceCount";

type SortDirection = "asc" | "desc";

type StudyStatusGroup = "new" | "renewal";

// Study-status values differ per program (新領/新生 for new, 續領/舊生 for
// renewal); group them so one filter covers every scholarship.
const NEW_STUDY_STATUSES = new Set(["新領", "新生"]);
const RENEWAL_STUDY_STATUSES = new Set(["續領", "舊生"]);

function classifyStudyStatus(status: string): StudyStatusGroup | null {
  if (NEW_STUDY_STATUSES.has(status)) return "new";
  if (RENEWAL_STUDY_STATUSES.has(status)) return "renewal";
  return null;
}

type DashboardRow = {
  rowNumber: number;
  application: ScholarshipApplication;
  reviewSortOrder: number;
  department: string;
  studentId: string;
  name: string;
  submittedAt: string | null;
  submittedAtTime: number | null;
  gpa: number | null;
  completedCredits: string;
  journalCount: number;
  levelOneJournalCount: number;
  conferenceCount: number;
  studyStatus: string;
};

/* ------------------------------------------------------------------ */
/*  Row builder                                                        */
/* ------------------------------------------------------------------ */

function toRows(apps: ScholarshipApplication[]): DashboardRow[] {
  return apps.map((app, idx) => {
    const gpaSummary = getDashboardGpaSummary(app);
    const journals = getNonEmptyJournals(app.payload.journals);
    const conferences = getNonEmptyConferences(app.payload.conferences);
    const submittedAtTime = app.submitted_at
      ? new Date(app.submitted_at).getTime()
      : null;
    return {
      rowNumber: idx + 1,
      application: app,
      reviewSortOrder: app.review_sort_order ?? 0,
      department: app.department,
      studentId: app.student_id,
      name: app.applicant_name,
      submittedAt: app.submitted_at,
      submittedAtTime:
        submittedAtTime !== null && Number.isFinite(submittedAtTime)
          ? submittedAtTime
          : null,
      gpa: gpaSummary.gpa,
      completedCredits: gpaSummary.completedCredits,
      journalCount: journals.length,
      levelOneJournalCount: journals.filter((j) => j.journalLevel === "I級期刊")
        .length,
      conferenceCount: conferences.length,
      studyStatus: app.payload.applicantInfo?.studyStatus ?? "",
    };
  });
}

function comparePrimitive(
  a: string | number | null,
  b: string | number | null,
  dir: SortDirection,
): number {
  const factor = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return factor;
  if (b == null) return -factor;
  if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
  return String(a).localeCompare(String(b), "zh-Hant") * factor;
}

function compareReviewSortOrder(
  a: number,
  b: number,
  dir: SortDirection,
): number {
  const aUnspecified = a === 0;
  const bUnspecified = b === 0;
  if (aUnspecified && bUnspecified) return 0;
  if (aUnspecified) return 1;
  if (bUnspecified) return -1;
  return comparePrimitive(a, b, dir);
}

function escapeExcelCell(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadExcelFile({
  fileName,
  rows,
}: {
  fileName: string;
  rows: (string | number | null | undefined)[][];
}) {
  const tableHtml = rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="mso-number-format:'\\@';">${escapeExcelCell(cell)}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${tableHtml}</table></body></html>`;
  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatFileDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}`;
}

/* ------------------------------------------------------------------ */
/*  Review status config                                               */
/* ------------------------------------------------------------------ */

const ALL_REVIEW_STATUSES: ReviewStatus[] = [
  "未審核",
  "系所審核通過",
  "院辦審核通過",
];

const REVIEW_STATUS_CONFIG: Record<
  ReviewStatus,
  { icon: typeof CheckCircle2; className: string }
> = {
  "未審核": {
    icon: Clock,
    className: "bg-slate-50 text-slate-700 border-slate-200",
  },
  "系所審核通過": {
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  "院辦審核通過": {
    icon: CircleDot,
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
};

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const config = REVIEW_STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${config.className}`}
    >
      <Icon className="size-3" />
      {REVIEW_STATUS_LABELS[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Review status dropdown                                             */
/* ------------------------------------------------------------------ */

function ReviewStatusSelect({
  status,
  onStatusChange,
}: {
  status: ReviewStatus;
  onStatusChange: (s: ReviewStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ReviewStatusBadge status={status} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-white min-w-[180px]">
        {ALL_REVIEW_STATUSES.map((s) => {
          const config = REVIEW_STATUS_CONFIG[s];
          const Icon = config.icon;
          return (
            <DropdownMenuItem
              key={s}
              className={`text-xs gap-2 cursor-pointer ${s === status ? "font-semibold" : ""}`}
              onClick={() => onStatusChange(s)}
            >
              <Icon className={`size-3.5 ${s === status ? "opacity-100" : "opacity-50"}`} />
              {REVIEW_STATUS_LABELS[s]}
              {s === status && (
                <span className="ml-auto text-emerald-600">✓</span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/*  Sort icon                                                          */
/* ------------------------------------------------------------------ */

function SortIcon({
  column,
  current,
  direction,
}: {
  column: SortColumn;
  current: SortColumn;
  direction: SortDirection;
}) {
  if (column !== current)
    return <ArrowUpDown className="ml-1 inline-block size-3.5 opacity-40" />;
  return direction === "asc" ? (
    <ArrowUp className="ml-1 inline-block size-3.5" />
  ) : (
    <ArrowDown className="ml-1 inline-block size-3.5" />
  );
}

/* ------------------------------------------------------------------ */
/*  Editable remark cell                                               */
/* ------------------------------------------------------------------ */

function SortOrderCell({
  appId,
  value,
  onChange,
}: {
  appId: string;
  value: number;
  onChange: (id: string, val: number, previous: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = useCallback(() => {
    const parsed = Number(draft);
    const next = Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    setDraft(String(next));
    if (next !== value) onChange(appId, next, value);
  }, [appId, draft, value, onChange]);

  return (
    <input
      type="number"
      min={0}
      step={1}
      inputMode="numeric"
      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-center text-xs font-medium text-slate-700 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
      value={draft}
      aria-label="排序"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function RemarkCell({
  appId,
  value,
  onChange,
}: {
  appId: string;
  value: string;
  onChange: (id: string, val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Set when the user presses Escape so the pending blur/commit is discarded.
  const cancelRef = useRef(false);

  useEffect(() => {
    if (editing) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [editing]);

  // The textarea stays uncontrolled while editing and we read its value on
  // commit. This avoids per-keystroke re-renders that clobber IME composition
  // (e.g. Chinese input dropping to only the trailing ASCII characters).
  const commit = useCallback(() => {
    setEditing(false);
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    const next = textareaRef.current?.value ?? value;
    if (next !== value) onChange(appId, next);
  }, [appId, value, onChange]);

  if (!editing) {
    return (
      <button
        type="button"
        className="w-full text-left text-xs text-slate-500 hover:text-slate-800 transition-colors min-h-[24px] rounded px-1 -mx-1 hover:bg-slate-50 whitespace-pre-wrap break-words"
        onClick={() => {
          cancelRef.current = false;
          setEditing(true);
        }}
        title="點擊編輯備註"
      >
        {value || <span className="text-slate-300 italic">點擊新增備註</span>}
      </button>
    );
  }

  return (
    <Textarea
      ref={textareaRef}
      className="text-xs min-w-[120px] min-h-[32px] p-1.5 resize-none"
      defaultValue={value}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancelRef.current = true;
          setEditing(false);
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Study-status filter chip                                           */
/* ------------------------------------------------------------------ */

function StudyStatusFilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-[#1f6f78] bg-[#1f6f78] text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span
        className={`flex size-3.5 items-center justify-center rounded-[3px] border ${
          active ? "border-white bg-white/20" : "border-slate-300"
        }`}
      >
        {active && <Check className="size-2.5" />}
      </span>
      {label}
      <span
        className={`rounded px-1 text-[10px] ${
          active ? "bg-white/20" : "bg-slate-100 text-slate-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DashboardTable({
  applications,
  permissions,
  role,
}: {
  applications: ScholarshipApplication[];
  permissions: DashboardActionPermissions;
  role: DashboardRole;
}) {
  const [sortColumn, setSortColumn] =
    useState<SortColumn>("reviewSortOrder");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedApp, setSelectedApp] =
    useState<ScholarshipApplication | null>(null);

  // Shared across every DashboardTable instance so switching tabs (which
  // unmounts the inactive table) never rolls edits back to the page-load props.
  const {
    appOverrides,
    deletedIds,
    remarks,
    reviewStatuses,
    sortOrders,
    handleRemarkChange,
    handleReviewStatusChange,
    handleSortOrderChange,
    markDeleted,
    applyUpdatedApplication,
  } = useDashboardReviewState();

  const effectiveApplications = useMemo(
    () =>
      applications
        .map((a) => appOverrides[a.id] ?? a)
        .filter(
          (a) => a.submission_status === "submitted" && !deletedIds.has(a.id),
        ),
    [applications, appOverrides, deletedIds],
  );

  const rows = useMemo(
    () => toRows(effectiveApplications),
    [effectiveApplications],
  );

  // Study-status (請領別) filter: empty set means "show all".
  const [studyStatusFilter, setStudyStatusFilter] = useState<
    Set<StudyStatusGroup>
  >(() => new Set());

  const studyStatusCounts = useMemo(() => {
    let newCount = 0;
    let renewalCount = 0;
    for (const row of rows) {
      const group = classifyStudyStatus(row.studyStatus);
      if (group === "new") newCount += 1;
      else if (group === "renewal") renewalCount += 1;
    }
    return { new: newCount, renewal: renewalCount };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (studyStatusFilter.size === 0) return rows;
    return rows.filter((row) => {
      const group = classifyStudyStatus(row.studyStatus);
      return group !== null && studyStatusFilter.has(group);
    });
  }, [rows, studyStatusFilter]);

  const toggleStudyStatusFilter = useCallback((group: StudyStatusGroup) => {
    setStudyStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      switch (sortColumn) {
        case "rowNumber":
          return comparePrimitive(a.rowNumber, b.rowNumber, sortDirection);
        case "reviewSortOrder": {
          const orderResult = compareReviewSortOrder(
            sortOrders[a.application.id] ?? a.reviewSortOrder,
            sortOrders[b.application.id] ?? b.reviewSortOrder,
            sortDirection,
          );
          return orderResult || comparePrimitive(a.rowNumber, b.rowNumber, "asc");
        }
        case "department":
          return comparePrimitive(a.department, b.department, sortDirection);
        case "studentId":
          return comparePrimitive(a.studentId, b.studentId, sortDirection);
        case "name":
          return comparePrimitive(a.name, b.name, sortDirection);
        case "submittedAt":
          return comparePrimitive(
            a.submittedAtTime,
            b.submittedAtTime,
            sortDirection,
          );
        case "gpa":
          return comparePrimitive(a.gpa, b.gpa, sortDirection);
        case "journalCount":
          return comparePrimitive(
            a.journalCount,
            b.journalCount,
            sortDirection,
          );
        case "levelOneJournalCount":
          return comparePrimitive(
            a.levelOneJournalCount,
            b.levelOneJournalCount,
            sortDirection,
          );
        case "conferenceCount":
          return comparePrimitive(
            a.conferenceCount,
            b.conferenceCount,
            sortDirection,
          );
        default:
          return 0;
      }
    });
  }, [filteredRows, sortColumn, sortDirection, sortOrders]);

  function handleSort(col: SortColumn) {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  }

  const handleExportExcel = useCallback(() => {
    if (sortedRows.length === 0) {
      toast.info("目前沒有可匯出的申請案。");
      return;
    }

    const header = [
      "編號",
      "排序",
      "備註",
      "系所",
      "學號",
      "姓名",
      "最新送出時間",
      "累計GPA",
      "學分數",
      "期刊（累計）",
      "I級期刊",
      "研討會（累計）",
      "文獻真實性審核",
    ];
    const dataRows = sortedRows.map((row) => {
      const appId = row.application.id;
      const effectiveStatus =
        reviewStatuses[appId] ?? row.application.review_status;

      return [
        row.rowNumber,
        sortOrders[appId] ?? row.reviewSortOrder,
        remarks[appId] ?? row.application.reviewer_remarks ?? "",
        row.department,
        row.studentId,
        row.name,
        formatSubmittedAt(row.submittedAt),
        row.gpa != null ? row.gpa.toFixed(2) : "",
        row.completedCredits,
        row.journalCount,
        row.levelOneJournalCount,
        row.conferenceCount,
        REVIEW_STATUS_LABELS[effectiveStatus],
      ];
    });

    downloadExcelFile({
      fileName: `獎學金申請案列表_${formatFileDate()}.xls`,
      rows: [header, ...dataRows],
    });
    toast.success(`已匯出 ${dataRows.length} 件申請案。`);
  }, [remarks, reviewStatuses, sortOrders, sortedRows]);

  const thClass =
    "cursor-pointer select-none hover:bg-slate-100 transition-colors";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">
            篩選請領別：
          </span>
          <StudyStatusFilterChip
            label="新領"
            count={studyStatusCounts.new}
            active={studyStatusFilter.has("new")}
            onClick={() => toggleStudyStatusFilter("new")}
          />
          <StudyStatusFilterChip
            label="續領"
            count={studyStatusCounts.renewal}
            active={studyStatusFilter.has("renewal")}
            onClick={() => toggleStudyStatusFilter("renewal")}
          />
          {studyStatusFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setStudyStatusFilter(new Set())}
              className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600"
            >
              清除篩選
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={handleExportExcel}
        >
          <Download className="size-3.5" />
          匯出 Excel
        </Button>
      </div>
      <div className="w-full max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <Table className="w-full table-fixed text-xs [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal">
          <colgroup>
            <col className="w-[4%]" />
            <col className="w-[6%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[8%]" />
            <col className="w-[13%]" />
            <col className="w-[10%]" />
            <col className="w-[9%]" />
            <col className="w-[6%]" />
            <col className="w-[5%]" />
            <col className="w-[7%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
          </colgroup>
          <TableHeader>
            {/* ── Row 1: grouped header ── */}
            <TableRow className="bg-slate-50">
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("rowNumber")}
              >
                編號
                <SortIcon
                  column="rowNumber"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("reviewSortOrder")}
              >
                排序
                <SortIcon
                  column="reviewSortOrder"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead rowSpan={2}>備註</TableHead>
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("department")}
              >
                系所
                <SortIcon
                  column="department"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("studentId")}
              >
                學號
                <SortIcon
                  column="studentId"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("name")}
              >
                姓名
                <SortIcon
                  column="name"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("submittedAt")}
              >
                最新送出時間
                <SortIcon
                  column="submittedAt"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                rowSpan={2}
                className={thClass}
                onClick={() => handleSort("gpa")}
              >
                累計GPA（學分數）
                <SortIcon
                  column="gpa"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead colSpan={3} className="text-center border-b-0">
                <div>學術表現</div>
                <div className="text-[10px] font-normal text-slate-400 mt-0.5">
                  新生統計五年內、非新生過去一年內
                </div>
              </TableHead>
              <TableHead rowSpan={2}>文獻真實性審核</TableHead>
              <TableHead rowSpan={2}>審查資料</TableHead>
            </TableRow>

            {/* ── Row 2: sub-headers for 學術表現 ── */}
            <TableRow className="bg-slate-50">
              <TableHead
                className={thClass}
                onClick={() => handleSort("journalCount")}
              >
                期刊（累計）
                <SortIcon
                  column="journalCount"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                className={thClass}
                onClick={() => handleSort("levelOneJournalCount")}
              >
                I級期刊
                <SortIcon
                  column="levelOneJournalCount"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
              <TableHead
                className={thClass}
                onClick={() => handleSort("conferenceCount")}
              >
                研討會（累計）
                <SortIcon
                  column="conferenceCount"
                  current={sortColumn}
                  direction={sortDirection}
                />
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={13}
                  className="h-28 text-center text-sm text-slate-500"
                >
                  目前沒有此獎學金項目的已送出申請案。
                </TableCell>
              </TableRow>
            ) : null}
            {sortedRows.map((row) => {
              const appId = row.application.id;
              const effectiveStatus =
                reviewStatuses[appId] ?? row.application.review_status;

              return (
                <TableRow key={appId}>
                  <TableCell className="text-center font-medium">
                    {row.rowNumber}
                  </TableCell>
                  <TableCell className="text-center">
                    <SortOrderCell
                      appId={appId}
                      value={sortOrders[appId] ?? row.reviewSortOrder}
                      onChange={handleSortOrderChange}
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal min-w-[100px] max-w-[180px]">
                    <RemarkCell
                      appId={appId}
                      value={
                        remarks[appId] ??
                        row.application.reviewer_remarks ??
                        ""
                      }
                      onChange={handleRemarkChange}
                    />
                  </TableCell>
                  <TableCell>{row.department}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.studentId}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-emerald-700 underline underline-offset-2 decoration-emerald-300 hover:text-emerald-900 hover:decoration-emerald-600 transition-colors font-medium"
                      onClick={() => setSelectedApp(row.application)}
                    >
                      {row.name}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-slate-600">
                    {formatSubmittedAt(row.submittedAt)}
                  </TableCell>
                  <TableCell>
                    {row.gpa != null ? (
                      <>
                        {row.gpa.toFixed(2)}
                        <span className="text-slate-400 ml-0.5 text-xs">
                          （{row.completedCredits}）
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={row.journalCount > 0 ? "default" : "secondary"}
                    >
                      {row.journalCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        row.levelOneJournalCount > 0 ? "default" : "secondary"
                      }
                    >
                      {row.levelOneJournalCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        row.conferenceCount > 0 ? "default" : "secondary"
                      }
                    >
                      {row.conferenceCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {permissions.changeReviewStatus ? (
                      <ReviewStatusSelect
                        status={effectiveStatus}
                        onStatusChange={(s) =>
                          handleReviewStatusChange(appId, s, effectiveStatus)
                        }
                      />
                    ) : (
                      <ReviewStatusBadge status={effectiveStatus} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1"
                      onClick={() => setSelectedApp(row.application)}
                    >
                      <FileText className="size-3.5" />
                      附件
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ApplicationDetail
        application={
          selectedApp ? (appOverrides[selectedApp.id] ?? selectedApp) : null
        }
        open={selectedApp !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedApp(null);
        }}
        onUpdated={applyUpdatedApplication}
        permissions={permissions}
        role={role}
        onDeleted={(id) => {
          markDeleted(id);
          setSelectedApp(null);
        }}
      />
    </>
  );
}

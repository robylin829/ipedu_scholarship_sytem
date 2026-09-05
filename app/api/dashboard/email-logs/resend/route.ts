import { after, NextResponse } from "next/server";
import { canAccessDepartment, checkDashboardAccess } from "@/lib/auth";
import {
  sendDepartmentResubmissionEmail,
  sendScholarshipConfirmationEmail,
  sendScholarshipCorrectionEmail,
} from "@/lib/email/resend";
import {
  getMetadataString,
  getMetadataStringArray,
  normalizeEmailLogMetadata,
  sendAndLogScholarshipEmail,
} from "@/lib/email/scholarship-email-logs";
import type {
  ScholarshipEmailLog,
  ScholarshipPayload,
} from "@/lib/types";
import { isValidUUID } from "@/lib/validation";

type ResendEmailRequest = {
  logId?: string;
};

type ScholarshipApplicationRecord = {
  id: string;
  applicant_name: string | null;
  department: string | null;
  email: string | null;
  payload: ScholarshipPayload;
  scholarship_program: string | null;
  student_id: string | null;
  submitted_at: string | null;
};

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("尚未設定 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY。");
  }

  return {
    serviceRoleKey,
    url: url.replace(/\/$/, ""),
  };
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function getDashboardUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const origin = configured || new URL(request.url).origin;

  if (!/^https:\/\//i.test(origin) && process.env.NODE_ENV === "production") {
    return null;
  }

  return `${origin}/dashboard`;
}

function splitRecipientEmail(value: string) {
  return value
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}

async function fetchEmailLog({
  logId,
  serviceRoleKey,
  url,
}: {
  logId: string;
  serviceRoleKey: string;
  url: string;
}) {
  const query = new URLSearchParams({
    id: `eq.${logId}`,
    limit: "1",
    select:
      "id,application_id,recipient_email,email_type,sent_at,resend_message_id,status,failure_reason,metadata",
  });

  const response = await fetch(`${url}/rest/v1/scholarship_email_logs?${query}`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("查詢寄送紀錄失敗。");
  }

  const [log] = (await response.json()) as ScholarshipEmailLog[];
  return log ?? null;
}

async function fetchApplication({
  applicationId,
  serviceRoleKey,
  url,
}: {
  applicationId: string;
  serviceRoleKey: string;
  url: string;
}) {
  const query = new URLSearchParams({
    id: `eq.${applicationId}`,
    limit: "1",
    select:
      "id,applicant_name,department,email,payload,scholarship_program,student_id,submitted_at",
  });

  const response = await fetch(
    `${url}/rest/v1/scholarship_applications?${query}`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("查詢申請案失敗。");
  }

  const [application] = (await response.json()) as ScholarshipApplicationRecord[];
  return application ?? null;
}

async function resendEmailLog({
  application,
  dashboardUrl,
  log,
  serviceRoleKey,
  url,
}: {
  application: ScholarshipApplicationRecord;
  dashboardUrl: string | null;
  log: ScholarshipEmailLog;
  serviceRoleKey: string;
  url: string;
}) {
  const applicantName =
    application.applicant_name ||
    application.payload.applicantInfo?.applicantName ||
    "";
  const department =
    application.department || application.payload.applicantInfo?.department || "";
  const scholarshipProgram = application.scholarship_program || "獎學金申請";
  const metadata = normalizeEmailLogMetadata(log.metadata);
  const retryMetadata = {
    ...metadata,
    retry_of: log.id,
    retry_requested_at: new Date().toISOString(),
  };

  if (log.email_type === "student_submission_confirmation") {
    const recipientEmail =
      log.recipient_email || application.email || application.payload.applicantInfo?.email || "";
    await sendAndLogScholarshipEmail({
      applicationId: application.id,
      emailType: log.email_type,
      metadata: retryMetadata,
      recipientEmail,
      serviceRoleKey,
      url,
      send: () =>
        sendScholarshipConfirmationEmail({
          applicationId: application.id,
          applicantName,
          department,
          recipientEmail,
          scholarshipProgram,
          submittedAt: application.submitted_at,
        }),
    });
    return;
  }

  if (log.email_type === "student_correction_notice") {
    const recipientEmail =
      log.recipient_email || application.email || application.payload.applicantInfo?.email || "";
    const message =
      getMetadataString(metadata.message) ||
      "請依系所通知補正申請資料。";
    await sendAndLogScholarshipEmail({
      applicationId: application.id,
      emailType: log.email_type,
      metadata: retryMetadata,
      recipientEmail,
      serviceRoleKey,
      url,
      send: () =>
        sendScholarshipCorrectionEmail({
          applicationId: application.id,
          applicantName,
          department,
          message,
          recipientEmail,
          scholarshipProgram,
        }),
    });
    return;
  }

  const recipientEmails =
    getMetadataStringArray(metadata.recipient_emails).length > 0
      ? getMetadataStringArray(metadata.recipient_emails)
      : splitRecipientEmail(log.recipient_email);
  await sendAndLogScholarshipEmail({
    applicationId: application.id,
    emailType: log.email_type,
    metadata: retryMetadata,
    recipientEmail: recipientEmails.join(", "),
    serviceRoleKey,
    url,
    send: () =>
      sendDepartmentResubmissionEmail({
        applicantName,
        applicationId: application.id,
        dashboardUrl: getMetadataString(metadata.dashboard_url) || dashboardUrl,
        department,
        idempotencySuffix: `retry-${log.id}-${Date.now()}`,
        isCorrectionResubmission:
          metadata.is_correction_resubmission === true,
        recipientEmails,
        scholarshipProgram,
        studentId:
          application.student_id ||
          application.payload.applicantInfo?.studentId ||
          null,
        submittedAt: application.submitted_at,
      }),
  });
}

export async function POST(request: Request) {
  try {
    const auth = await checkDashboardAccess();
    if (!auth.authorized) {
      return jsonError(
        auth.reason === "not_authenticated" ? "請先登入。" : "無權限存取。",
        auth.reason === "not_authenticated" ? 401 : 403
      );
    }

    if (auth.role !== "admin") {
      return jsonError("只有管理員可以重寄通知信。", 403);
    }

    const body = (await request.json().catch(() => ({}))) as ResendEmailRequest;
    const logId = body.logId?.trim();

    if (!logId) {
      return jsonError("缺少 logId。");
    }

    if (!isValidUUID(logId)) {
      return jsonError("logId 格式不合法。");
    }

    const { serviceRoleKey, url } = getSupabaseConfig();
    const log = await fetchEmailLog({ logId, serviceRoleKey, url });
    if (!log) {
      return jsonError("找不到寄送紀錄。", 404);
    }

    const application = await fetchApplication({
      applicationId: log.application_id,
      serviceRoleKey,
      url,
    });
    if (!application) {
      return jsonError("找不到該申請案。", 404);
    }

    if (!canAccessDepartment(auth.departmentScope, application.department)) {
      return jsonError("無權限重寄此系所申請案通知。", 403);
    }

    const dashboardUrl = getDashboardUrl(request);
    after(() =>
      resendEmailLog({
        application,
        dashboardUrl,
        log,
        serviceRoleKey,
        url,
      }).catch((error) => {
        console.error("Dashboard email resend failed:", error);
      })
    );

    return NextResponse.json({ emailQueued: true, success: true });
  } catch (error) {
    console.error("Dashboard email resend error:", error);
    return jsonError("伺服器處理時發生錯誤。", 500);
  }
}

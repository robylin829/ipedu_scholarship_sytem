import { after, NextResponse } from "next/server";
import {
  canAccessDepartment,
  checkDashboardAccess,
} from "@/lib/auth";
import { getDashboardRolePermissions } from "@/lib/dashboard-permissions";
import { sendScholarshipCorrectionEmail } from "@/lib/email/resend";
import { sendAndLogScholarshipEmail } from "@/lib/email/scholarship-email-logs";
import { patchScholarshipApplication } from "@/lib/supabase/patch-application";
import type { ScholarshipPayload } from "@/lib/types";
import { isValidEmail, isValidUUID } from "@/lib/validation";

const MAX_MESSAGE_LENGTH = 2000;

type CorrectionEmailRequest = {
  applicationId?: string;
  message?: string;
};

type ScholarshipApplicationRecord = {
  id: string;
  applicant_name: string | null;
  department: string | null;
  email: string | null;
  payload: ScholarshipPayload;
  scholarship_program: string | null;
  submission_status: string;
};

type CorrectionRecord = {
  id: string;
  application_id: string;
  correction_number: number;
  message: string;
  notified_by: string | null;
  notifier_role: "teacher" | "admin";
  created_at: string;
};

type CorrectionEmailJob = {
  applicationId: string;
  applicantName: string;
  correctionRecordId: string;
  department: string;
  message: string;
  recipientEmail: string;
  serviceRoleKey: string;
  scholarshipProgram: string;
  url: string;
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

function getRecipientEmail(application: ScholarshipApplicationRecord) {
  return (
    application.email?.trim() ||
    application.payload.applicantInfo?.email?.trim() ||
    ""
  );
}

async function sendCorrectionNotice(job: CorrectionEmailJob) {
  try {
    await sendAndLogScholarshipEmail({
      applicationId: job.applicationId,
      emailType: "student_correction_notice",
      metadata: {
        correction_record_id: job.correctionRecordId,
        message: job.message,
      },
      recipientEmail: job.recipientEmail,
      serviceRoleKey: job.serviceRoleKey,
      url: job.url,
      send: () => sendScholarshipCorrectionEmail(job),
    });
  } catch (error) {
    console.error("Scholarship correction email failed:", error);
  }
}

async function getNextCorrectionNumber({
  applicationId,
  serviceRoleKey,
  url,
}: {
  applicationId: string;
  serviceRoleKey: string;
  url: string;
}) {
  const query = new URLSearchParams({
    application_id: `eq.${applicationId}`,
    limit: "1",
    order: "correction_number.desc",
    select: "correction_number",
  });

  const response = await fetch(
    `${url}/rest/v1/scholarship_correction_records?${query}`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("查詢補正紀錄失敗。");
  }

  const [latest] = (await response.json()) as {
    correction_number: number;
  }[];
  return (latest?.correction_number ?? 0) + 1;
}

async function createCorrectionRecord({
  applicationId,
  auth,
  message,
  serviceRoleKey,
  url,
}: {
  applicationId: string;
  auth: Extract<Awaited<ReturnType<typeof checkDashboardAccess>>, { authorized: true }>;
  message: string;
  serviceRoleKey: string;
  url: string;
}) {
  const correctionNumber = await getNextCorrectionNumber({
    applicationId,
    serviceRoleKey,
    url,
  });

  const response = await fetch(
    `${url}/rest/v1/scholarship_correction_records`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
        prefer: "return=representation",
      },
      body: JSON.stringify({
        application_id: applicationId,
        correction_number: correctionNumber,
        message,
        notified_by: auth.userId,
        notifier_role: auth.role,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("補正紀錄寫入失敗。");
  }

  const [record] = (await response.json()) as CorrectionRecord[];
  return record;
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
    const permissions = await getDashboardRolePermissions(auth.role);
    if (!permissions.sendCorrection) {
      return jsonError("此角色目前無法通知補正。", 403);
    }

    const body = (await request.json()) as CorrectionEmailRequest;
    const applicationId = body.applicationId?.trim();
    const message = body.message?.trim() ?? "";

    if (!applicationId) {
      return jsonError("缺少 applicationId。");
    }

    if (!isValidUUID(applicationId)) {
      return jsonError("applicationId 格式不合法。");
    }

    if (!message) {
      return jsonError("請填寫需補正內容。");
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonError(`需補正內容不可超過 ${MAX_MESSAGE_LENGTH} 字。`);
    }

    const { serviceRoleKey, url } = getSupabaseConfig();
    const query = new URLSearchParams({
      id: `eq.${applicationId}`,
      limit: "1",
      select:
        "id,applicant_name,department,email,payload,scholarship_program,submission_status",
    });

    const checkResponse = await fetch(
      `${url}/rest/v1/scholarship_applications?${query}`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!checkResponse.ok) {
      throw new Error("查詢申請案失敗。");
    }

    const [application] =
      (await checkResponse.json()) as ScholarshipApplicationRecord[];

    if (!application) {
      return jsonError("找不到該申請案。", 404);
    }

    if (!canAccessDepartment(auth.departmentScope, application.department)) {
      return jsonError("無權限通知此系所申請案。", 403);
    }

    if (application.submission_status !== "submitted") {
      return jsonError("此申請案目前不是已送出狀態，無法退回補正。");
    }

    const recipientEmail = getRecipientEmail(application);
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      return jsonError("找不到可寄送的學生 Email。");
    }

    const emailJobBase = {
      applicationId: application.id,
      applicantName:
        application.applicant_name ||
        application.payload.applicantInfo?.applicantName ||
        "",
      department:
        application.department ||
        application.payload.applicantInfo?.department ||
        "",
      message,
      recipientEmail,
      serviceRoleKey,
      scholarshipProgram: application.scholarship_program || "獎學金申請",
      url,
    };

    const updateResult = await patchScholarshipApplication({
      applicationId: application.id,
      fields: {
        reviewed_by: auth.userId,
        reviewed_by_label: auth.displayName || auth.username || auth.email,
        review_status: "未審核",
        reviewer_remarks: message,
        submission_status: "draft",
        submitted_at: null,
      },
      returnRepresentation: true,
      serviceRoleKey,
      url,
    });

    if (!updateResult.ok) {
      console.error(
        "Correction PATCH failed:",
        updateResult.status,
        updateResult.detail
      );
      throw new Error("退回申請案失敗。");
    }

    const [updated] = updateResult.data;
    const correctionRecord = await createCorrectionRecord({
      applicationId: application.id,
      auth,
      message,
      serviceRoleKey,
      url,
    });

    after(() =>
      sendCorrectionNotice({
        ...emailJobBase,
        correctionRecordId: correctionRecord.id,
      })
    );

    return NextResponse.json({
      success: true,
      application: updated,
      correctionRecord,
      emailQueued: true,
    });
  } catch (error) {
    console.error("Dashboard correction email error:", error);
    // Surface the real reason (Resend config / domain / API key) for diagnosis.
    return jsonError(
      error instanceof Error ? error.message : "補正通知信寄送失敗。",
      500
    );
  }
}

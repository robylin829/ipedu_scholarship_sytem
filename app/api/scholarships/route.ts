import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendScholarshipConfirmationEmail } from "@/lib/email/resend";
import {
  recordScholarshipEmailLog,
  sendAndLogScholarshipEmail,
} from "@/lib/email/scholarship-email-logs";
import { notifyDepartmentOfResubmission } from "@/lib/notifications/resubmission-notice";
import { patchScholarshipApplication } from "@/lib/supabase/patch-application";
import {
  DEFAULT_SCHOLARSHIP_PROGRAM_KEY,
  getDefaultScholarshipProgramSetting,
  getProgramKeyByLegacyTitle,
  isScholarshipProgramKey,
  type ScholarshipProgramKey,
} from "@/lib/scholarship-settings";
import { derivePayloadAcademicGpa } from "@/lib/academic-gpa";
import type { ScholarshipPayload } from "@/lib/types";
import { isValidUUID } from "@/lib/validation";
import { verifyAllPublications } from "@/lib/verification";

const DEFAULT_SCHOLARSHIP_PROGRAM = "國科會-培育優秀博士生獎學金";

type SupabaseFileRecord = {
  field: string;
  label: string | null;
  name: string;
  path: string;
  type: string;
  size: number;
};

type ExistingApplicationAccessRecord = {
  id: string;
  program_key: string;
  submission_status: string;
};

type SavedApplicationRecord = {
  id: string;
  applicant_name: string | null;
  department: string | null;
  email: string | null;
  scholarship_program: string | null;
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

/**
 * 通知信裡的後台連結來源：優先用 NEXT_PUBLIC_SITE_URL（components/auth-button.tsx
 * 已在用同一個變數），否則退回這次請求的 origin。production 下取不到 https 網址
 * 就不放連結，避免寄出內部主機名這種點不開的連結。
 */
function getDashboardUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const origin = configured || new URL(request.url).origin;

  if (!/^https:\/\//i.test(origin) && process.env.NODE_ENV === "production") {
    return null;
  }

  return `${origin}/dashboard`;
}

function normalizeScholarshipProgram(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_SCHOLARSHIP_PROGRAM;
}

async function sendStudentSubmissionConfirmation({
  application,
  fallbackEmail,
  serviceRoleKey,
  url,
}: {
  application: SavedApplicationRecord;
  fallbackEmail: string | null | undefined;
  serviceRoleKey: string;
  url: string;
}) {
  const recipientEmail = application.email || fallbackEmail;
  if (!recipientEmail) {
    console.error(
      "Scholarship confirmation email skipped: no recipient email",
      application.id
    );
    await recordScholarshipEmailLog({
      applicationId: application.id,
      emailType: "student_submission_confirmation",
      failureReason: "找不到可寄送的學生 Email。",
      recipientEmail: "",
      serviceRoleKey,
      status: "failed",
      url,
    });
    return;
  }

  try {
    await sendAndLogScholarshipEmail({
      applicationId: application.id,
      emailType: "student_submission_confirmation",
      recipientEmail,
      serviceRoleKey,
      url,
      send: () =>
        sendScholarshipConfirmationEmail({
          applicationId: application.id,
          applicantName: application.applicant_name || "",
          department: application.department || "",
          recipientEmail,
          scholarshipProgram: application.scholarship_program || "獎學金申請",
          submittedAt: application.submitted_at,
        }),
    });
  } catch (error) {
    console.error("Scholarship confirmation email failed:", error);
  }
}

function normalizeProgramKey(
  value?: string | null,
  scholarshipProgram?: string | null
): ScholarshipProgramKey {
  if (isScholarshipProgramKey(value)) {
    return value;
  }

  if (scholarshipProgram) {
    return getProgramKeyByLegacyTitle(scholarshipProgram);
  }

  return DEFAULT_SCHOLARSHIP_PROGRAM_KEY;
}

async function fetchProgramSetting({
  programKey,
  serviceRoleKey,
  url,
}: {
  programKey: ScholarshipProgramKey;
  serviceRoleKey: string;
  url: string;
}) {
  const query = new URLSearchParams({
    limit: "1",
    program_key: `eq.${programKey}`,
    select: "program_key,is_open,is_correction_open",
  });

  const response = await fetch(
    `${url}/rest/v1/scholarship_program_settings?${query}`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("獎學金開放設定查詢失敗。");
  }

  const [setting] = (await response.json()) as {
    is_correction_open: boolean;
    is_open: boolean;
    program_key: ScholarshipProgramKey;
  }[];

  return setting ?? getDefaultScholarshipProgramSetting(programKey);
}

function getWriteAccessError(
  setting: Awaited<ReturnType<typeof fetchProgramSetting>>,
  existingApplication?: ExistingApplicationAccessRecord | null
) {
  if (setting?.is_open) {
    return null;
  }

  if (!existingApplication) {
    return "此獎學金目前已關閉，無法建立新申請。";
  }

  if (existingApplication.submission_status !== "draft") {
    return "此獎學金目前已關閉，只有退回補正的草稿可修改。";
  }

  if (!setting?.is_correction_open) {
    return "此獎學金目前未開放補正。";
  }

  return null;
}

async function fetchExistingApplicationForProgram({
  programKey,
  serviceRoleKey,
  url,
  userId,
}: {
  programKey: string;
  serviceRoleKey: string;
  url: string;
  userId: string;
}) {
  const query = new URLSearchParams({
    limit: "1",
    program_key: `eq.${programKey}`,
    select: "id,program_key,submission_status",
    user_id: `eq.${userId}`,
  });

  const response = await fetch(
    `${url}/rest/v1/scholarship_applications?${query}`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("資料查詢失敗。");
  }

  const [application] =
    (await response.json()) as ExistingApplicationAccessRecord[];
  return application ?? null;
}

async function fetchExistingApplicationById({
  applicationId,
  serviceRoleKey,
  url,
  userId,
}: {
  applicationId: string;
  serviceRoleKey: string;
  url: string;
  userId: string;
}) {
  const query = new URLSearchParams({
    id: `eq.${applicationId}`,
    limit: "1",
    select: "id,program_key,submission_status",
    user_id: `eq.${userId}`,
  });

  const response = await fetch(
    `${url}/rest/v1/scholarship_applications?${query}`,
    {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error("資料查詢失敗。");
  }

  const [application] =
    (await response.json()) as ExistingApplicationAccessRecord[];
  return application ?? null;
}

/* ------------------------------------------------------------------ */
/*  GET — Fetch existing application for the current user              */
/* ------------------------------------------------------------------ */

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("請先使用 Google 帳戶登入。", 401);
    }

    const { serviceRoleKey, url } = getSupabaseConfig();
    const searchParams = new URL(request.url).searchParams;

    // ── Mode: list this user's previous applications (drafts + submitted) ──
    // Used by the form page to offer auto-fill from a prior application. Drafts
    // are included so basic data carries over even before the source is sent.
    if (searchParams.get("previousSubmitted")) {
      const prevQuery = new URLSearchParams({
        // SECURITY: scope strictly to the verified user.id — never from input.
        user_id: `eq.${user.id}`,
        select:
          "id,program_key,scholarship_program,submission_status,submitted_at,updated_at,payload",
        order: "updated_at.desc",
      });

      const prevResponse = await fetch(
        `${url}/rest/v1/scholarship_applications?${prevQuery}`,
        {
          headers: {
            apikey: serviceRoleKey,
            authorization: `Bearer ${serviceRoleKey}`,
          },
        }
      );

      if (!prevResponse.ok) {
        throw new Error("資料查詢失敗。");
      }

      const applications = (await prevResponse.json()) as {
        id: string;
        program_key: string;
        scholarship_program: string | null;
        submission_status: string | null;
        submitted_at: string | null;
        updated_at: string | null;
        payload: ScholarshipPayload;
      }[];

      return NextResponse.json({ success: true, applications });
    }

    const scholarshipProgram = normalizeScholarshipProgram(
      searchParams.get("scholarshipProgram")
    );
    const programKey = normalizeProgramKey(
      searchParams.get("programKey"),
      scholarshipProgram
    );
    const query = new URLSearchParams({
      limit: "1",
      program_key: `eq.${programKey}`,
      select:
        "id,payload,files,submission_status,updated_at,submitted_at",
      user_id: `eq.${user.id}`,
    });

    const response = await fetch(
      `${url}/rest/v1/scholarship_applications?${query}`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("資料查詢失敗。");
    }

    const records = (await response.json()) as {
      id: string;
      payload: ScholarshipPayload;
      files: SupabaseFileRecord[];
      submission_status: string;
      updated_at: string;
      submitted_at: string | null;
    }[];

    if (records.length === 0) {
      return NextResponse.json({ success: true, application: null });
    }

    return NextResponse.json({ success: true, application: records[0] });
  } catch (error) {
    console.error("Scholarships API error:", error);
    return jsonError("伺服器處理時發生錯誤。", 500);
  }
}

/* ------------------------------------------------------------------ */
/*  POST — Create or update application record (upsert, JSON only)     */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("請先使用 Google 帳戶登入。", 401);
    }

    const { serviceRoleKey, url } = getSupabaseConfig();
    const body = (await request.json()) as {
      applicationId: string;
      payload: ScholarshipPayload;
      programKey?: string;
      scholarshipProgram?: string;
      status: string;
    };

    const { applicationId, payload, status } = body;
    const programKey = normalizeProgramKey(body.programKey, body.scholarshipProgram);
    const scholarshipProgram = normalizeScholarshipProgram(
      body.scholarshipProgram ||
        getDefaultScholarshipProgramSetting(programKey).title
    );

    if (!applicationId || !payload) {
      return jsonError("缺少必要欄位。");
    }

    if (!isValidUUID(applicationId)) {
      return jsonError("applicationId 格式不合法。");
    }

    const existingApplication = await fetchExistingApplicationForProgram({
      programKey,
      serviceRoleKey,
      url,
      userId: user.id,
    });
    const accessError = getWriteAccessError(
      await fetchProgramSetting({ programKey, serviceRoleKey, url }),
      existingApplication
    );
    if (accessError) {
      return jsonError(accessError, 403);
    }

    const derivedPayload = derivePayloadAcademicGpa(payload, programKey);
    const applicantInfo = derivedPayload.applicantInfo || {};
    if (!applicantInfo.applicantName || !applicantInfo.department) {
      return jsonError("請填寫申請人姓名與所屬學系所。");
    }

    const submissionStatus =
      status === "submitted" ? "submitted" : "draft";
    const academic = derivedPayload.academicPerformance || {};
    const submittedAt =
      submissionStatus === "submitted" ? new Date().toISOString() : undefined;
    const upsertBody: Record<string, unknown> = {
      id: applicationId,
      user_id: user.id,
      program_key: programKey,
      scholarship_program: scholarshipProgram,
      applicant_name: applicantInfo.applicantName,
      student_id: applicantInfo.studentId || null,
      department: applicantInfo.department,
      email: applicantInfo.email || null,
      phone: applicantInfo.phone || null,
      advisor_name: applicantInfo.advisorName || null,
      admission_academic_year:
        applicantInfo.admissionAcademicYear || null,
      application_type: applicantInfo.applicationType || null,
      gpa: academic.cumulativeGpa || null,
      gpa_scale: academic.cumulativeGpaScale || null,
      submission_status: submissionStatus,
      payload: derivedPayload,
    };
    // Never write review_status / reviewer_remarks here. A new row gets the DB
    // defaults ('未審核' / ''), and for an existing row those columns belong to
    // 系辦/院辦 — clobbering them on every save (drafts included) is what wiped
    // completed 文件真實性審核 and the reviewer's 補正說明.
    // A genuine re-submission still needs a re-review; that reset happens after
    // the upsert below, and only for that case.
    const isResubmission =
      submissionStatus === "submitted" && Boolean(existingApplication);
    // 通知系所時要用「這次 upsert 前」的狀態，才能把「草稿→首次送出」跟真正的
    // 重新送出分開。詳見 lib/notifications/resubmission-notice.ts。
    const previousSubmissionStatus =
      existingApplication?.submission_status ?? null;
    if (submittedAt) {
      upsertBody.submitted_at = submittedAt;
    }

    // Use upsert: if same (user_id, program_key) exists, update it
    const upsertResponse = await fetch(
      `${url}/rest/v1/scholarship_applications?on_conflict=user_id,program_key`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          prefer: "return=representation,resolution=merge-duplicates",
        },
        body: JSON.stringify(upsertBody),
      }
    );

    if (!upsertResponse.ok) {
      const errorText = await upsertResponse.text();
      console.error("Supabase upsert error:", errorText);
      throw new Error("Supabase 資料寫入失敗。");
    }

    const [record] = (await upsertResponse.json()) as SavedApplicationRecord[];
    const resolvedId = record?.id || applicationId;

    if (submissionStatus === "submitted") {
      const savedApplication: SavedApplicationRecord = {
        id: resolvedId,
        applicant_name: record?.applicant_name ?? applicantInfo.applicantName ?? "",
        department: record?.department ?? applicantInfo.department ?? "",
        email: record?.email ?? applicantInfo.email ?? null,
        scholarship_program: record?.scholarship_program ?? scholarshipProgram,
        submitted_at: record?.submitted_at ?? submittedAt ?? null,
      };

      after(() =>
        sendStudentSubmissionConfirmation({
          application: savedApplication,
          fallbackEmail: user.email,
          serviceRoleKey,
          url,
        })
      );
    }

    // ── A real re-submission invalidates the previous 文件真實性審核 ──
    // Only the status resets; reviewer_remarks is left alone so the 補正 note
    // written by 系辦/院辦 survives the student's resubmission.
    if (isResubmission) {
      const resetResult = await patchScholarshipApplication({
        applicationId: resolvedId,
        // The label lands in review_logs.actor_label, so the audit trail shows
        // plainly that the student's resubmission caused the reset.
        fields: {
          review_status: "未審核",
          reviewed_by: null,
          reviewed_by_label: "學生重新送出",
        },
        serviceRoleKey,
        url,
      });
      if (!resetResult.ok) {
        console.error("Review status reset failed:", resetResult.detail);
      }

      // ── Tell the 系所 the case needs reviewing again ──
      // after() runs this once the response is already on its way, so the
      // student never waits on Resend and a mail failure can never fail the
      // submission. request.url is read here, outside the callback.
      const dashboardUrl = getDashboardUrl(request);
      after(() =>
        notifyDepartmentOfResubmission({
          applicantName: applicantInfo.applicantName || "",
          applicationId: resolvedId,
          dashboardUrl,
          department: applicantInfo.department || "",
          previousSubmissionStatus,
          scholarshipProgram,
          serviceRoleKey,
          studentId: applicantInfo.studentId || null,
          submittedAt: submittedAt ?? null,
          url,
        })
      );
    }

    // ── Run publication verification on submission ──
    let verificationSummary = null;
    if (submissionStatus === "submitted") {
      try {
        const journals = (derivedPayload as Record<string, unknown>).journals as
          | import("@/lib/types").Journal[]
          | undefined;
        if (journals && journals.length > 0) {
          const vResult = await verifyAllPublications(journals);

          // Store the enriched payload only — review_status is not derived
          // from verification results.
          const enrichedPayload = {
            ...(derivedPayload as Record<string, unknown>),
            journals: vResult.journals,
            verificationSummary: vResult.summary,
          };
          await fetch(
            `${url}/rest/v1/scholarship_applications?id=eq.${resolvedId}`,
            {
              method: "PATCH",
              headers: {
                apikey: serviceRoleKey,
                authorization: `Bearer ${serviceRoleKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                payload: enrichedPayload,
              }),
            }
          );
          verificationSummary = vResult.summary;
        }
      } catch (verifyErr) {
        // Verification failure should not block the submission
        console.error("Publication verification error:", verifyErr);
      }
    }

    return NextResponse.json({
      success: true,
      applicationId: resolvedId,
      verificationSummary,
    });
  } catch (error) {
    console.error("Scholarships API error:", error);
    return jsonError("伺服器處理時發生錯誤。", 500);
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH — Update file metadata after client-side uploads             */
/* ------------------------------------------------------------------ */

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonError("請先使用 Google 帳戶登入。", 401);
    }

    const { serviceRoleKey, url } = getSupabaseConfig();
    const body = (await request.json()) as {
      applicationId: string;
      files: SupabaseFileRecord[];
    };

    const { applicationId, files } = body;

    if (!applicationId || !Array.isArray(files)) {
      return jsonError("缺少必要欄位。");
    }

    if (!isValidUUID(applicationId)) {
      return jsonError("applicationId 格式不合法。");
    }

    const application = await fetchExistingApplicationById({
      applicationId,
      serviceRoleKey,
      url,
      userId: user.id,
    });
    if (!application) {
      return jsonError("找不到該申請案或無權限。", 403);
    }

    const accessError = getWriteAccessError(
      await fetchProgramSetting({
        programKey: application.program_key as ScholarshipProgramKey,
        serviceRoleKey,
        url,
      }),
      application
    );
    if (accessError) {
      return jsonError(accessError, 403);
    }

    // Update the files metadata
    const updateResponse = await fetch(
      `${url}/rest/v1/scholarship_applications?id=eq.${applicationId}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify({ files }),
      }
    );

    if (!updateResponse.ok) {
      throw new Error("檔案資料更新失敗。");
    }

    return NextResponse.json({
      success: true,
      applicationId,
      files,
    });
  } catch (error) {
    console.error("Scholarships API error:", error);
    return jsonError("伺服器處理時發生錯誤。", 500);
  }
}

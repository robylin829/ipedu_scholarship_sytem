import { NextResponse } from "next/server";
import { canAccessDepartment, checkDashboardAccess } from "@/lib/auth";
import type { ScholarshipEmailLog } from "@/lib/types";
import { isValidUUID } from "@/lib/validation";

type ApplicationDepartmentRecord = {
  department: string | null;
  id: string;
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

export async function GET(request: Request) {
  try {
    const auth = await checkDashboardAccess();
    if (!auth.authorized) {
      return jsonError(
        auth.reason === "not_authenticated" ? "請先登入。" : "無權限存取。",
        auth.reason === "not_authenticated" ? 401 : 403
      );
    }

    const applicationId = new URL(request.url).searchParams
      .get("applicationId")
      ?.trim();

    if (!applicationId) {
      return jsonError("缺少 applicationId。");
    }

    if (!isValidUUID(applicationId)) {
      return jsonError("applicationId 格式不合法。");
    }

    const { serviceRoleKey, url } = getSupabaseConfig();
    const applicationQuery = new URLSearchParams({
      id: `eq.${applicationId}`,
      limit: "1",
      select: "id,department",
    });

    const applicationResponse = await fetch(
      `${url}/rest/v1/scholarship_applications?${applicationQuery}`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!applicationResponse.ok) {
      throw new Error("查詢申請案失敗。");
    }

    const [application] =
      (await applicationResponse.json()) as ApplicationDepartmentRecord[];

    if (!application) {
      return jsonError("找不到該申請案。", 404);
    }

    if (!canAccessDepartment(auth.departmentScope, application.department)) {
      return jsonError("無權限檢視此系所申請案。", 403);
    }

    const logsQuery = new URLSearchParams({
      application_id: `eq.${applicationId}`,
      order: "sent_at.desc",
      select:
        "id,application_id,recipient_email,email_type,sent_at,resend_message_id,status,failure_reason,metadata",
    });

    const logsResponse = await fetch(
      `${url}/rest/v1/scholarship_email_logs?${logsQuery}`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!logsResponse.ok) {
      throw new Error("查詢寄送紀錄失敗。");
    }

    const records = (await logsResponse.json()) as ScholarshipEmailLog[];
    return NextResponse.json({
      canResend: auth.role === "admin",
      records,
      success: true,
    });
  } catch (error) {
    console.error("Dashboard email logs error:", error);
    return jsonError("伺服器處理時發生錯誤。", 500);
  }
}

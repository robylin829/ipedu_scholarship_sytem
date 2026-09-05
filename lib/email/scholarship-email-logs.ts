import type {
  ScholarshipEmailLog,
  ScholarshipEmailStatus,
  ScholarshipEmailType,
} from "@/lib/types";

type SupabaseServiceConfig = {
  serviceRoleKey: string;
  url: string;
};

type RecordScholarshipEmailLogInput = SupabaseServiceConfig & {
  applicationId: string;
  emailType: ScholarshipEmailType;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
  recipientEmail: string;
  resendMessageId?: string | null;
  status: ScholarshipEmailStatus;
};

type SendAndLogScholarshipEmailInput = SupabaseServiceConfig & {
  applicationId: string;
  emailType: ScholarshipEmailType;
  metadata?: Record<string, unknown>;
  recipientEmail: string;
  send: () => Promise<string | undefined>;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "寄信失敗。";
}

export async function recordScholarshipEmailLog({
  applicationId,
  emailType,
  failureReason,
  metadata = {},
  recipientEmail,
  resendMessageId,
  serviceRoleKey,
  status,
  url,
}: RecordScholarshipEmailLogInput) {
  try {
    const response = await fetch(`${url}/rest/v1/scholarship_email_logs`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        application_id: applicationId,
        email_type: emailType,
        failure_reason: failureReason || null,
        metadata,
        recipient_email: recipientEmail,
        resend_message_id: resendMessageId || null,
        status,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Scholarship email log write failed:", detail);
    }
  } catch (error) {
    console.error("Scholarship email log write failed:", error);
  }
}

export async function sendAndLogScholarshipEmail({
  applicationId,
  emailType,
  metadata,
  recipientEmail,
  send,
  serviceRoleKey,
  url,
}: SendAndLogScholarshipEmailInput) {
  try {
    const resendMessageId = await send();
    await recordScholarshipEmailLog({
      applicationId,
      emailType,
      metadata,
      recipientEmail,
      resendMessageId: resendMessageId || null,
      serviceRoleKey,
      status: "success",
      url,
    });
  } catch (error) {
    await recordScholarshipEmailLog({
      applicationId,
      emailType,
      failureReason: getErrorMessage(error),
      metadata,
      recipientEmail,
      serviceRoleKey,
      status: "failed",
      url,
    });
    throw error;
  }
}

export function normalizeEmailLogMetadata(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function getMetadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function getMetadataStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export type { ScholarshipEmailLog };

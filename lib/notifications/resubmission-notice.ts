import { sendDepartmentResubmissionEmail } from "@/lib/email/resend";
import {
  recordScholarshipEmailLog,
  sendAndLogScholarshipEmail,
} from "@/lib/email/scholarship-email-logs";
import { resolveDepartmentNotificationRecipients } from "@/lib/notifications/department-recipients";

/**
 * Tells the owning 系所 (and any 院辦 account whose scope covers the department)
 * that a student re-submitted an application and it needs reviewing again.
 *
 * Why the extra gate below: `isResubmission` in the scholarships POST is true
 * whenever a row already existed, which also covers "saved a draft, now
 * submitting for the first time". That is a first submission and must stay
 * silent, so we look at the row's state *before* this upsert:
 *
 *   submitted                        → edited + resubmitted while open  → notify
 *   draft + has a correction record  → bounced for 補正, now resent     → notify
 *   draft + no correction record     → draft → first real submit       → silent
 *
 * `submitted_at` cannot be used to tell these apart: the 通知補正 handler nulls
 * it (app/api/dashboard/correction-email/route.ts). A correction record is the
 * reliable marker — that handler is the only place in the repo that writes an
 * existing row back to `submission_status: "draft"`, and it always inserts one.
 */

type NotifyDepartmentOfResubmissionInput = {
  applicantName: string;
  applicationId: string;
  dashboardUrl: string | null;
  department: string;
  previousSubmissionStatus: string | null;
  scholarshipProgram: string;
  serviceRoleKey: string;
  studentId: string | null;
  submittedAt: string | null;
  url: string;
};

async function hasCorrectionRecord({
  applicationId,
  serviceRoleKey,
  url,
}: {
  applicationId: string;
  serviceRoleKey: string;
  url: string;
}) {
  try {
    const response = await fetch(
      `${url}/rest/v1/scholarship_correction_records?application_id=eq.${applicationId}&select=id&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) return false;
    return ((await response.json()) as unknown[]).length > 0;
  } catch {
    return false;
  }
}

/**
 * 學生重新送出申請時通知對應的系所帳號。
 * 這個函式永遠不會 throw —— 通知失敗絕不能影響學生送件。
 */
export async function notifyDepartmentOfResubmission({
  applicantName,
  applicationId,
  dashboardUrl,
  department,
  previousSubmissionStatus,
  scholarshipProgram,
  serviceRoleKey,
  studentId,
  submittedAt,
  url,
}: NotifyDepartmentOfResubmissionInput) {
  try {
    const isCorrectionResubmission =
      previousSubmissionStatus === "draft" &&
      (await hasCorrectionRecord({ applicationId, serviceRoleKey, url }));

    const shouldNotify =
      previousSubmissionStatus === "submitted" || isCorrectionResubmission;
    if (!shouldNotify) return;

    const recipients = await resolveDepartmentNotificationRecipients({
      department,
      serviceRoleKey,
      url,
    });

    if (recipients.length === 0) {
      // Expected before any 系所 fills in the dialog, and also when a hand-typed
      // department string matches no scope — log it so a typo is discoverable.
      console.info(
        `No department notification recipients configured for "${department}".`
      );
      await recordScholarshipEmailLog({
        applicationId,
        emailType: "department_resubmission_notice",
        failureReason: "找不到可寄送的系所通知信箱。",
        metadata: { department },
        recipientEmail: "",
        serviceRoleKey,
        status: "failed",
        url,
      });
      return;
    }

    // A genuine retry within the same minute dedups at Resend, while a real
    // later resubmission gets a fresh key — same reasoning as the confirmation
    // email's idempotency key.
    const minuteBucket = Math.floor(
      (submittedAt ? Date.parse(submittedAt) : Date.now()) / 60000
    );

    // Sequential (list is <= 5) keeps us under Resend's rate limit, and one call
    // per account means one department's addresses never reach another's inbox.
    for (const recipient of recipients) {
      const idempotencySuffix = `${recipient.accountKey}-${minuteBucket}`;
      const metadata = {
        account_key: recipient.accountKey,
        dashboard_url: dashboardUrl,
        display_name: recipient.displayName,
        idempotency_suffix: idempotencySuffix,
        is_correction_resubmission: isCorrectionResubmission,
        recipient_emails: recipient.emails,
        role: recipient.role,
      };
      try {
        await sendAndLogScholarshipEmail({
          applicationId,
          emailType: "department_resubmission_notice",
          metadata,
          recipientEmail: recipient.emails.join(", "),
          serviceRoleKey,
          url,
          send: () =>
            sendDepartmentResubmissionEmail({
              applicantName,
              applicationId,
              dashboardUrl,
              department,
              idempotencySuffix,
              isCorrectionResubmission,
              recipientEmails: recipient.emails,
              scholarshipProgram,
              studentId,
              submittedAt,
            }),
        });
      } catch (error) {
        // Missing RESEND_API_KEY, unverified domain, a bad address — log only.
        console.error(
          `Resubmission notice to ${recipient.accountKey} failed:`,
          error
        );
      }
    }
  } catch (error) {
    console.error("notifyDepartmentOfResubmission failed:", error);
  }
}

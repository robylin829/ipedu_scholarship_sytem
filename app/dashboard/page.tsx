import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import {
  checkDashboardAccess,
  filterApplicationsByScope,
  type AuthResult,
} from "@/lib/auth";
import type { DashboardAuthProvider, DashboardRole } from "@/lib/types";
import type { ScholarshipApplication } from "@/lib/types";
import { AuthButton } from "@/components/auth-button";
import { fetchScholarshipProgramSettings } from "@/lib/scholarship-settings-server";
import { getDashboardRolePermissions } from "@/lib/dashboard-permissions";
import { withDerivedDashboardGpas } from "@/lib/dashboard-application-display";
import { AdminPanel } from "./admin-panel";
import { DashboardTabs } from "./dashboard-tabs";
import { ScholarshipProgramSwitcher } from "./scholarship-program-switcher";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "教師審查面板 — 獎學金申請",
  description: "竹師教育學院獎學金申請案教師審查面板",
};

async function fetchApplications(
  auth: Extract<AuthResult, { authorized: true }>
): Promise<ScholarshipApplication[]> {
  const url = (
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  ).replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return [];
  }

  try {
    const response = await fetch(
      `${url}/rest/v1/scholarship_applications?submission_status=eq.submitted&order=submitted_at.desc&select=id,applicant_name,student_id,department,advisor_name,gpa,gpa_scale,program_key,scholarship_program,submission_status,review_status,reviewer_remarks,review_sort_order,payload,files,submitted_at,created_at,updated_at`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) return [];
    const applications = (await response.json()) as ScholarshipApplication[];
    return filterApplicationsByScope(
      withDerivedDashboardGpas(applications),
      auth.departmentScope
    );
  } catch {
    return [];
  }
}

function AccessDeniedView() {
  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-lg mt-20">
        <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center space-y-4">
          <ShieldAlert className="mx-auto size-12 text-amber-500" />
          <h1 className="text-xl font-bold text-slate-900">無權限存取</h1>
          <p className="text-sm text-slate-500">
            您的帳號不在教師或管理員名單中，無法存取此頁面。
            <br />
            如有疑問請聯繫系統管理員。
          </p>
          <div className="pt-2">
            <AuthButton />
          </div>
        </div>
      </div>
    </main>
  );
}

function DashboardHeader({
  authProvider,
  displayName,
  role,
  applicationCount,
}: {
  authProvider: DashboardAuthProvider;
  displayName: string;
  role: DashboardRole;
  applicationCount: number;
}) {
  return (
    <header className="border-b border-slate-300 pb-6">
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-700">
            竹師教育學院獎學金
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950 sm:text-3xl">
            教師審查面板
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            共 {applicationCount} 件已送出申請案
            <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {displayName}
            </span>
            {role === "admin" && (
              <span className="ml-2 inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                管理員
              </span>
            )}
          </p>
        </div>
        <div className="min-w-0 lg:justify-self-end">
          <AuthButton
            dashboardIdentity={
              authProvider === "password" ? { displayName } : undefined
            }
            dashboardNotifications={authProvider === "google"}
          />
        </div>
      </div>
    </header>
  );
}

export default async function DashboardPage() {
  const auth = await checkDashboardAccess();

  if (!auth.authorized) {
    if (auth.reason === "not_authenticated") {
      redirect("/dashboard/login");
    }
    return <AccessDeniedView />;
  }

  const [applications, programs, permissions] = await Promise.all([
    fetchApplications(auth),
    fetchScholarshipProgramSettings(),
    getDashboardRolePermissions(auth.role),
  ]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f4f7f6] px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto w-full max-w-[1600px] min-w-0 space-y-6">
        {auth.role === "admin" ? (
          <DashboardTabs
            authProvider={auth.authProvider}
            displayName={auth.displayName}
            role={auth.role}
            applicationCount={applications.length}
            reviewContent={
              <ScholarshipProgramSwitcher
                applications={applications}
                programs={programs}
                permissions={permissions}
                role={auth.role}
              />
            }
            adminContent={<AdminPanel />}
          />
        ) : (
          <>
            <DashboardHeader
              authProvider={auth.authProvider}
              displayName={auth.displayName}
              role={auth.role}
              applicationCount={applications.length}
            />
            <ScholarshipProgramSwitcher
              applications={applications}
              programs={programs}
              permissions={permissions}
              role={auth.role}
            />
          </>
        )}
      </div>
    </main>
  );
}

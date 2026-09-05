"use client";

import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DashboardRole, ScholarshipApplication } from "@/lib/types";
import type { DashboardActionPermissions } from "@/lib/dashboard-permissions";
import {
  DEFAULT_SCHOLARSHIP_PROGRAM_SETTINGS,
  getProgramKeyByLegacyTitle,
  type ScholarshipProgramSetting,
} from "@/lib/scholarship-settings";
import { DashboardTable } from "./dashboard-table";
import { DashboardReviewStateProvider } from "./dashboard-review-state";

const ALL_PROGRAMS_VALUE = "all";

function getProgramLabel(program: ScholarshipProgramSetting) {
  return program.title.length > 12
    ? `${program.title.slice(0, 12)}...`
    : program.title;
}

function ProgramCount({
  count,
  selected,
}: {
  count: number;
  selected?: boolean;
}) {
  return (
    <span
      className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] ${
        selected
          ? "bg-white/20 text-current"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {count}
    </span>
  );
}

export function ScholarshipProgramSwitcher({
  applications,
  programs = DEFAULT_SCHOLARSHIP_PROGRAM_SETTINGS,
  permissions,
  role,
}: {
  applications: ScholarshipApplication[];
  programs?: ScholarshipProgramSetting[];
  permissions: DashboardActionPermissions;
  role: DashboardRole;
}) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const application of applications) {
      const program =
        application.program_key ||
        getProgramKeyByLegacyTitle(application.scholarship_program);
      map.set(program, (map.get(program) ?? 0) + 1);
    }
    return map;
  }, [applications]);

  return (
    // The provider sits above <Tabs> so review edits survive tab switches,
    // which unmount the inactive table.
    <DashboardReviewStateProvider>
      <Tabs
        defaultValue={ALL_PROGRAMS_VALUE}
        className="w-full min-w-0 max-w-full space-y-4 overflow-hidden"
      >
        <TabsList className="flex h-auto w-full max-w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger
            value={ALL_PROGRAMS_VALUE}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm data-[state=active]:border-[#1f6f78] data-[state=active]:bg-[#1f6f78] data-[state=active]:text-white"
          >
            全部
            <ProgramCount count={applications.length} />
          </TabsTrigger>
          {programs.map((program) => (
            <TabsTrigger
              key={program.program_key}
              value={program.program_key}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm data-[state=active]:border-[#1f6f78] data-[state=active]:bg-[#1f6f78] data-[state=active]:text-white"
            >
              {getProgramLabel(program)}
              <ProgramCount count={counts.get(program.program_key) ?? 0} />
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent
          value={ALL_PROGRAMS_VALUE}
          className="min-w-0 max-w-full overflow-hidden"
        >
          <DashboardTable
            applications={applications}
            permissions={permissions}
            role={role}
          />
        </TabsContent>
        {programs.map((program) => {
          const filteredApplications = applications.filter(
            (application) =>
              (application.program_key ||
                getProgramKeyByLegacyTitle(application.scholarship_program)) ===
              program.program_key
          );

          return (
            <TabsContent
              key={program.program_key}
              value={program.program_key}
              className="min-w-0 max-w-full overflow-hidden"
            >
              <DashboardTable
                key={program.program_key}
                applications={filteredApplications}
                permissions={permissions}
                role={role}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </DashboardReviewStateProvider>
  );
}

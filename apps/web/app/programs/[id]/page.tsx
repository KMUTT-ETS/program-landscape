import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
// DQ_MODULES / DQ_PASS_MARK are plain data, but importing them in the
// client component pulls the `@kku/shared` barrel (and `node:crypto`)
// into the browser bundle — so they are read here, on the server, and
// passed down. Same for the suppression floor out of `@kku/db`, which
// the DQ copy quotes: one definition, not two.
import { DQ_MODULES, DQ_PASS_MARK, isAdminGrade, type SessionUser } from '@kku/shared';
import { DQ_MIN_CELL_STUDENTS, OVERALL_MEAN_MAX_MODULE_NO } from '@kku/db';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Button, Card, PageHeader } from '@kku/ui';
import { ChevronRight, FileText, Home, Printer } from 'lucide-react';
import { DeepDiveClient, type DeepDiveDigitalCompetency } from './client';
import type {
  DeepDiveOverview,
  DeepDiveDemandFunnel,
  DeepDiveDemographicOutlook,
  DeepDiveFinancials,
  DeepDiveSkills,
  DeepDiveOutcomes,
  DeepDiveCourses,
  DeepDiveFaculty,
  DeepDivePeers,
  DeepDiveStudentCohorts,
  DeepDiveTcasStats,
  DeepDiveRecruitment,
  DeepDiveAiPeers,
  DeepDiveAiReadiness,
  DeepDiveLifecycle,
  DeepDiveStrategicNarrative,
  DeepDiveResearchExpertise,
  DeepDiveCurriculumRevision,
  DeepDiveTrends,
  DeepDiveHealthBenchmarks,
  ProgramOverlapSection,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program Deep-Dive' };

export default async function ProgramDeepDivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { id } = await params;

  // Overview is the canary — it's the smallest fetch + every section
  // depends on knowing the program is reachable + the user can see it.
  // If overview fails on auth/permission/server we surface diagnostic;
  // 404 falls through to the standard not-found page.
  const overviewRes = await apiFetchSafe<DeepDiveOverview>(`/programs/${id}/overview`);
  const overview = overviewRes.ok ? overviewRes.data : null;

  // Parallel-fetch all sections. If any section 403s (role-gated) we
  // render the page with that section in an empty state.
  const [
    demandFunnel,
    studentCohorts,
    tcasStats,
    recruitment,
    aiPeers,
    aiReadiness,
    lifecycle,
    strategicNarrative,
    researchExpertise,
    curriculumRevision,
    demographicOutlook,
    financials,
    skills,
    outcomes,
    courses,
    facultyData,
    peers,
    trends,
    healthBenchmarks,
    digitalCompetency,
    overlapEnvelope,
  ] = await Promise.all([
    apiFetch<DeepDiveDemandFunnel>(`/programs/${id}/demand-funnel`).catch(() => null),
    apiFetch<DeepDiveStudentCohorts>(`/programs/${id}/student-cohorts`).catch(() => null),
    apiFetch<DeepDiveTcasStats>(`/programs/${id}/tcas-stats`).catch(() => null),
    apiFetch<DeepDiveRecruitment>(`/programs/${id}/recruitment`).catch(() => null),
    apiFetch<DeepDiveAiPeers>(`/programs/${id}/ai-peers`).catch(() => null),
    apiFetch<DeepDiveAiReadiness>(`/programs/${id}/ai-readiness`).catch(() => null),
    apiFetch<DeepDiveLifecycle>(`/programs/${id}/lifecycle`).catch(() => null),
    apiFetch<DeepDiveStrategicNarrative>(`/programs/${id}/strategic-narrative`).catch(() => null),
    apiFetch<DeepDiveResearchExpertise>(`/programs/${id}/research-expertise`).catch(() => null),
    apiFetch<DeepDiveCurriculumRevision>(`/programs/${id}/curriculum-revision`).catch(() => null),
    apiFetch<DeepDiveDemographicOutlook>(`/programs/${id}/demographic-outlook`).catch(() => null),
    apiFetch<DeepDiveFinancials>(`/programs/${id}/financials`).catch(() => null),
    apiFetch<DeepDiveSkills>(`/programs/${id}/skills`).catch(() => null),
    apiFetch<DeepDiveOutcomes>(`/programs/${id}/outcomes`).catch(() => null),
    apiFetch<DeepDiveCourses>(`/programs/${id}/courses`).catch(() => null),
    apiFetch<DeepDiveFaculty>(`/programs/${id}/faculty`).catch(() => null),
    apiFetch<DeepDivePeers>(`/programs/${id}/peers`).catch(() => null),
    apiFetch<DeepDiveTrends>(`/programs/${id}/trends`).catch(() => null),
    apiFetch<DeepDiveHealthBenchmarks>(`/programs/${id}/health-benchmarks`).catch(() => null),
    // Answers for every programme — a non-bachelor one comes back
    // `not-applicable`, which the client renders as nothing at all.
    apiFetch<DeepDiveDigitalCompetency>(`/programs/${id}/dq`).catch(() => null),
    // program-overlap.v1. The envelope, not just the data, so the section's
    // provenance drawer shows the endpoint's own sources and caveats. null
    // (no run) and an empty sibling list both hide the section (D6).
    apiFetchEnvelope<ProgramOverlapSection | null>(`/programs/${id}/overlap`).catch(() => null),
  ]);

  if (!overview) {
    if (!overviewRes.ok && overviewRes.error.category === 'notFound') notFound();
    return (
      <AuthedAppShell user={user}>
        <PageHeader title="Program deep-dive" />
        <DiagnosticEmptyState
          surface="this program's deep-dive"
          error={overviewRes.ok ? null : overviewRes.error}
        />
      </AuthedAppShell>
    );
  }

  // Cockpit-style breadcrumb so users can navigate back from the
  // deepest level (program → department → faculty → KKU root) without
  // hunting for the browser back button.
  const facultyHref = `/cockpit?scope=faculty&scopeId=${overview.program.faculty.id}`;
  const deptHref = overview.program.department
    ? `/cockpit?scope=department&scopeId=${overview.program.department.id}`
    : null;

  return (
    <AuthedAppShell user={user}>
      <Card padding="sm" className="mb-3">
        <nav
          aria-label="Program breadcrumb"
          className="flex items-center gap-2 text-sm flex-wrap"
        >
          <Link
            href="/programs"
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-text-secondary hover:bg-surface-2 hover:text-accent transition-colors"
          >
            <Home className="size-icon-sm shrink-0" aria-hidden />
            <span className="flex flex-col leading-tight">
              <span lang="th">มข. (ภาพรวม)</span>
              <span className="text-[10px] text-text-tertiary">KKU University</span>
            </span>
          </Link>
          <ChevronRight className="size-icon-sm text-text-tertiary shrink-0" aria-hidden />
          <Link
            href={facultyHref}
            className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-surface-2 hover:text-accent transition-colors"
          >
            <span className="flex flex-col leading-tight">
              <span lang="th">{overview.program.faculty.nameTh}</span>
              <span className="text-[10px] text-text-tertiary">{overview.program.faculty.nameEn}</span>
            </span>
          </Link>
          {deptHref && overview.program.department && (
            <>
              <ChevronRight className="size-icon-sm text-text-tertiary shrink-0" aria-hidden />
              <Link
                href={deptHref}
                className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-surface-2 hover:text-accent transition-colors"
              >
                <span className="flex flex-col leading-tight">
                  <span lang="th">{overview.program.department.nameTh}</span>
                  <span className="text-[10px] text-text-tertiary">{overview.program.department.nameEn}</span>
                </span>
              </Link>
            </>
          )}
          <ChevronRight className="size-icon-sm text-text-tertiary shrink-0" aria-hidden />
          <span className="px-1.5 py-0.5 text-text-primary font-medium">
            <span className="flex flex-col leading-tight">
              <span lang="th">{overview.program.nameTh}</span>
              <span className="text-[10px] text-text-tertiary">{overview.program.nameEn}</span>
            </span>
          </span>
        </nav>
      </Card>
      <PageHeader
        title={overview.program.nameEn}
        subtitle={`${overview.program.code} · ${overview.program.nameTh} · ${overview.program.faculty.nameEn}${overview.program.department ? ` · ${overview.program.department.nameEn}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/programs/${id}/print`} target="_blank" rel="noopener noreferrer">
                <Printer className="size-icon-md" />
                Print view
              </Link>
            </Button>
            {/* Export PDF — server-side Gotenberg render of the
                comprehensive tabular detail report. The route returns
                a 302 redirect to a signed MinIO URL, so the browser
                downloads the PDF directly. Print view is the on-screen
                browser-print version of the same content. */}
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/api/admin-program-export/${id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText className="size-icon-md" />
                Export PDF
              </a>
            </Button>
          </div>
        }
      />
      <DeepDiveClient
        user={user}
        programId={id}
        overview={overview}
        demandFunnel={demandFunnel}
        studentCohorts={studentCohorts}
        tcasStats={tcasStats}
        canOpenDataSources={isAdminGrade(user.effectiveRole ?? user.role)}
        recruitment={recruitment}
        aiPeers={aiPeers}
        aiReadiness={aiReadiness}
        lifecycle={lifecycle}
        strategicNarrative={strategicNarrative}
        researchExpertise={researchExpertise}
        curriculumRevision={curriculumRevision}
        demographicOutlook={demographicOutlook}
        financials={financials}
        skills={skills}
        outcomes={outcomes}
        courses={courses}
        faculty={facultyData}
        peers={peers}
        trends={trends}
        healthBenchmarks={healthBenchmarks}
        digitalCompetency={digitalCompetency}
        overlap={overlapEnvelope?.data ?? null}
        overlapMeta={overlapEnvelope?.meta ?? null}
        dqModules={DQ_MODULES.filter((m) => m.kind === 'THEORY')}
        dqMinCellStudents={DQ_MIN_CELL_STUDENTS}
        dqPassMark={DQ_PASS_MARK}
        dqHeadlineMaxModuleNo={OVERALL_MEAN_MAX_MODULE_NO}
      />
    </AuthedAppShell>
  );
}

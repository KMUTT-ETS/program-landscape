import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Button, PageHeader } from '@kku/ui';
import { FileText, Printer } from 'lucide-react';
import { DeepDiveClient } from './client';
import type {
  DeepDiveOverview,
  DeepDiveDemandFunnel,
  DeepDiveDemographicOutlook,
  DeepDiveFinancials,
  DeepDiveSkills,
  DeepDiveOutcomes,
  DeepDiveFaculty,
  DeepDivePeers,
  DeepDiveStudentCohorts,
  DeepDiveTcasStats,
  DeepDiveAiPeers,
  DeepDiveAiReadiness,
  DeepDiveLifecycle,
  DeepDiveStrategicNarrative,
  DeepDiveTrends,
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

  // Parallel-fetch all sections. If any section 403s (role-gated) we
  // render the page with that section in an empty state.
  const [
    overview,
    demandFunnel,
    studentCohorts,
    tcasStats,
    aiPeers,
    aiReadiness,
    lifecycle,
    strategicNarrative,
    demographicOutlook,
    financials,
    skills,
    outcomes,
    facultyData,
    peers,
    trends,
  ] = await Promise.all([
    apiFetch<DeepDiveOverview>(`/programs/${id}/overview`).catch(() => null),
    apiFetch<DeepDiveDemandFunnel>(`/programs/${id}/demand-funnel`).catch(() => null),
    apiFetch<DeepDiveStudentCohorts>(`/programs/${id}/student-cohorts`).catch(() => null),
    apiFetch<DeepDiveTcasStats>(`/programs/${id}/tcas-stats`).catch(() => null),
    apiFetch<DeepDiveAiPeers>(`/programs/${id}/ai-peers`).catch(() => null),
    apiFetch<DeepDiveAiReadiness>(`/programs/${id}/ai-readiness`).catch(() => null),
    apiFetch<DeepDiveLifecycle>(`/programs/${id}/lifecycle`).catch(() => null),
    apiFetch<DeepDiveStrategicNarrative>(`/programs/${id}/strategic-narrative`).catch(() => null),
    apiFetch<DeepDiveDemographicOutlook>(`/programs/${id}/demographic-outlook`).catch(() => null),
    apiFetch<DeepDiveFinancials>(`/programs/${id}/financials`).catch(() => null),
    apiFetch<DeepDiveSkills>(`/programs/${id}/skills`).catch(() => null),
    apiFetch<DeepDiveOutcomes>(`/programs/${id}/outcomes`).catch(() => null),
    apiFetch<DeepDiveFaculty>(`/programs/${id}/faculty`).catch(() => null),
    apiFetch<DeepDivePeers>(`/programs/${id}/peers`).catch(() => null),
    apiFetch<DeepDiveTrends>(`/programs/${id}/trends`).catch(() => null),
  ]);

  if (!overview) notFound();

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={overview.program.nameEn}
        subtitle={`${overview.program.code} · ${overview.program.nameTh} · ${overview.program.faculty.nameEn}${overview.program.department ? ` · ${overview.program.department.nameEn}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/programs/${id}/print`} target="_blank" rel="noopener noreferrer">
                <Printer className="h-4 w-4" />
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
                <FileText className="h-4 w-4" />
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
        aiPeers={aiPeers}
        aiReadiness={aiReadiness}
        lifecycle={lifecycle}
        strategicNarrative={strategicNarrative}
        demographicOutlook={demographicOutlook}
        financials={financials}
        skills={skills}
        outcomes={outcomes}
        faculty={facultyData}
        peers={peers}
        trends={trends}
      />
    </AuthedAppShell>
  );
}

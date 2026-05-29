import { redirect } from 'next/navigation';
import { isUniversityWide, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { prisma } from '@kku/db';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { Card, PageHeader, Section } from '@kku/ui';
import { EducationRefreshBar } from '../../education/refresh-bar';
import { StaffRefreshBar } from '../../staff/refresh-bar';
import { SatisfactionRefreshBar } from './satisfaction-refresh-bar';
import { ClassOfferingsRefreshBar } from './class-offerings-refresh-bar';
import { ResearchRefreshBar } from './research-refresh-bar';
import type { RefreshStatus } from '../../education/types';
import type { RefreshStatus as StaffRefreshStatus } from '../../staff/types';

interface ClassOfferingsRefreshStatus {
  isRunning: boolean;
  rowCount: number;
  withGpaCount: number;
  lastRefreshedAt: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// /admin/dashboard-data-fetch — manual refresh for Education + Staff cubes.
//
// Was previously a top-strip on /education and /staff visible to anyone
// with `isUniversityWide` rights. Moved into /admin in v1.2.8 because
// (a) the refresh button is an operator action — it triggers Oracle
// queries and rebuilds cubes — not a dashboard control, and
// (b) it took premium real-estate on dashboards everyone sees, even
// though only admins can actually use it.
//
// Page hosts BOTH refresh bars stacked. Re-uses the same client
// components mounted previously on the dashboards.
// ──────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard data fetch — Admin' };

// Read a catalog data source + its latest-run summary directly from
// Prisma (keeps the page SSR fast; no extra API endpoint for this
// display-only strip). Returns null when the source isn't seeded.
async function loadSourceStatus(slug: string) {
  const ds = await prisma.dataSource.findUnique({
    where: { slug },
    select: { id: true, slug: true, cadenceCron: true, scheduleEnabled: true, status: true },
  });
  if (!ds) return null;
  const lastSucceeded = await prisma.ingestionRun.findFirst({
    where: { dataSourceId: ds.id, status: 'SUCCEEDED' },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });
  const lastRun = await prisma.ingestionRun.findFirst({
    where: { dataSourceId: ds.id },
    orderBy: { createdAt: 'desc' },
    select: {
      status: true,
      completedAt: true,
      recordsLoaded: true,
      recordsFailed: true,
      durationMs: true,
    },
  });
  return {
    ...ds,
    lastSuccessAt: lastSucceeded?.completedAt?.toISOString() ?? null,
    lastRunStatus: lastRun?.status ?? null,
    lastRunCompletedAt: lastRun?.completedAt?.toISOString() ?? null,
    lastRunRecordsLoaded: lastRun?.recordsLoaded ?? null,
    lastRunRecordsFailed: lastRun?.recordsFailed ?? null,
    lastRunDurationMs: lastRun?.durationMs ?? null,
  };
}

export default async function DashboardDataFetchPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  // Refresh actions are university-wide — same gate as the previous
  // top-strip placement on /education and /staff.
  if (!isUniversityWide(role)) redirect('/no-access');

  const [eduStatus, staffStatus, evalsSource, researchSource, classOfferingsStatus] =
    await Promise.all([
      apiFetch<RefreshStatus>('/education/refresh/status').catch(() => null),
      apiFetch<StaffRefreshStatus>('/staff-dashboard/refresh/status').catch(() => null),
      // kku-evaluations + kku-research data sources + their most recent
      // runs for the refresh bars' "last success / duration / records
      // loaded" strips. Read directly from Prisma — keeps the page SSR
      // fast and avoids one-off API endpoints for display.
      loadSourceStatus('kku-evaluations').catch(() => null),
      loadSourceStatus('kku-research').catch(() => null),
      apiFetch<ClassOfferingsRefreshStatus>(
        '/education/class-offerings/refresh/status',
      ).catch(() => null),
    ]);

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Dashboard data fetch" />
      <PageHeader
        title="Dashboard data fetch"
        subtitle="Manually rebuild the Education and Staff cubes from their underlying Oracle / MSSQL warehouses. Runs nightly on schedule; use these only when you need a fresh snapshot before a Council meeting or after a registrar reconciliation."
      />

      <Section
        title="Education cubes"
        description="POWERBI.VIEW_STUDENT_DETAIL_ALL (student/location/tuition/performance/entry-scores) + POWERBI.ADMISSION_STAT_CURRID (recruitment funnel)."
      >
        <Card>
          <EducationRefreshBar initialStatus={eduStatus} />
        </Card>
      </Section>

      <Section
        title="Staff cubes"
        description="staff_master_records + workforce_hcm_actual (workforce + faculty-by-program + research) and the compensation cube."
      >
        <Card>
          <StaffRefreshBar initialStatus={staffStatus} />
        </Card>
      </Section>

      <Section
        title="Class offerings & class GPA"
        description="POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER — every class section the registrar opened, with the per-letter grade distribution and the precomputed class GPA. Powers the class-GPA section of Education → Student performance. Run after the registrar posts a semester's grades."
      >
        <ClassOfferingsRefreshBar initial={classOfferingsStatus} />
      </Section>

      <Section
        title="Student-evaluation survey"
        description="POWERBI.EVALUATE_INSTRUCTOR — pre-aggregated student ratings of every (class × question × instructor) cell with TOTAL_STUDENT ≥ 5. Powers /education/satisfaction and /staff/teaching. Refresh is bi-weekly because the dataset is large (986K cells, ~110 min load); force a manual refresh when a Council meeting needs the latest semester's data before the next scheduled run."
      >
        <SatisfactionRefreshBar initial={evalsSource} />
      </Section>

      <Section
        title="Research output (publications)"
        description="kku-publications mirror (Scopus + PubMed) — every KKU paper resolved to its authors, with journal quartile (Q1–Q4), the Top-10% / Tier-1 band and SJR from Scopus CiteScore. Powers /staff/research. Runs weekly; force a refresh after the Library curates a new batch or refreshes CiteScore metrics. Same connector as kku-research in Data sources."
      >
        <ResearchRefreshBar initial={researchSource} />
      </Section>
    </AuthedAppShell>
  );
}

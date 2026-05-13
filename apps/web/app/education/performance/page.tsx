import { redirect } from 'next/navigation';
import { canSeeFacultyDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import type {
  EntryScoreResponse,
  PerformanceByLocationResponse,
  PerformanceByProgramResponse,
  PerformanceOverall,
  ThailandRegion,
} from '../types';
import { PerformanceClient } from './client';
import { EducationBackLink } from '../back-link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student performance — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

const VALID_REGIONS = new Set<ThailandRegion>([
  'NORTH',
  'NORTHEAST',
  'CENTRAL',
  'EAST',
  'WEST',
  'SOUTH',
]);

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeFacultyDashboards(user.role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const programLevel = arr(sp.programLevel);
  const programName = arr(sp.programName);
  const region = arr(sp.region).filter((r): r is ThailandRegion =>
    VALID_REGIONS.has(r as ThailandRegion),
  );

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  programLevel.forEach((v) => qs.append('programLevel', v));
  programName.forEach((v) => qs.append('programName', v));
  region.forEach((v) => qs.append('region', v));
  const qsString = qs.toString() ? `?${qs}` : '';

  // Overall is the canary; the per-program/location/entry-score
  // fetches stay best-effort (each section can be null).
  const overallRes = await apiFetchSafe<PerformanceOverall>(
    `/education/performance/overall${qsString}`,
  );
  const [byProgram, byLocation, entryScores] = await Promise.all([
    apiFetch<PerformanceByProgramResponse>(
      `/education/performance/by-program${qsString}`,
    ).catch(() => null),
    apiFetch<PerformanceByLocationResponse>(
      `/education/performance/by-location${qsString}`,
    ).catch(() => null),
    apiFetch<EntryScoreResponse>(
      `/education/entry-scores${qsString}`,
    ).catch(() => null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student performance"
        subtitle="Undergraduate GPAs and entry test scores. Faculty → Program drill-down for GPA averages, plus a deeper Region → Province → School view, plus a per-subject score pivot."
      />
      {overallRes.ok ? (
        <PerformanceClient
          overall={overallRes.data}
          byProgram={byProgram}
          byLocation={byLocation}
          entryScores={entryScores}
          initialFilters={{ facultyName, programLevel, programName, region }}
        />
      ) : (
        <DiagnosticEmptyState surface="student performance" error={overallRes.error} />
      )}
    </AuthedAppShell>
  );
}

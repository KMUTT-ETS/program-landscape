import { redirect } from 'next/navigation';
import {
  canSeeProgramAwareDashboards,
  DQ_MODULES,
  DQ_PASS_MARK,
  type SessionUser,
} from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { EducationBackLink } from '../back-link';
import {
  StudentDqClient,
  type DqDrillResponse,
  type DqModuleKindFilter,
  type DqOverviewResponse,
} from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student DQ — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Cohort options.
 *
 * No endpoint exposes the cube's distinct `cohortYearBE` values (the
 * drill queries group them away — cohort is a filter here, not a display
 * level), so the list is the full window `cohortFromStudentId` in
 * `@kku/shared` will accept: BE 2550 up to the current Buddhist-era
 * year. That means every cohort the cube can possibly hold is offerable;
 * a year with no rows returns an empty table rather than a wrong one.
 */
const COHORT_MIN_BE = 2550;
function cohortOptions(): number[] {
  const currentBE = new Date().getFullYear() + 543;
  const years: number[] = [];
  for (let y = currentBE; y >= COHORT_MIN_BE; y -= 1) years.push(y);
  return years;
}

export default async function StudentDqPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const cohortYearBE = arr(sp.cohortYearBE).map(Number).filter(Number.isFinite);
  const kind: DqModuleKindFilter = arr(sp.kind).includes('WORKSHOP') ? 'WORKSHOP' : 'THEORY';

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  cohortYearBE.forEach((v) => qs.append('cohortYearBE', String(v)));
  const qsString = qs.toString() ? `?${qs}` : '';

  const [overviewRes, drillRes] = await Promise.all([
    apiFetchSafe<DqOverviewResponse>(`/education/student-dq/overview${qsString}`),
    apiFetchSafe<DqDrillResponse>(`/education/student-dq/drill${qsString}`),
  ]);

  // The faculty dropdown must list every faculty the caller may see, not
  // just those surviving the current filter — otherwise a selection can
  // only ever be narrowed, never swapped. One extra unfiltered call, and
  // only when a filter is actually applied; the API clamps it to the
  // caller's scope exactly as it clamps the filtered one.
  const anyFilter = facultyName.length > 0 || cohortYearBE.length > 0;
  const optionsRes = anyFilter
    ? await apiFetchSafe<DqDrillResponse>('/education/student-dq/drill')
    : drillRes;
  const facultyOptions = optionsRes.ok
    ? optionsRes.data.faculties.map((f) => f.facultyName)
    : drillRes.ok
      ? drillRes.data.faculties.map((f) => f.facultyName)
      : [];

  const loaded = overviewRes.ok && drillRes.ok;
  // Zero faculty rows means the cubes are empty — the connector has
  // never completed a run (or ran with no token). That is a different
  // failure from a 500, and the empty state says so.
  const hasRows = drillRes.ok && drillRes.data.faculties.length > 0;

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student DQ"
        subtitle="How KKU undergraduates perform on the university's Digital Intelligence competency test. Drill from faculty down to a programme, with a column for every module. Scores are withheld on rows with fewer than 5 scored students."
      />
      {loaded && hasRows ? (
        <StudentDqClient
          overview={overviewRes.data}
          drill={drillRes.data}
          // DQ_MODULES is plain data, but importing it in the client
          // component would pull the @kku/shared barrel (and node:crypto)
          // into the browser bundle — so it is read here, on the server,
          // and passed down. Same for DQ_PASS_MARK.
          modules={[...DQ_MODULES]}
          passMark={DQ_PASS_MARK}
          facultyOptions={facultyOptions}
          cohortOptions={cohortOptions()}
          initialFilters={{ facultyName, cohortYearBE, kind }}
        />
      ) : (
        <DiagnosticEmptyState
          surface="student DQ"
          error={
            !overviewRes.ok
              ? overviewRes.error
              : !drillRes.ok
                ? drillRes.error
                : null
          }
          emptyMessage="No DQ results have been loaded yet. Run the kku-dq connector from /admin/data-sources/kku-dq, then reload this page."
        />
      )}
    </AuthedAppShell>
  );
}

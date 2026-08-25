import { redirect } from 'next/navigation';
import {
  canSeeProgramAwareDashboards,
  DQ_MODULES,
  DQ_PASS_MARK,
  type SessionUser,
} from '@kku/shared';
// Server component, so the suppression floor is read from the one place
// the query layer defines it rather than written into the page copy —
// three UI strings quote it, and if the floor moves they must move with
// it. Passed down as a prop; `@kku/db` never reaches the client.
import { DQ_MIN_CELL_STUDENTS } from '@kku/db';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { EducationBackLink } from '../back-link';
import {
  StudentDqClient,
  type DqDrillResponse,
  type DqOverviewResponse,
} from './client';

interface DqFilterOptionsResponse {
  methodologyVersion: string;
  facultyNames: string[];
  /** Ascending, and only the cohorts the cube actually holds. */
  cohortYearsBE: number[];
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student DQ — Education' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function StudentDqPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!canSeeProgramAwareDashboards(user.effectiveRole ?? user.role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const cohortYearBE = arr(sp.cohortYearBE).map(Number).filter(Number.isFinite);
  const anyFilter = facultyName.length > 0 || cohortYearBE.length > 0;

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  cohortYearBE.forEach((v) => qs.append('cohortYearBE', String(v)));
  const qsString = qs.toString() ? `?${qs}` : '';

  // Cohort options cascade from the faculty selection (a faculty's own
  // cohorts, not the institution's) — but NOT from the cohort selection,
  // or picking a year would shrink the list it was picked from. The
  // faculty list therefore has to come from an unnarrowed call, so a
  // faculty selection can be swapped and not only narrowed. Both calls
  // are one grouped scan and both are clamped by the API.
  const cascadeQs = new URLSearchParams();
  facultyName.forEach((v) => cascadeQs.append('facultyName', v));
  const cascadeQsString = cascadeQs.toString() ? `?${cascadeQs}` : '';

  const [overviewRes, drillRes, cascadeRes] = await Promise.all([
    apiFetchSafe<DqOverviewResponse>(`/education/student-dq/overview${qsString}`),
    apiFetchSafe<DqDrillResponse>(`/education/student-dq/drill${qsString}`),
    apiFetchSafe<DqFilterOptionsResponse>(
      `/education/student-dq/filter-options${cascadeQsString}`,
    ),
  ]);
  const facultyListRes =
    facultyName.length > 0
      ? await apiFetchSafe<DqFilterOptionsResponse>('/education/student-dq/filter-options')
      : cascadeRes;

  const facultyOptions = facultyListRes.ok ? facultyListRes.data.facultyNames : facultyName;
  // Newest intake first: it is the cohort a reader reaches for.
  const cohortOptions = cascadeRes.ok
    ? [...cascadeRes.data.cohortYearsBE].sort((a, b) => b - a)
    : [];

  const loaded = overviewRes.ok && drillRes.ok;
  // Zero faculty rows means the cubes are empty — the connector has
  // never completed a run (or ran with no token). ONLY true when nothing
  // is filtered: under a filter, zero rows means the filter matched
  // nothing, and diagnosing that as "the connector never ran" is both
  // false and a trap — the empty state replaces the client, so the rail
  // that set the filter disappears with it and the only way back is to
  // edit the URL. Filtered-and-empty renders the client, which says so
  // in the table with the rail still on screen.
  const cubesEmpty = drillRes.ok && !anyFilter && drillRes.data.faculties.length === 0;

  return (
    <AuthedAppShell user={user}>
      <EducationBackLink />
      <PageHeader
        title="Student DQ"
        subtitle={`How KKU undergraduates perform on the university's Digital Intelligence competency test. Drill from faculty down to a programme, with a column for every module. Scores are withheld on rows with fewer than ${DQ_MIN_CELL_STUDENTS} scored students.`}
      />
      {loaded && !cubesEmpty ? (
        <StudentDqClient
          overview={overviewRes.data}
          drill={drillRes.data}
          // DQ_MODULES is plain data, but importing it in the client
          // component would pull the @kku/shared barrel (and node:crypto)
          // into the browser bundle — so it is read here, on the server,
          // and passed down. Same for DQ_PASS_MARK.
          modules={[...DQ_MODULES]}
          passMark={DQ_PASS_MARK}
          minCellStudents={DQ_MIN_CELL_STUDENTS}
          facultyOptions={facultyOptions}
          cohortOptions={cohortOptions}
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

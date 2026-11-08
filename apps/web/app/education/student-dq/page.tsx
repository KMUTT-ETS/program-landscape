import { orgShortNamesForRequest } from '@/lib/branding';
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
  type DqRadarResponse,
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
  const org = await orgShortNamesForRequest();
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

  // ── Radar scope ──────────────────────────────────────────────────
  //
  // The radar plots ONE scope, so its target is its own URL state and not
  // the rail's multi-select: `radarFaculty` / `radarProgram` are set by
  // the picker on the chart. With no target it falls back to the current
  // selection — which it can only represent when that selection is a
  // single faculty or none, because `dqRadar` takes one faculty name.
  // Under a multi-faculty filter it therefore shows the university, and
  // the chart says so rather than labelling the union it is not.
  const kind = sp.kind === 'WORKSHOP' ? 'WORKSHOP' : 'THEORY';
  const radarProgramId = typeof sp.radarProgram === 'string' ? sp.radarProgram : undefined;
  const radarFacultyName =
    typeof sp.radarFaculty === 'string'
      ? sp.radarFaculty
      : facultyName.length === 1
        ? facultyName[0]
        : undefined;

  const radarQs = new URLSearchParams();
  if (radarFacultyName) radarQs.append('facultyName', radarFacultyName);
  // The cohort filter travels with the scope series (the API applies it),
  // but NOT into `scopeLabel` — the client appends it to the legend.
  cohortYearBE.forEach((v) => radarQs.append('cohortYearBE', String(v)));
  if (radarProgramId) radarQs.append('programId', radarProgramId);
  radarQs.append('kind', kind);

  const [overviewRes, drillRes, cascadeRes, radarRes] = await Promise.all([
    apiFetchSafe<DqOverviewResponse>(`/education/student-dq/overview${qsString}`),
    apiFetchSafe<DqDrillResponse>(`/education/student-dq/drill${qsString}`),
    apiFetchSafe<DqFilterOptionsResponse>(
      `/education/student-dq/filter-options${cascadeQsString}`,
    ),
    apiFetchSafe<DqRadarResponse>(`/education/student-dq/radar?${radarQs}`),
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
        subtitle={`How ${org.en} undergraduates perform on the university's Digital Intelligence competency test. Drill from faculty down to a programme, with a column for every module. Scores are withheld on rows with fewer than ${DQ_MIN_CELL_STUDENTS} scored students.`}
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
          // A radar failure is a failure of one card, not of the page:
          // the table above carries the same per-module figures, so the
          // client renders a note in place of the chart rather than the
          // whole surface collapsing to an empty state.
          radar={radarRes.ok ? radarRes.data : null}
          // The RESOLVED target — the client uses it to tell "this scope
          // is the comparison population" from "this scope sits inside
          // it", which the raw URL params alone cannot answer.
          radarScope={{
            facultyName: radarFacultyName ?? null,
            programId: radarProgramId ?? null,
          }}
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
          emptyMessage="No DQ results have been loaded yet. Upload the Digital Competency Cohorts and Digital Competency Modules sheets in Data setup (/admin/data-setup), then reload this page."
        />
      )}
    </AuthedAppShell>
  );
}

'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, RadarChartSmall, type RadarPoint } from '@kku/ui';
// TYPE-ONLY import. The `@kku/shared` barrel re-exports subpaths that
// pull `node:crypto`, which breaks the client bundle — so the module
// table itself (`DQ_MODULES`, plain data) is imported by the SERVER
// component and handed down as the `modules` prop. Nothing here reaches
// into `@kku/shared` at runtime.
import type { DqModule } from '@kku/shared';
import { MultiSelectField } from '../multi-select';
import {
  DrillDownPivot,
  type DrillColumn,
  type DrillRow,
  type DrillRowBadge,
} from '../../staff/drill-down-pivot';

// ─────────────────────────────────────────────────────────────────────
// Response shapes, mirroring `DqOverview` / `DqDrillResult` in
// `packages/db/src/student-dq.ts` and `apps/api/src/education/
// student-dq.service.ts`. Declared here (not imported from @kku/db —
// the web app does not depend on it) and re-used by the server
// component, which imports them as types.
// ─────────────────────────────────────────────────────────────────────

export interface DqModuleCellDto {
  moduleKey: string;
  moduleNo: number;
  moduleKind: string;
  /** Null = nobody took it. Never render this as 0. */
  mean: number | null;
  takenCount: number;
  studentsInScope: number;
  coveragePct: number | null;
}

export interface DqDrillRowDto {
  facultyName: string;
  facultyId: string | null;
  /** Null on a faculty row AND on the "Program not identified" bucket —
   *  the two are told apart by which array the row arrived in, never by
   *  this field. */
  programId: string | null;
  programName: string | null;
  studentsTested: number;
  studentsWithScores: number;
  /** Null when suppressed (fewer than 5 scored students). */
  studentsAllPassed: number | null;
  overallMean: number | null;
  suppressed: boolean;
  modules: DqModuleCellDto[];
}

export interface DqDrillResponse {
  methodologyVersion: string;
  faculties: DqDrillRowDto[];
  programs: DqDrillRowDto[];
}

export interface DqOverviewResponse {
  methodologyVersion: string;
  studentsTested: number;
  studentsWithScores: number;
  /** Null when the selection is suppressed — fewer than 5 scored
   *  students, so the pass verdict and every module mean are withheld.
   *  Counts stay visible. */
  studentsAllPassed: number | null;
  suppressed: boolean;
  facultyCount: number;
  programsResolved: number;
  studentsUnplaced: number;
  modules: DqModuleCellDto[];
  /** ISO string over the wire (a `Date` in the API layer). */
  refreshedAt: string | null;
  coverage: {
    fetched: number;
    /** Students the source flags `hasResult` — wider than `withScores`,
     *  because a result can carry no module payload. Null when the
     *  refresh that wrote the cubes predates the counter. */
    withResult: number | null;
    withScores: number;
    matchRatePct: number;
    unmatchedFacultyNames: string[];
    allPassedInconsistent: number;
  } | null;
}

/** `DqRadarResult` + the service's `comparisonLabel`. Both series are
 *  already aligned against `DQ_MODULES` of the requested kind and share
 *  an index, which is what `RadarChartSmall.comparisons` requires. */
export interface DqRadarResponse {
  methodologyVersion: string;
  /** What the scope series covers, resolved by the API (a programme
   *  name, a faculty name, or 'University'). It does NOT encode the
   *  cohort filter — the legend adds that. */
  scopeLabel: string;
  /** What the comparison series covers, in words. Rendered verbatim:
   *  the ring is computed over the whole institution regardless of the
   *  caller's clamp, and a legend reading "University" when it meant
   *  something else is the exact bug this field exists to prevent. */
  comparisonLabel: string;
  scope: DqModuleCellDto[];
  university: DqModuleCellDto[];
  studentsWithScores: number;
  suppressed: boolean;
}

/** The radar target the server resolved for this render. */
export interface DqRadarScopeDto {
  facultyName: string | null;
  programId: string | null;
}

export type DqModuleKindFilter = 'THEORY' | 'WORKSHOP';

/**
 * A module taken by fewer than this share of the scope's scored students
 * is called out beneath the chart: its mean describes the people who
 * took it, not the scope.
 *
 * Set from the measured shape of the data rather than picked round. At
 * university scope modules 1-12 sit at ~94% coverage and module 13
 * (Generative AI, still rolling out) at 57% — the one module on the
 * chart whose mean must not be read as the cohort's. A 50% line would
 * clear all thirteen and disclose nothing; 75% separates a
 * still-arriving module from a fully-taken one with room on both sides.
 */
const THIN_COVERAGE_PCT = 75;

interface Props {
  overview: DqOverviewResponse;
  drill: DqDrillResponse;
  /** Null when the radar request failed — the card says so; the table
   *  above carries the same per-module figures either way. */
  radar: DqRadarResponse | null;
  radarScope: DqRadarScopeDto;
  /** `DQ_MODULES` from `@kku/shared`, in framework order — see the
   *  import note above for why it arrives as a prop. */
  modules: DqModule[];
  /** Pass mark (70) from `@kku/shared`, for the methodology note. */
  passMark: number;
  /** `DQ_MIN_CELL_STUDENTS` from `@kku/db` — the scored-student floor
   *  below which scores are withheld. Rendered rather than written into
   *  the copy, so moving the floor cannot leave the page claiming a
   *  number the query layer no longer uses. */
  minCellStudents: number;
  /** Every faculty the caller may see, unnarrowed by the current filter,
   *  so a selection can be swapped and not only narrowed. */
  facultyOptions: string[];
  /** Cohorts present in the cube under the current faculty selection —
   *  the rail never offers a cut with no data behind it. */
  cohortOptions: number[];
}

const TH_COLLATOR = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

/**
 * The chip after a row label.
 *
 * Suppressed rows come back with null means and visible headcounts, so
 * the chip has to say WHY the dashes are there — a withheld score must
 * not read as a zero one. It names `scored` explicitly because that is
 * the column suppression keys on: a row can read "13 tested" and still
 * be withheld on 4 scored, and without the word the badge looks like a
 * bug sitting next to the headcount.
 *
 * An unplaced row that is ALSO suppressed carries both facts: dropping
 * the suppression half would leave its dashes unexplained, which is the
 * exact ambiguity the chip exists to remove.
 */
function rowBadge(
  opts: { suppressed: boolean; unplaced: boolean },
  minCellStudents: number,
): DrillRowBadge | undefined {
  const withheld = `n<${minCellStudents} scored`;
  if (opts.unplaced) {
    return { text: opts.suppressed ? `unplaced · ${withheld}` : 'unplaced', tone: 'muted' };
  }
  return opts.suppressed ? { text: withheld, tone: 'muted' } : undefined;
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? (100 * part) / whole : null;
}

/** Share of scored students the source marks `allPassed`. Scored — not
 *  tested — is the denominator: a student with no module payload has no
 *  verdict to count either way. Null when the row is suppressed. */
function passedPct(row: DqDrillRowDto): number | null {
  if (row.studentsAllPassed === null) return null;
  return pctOf(row.studentsAllPassed, row.studentsWithScores);
}

/** One metric per module column, keyed by module key. A module the row
 *  has no cube entry for is `null`, which the pivot renders as `—`. */
function moduleMetrics(row: DqDrillRowDto, modules: DqModule[]): Record<string, number | null> {
  const byKey = new Map(row.modules.map((m) => [m.moduleKey, m]));
  const out: Record<string, number | null> = {};
  for (const m of modules) out[m.key] = byKey.get(m.key)?.mean ?? null;
  return out;
}

function metricsFor(row: DqDrillRowDto, modules: DqModule[]): Record<string, number | null> {
  return {
    overall: row.overallMean,
    passedPct: passedPct(row),
    tested: row.studentsTested,
    // Never suppressed, and on screen next to Tested: it is the number
    // the ≥N gate actually tests, so a reader can see why a row with a
    // healthy Tested count is still withheld.
    scored: row.studentsWithScores,
    ...moduleMetrics(row, modules),
  };
}

export function StudentDqClient({
  overview,
  drill,
  radar,
  radarScope,
  modules,
  passMark,
  minCellStudents,
  facultyOptions,
  cohortOptions,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the single source of truth for the rail. Seeding
  // `useState` from props and never re-syncing leaves the chips showing
  // a stale selection after Back/Forward: the soft navigation re-renders
  // with new data, but a state initialiser only runs on mount, so the
  // table and the chips disagree about what is filtered.
  const faculty = React.useMemo(() => searchParams.getAll('facultyName'), [searchParams]);
  const cohort = React.useMemo(() => searchParams.getAll('cohortYearBE'), [searchParams]);
  const kind: DqModuleKindFilter = searchParams.get('kind') === 'WORKSHOP' ? 'WORKSHOP' : 'THEORY';

  // The radar's target, as the URL carries it — NOT as the server
  // resolved it. The picker reads "Whole selection" while no target is
  // set, even though the server may have resolved that to a single
  // filtered faculty; re-emitting the resolution as an explicit target
  // would leave two places deciding the default and eventually
  // disagreeing about it. `radarScope` (resolved) drives the wording
  // below; this drives the control.
  const radarFacultyParam = searchParams.get('radarFaculty');
  const radarProgramParam = searchParams.get('radarProgram');
  const targetParamValue = radarProgramParam
    ? `p:${radarProgramParam}|${radarFacultyParam ?? ''}`
    : radarFacultyParam
      ? `f:${radarFacultyParam}`
      : '';

  const apply = (next: {
    faculty?: string[];
    cohort?: string[];
    kind?: DqModuleKindFilter;
    /** '' = whole selection, `f:<facultyName>`, `p:<programId>|<facultyName>`. */
    radarTarget?: string;
  }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.cohort ?? cohort).forEach((v) => params.append('cohortYearBE', v));
    const k = next.kind ?? kind;
    if (k !== 'THEORY') params.append('kind', k);
    // Changing the data filter clears the radar target: the faculty or
    // programme it pointed at may not be in the new selection at all, and
    // a chart aimed outside the table beneath it is worse than one aimed
    // at the whole selection. Switching Theory/Workshop keeps it — that
    // is a change of axes, not of population.
    const filterChanged = next.faculty !== undefined || next.cohort !== undefined;
    const target = next.radarTarget ?? (filterChanged ? '' : targetParamValue);
    if (target.startsWith('p:')) {
      const rest = target.slice(2);
      const sep = rest.indexOf('|');
      const programId = sep === -1 ? rest : rest.slice(0, sep);
      const targetFaculty = sep === -1 ? '' : rest.slice(sep + 1);
      params.append('radarProgram', programId);
      // The faculty travels with the programme so the radar reads the
      // same cube rows the drill row does: one programme can appear under
      // two faculty names, and those are two different populations.
      if (targetFaculty) params.append('radarFaculty', targetFaculty);
    } else if (target.startsWith('f:')) {
      params.append('radarFaculty', target.slice(2));
    }
    router.push(`/education/student-dq${params.toString() ? `?${params}` : ''}`);
  };

  const anyFilter = faculty.length > 0 || cohort.length > 0;

  // ── Tree: faculty rows as the API computed them, programs beneath ──
  //
  // Faculty figures are taken from `drill.faculties` verbatim. They are
  // NOT re-derived from the program rows: suppression nulls the mean on
  // every program cell with fewer than five scored students, so folding
  // children together would quietly drop exactly those students out of
  // their faculty's mean. The API groups at faculty scope for this
  // reason — see `dqFacultyRows` in packages/db/src/student-dq.ts.
  const rows: DrillRow[] = React.useMemo(() => {
    const childrenByFaculty = new Map<string, DqDrillRowDto[]>();
    for (const p of drill.programs) {
      const list = childrenByFaculty.get(p.facultyName) ?? [];
      list.push(p);
      childrenByFaculty.set(p.facultyName, list);
    }

    const childRow = (p: DqDrillRowDto): DrillRow => {
      const unplaced = p.programId === null;
      return {
        label: unplaced ? 'Program not identified' : (p.programName ?? '(unnamed program)'),
        emphasis: unplaced ? 'muted' : undefined,
        badge: rowBadge({ suppressed: p.suppressed, unplaced }, minCellStudents),
        metrics: metricsFor(p, modules),
        // The unplaced bucket gets no key: it is students the export
        // could not match to a programme, not a scope the radar can plot.
        // Carrying the faculty alongside the id is what keeps a row that
        // appears under two faculties pointing at its own population.
        selectionKey: unplaced ? undefined : `p:${p.programId}|${p.facultyName}`,
      };
    };

    const buildChildren = (facultyName: string): DrillRow[] => {
      const kids = childrenByFaculty.get(facultyName) ?? [];
      childrenByFaculty.delete(facultyName);
      const placed = kids
        .filter((k) => k.programId !== null)
        .sort((a, b) => TH_COLLATOR.compare(a.programName ?? '', b.programName ?? ''));
      // The unidentified bucket sorts last within its faculty: it is a
      // coverage statement about students we could not place, not a
      // programme competing with the ones above it.
      const unplaced = kids.filter((k) => k.programId === null);
      return [...placed, ...unplaced].map(childRow);
    };

    const facultyRows: DrillRow[] = drill.faculties.map((f) => ({
      label: f.facultyName,
      badge: rowBadge({ suppressed: f.suppressed, unplaced: false }, minCellStudents),
      metrics: metricsFor(f, modules),
      children: buildChildren(f.facultyName),
      selectionKey: `f:${f.facultyName}`,
    }));

    // Both arrays come from the same cube scan, so every program's
    // faculty should appear above. If one ever does not, show it rather
    // than dropping the students — with no faculty figures, because the
    // only honest faculty figure is one the API computed.
    const orphans: DrillRow[] = [...childrenByFaculty.entries()].map(([name, kids]) => ({
      label: `${name} — no faculty row returned`,
      emphasis: 'warn' as const,
      metrics: { overall: null, passedPct: null, tested: null, scored: null },
      children: kids.map(childRow),
    }));

    return [...facultyRows, ...orphans];
  }, [drill, modules, minCellStudents]);

  // Framework order, straight from DQ_MODULES. Theory and workshop
  // modules 5-8 share a `shortEn`, so workshop headers carry a suffix —
  // without it four column pairs would be indistinguishable.
  const columns: DrillColumn[] = React.useMemo(
    () => [
      { key: 'overall', label: 'Overall', format: 'decimal1' },
      { key: 'passedPct', label: 'Passed %', format: 'decimal1' },
      { key: 'tested', label: 'Tested', format: 'int' },
      { key: 'scored', label: 'Scored', format: 'int' },
      ...modules.map(
        (m): DrillColumn => ({
          key: m.key,
          label: m.kind === 'WORKSHOP' ? `${m.shortEn} · ws` : m.shortEn,
          format: 'decimal1',
        }),
      ),
    ],
    [modules],
  );

  const scoredPct = pctOf(overview.studentsWithScores, overview.studentsTested);
  const passPct =
    overview.studentsAllPassed === null
      ? null
      : pctOf(overview.studentsAllPassed, overview.studentsWithScores);

  // Module 13 in the framework table is the Generative AI module; find
  // it by domain rather than by hardcoding a key here.
  const genAi = modules.find((m) => m.kind === 'THEORY' && m.domain === 'GENERATIVE_AI');
  const genAiCell = genAi ? overview.modules.find((m) => m.moduleKey === genAi.key) : undefined;

  // ── Radar ────────────────────────────────────────────────────────
  //
  // Both series arrive aligned against the framework's module list for
  // the requested kind, so they are mapped straight through: reordering
  // or filtering either one here would rotate it against the other and
  // the overlay would compare a module with its neighbour.
  const moduleByKey = React.useMemo(() => new Map(modules.map((m) => [m.key, m])), [modules]);
  const toPoints = React.useCallback(
    (cells: DqModuleCellDto[]): RadarPoint[] =>
      cells.map((c) => ({
        label: moduleByKey.get(c.moduleKey)?.shortEn ?? c.moduleKey,
        // Null stays null. The primitive draws a gap and suffixes the
        // axis with '· n/d'; a 0 would draw a spike into the centre and
        // read as "they scored nothing" rather than "nobody took it".
        value: c.mean,
      })),
    [moduleByKey],
  );

  // ── Radial scale ────────────────────────────────────────────────────
  // DQ scores cluster hard against the top of the scale: university-wide
  // the 13 theory means span 67.6-89.7, and a faculty is much the same.
  // Plotted on a 0-100 axis every one of them sits in the outer quarter
  // of the radius and the polygon reads as a circle — the shape carries
  // no information, which is the whole point of a radar.
  //
  // So the axis floor drops to the plotted data's decade instead of 0.
  // Two constraints make that honest rather than flattering:
  //
  //  1. The floor is computed across BOTH series. Using the scope's own
  //     minimum would clip the comparison ring wherever the university
  //     scores lower, silently drawing it at the centre.
  //  2. It is never raised above FLOOR_CAP. Programme-level cells go as
  //     low as 5.6 in this data (30 cells below 60, 9 below 50); a fixed
  //     60 floor would render a programme scoring 5.6 exactly like one
  //     scoring 60. When the data goes low, the axis follows it down.
  //
  // In the common case this yields 60-100 for every scope, so faculties
  // stay comparable with each other; an outlier scope widens instead of
  // lying. The floor is stated in words beneath the chart — the axis
  // ticks show it, but nobody scanning shapes reads axis ticks.
  const FLOOR_CAP = 60;
  const radarDomain = React.useMemo((): [number, number] => {
    const values = [...(radar?.scope ?? []), ...(radar?.university ?? [])]
      .map((c) => c.mean)
      .filter((v): v is number => v !== null);
    if (values.length === 0) return [0, 100];
    const floor = Math.floor(Math.min(...values) / 10) * 10;
    return [Math.max(0, Math.min(FLOOR_CAP, floor)), 100];
  }, [radar]);

  // The API's scopeLabel names the faculty/programme but knows nothing of
  // the cohort filter, which the API nonetheless applies to the series.
  // Appending it here keeps the legend equal to what is plotted.
  const cohortNote = cohort.length > 0 ? ` · BE ${cohort.join(', ')}` : '';
  // When nothing narrows the scope, the two series are the same
  // population and the dashed overlay would sit exactly on the filled
  // one — a benchmark that benchmarks against itself. Say so instead.
  const comparisonIsScope =
    radarScope.facultyName === null && radarScope.programId === null && cohort.length === 0;
  // `mean !== null` is load-bearing, not defensive: a module nobody took
  // has a coverage of 0, which clears the threshold trivially and put
  // "thinly taken (0% of scored students) … each mean describes the
  // students who took the module" on screen for a module with no mean at
  // all. Nobody-took-it is already said on the axis, as `· n/d`.
  const thinlyTaken = (radar?.scope ?? []).filter(
    (c) => c.mean !== null && c.coveragePct !== null && c.coveragePct < THIN_COVERAGE_PCT,
  );

  // Faculties and their programmes, as targets for the chart. Built from
  // the same drill payload the table renders, so the picker can only
  // offer a scope that is on screen beneath it.
  const scopeGroups = React.useMemo(
    () =>
      drill.faculties.map((f) => ({
        facultyName: f.facultyName,
        programs: drill.programs
          .filter((p) => p.facultyName === f.facultyName && p.programId !== null)
          .sort((a, b) => TH_COLLATOR.compare(a.programName ?? '', b.programName ?? '')),
      })),
    [drill],
  );
  const scopeValues = React.useMemo(() => {
    const set = new Set<string>(['']);
    for (const g of scopeGroups) {
      set.add(`f:${g.facultyName}`);
      for (const p of g.programs) set.add(`p:${p.programId}|${g.facultyName}`);
    }
    return set;
  }, [scopeGroups]);
  // A target left over from a wider filter still drives the chart (the
  // server fetched it), so it gets an option of its own rather than the
  // control quietly reading "Whole selection" while the chart shows a
  // programme.
  const targetIsOffList = targetParamValue !== '' && !scopeValues.has(targetParamValue);

  const refreshed = overview.refreshedAt ? new Date(overview.refreshedAt) : null;
  // Distinct from `overview.programsResolved`, which counts distinct
  // programmes: one programme taught to students recorded under two
  // faculty names is two rows here and one programme there. Both
  // figures are labelled so the difference reads as a difference.
  const placedRowCount = drill.programs.filter((p) => p.programId !== null).length;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail — URL state, shareable ──────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={facultyOptions.map((f) => ({ value: f, label: f }))}
            selected={faculty}
            onChange={(vs) => apply({ faculty: vs })}
          />
          <MultiSelectField
            label="Cohort (admission year)"
            options={cohortOptions.map((y) => ({
              value: String(y),
              label: `BE ${y}`,
              hint: `CE ${y - 543}`,
            }))}
            selected={cohort}
            onChange={(vs) => apply({ cohort: vs })}
            preserveOrder
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Radar axes</span>
            <div className="inline-flex overflow-hidden rounded-md border border-subtle">
              {(['THEORY', 'WORKSHOP'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => apply({ kind: k })}
                  className={
                    kind === k
                      ? 'bg-surface-3 px-3 py-1 text-xs font-medium text-text-primary'
                      : 'bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2'
                  }
                >
                  {k === 'THEORY' ? 'Theory' : 'Workshop'}
                </button>
              ))}
            </div>
          </div>
          {anyFilter && (
            <button
              type="button"
              className="rounded-md border border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              // Clears the data filters and leaves the Theory/Workshop
              // view where the reader put it — and goes through `apply`
              // so the URL it pushes and the chips it clears can never
              // describe different things.
              onClick={() => apply({ faculty: [], cohort: [] })}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {num(overview.studentsTested)} students tested
            <span className="px-1">·</span>
            {num(overview.facultyCount)} faculties
            <span className="px-1">·</span>
            {num(overview.programsResolved)} distinct programmes matched
          </span>
        </div>
      </Card>

      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Students tested"
          value={num(overview.studentsTested)}
          subtitle="everyone who has sat the DQ test, all cohorts"
        />
        <KpiTile
          label="With module scores"
          value={num(overview.studentsWithScores)}
          subtitle={
            scoredPct === null
              ? 'no students in this selection'
              : `${scoredPct.toFixed(1)}% of those tested carry a score payload`
          }
        />
        <KpiTile
          label="Passed (DQ verdict)"
          value={overview.studentsAllPassed === null ? '—' : num(overview.studentsAllPassed)}
          subtitle={
            // Suppressed and empty are different states and must not
            // share a caption: one is "we will not say", the other is
            // "there is nothing to say".
            overview.suppressed && overview.studentsWithScores > 0
              ? `withheld — fewer than ${minCellStudents} scored students in this selection (${num(
                  overview.studentsWithScores,
                )})`
              : passPct === null
                ? 'no scored students in this selection'
                : `${passPct.toFixed(1)}% of scored students, as flagged by DQ`
          }
        />
        <KpiTile
          label={genAi ? `${genAi.nameEn} adoption` : 'Module adoption'}
          value={
            genAiCell?.coveragePct === null || genAiCell?.coveragePct === undefined
              ? '—'
              : `${genAiCell.coveragePct.toFixed(1)}%`
          }
          subtitle={
            genAiCell
              ? `taken by ${num(genAiCell.takenCount)} of ${num(genAiCell.studentsInScope)} scored students${
                  genAiCell.mean === null
                    ? ''
                    : ` · mean ${genAiCell.mean.toFixed(1)} among those who took it`
                }`
              : 'module not present in the current refresh'
          }
        />
      </div>

      {/* ── Faculty → Program drill-down ────────────────────────── */}
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">
            Digital Intelligence results by faculty and program
          </h3>
          <span className="text-xs text-text-tertiary">
            {num(drill.faculties.length)} faculty rows
            <span className="px-1">·</span>
            {num(placedRowCount)} faculty &times; programme rows
          </span>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          Click the arrow beside a faculty to open its programs, or click a name to plot that
          faculty or programme on the module profile below. Overall is the weighted mean across
          theory modules 1&ndash;12 &mdash; module 13 keeps its own column but stays out of the
          headline, because its rollout has reached faculties unevenly and the headline is the one
          figure faculties are compared on. Passed % is the share of scored students DQ itself marks
          as having passed. Tested counts everyone who sat the test; Scored counts those whose
          result carries module scores, and it is Scored that decides whether a row is withheld. A
          dash means the figure is not available &mdash; either nobody took that module, or the row
          holds fewer than {minCellStudents} scored students and its scores are withheld (marked{' '}
          <span className="font-medium">n&lt;{minCellStudents} scored</span>). Dashes are never
          zeros.
        </p>
        <div className="mt-3">
          {rows.length === 0 ? (
            // An empty result under a filter is a fact about the filter,
            // not about the connector — and the rail above stays on
            // screen so the reader can widen it again.
            <p className="rounded-md border border-subtle bg-surface-2 px-3 py-6 text-center text-xs text-text-secondary">
              No rows match this filter. Widen the faculty or cohort selection above, or clear the
              filters.
            </p>
          ) : (
            <DrillDownPivot
              rowHeaderLabel="Faculty / program"
              rows={rows}
              columns={columns}
              maxDepth={2}
              // Same URL state the radar's own picker writes, so the two
              // controls cannot disagree about what is plotted.
              onSelect={(row) => {
                if (row.selectionKey) apply({ radarTarget: row.selectionKey });
              }}
              selectHint="Plot on the module profile"
            />
          )}
        </div>
        <p className="mt-3 text-xs text-text-tertiary">
          Pass mark is {passMark} on every module. A score of 0 is treated as &ldquo;not
          taken&rdquo; and excluded from every average, so a module that has only just rolled out
          reads as thin coverage rather than as poor performance. Faculty figures are aggregated at
          faculty scope from the source sums, never averaged from the program rows beneath them.
          Scores and the pass verdict are withheld on any row with fewer than {minCellStudents}{' '}
          scored students. Rows headed &ldquo;Program not identified&rdquo; are students the DQ
          export could not be matched to a current programme — mostly past cohorts and the newest
          intake — and are a coverage statement, not a programme.
        </p>
        <p className="mt-1 text-xs text-text-tertiary">
          Methodology <span className="font-medium">{drill.methodologyVersion}</span>
          <span className="px-1">·</span>
          {refreshed
            ? `source refreshed ${refreshed.toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}`
            : 'source refresh time unknown'}
        </p>
      </Card>

      {/* ── Module profile radar ────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold">
            Module profile &mdash; {kind === 'THEORY' ? 'theory' : 'workshop'} modules
          </h3>
          <label className="flex min-w-0 items-center gap-2 text-xs text-text-tertiary">
            Scope
            <select
              // A select sizes itself to its longest option, and these are
              // full Thai programme names — left alone it was 500px wide
              // and pushed the page into horizontal scroll on a narrow
              // viewport. Capped here; the native control clips the text
              // and the full name stays readable once the list is open.
              className="max-w-[16rem] rounded-md border border-subtle bg-surface-1 px-2 py-1 text-xs text-text-primary"
              value={targetParamValue}
              onChange={(e) => apply({ radarTarget: e.target.value })}
            >
              <option value="">Whole selection</option>
              {targetIsOffList && (
                <option value={targetParamValue}>
                  {radar ? radar.scopeLabel : 'Current target'} &mdash; outside the current filter
                </option>
              )}
              {scopeGroups.map((g) => (
                <optgroup key={g.facultyName} label={g.facultyName}>
                  <option value={`f:${g.facultyName}`}>
                    {g.facultyName} &mdash; all programmes
                  </option>
                  {g.programs.map((p) => (
                    <option key={p.programId} value={`p:${p.programId}|${g.facultyName}`}>
                      {p.programName ?? '(unnamed program)'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        {radar === null ? (
          <p className="mt-3 rounded-md border border-subtle bg-surface-2 px-3 py-6 text-center text-xs text-text-secondary">
            The module profile could not be loaded. The per-module figures in the table above are
            unaffected &mdash; they come from a separate request.
          </p>
        ) : radar.suppressed ? (
          // Every scope mean is withheld here, so the chart would be a
          // ring of gaps. Drawing it would look like a measured profile
          // that happens to be empty; it is a refusal to publish one.
          <p className="mt-3 rounded-md border border-subtle bg-surface-2 px-3 py-6 text-center text-xs text-text-secondary">
            {radar.studentsWithScores === 0 ? (
              // "We will not say" and "there is nothing to say" are
              // different states and must not share a caption — the same
              // distinction the Passed KPI draws above.
              <>
                No profile for <span className="font-medium">{radar.scopeLabel}</span>
                {cohortNote}: nobody in this scope has a result carrying module scores.
              </>
            ) : (
              <>
                Scores withheld for <span className="font-medium">{radar.scopeLabel}</span>
                {cohortNote}. This scope holds {num(radar.studentsWithScores)} scored{' '}
                {radar.studentsWithScores === 1 ? 'student' : 'students'}, fewer than the{' '}
                {minCellStudents} needed to publish per-module means. Widen the scope or the cohort
                filter to see a profile.
              </>
            )}
          </p>
        ) : (
          // The chart is a fixed 720px and the shared primitive takes no
          // responsive sizing, so on a narrow card it must scroll inside
          // its own box — the page body never scrolls sideways. The inner
          // `min-w-fit` is what makes that work with centring: without it
          // the centred row would be clipped on its left edge, out of
          // reach of the scrollbar, once the content exceeds the box.
          <div className="mt-3 overflow-x-auto">
            <div className="flex min-w-fit justify-center">
              <RadarChartSmall
                points={toPoints(radar.scope)}
                // Verbatim from the API. It states exactly which
                // population the ring covers; it is not the caller's
                // scope wearing the word "University".
                comparisons={
                  comparisonIsScope
                    ? []
                    : [{ label: radar.comparisonLabel, points: toPoints(radar.university) }]
                }
                seriesLabel={`${radar.scopeLabel}${cohortNote}`}
                // 13 theory axes at fontSize 11: the primitive's label
                // gutter is fixed at 56px, so the outer radius has to
                // come from the HEIGHT (Recharts takes 80% of the
                // smaller side) for the widest labels — 'Collaboration',
                // 'Presentation' — to have room beyond the polygon.
                // 720 x 420 leaves the labels clear at every vertex;
                // narrowing the box or squaring it off puts them back
                // over the grid.
                width={720}
                height={420}
                // Not the default 0-100: see radarDomain above.
                domain={radarDomain}
              />
            </div>
          </div>
        )}

        {radar !== null && !radar.suppressed && (
          <>
            {radarDomain[0] > 0 && (
              <p className="mt-2 text-xs text-text-tertiary">
                The axis runs {radarDomain[0]}&ndash;100, not 0&ndash;100. DQ scores cluster near
                the top of the scale, so a full-scale plot draws every module at almost the same
                radius; starting at {radarDomain[0]} makes the differences legible, but it also
                magnifies them &mdash; read the shape as relative, and the ring labels for the
                actual values.
                {radarDomain[0] < passMark && ` The pass mark, ${passMark}, sits inside the chart.`}
              </p>
            )}
            {thinlyTaken.length > 0 && (
              <p className="mt-2 text-xs text-warning">
                Thinly taken:{' '}
                {thinlyTaken
                  .map(
                    (c) =>
                      `${moduleByKey.get(c.moduleKey)?.nameEn ?? c.moduleKey} (${c.coveragePct!.toFixed(
                        0,
                      )}% of scored students)`,
                  )
                  .join(', ')}
                . Fewer than {THIN_COVERAGE_PCT}% of this scope&rsquo;s scored students have taken
                these, so each mean describes the students who took the module, not the scope
                &mdash; a thinly-taken module is not a strong one.
              </p>
            )}
            <p className="mt-2 text-xs text-text-tertiary">
              {comparisonIsScope ? (
                <>
                  {/* Scoped to the radar deliberately: the multi-faculty
                      note below says the table IS narrowed, and an
                      unqualified "nothing narrows this selection" beside
                      it reads as a contradiction rather than as two
                      statements about two different things. */}
                  No comparison ring: nothing narrows the radar&rsquo;s scope, so it{' '}
                  <span className="font-medium">is</span> the comparison population (
                  {radar.comparisonLabel}). Pick a faculty or programme above to see one against the
                  institution.
                </>
              ) : (
                <>
                  Solid ring is{' '}
                  <span className="font-medium">
                    {radar.scopeLabel}
                    {cohortNote}
                  </span>{' '}
                  ({num(radar.studentsWithScores)} scored students); the dashed ring is{' '}
                  <span className="font-medium">{radar.comparisonLabel}</span> &mdash; it is not
                  recomputed inside the current filter. Click either legend entry to hide it.
                </>
              )}{' '}
              An axis marked <span className="font-medium">&middot; n/d</span> is a module nobody in
              this scope has taken; the polygon skips it rather than dropping to zero.
            </p>
            {radarScope.facultyName === null &&
              radarScope.programId === null &&
              faculty.length > 1 && (
                <p className="mt-1 text-xs text-warning">
                  {faculty.length} faculties are selected, and the radar plots one scope at a time
                  &mdash; it is showing {radar.scopeLabel}, not the union of the selected faculties.
                  Pick one above to see it on its own.
                </p>
              )}
          </>
        )}
      </Card>

      {/* ── Coverage: what this dashboard does not cover ─────────── */}
      {overview.coverage && (
        <CoveragePanel coverage={overview.coverage} minCellStudents={minCellStudents} />
      )}
    </div>
  );
}

/**
 * What the refresh could not place, sized.
 *
 * Every figure here describes the whole DQ export as the connector last
 * read it — NOT the current filter. That is the point: the reader needs
 * to know how much of the source never reaches the table above, and a
 * filtered version of that answer would move every time the rail moved.
 * The panel says so in its first line rather than letting the numbers be
 * mistaken for the selection's.
 */
function CoveragePanel({
  coverage,
  minCellStudents,
}: {
  coverage: NonNullable<DqOverviewResponse['coverage']>;
  minCellStudents: number;
}) {
  const [open, setOpen] = React.useState(false);
  // Tested minus scored. NOT "students whose result carries no scores" —
  // that is only the part of this gap where a result exists at all, and
  // conflating the two was a false claim on a panel whose job is the
  // opposite. `withResult` is what splits it.
  const noScores = coverage.fetched - coverage.withScores;
  const scoredPct = pctOf(coverage.withScores, coverage.fetched);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium hover:text-accent-default"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Coverage &mdash; {num(coverage.withScores)} of {num(coverage.fetched)} exported students
        carry module scores
        {scoredPct !== null && ` (${scoredPct.toFixed(1)}%)`}, and{' '}
        {coverage.matchRatePct.toFixed(1)}% match a current programme
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 text-xs text-text-secondary">
          <p className="text-text-tertiary">
            These figures describe the whole DQ export at the last refresh, not the selection above
            &mdash; they are what the source contains, before any filter.
          </p>
          <div>
            <div className="font-medium text-text-primary">
              Tested {num(coverage.fetched)} &middot; scored {num(coverage.withScores)}
            </div>
            <p className="mt-1">
              {coverage.withResult === null ? (
                // The refresh that wrote these cubes predates the
                // `hasResult` counter, so the gap cannot be split. Say
                // its size and stop there rather than attributing all of
                // it to one of the two states.
                <>
                  {num(noScores)} of the tested students carry no module scores. This refresh did
                  not record how many of them have a result on file at all, so the gap is not broken
                  down here; re-run the connector to populate it.
                </>
              ) : (
                <>
                  The gap is two different things, not one.{' '}
                  {num(coverage.fetched - coverage.withResult)} of the tested students have no
                  result on file at all, and a further{' '}
                  {num(coverage.withResult - coverage.withScores)} have a result that carries no
                  module scores.
                </>
              )}{' '}
              Both are counted as tested and both are absent from every mean, and it is the scored
              count &mdash; not the tested one &mdash; that decides whether a row clears the{' '}
              {minCellStudents}-student floor.
            </p>
          </div>
          <div>
            <div className="font-medium text-text-primary">
              Programme match rate {coverage.matchRatePct.toFixed(1)}%
            </div>
            <p className="mt-1">
              The export is cumulative &mdash; every cohort that has ever sat the test &mdash; while
              the enrolment snapshot we match against is current-year. Past cohorts have left it and
              the newest intake has not yet entered it, so neither can be matched to a programme;
              they appear under &ldquo;Program not identified&rdquo; in the table above. The
              unmatched students are in the faculty figures, just not under a programme.
            </p>
          </div>
          <div>
            <div className="font-medium text-text-primary">
              {num(coverage.unmatchedFacultyNames.length)} faculty{' '}
              {coverage.unmatchedFacultyNames.length === 1 ? 'name' : 'names'} we do not carry
            </div>
            <p className="mt-1">
              Students recorded under these names are shown under the name the export gave, with no
              link to a faculty record &mdash; campus faculties, service units and abbreviations the
              export uses in place of a full name:{' '}
              <span className="text-text-tertiary">
                {coverage.unmatchedFacultyNames.join(', ')}
              </span>
              .
            </p>
          </div>
          <div>
            <div className="font-medium text-text-primary">
              {num(coverage.allPassedInconsistent)} students marked passed despite failing a module
            </div>
            <p className="mt-1">
              The pass verdict is DQ&rsquo;s own flag, passed through unchanged &mdash; this
              dashboard never recomputes it. The source applies no single rule to it:{' '}
              {num(coverage.allPassedInconsistent)} students are flagged as passed while scoring
              below the pass mark on module 13, and others with that same profile are flagged as
              failed. Read &ldquo;Passed %&rdquo; as the source&rsquo;s verdict, not as a test
              against the pass mark.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

function KpiTile({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="mt-1 font-tabular text-3xl font-semibold">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-text-tertiary">{subtitle}</div>}
    </Card>
  );
}

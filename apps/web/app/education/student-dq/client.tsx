'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
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
  studentsAllPassed: number;
  facultyCount: number;
  programsResolved: number;
  studentsUnplaced: number;
  modules: DqModuleCellDto[];
  /** ISO string over the wire (a `Date` in the API layer). */
  refreshedAt: string | null;
  coverage: {
    fetched: number;
    withScores: number;
    matchRatePct: number;
    unmatchedFacultyNames: string[];
    allPassedInconsistent: number;
  } | null;
}

export type DqModuleKindFilter = 'THEORY' | 'WORKSHOP';

interface Props {
  overview: DqOverviewResponse;
  drill: DqDrillResponse;
  /** `DQ_MODULES` from `@kku/shared`, in framework order — see the
   *  import note above for why it arrives as a prop. */
  modules: DqModule[];
  /** Pass mark (70) from `@kku/shared`, for the methodology note. */
  passMark: number;
  /** Every faculty the caller may see, so narrowing the filter never
   *  shrinks the list you can widen it back with. */
  facultyOptions: string[];
  cohortOptions: number[];
  initialFilters: {
    facultyName: string[];
    cohortYearBE: number[];
    kind: DqModuleKindFilter;
  };
}

const TH_COLLATOR = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

/** Suppressed rows come back with null means and a visible headcount.
 *  The badge says WHY the dashes are there — a reader must not read a
 *  withheld score as a zero one. */
const SUPPRESSED_BADGE = { text: 'n<5', tone: 'muted' } as const;
const UNPLACED_BADGE = { text: 'unplaced', tone: 'muted' } as const;

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
    ...moduleMetrics(row, modules),
  };
}

export function StudentDqClient({
  overview,
  drill,
  modules,
  passMark,
  facultyOptions,
  cohortOptions,
  initialFilters,
}: Props) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [cohort, setCohort] = React.useState<string[]>(
    initialFilters.cohortYearBE.map(String),
  );
  const [kind, setKind] = React.useState<DqModuleKindFilter>(initialFilters.kind);

  const apply = (next: {
    faculty?: string[];
    cohort?: string[];
    kind?: DqModuleKindFilter;
  }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.cohort ?? cohort).forEach((v) => params.append('cohortYearBE', v));
    const k = next.kind ?? kind;
    if (k !== 'THEORY') params.append('kind', k);
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
        badge: unplaced ? UNPLACED_BADGE : p.suppressed ? SUPPRESSED_BADGE : undefined,
        metrics: metricsFor(p, modules),
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
      badge: f.suppressed ? SUPPRESSED_BADGE : undefined,
      metrics: metricsFor(f, modules),
      children: buildChildren(f.facultyName),
    }));

    // Both arrays come from the same cube scan, so every program's
    // faculty should appear above. If one ever does not, show it rather
    // than dropping the students — with no faculty figures, because the
    // only honest faculty figure is one the API computed.
    const orphans: DrillRow[] = [...childrenByFaculty.entries()].map(([name, kids]) => ({
      label: `${name} — no faculty row returned`,
      emphasis: 'warn' as const,
      metrics: { overall: null, passedPct: null, tested: null },
      children: kids.map(childRow),
    }));

    return [...facultyRows, ...orphans];
  }, [drill, modules]);

  // Framework order, straight from DQ_MODULES. Theory and workshop
  // modules 5-8 share a `shortEn`, so workshop headers carry a suffix —
  // without it four column pairs would be indistinguishable.
  const columns: DrillColumn[] = React.useMemo(
    () => [
      { key: 'overall', label: 'Overall', format: 'decimal1' },
      { key: 'passedPct', label: 'Passed %', format: 'decimal1' },
      { key: 'tested', label: 'Tested', format: 'int' },
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
  const passPct = pctOf(overview.studentsAllPassed, overview.studentsWithScores);

  // Module 13 in the framework table is the Generative AI module; find
  // it by domain rather than by hardcoding a key here.
  const genAi = modules.find((m) => m.kind === 'THEORY' && m.domain === 'GENERATIVE_AI');
  const genAiCell = genAi
    ? overview.modules.find((m) => m.moduleKey === genAi.key)
    : undefined;

  const axisCount = modules.filter((m) => m.kind === kind).length;
  const refreshed = overview.refreshedAt ? new Date(overview.refreshedAt) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter rail — URL state, shareable ──────────────────── */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={facultyOptions.map((f) => ({ value: f, label: f }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              apply({ faculty: vs });
            }}
          />
          <MultiSelectField
            label="Cohort (admission year)"
            options={cohortOptions.map((y) => ({
              value: String(y),
              label: `BE ${y}`,
              hint: `CE ${y - 543}`,
            }))}
            selected={cohort}
            onChange={(vs) => {
              setCohort(vs);
              apply({ cohort: vs });
            }}
            preserveOrder
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-tertiary">Radar axes</span>
            <div className="inline-flex overflow-hidden rounded border border-subtle">
              {(['THEORY', 'WORKSHOP'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    apply({ kind: k });
                  }}
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
              className="rounded border border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setCohort([]);
                router.push('/education/student-dq');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {num(overview.studentsTested)} students tested
            <span className="px-1">·</span>
            {num(overview.facultyCount)} faculties
            <span className="px-1">·</span>
            {num(overview.programsResolved)} programs matched
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
          value={num(overview.studentsAllPassed)}
          subtitle={
            passPct === null
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
            {num(drill.faculties.length)} faculties
            <span className="px-1">·</span>
            {num(drill.programs.filter((p) => p.programId !== null).length)} program rows
          </span>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          Click a faculty to open its programs. Overall is the weighted mean across the
          theory modules; Passed % is the share of scored students DQ itself marks as
          having passed. A dash means the figure is not available — either nobody took
          that module, or the row holds fewer than 5 scored students and its scores are
          withheld (marked <span className="font-medium">n&lt;5</span>). Dashes are never
          zeros.
        </p>
        <div className="mt-3">
          <DrillDownPivot
            rowHeaderLabel="Faculty / program"
            rows={rows}
            columns={columns}
            maxDepth={2}
          />
        </div>
        <p className="mt-3 text-xs text-text-tertiary">
          Pass mark is {passMark} on every module. A score of 0 is treated as
          &ldquo;not taken&rdquo; and excluded from every average, so a module that has
          only just rolled out reads as thin coverage rather than as poor performance.
          Faculty figures are aggregated at faculty scope from the source sums, never
          averaged from the program rows beneath them. Rows headed &ldquo;Program not
          identified&rdquo; are students the DQ export could not be matched to a current
          programme — mostly past cohorts and the newest intake — and are a coverage
          statement, not a programme.
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

      {/* ─────────────────────────────────────────────────────────
          RADAR PLACEHOLDER — the module-profile radar (scope vs
          university, driven by the Theory/Workshop toggle above) is a
          separate piece of work and is deliberately not rendered here.
          Replace this card with `RadarChartSmall` from @kku/ui.
          ───────────────────────────────────────────────────────── */}
      <Card>
        <h3 className="text-sm font-semibold text-text-secondary">Module profile radar</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Not yet available. When it lands it will plot the {axisCount}{' '}
          {kind === 'THEORY' ? 'theory' : 'workshop'} modules for the selected scope
          against the university profile. Until then the table above carries the same
          per-module figures.
        </p>
      </Card>
    </div>
  );
}

function KpiTile({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="mt-1 font-tabular text-3xl font-semibold">{value}</div>
      {subtitle && <div className="mt-1 text-xs text-text-tertiary">{subtitle}</div>}
    </Card>
  );
}

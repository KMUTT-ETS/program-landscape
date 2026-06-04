'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Card, EmptyState, Section, SortableTh, useSortableTable } from '@kku/ui';
import { FunnelPipeline, useChartPalette, type FunnelStage } from '@kku/ui';
import { HoverTooltip, TooltipProvider } from '@kku/ui';
import { ChevronDown, ChevronUp, ExternalLink, Info, Link2Off } from 'lucide-react';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect as SharedFilterSelect,
} from '@/components/filter-rail';
import { startRouteProgress } from '@/components/route-progress';

const UNASSIGNED_FACULTY_ID = '__unassigned__';
const isUnmappedProgram = (programId: string | null) => programId === null;

// ─── Types (mirror apps/api/src/education/admission-campaigns.service.ts) ───

interface CampaignMetrics {
  plan: number | null;
  seats: number | null;
  applicants: number;
  passed: number;
  sendCh: number;
  confirmCh: number;
  sendReg: number;
  enrolled: number;
  /** Enrolled from plan-bearing programs only — the % Admit numerator. */
  enrolledWithPlan: number;
  percentAdmit: number | null;
  competitionRate: number | null;
  // Plan coverage — distinct PROGRAMIDs total vs those carrying a plan.
  // % Admit covers only the `withPlan` programs (the rest are excluded from
  // both numerator and denominator); withPlan === 0 ⇒ % Admit not computable.
  planProgramsTotal: number;
  planProgramsWithPlan: number;
}

interface CampaignKpis extends CampaignMetrics {
  programs: number;
  subPrograms: number;
  campaigns: number;
  overAlloc: number | null;
}

interface CampaignRoundRow extends CampaignMetrics {
  round: string;
  programs: number;
  campaigns: number;
}

interface CampaignYearRow extends CampaignMetrics {
  acadYearBE: number;
  isComplete: boolean;
  programs: number;
  campaigns: number;
}

interface CampaignTrackNode extends CampaignMetrics {
  wProgramId: string;
  campaignName: string;
}

interface CampaignRoundNode extends CampaignMetrics {
  round: string;
  trackCount: number;
  tracks: CampaignTrackNode[];
}

interface CampaignSubProgramNode extends CampaignMetrics {
  recruitmentProgramId: string;
  currId: string | null;
  label: string;
  roundCount: number;
  rounds: CampaignRoundNode[];
}

interface CampaignProgramRow extends CampaignMetrics {
  programKey: string;
  programId: string | null;
  programNameTh: string;
  programNameEn: string | null;
  mappingMethod: string | null;
  /** Standalone new program (not yet in the curriculum catalog). */
  isNewProgram: boolean;
  facultyId: string | null;
  facultyNameTh: string;
  subProgramCount: number;
  subPrograms: CampaignSubProgramNode[];
}

interface DecliningProgramRow {
  programKey: string;
  programNameTh: string;
  facultyNameTh: string;
  currentCompetition: number | null;
  priorCompetition: number | null;
  avgYoYChange: number;
  yearsObserved: number;
}

interface FacultyOption {
  id: string;
  nameTh: string;
}

export interface CampaignDashboardPayload {
  meta: {
    availableYears: number[];
    selectedYear: number | null;
    availableRounds: string[];
    selectedRound: string | null;
    appliedFilters: {
      acadYearBE?: number | null;
      facultyId?: string | null;
      round?: string | null;
      unmappedOnly?: boolean | null;
    };
    latestCompleteYear: number | null;
    selectedYearIsComplete: boolean;
    facultiesWithData: FacultyOption[];
    hasUnassignedFaculty: boolean;
    seatDataAvailable: boolean;
    unmappedProgramCount: number;
    totalProgramCount: number;
  };
  kpis: CampaignKpis;
  byRound: CampaignRoundRow[];
  byYear: CampaignYearRow[];
  programs: CampaignProgramRow[];
  decliningPrograms: DecliningProgramRow[];
  zeroApplicantTrackCount: number;
}

const pct = (v: number | null): string => (v === null ? '—' : `${(v * 100).toFixed(0)}%`);
const numf = (v: number | null): string => (v === null ? '—' : v.toLocaleString('en-US'));
const compf = (v: number | null): string => (v === null ? '—' : `${v.toFixed(1)}×`);

function sumMetrics(items: CampaignMetrics[]): CampaignMetrics {
  let plan: number | null = null;
  let seats: number | null = null;
  let applicants = 0, passed = 0, sendCh = 0, confirmCh = 0, sendReg = 0, enrolled = 0;
  let enrolledWithPlan = 0, planProgramsTotal = 0, planProgramsWithPlan = 0;
  for (const m of items) {
    if (m.plan != null) plan = (plan ?? 0) + m.plan;
    if (m.seats != null) seats = (seats ?? 0) + m.seats;
    applicants += m.applicants;
    passed += m.passed;
    sendCh += m.sendCh;
    confirmCh += m.confirmCh;
    sendReg += m.sendReg;
    enrolled += m.enrolled;
    enrolledWithPlan += m.enrolledWithPlan;
    // PROGRAMIDs are disjoint across the items we roll up (each belongs to one
    // program), so summing the counts keeps the coverage ratio honest.
    planProgramsTotal += m.planProgramsTotal;
    planProgramsWithPlan += m.planProgramsWithPlan;
  }
  return {
    plan, seats, applicants, passed, sendCh, confirmCh, sendReg, enrolled, enrolledWithPlan,
    // Numerator + denominator over the same (plan-bearing) program set.
    percentAdmit: plan != null && plan > 0 ? enrolledWithPlan / plan : null,
    competitionRate: seats != null && seats > 0 ? applicants / seats : null,
    planProgramsTotal, planProgramsWithPlan,
  };
}

// ─── Plan coverage ──────────────────────────────────────────────────────────
// % Admit = Enrolled ÷ Plan, computed over plan-bearing programs only — both
// the numerator (enrolledWithPlan) and denominator (plan) exclude programs with
// no plan, so a partial-plan % Admit is correct but covers a subset. Only a
// fully-missing plan leaves it uncomputable. Classify for the coverage caveat.
type PlanState = 'complete' | 'partial' | 'missing';

function planState(m: CampaignMetrics): PlanState {
  if (m.planProgramsWithPlan === 0) return 'missing';
  if (m.planProgramsWithPlan < m.planProgramsTotal) return 'partial';
  return 'complete';
}

function planNote(m: CampaignMetrics): string | null {
  const st = planState(m);
  if (st === 'missing') return 'No plan data for these programs — % Admit cannot be computed.';
  if (st === 'partial')
    return `% Admit covers the ${m.planProgramsWithPlan} of ${m.planProgramsTotal} programs that have a plan; programs without a plan are excluded from both sides.`;
  return null;
}

// ─── Metric columns: shared label / source / formula config ─────────────────

type MetricKey =
  | 'plan' | 'seats' | 'applicants' | 'competitionRate' | 'passed'
  | 'sendCh' | 'confirmCh' | 'sendReg' | 'enrolled' | 'percentAdmit' | 'enrolYield';

interface MetricCol {
  key: MetricKey;
  label: string;
  /** source column / definition shown in the header title + tooltip */
  source: string;
}

const METRIC_COLS: MetricCol[] = [
  { key: 'plan', label: 'Plan', source: 'PLAN_PER_YEAER' },
  { key: 'seats', label: 'Seats', source: 'ENROLLSEAT' },
  { key: 'applicants', label: 'Applicants', source: 'TOTAL_APPLICANT' },
  { key: 'competitionRate', label: 'Comp.', source: 'Applicants ÷ Seats' },
  { key: 'passed', label: 'Passed', source: 'TOTAL_PASS' },
  { key: 'sendCh', label: 'Send CH', source: 'SEND_CLEARINGHOUSE' },
  { key: 'confirmCh', label: 'Confirm CH', source: 'CONFIRM_CLEARINGHOUSE' },
  { key: 'sendReg', label: 'Send Reg', source: 'SEND_REG_REPORTED' },
  { key: 'enrolled', label: 'Enrolled', source: 'REG_REPORTED' },
  { key: 'enrolYield', label: '% Enrol yield', source: 'Enrolled ÷ Passed' },
  { key: 'percentAdmit', label: '% Admit', source: 'Enrolled ÷ Plan' },
];
const COL_BY_KEY = new Map(METRIC_COLS.map((c) => [c.key, c]));

// % Enrol yield = Enrolled ÷ Passed — derived, not stored on CampaignMetrics.
const enrolYieldOf = (m: CampaignMetrics): number | null =>
  m.passed > 0 ? m.enrolled / m.passed : null;

function fmtMetric(key: MetricKey, m: CampaignMetrics): string {
  if (key === 'competitionRate') return compf(m.competitionRate);
  if (key === 'percentAdmit') return pct(m.percentAdmit);
  if (key === 'enrolYield') return pct(enrolYieldOf(m));
  if (key === 'plan' || key === 'seats') return numf(m[key]);
  return (m[key] as number).toLocaleString('en-US');
}

// Pretty tooltip body: value + source/formula + worked calculation.
function MetricTip({ col, m }: { col: MetricCol; m: CampaignMetrics }) {
  let formula: string | null = null;
  let calc: string | null = null;
  if (col.key === 'competitionRate') {
    formula = 'Applicants ÷ Seats';
    calc = `${numf(m.applicants)} ÷ ${numf(m.seats)} = ${compf(m.competitionRate)}`;
  } else if (col.key === 'percentAdmit') {
    formula = 'Enrolled (plan-bearing) ÷ Plan';
    calc = `${numf(m.enrolledWithPlan)} ÷ ${numf(m.plan)} = ${pct(m.percentAdmit)}`;
  } else if (col.key === 'enrolYield') {
    formula = 'Enrolled ÷ Passed';
    calc = `${numf(m.enrolled)} ÷ ${numf(m.passed)} = ${pct(enrolYieldOf(m))}`;
  } else if (col.key === 'plan') {
    formula = 'Σ over sub-programs of MAX(PLAN_PER_YEAER)';
  } else if (col.key === 'seats') {
    formula = 'Σ ENROLLSEAT across tracks';
  } else {
    formula = `Σ ${col.source}`;
  }
  // Plan-completeness caveat — shown on plan-derived (% Admit) and the raw Plan.
  const note = col.key === 'percentAdmit' || col.key === 'plan' ? planNote(m) : null;
  return (
    <div className="max-w-[18rem] text-xs">
      <div className="font-semibold">{col.label} <span className="font-normal text-text-tertiary">· {fmtMetric(col.key, m)}</span></div>
      <div className="mt-1 text-text-secondary">{formula}</div>
      {calc && <div className="mt-0.5 font-tabular text-text-secondary">{calc}</div>}
      {note && <div className="mt-1 text-[11px] text-text-tertiary">{note}</div>}
      <div className="mt-1 text-[10px] text-text-tertiary">Source: POWERBI.ADMISSION_STAT · {col.source}</div>
    </div>
  );
}

function MetricCell({ col, m }: { col: MetricCol; m: CampaignMetrics }) {
  const danger = col.key === 'percentAdmit' && m.percentAdmit !== null && m.percentAdmit < 1;
  const muted = col.key === 'plan' || col.key === 'seats';
  // Mark % Admit with a muted '*' when its plan coverage is incomplete —
  // partial (value covers a subset of programs) or missing (shown as '—').
  // The cell value itself is correct; the marker + tooltip disclose coverage.
  const ps = col.key === 'percentAdmit' ? planState(m) : 'complete';
  return (
    <td className={`px-2 py-1.5 text-right font-tabular ${col.key === 'percentAdmit' ? 'font-semibold' : ''} ${danger ? 'text-warning' : muted ? 'text-text-tertiary' : ''}`}>
      <HoverTooltip content={<MetricTip col={col} m={m} />}>
        <span className="cursor-help border-b border-dotted border-transparent hover:border-border-subtle">
          {fmtMetric(col.key, m)}
          {ps !== 'complete' && <sup className="ml-0.5 text-text-tertiary">*</sup>}
        </span>
      </HoverTooltip>
    </td>
  );
}

function MetricCells({ m }: { m: CampaignMetrics }) {
  return (
    <>
      {METRIC_COLS.map((col) => (
        <MetricCell key={col.key} col={col} m={m} />
      ))}
    </>
  );
}

// ─── Drill sort ─────────────────────────────────────────────────────────────

type DrillSortKey = MetricKey | 'name';
interface DrillSort { key: DrillSortKey; dir: 'asc' | 'desc'; }

// Numeric sort value for a metric key, incl. the derived enrolYield.
function metricSortValue(m: CampaignMetrics, key: MetricKey): number {
  if (key === 'enrolYield') return enrolYieldOf(m) ?? -Infinity;
  return (m[key as keyof CampaignMetrics] as number | null) ?? -Infinity;
}

// TCAS rounds always order by round number (non-numeric sort last).
function roundOrder(round: string): number {
  const n = parseFloat(round);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

function sortNodes<T extends CampaignMetrics>(items: T[], sort: DrillSort, nameOf: (t: T) => string): T[] {
  const arr = [...items];
  if (sort.key === 'name') {
    arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'th'));
  } else {
    const k = sort.key;
    arr.sort((a, b) => metricSortValue(a, k) - metricSortValue(b, k));
  }
  if (sort.dir === 'desc') arr.reverse();
  return arr;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CampaignsClient({
  data,
  facultyFilterLocked = false,
}: {
  data: CampaignDashboardPayload;
  facultyFilterLocked?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setFilter = (
    key: 'acadYearBE' | 'facultyId' | 'round' | 'unmappedOnly',
    value: string | null,
  ) => {
    const next = new URLSearchParams(params.toString());
    if (value && value.length > 0) next.set(key, value);
    else next.delete(key);
    startRouteProgress();
    router.push(`${pathname}?${next.toString()}`);
  };

  const { meta } = data;
  const roundSuffix = meta.selectedRound ? ` · Round ${meta.selectedRound}` : '';
  // When the user is scoped (FACULTY_USER / PROGRAM_USER) the server clamps the
  // data to their faculty; show only that faculty in the locked dropdown.
  const facultyOptions = facultyFilterLocked
    ? meta.facultiesWithData.filter((f) => f.id === meta.appliedFilters.facultyId)
    : meta.facultiesWithData;

  return (
    <TooltipProvider delayDuration={150}>
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <FilterRail cols={4}>
        <FilterField label="Entry year (BE)">
          <SharedFilterSelect value={String(meta.selectedYear ?? '')} onChange={(e) => setFilter('acadYearBE', e.target.value)}>
            {meta.availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {`BE ${y} (CE ${y - 543})${y === meta.latestCompleteYear ? ' · latest complete' : ''}`}
              </option>
            ))}
          </SharedFilterSelect>
        </FilterField>
        <FilterField label="TCAS round">
          <SharedFilterSelect value={meta.selectedRound ?? ''} onChange={(e) => setFilter('round', e.target.value || null)}>
            <option value="">All rounds</option>
            {meta.availableRounds.map((r) => (
              <option key={r} value={r}>Round {r}</option>
            ))}
          </SharedFilterSelect>
        </FilterField>
        <FilterField label="Faculty">
          <SharedFilterSelect value={meta.appliedFilters.facultyId ?? ''} onChange={(e) => setFilter('facultyId', e.target.value || null)} disabled={facultyFilterLocked}>
            {!facultyFilterLocked && <option value="">All faculties</option>}
            {facultyOptions.map((f) => (
              <option key={f.id} value={f.id} lang="th">{f.nameTh}</option>
            ))}
            {!facultyFilterLocked && meta.hasUnassignedFaculty && (
              <option value={UNASSIGNED_FACULTY_ID} lang="th">ยังไม่ถูกกำหนด (to be assigned)</option>
            )}
          </SharedFilterSelect>
        </FilterField>
        <FilterField label="Mapping">
          <SharedFilterSelect value={meta.appliedFilters.unmappedOnly ? '1' : ''} onChange={(e) => setFilter('unmappedOnly', e.target.value || null)} disabled={facultyFilterLocked}>
            <option value="">All programs</option>
            <option value="1">Unmapped only (to be assigned)</option>
          </SharedFilterSelect>
        </FilterField>
      </FilterRail>

      {/* Banners */}
      {meta.selectedYear !== null && !meta.selectedYearIsComplete && (
        <Banner tone="warning">
          BE {meta.selectedYear} (CE {meta.selectedYear - 543}) is the in-progress
          cycle — later rounds haven&apos;t run, so numbers will rise.
          {meta.latestCompleteYear !== null && (
            <button type="button" onClick={() => setFilter('acadYearBE', String(meta.latestCompleteYear))} className="ml-1 text-accent-default hover:underline">
              Switch to BE {meta.latestCompleteYear} →
            </button>
          )}
        </Banner>
      )}
      {meta.unmappedProgramCount > 0 && (
        <Banner tone="info" icon={<Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-info" />}>
          {meta.unmappedProgramCount} of {meta.totalProgramCount} recruitment
          programs aren&apos;t yet matched to a curriculum (shown as
          &ldquo;to be assigned&rdquo;). Metrics are unaffected; program
          deep-dive links light up once mapping runs.
        </Banner>
      )}

      {/* KPI strip */}
      <KpiStrip kpis={data.kpis} year={meta.selectedYear} />

      {/* Funnel + year trend */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title={`Recruitment funnel — BE ${meta.selectedYear ?? '—'}${roundSuffix}`}>
          <Card padding="md">
            {data.kpis.applicants > 0 ? (
              <FunnelPipeline stages={buildFunnel(data.kpis)} width={560} height={320} />
            ) : (
              <EmptyState title="No funnel data" description="Filters returned no rows." />
            )}
          </Card>
        </Section>
        <Section title="Year-over-year demand">
          <Card padding="md">
            <YearTrendChart byYear={data.byYear} />
          </Card>
        </Section>
      </div>

      {/* Round histogram + % Admit year-trend — side by side */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title={`By TCAS round — competition — BE ${meta.selectedYear ?? '—'}`}>
          <Card padding="md">
            <RoundPerformanceChart rows={data.byRound} />
          </Card>
        </Section>
        <Section title="% Admit — year-over-year">
          <Card padding="md">
            <PercentAdmitTrendChart byYear={data.byYear} />
          </Card>
        </Section>
      </div>

      {/* By TCAS round — full-width breakdown table */}
      <Section title={`By TCAS round — breakdown — BE ${meta.selectedYear ?? '—'}`}>
        <Card padding="none">
          <RoundTable rows={data.byRound} />
        </Card>
      </Section>

      {/* Drill pivot */}
      <Section title={`Faculty → program → sub-program → TCAS round → track — BE ${meta.selectedYear ?? '—'}${roundSuffix}`}>
        <Card padding="none">
          <CampaignDrill rows={data.programs} zeroTrackCount={data.zeroApplicantTrackCount} />
        </Card>
      </Section>

      {/* Declining demand */}
      <Section title="Declining demand — risk monitoring (competition rate below 5× and falling year-on-year)">
        <Card padding="none">
          <DecliningTable rows={data.decliningPrograms} />
        </Card>
      </Section>
    </div>
    </TooltipProvider>
  );
}

// ─── Banner ─────────────────────────────────────────────────────────────────

function Banner({ tone, icon, children }: { tone: 'warning' | 'info'; icon?: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === 'warning' ? 'border-warning/30 bg-warning/5' : 'border-info/30 bg-info/5';
  return (
    <div className={`rounded-lg border ${cls} p-3 text-sm`}>
      <div className="flex items-start gap-2">
        {icon ?? <Info className={`mt-0.5 h-4 w-4 shrink-0 ${tone === 'warning' ? 'text-warning' : 'text-info'}`} />}
        <div className="flex-1 text-text-secondary">{children}</div>
      </div>
    </div>
  );
}

// ─── KPI strip ──────────────────────────────────────────────────────────────

function KpiStrip({ kpis, year }: { kpis: CampaignKpis; year: number | null }) {
  const admitPs = planState(kpis);
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: 'positive' | 'warning' }> = [
    { label: 'Programs', value: kpis.programs.toLocaleString('en-US'), sub: `${kpis.subPrograms.toLocaleString('en-US')} sub-programs · ${kpis.campaigns.toLocaleString('en-US')} tracks` },
    {
      label: 'Plan',
      value: numf(kpis.plan),
      sub:
        admitPs === 'missing'
          ? 'not yet assigned'
          : admitPs === 'partial'
            ? `${kpis.planProgramsWithPlan}/${kpis.planProgramsTotal} programs have a plan`
            : 'annual quota',
    },
    { label: 'Seats', value: numf(kpis.seats), sub: kpis.overAlloc !== null ? `${kpis.overAlloc.toFixed(2)}× over-allocated` : 'allocated across rounds' },
    { label: 'Applicants', value: kpis.applicants.toLocaleString('en-US'), sub: `${kpis.passed.toLocaleString('en-US')} passed` },
    { label: 'Confirm CH', value: kpis.confirmCh.toLocaleString('en-US'), sub: `${kpis.sendCh.toLocaleString('en-US')} sent CH` },
    { label: 'Enrolled', value: kpis.enrolled.toLocaleString('en-US'), sub: kpis.confirmCh > 0 ? `${pct(kpis.enrolled / kpis.confirmCh)} of confirm CH` : 'reported in' },
    {
      label: 'Percent Admit',
      value: pct(kpis.percentAdmit),
      sub:
        admitPs === 'missing'
          ? 'no plan data — not computed'
          : admitPs === 'partial'
            ? `covers ${kpis.planProgramsWithPlan}/${kpis.planProgramsTotal} programs with a plan`
            : 'Enrolled ÷ Plan',
      tone:
        kpis.percentAdmit !== null && kpis.percentAdmit < 1
          ? 'warning'
          : kpis.percentAdmit !== null
            ? 'positive'
            : undefined,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-4">
          <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{t.label}</p>
          <p className={`font-tabular text-2xl font-semibold ${t.tone === 'warning' ? 'text-warning' : t.tone === 'positive' ? 'text-positive' : 'text-text-primary'}`}>{t.value}</p>
          {t.sub && <p className="text-[11px] text-text-tertiary">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function buildFunnel(kpis: CampaignKpis): FunnelStage[] {
  const stages: Array<[string, number]> = [
    ['Applicants', kpis.applicants],
    ['Passed', kpis.passed],
    ['Send CH', kpis.sendCh],
    ['Confirm CH', kpis.confirmCh],
    ['Send Reg', kpis.sendReg],
    ['Enrolled', kpis.enrolled],
  ];
  return stages.map(([label, value], i) => ({ key: `s-${i}`, label, value }));
}

// ─── Year line chart (interactive: legend toggles + hover detail) ───────────
// One reusable multi-line chart over the BE-year axis. Each series declares
// its own axis ('ratio' = left "×" scale, 'pct' = 0–1 scale), formula, and a
// worked-calculation string surfaced on hover. The legend doubles as a
// show/hide toggle per line.

type YearAxis = 'ratio' | 'pct';

interface YearSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  axis: YearAxis;
  valueOf: (r: CampaignYearRow) => number | null;
  display: (v: number | null) => string;
  formula: string;
  calc: (r: CampaignYearRow) => string;
}

function YearLineChart({
  byYear,
  series,
  pctReference,
}: {
  byYear: CampaignYearRow[];
  series: YearSeries[];
  pctReference?: { value: number; label: string };
}) {
  const palette = useChartPalette();
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());
  const [hoverYear, setHoverYear] = React.useState<number | null>(null);

  if (byYear.length === 0) return <p className="text-sm text-text-tertiary">No trend data.</p>;

  const visible = series.filter((s) => !hidden.has(s.key));
  const hasRatio = visible.some((s) => s.axis === 'ratio');
  const hasPct = visible.some((s) => s.axis === 'pct');
  const leftAxis: YearAxis = hasRatio ? 'ratio' : 'pct';
  const rightAxis: YearAxis | null = hasRatio && hasPct ? 'pct' : null;

  const W = 560, H = 240;
  const PAD = { top: 16, right: rightAxis ? 44 : 18, bottom: 38, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const years = byYear.map((y) => y.acadYearBE);
  const xMin = years[0]!, xMax = years[years.length - 1]!;
  const xPx = (x: number) => PAD.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);

  const ratioMax = Math.max(
    5,
    ...visible.filter((s) => s.axis === 'ratio').flatMap((s) => byYear.map((r) => s.valueOf(r) ?? 0)),
  );
  const pctMax = Math.max(
    1,
    pctReference?.value ?? 0,
    ...visible.filter((s) => s.axis === 'pct').flatMap((s) => byYear.map((r) => s.valueOf(r) ?? 0)),
  );
  const yRatio = (v: number) => PAD.top + (1 - v / ratioMax) * innerH;
  const yPct = (v: number) => PAD.top + (1 - v / pctMax) * innerH;
  const yOf = (s: YearSeries, v: number) => (s.axis === 'ratio' ? yRatio(v) : yPct(v));

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const leftLabel = (t: number) =>
    leftAxis === 'ratio' ? `${(t * ratioMax).toFixed(ratioMax <= 2 ? 1 : 0)}×` : `${(t * pctMax * 100).toFixed(0)}%`;

  const toggle = (key: string) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const hoverRow = hoverYear != null ? byYear.find((r) => r.acadYearBE === hoverYear) ?? null : null;
  const hoverFrac = hoverRow ? xPx(hoverRow.acadYearBE) / W : 0;
  const hoverAnchor = hoverFrac < 0.34 ? '0' : hoverFrac > 0.66 ? '-100%' : '-50%';

  return (
    <div>
      {/* Legend — click a line to show/hide it */}
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={!off}
              title={off ? `Show ${s.label}` : `Hide ${s.label}`}
              className={`flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80 ${off ? 'opacity-40' : ''}`}
            >
              <svg width="16" height="8" aria-hidden className="shrink-0">
                <line x1="0" y1="4" x2="14" y2="4" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined} />
              </svg>
              <span className={off ? 'line-through' : ''}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
          {/* gridlines + axis labels */}
          {ticks.map((t, i) => {
            const y = PAD.top + (1 - t) * innerH;
            return (
              <g key={`g${i}`}>
                <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke={palette.grid} strokeDasharray="2 4" strokeWidth={0.6} />
                <text x={PAD.left - 6} y={y + 4} textAnchor="end" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>{leftLabel(t)}</text>
                {rightAxis === 'pct' && (
                  <text x={W - PAD.right + 6} y={y + 4} textAnchor="start" className="text-[10px] font-tabular" fill={palette.positive} opacity={0.8}>{`${(t * pctMax * 100).toFixed(0)}%`}</text>
                )}
              </g>
            );
          })}

          {/* optional pct reference line (e.g. Plan = 100%) */}
          {pctReference && (
            <g>
              <line x1={PAD.left} y1={yPct(pctReference.value)} x2={W - PAD.right} y2={yPct(pctReference.value)} stroke={palette.text} strokeDasharray="5 4" strokeWidth={1} opacity={0.45} />
              <text x={W - PAD.right} y={yPct(pctReference.value) - 4} textAnchor="end" className="text-[9px]" fill={palette.text} opacity={0.65}>{pctReference.label}</text>
            </g>
          )}

          {/* hover guide line */}
          {hoverRow && (
            <line x1={xPx(hoverRow.acadYearBE)} y1={PAD.top} x2={xPx(hoverRow.acadYearBE)} y2={PAD.top + innerH} stroke={palette.text} strokeWidth={1} opacity={0.25} />
          )}

          {/* x labels */}
          {byYear.map((r) => (
            <g key={`x${r.acadYearBE}`}>
              <text x={xPx(r.acadYearBE)} y={H - PAD.bottom + 16} textAnchor="middle" className="text-[10px] font-tabular" fill={palette.text} opacity={hoverYear === r.acadYearBE ? 1 : 0.7}>BE {r.acadYearBE}</text>
              {!r.isComplete && (
                <text x={xPx(r.acadYearBE)} y={H - PAD.bottom + 28} textAnchor="middle" className="text-[9px]" fill={palette.text} opacity={0.5}>(in progress)</text>
              )}
            </g>
          ))}

          {/* series lines — segmented so a missing point breaks the line
              instead of drawing a misleading bridge across the gap */}
          {visible.map((s) => {
            const segs: string[][] = [];
            let cur: string[] = [];
            for (const r of byYear) {
              const v = s.valueOf(r);
              if (v == null) {
                if (cur.length) { segs.push(cur); cur = []; }
                continue;
              }
              cur.push(`${xPx(r.acadYearBE)},${yOf(s, v)}`);
            }
            if (cur.length) segs.push(cur);
            return segs.map((seg, i) => (
              <polyline
                key={`${s.key}-${i}`}
                points={seg.join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '4 3' : undefined}
              />
            ));
          })}

          {/* dots (enlarged on the hovered year) */}
          {visible.map((s) =>
            byYear.map((r) => {
              const v = s.valueOf(r);
              if (v == null) return null;
              return (
                <circle
                  key={`${s.key}-${r.acadYearBE}`}
                  cx={xPx(r.acadYearBE)}
                  cy={yOf(s, v)}
                  r={hoverYear === r.acadYearBE ? 4.5 : 3}
                  fill={s.color}
                  opacity={r.isComplete ? 1 : 0.5}
                />
              );
            }),
          )}

          {/* invisible hover bands — one per year */}
          {byYear.map((r, i) => {
            const prevX = i === 0 ? PAD.left : (xPx(byYear[i - 1]!.acadYearBE) + xPx(r.acadYearBE)) / 2;
            const nextX = i === byYear.length - 1 ? W - PAD.right : (xPx(r.acadYearBE) + xPx(byYear[i + 1]!.acadYearBE)) / 2;
            return (
              <rect
                key={`ht${r.acadYearBE}`}
                x={prevX}
                y={PAD.top}
                width={Math.max(0, nextX - prevX)}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverYear(r.acadYearBE)}
                onMouseLeave={() => setHoverYear((y) => (y === r.acadYearBE ? null : y))}
              />
            );
          })}
        </svg>

        {/* hover detail — value + formula + worked calculation per visible line */}
        {hoverRow && visible.length > 0 && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-max max-w-[17rem] rounded-md border border-border-subtle bg-surface-1 p-2 shadow-md"
            style={{ left: `${hoverFrac * 100}%`, transform: `translateX(${hoverAnchor})` }}
          >
            <div className="mb-1 text-[11px] font-semibold">
              BE {hoverRow.acadYearBE}
              <span className="font-normal text-text-tertiary"> (CE {hoverRow.acadYearBE - 543})</span>
              {!hoverRow.isComplete && <span className="font-normal text-text-tertiary"> · in progress</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              {visible.map((s) => (
                <div key={s.key} className="text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="text-text-secondary">{s.label}</span>
                    <span className="ml-auto font-tabular font-semibold">{s.display(s.valueOf(hoverRow))}</span>
                  </div>
                  <div className="pl-3 text-text-tertiary">{s.formula}</div>
                  <div className="pl-3 font-tabular text-text-tertiary">{s.calc(hoverRow)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function YearTrendChart({ byYear }: { byYear: CampaignYearRow[] }) {
  const palette = useChartPalette();
  const series: YearSeries[] = [
    {
      key: 'comp',
      label: 'Competition',
      color: palette.series[0] ?? palette.text,
      axis: 'ratio',
      valueOf: (r) => r.competitionRate,
      display: (v) => compf(v),
      formula: 'Applicants ÷ Seats',
      calc: (r) => `${numf(r.applicants)} ÷ ${numf(r.seats)} = ${compf(r.competitionRate)}`,
    },
    {
      key: 'fill',
      label: 'Fill rate',
      color: palette.series[2] ?? palette.text,
      dashed: true,
      axis: 'pct',
      valueOf: (r) => (r.seats != null && r.seats > 0 ? r.passed / r.seats : null),
      display: (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`),
      formula: 'Passed ÷ Seats',
      calc: (r) =>
        `${numf(r.passed)} ÷ ${numf(r.seats)} = ${r.seats != null && r.seats > 0 ? `${((r.passed / r.seats) * 100).toFixed(0)}%` : '—'}`,
    },
    {
      key: 'yield',
      label: 'Enrol yield',
      color: palette.positive,
      axis: 'pct',
      valueOf: (r) => (r.sendCh > 0 ? r.enrolled / r.sendCh : null),
      display: (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`),
      formula: 'Enrolled ÷ Send CH',
      calc: (r) =>
        `${numf(r.enrolled)} ÷ ${numf(r.sendCh)} = ${r.sendCh > 0 ? `${((r.enrolled / r.sendCh) * 100).toFixed(0)}%` : '—'}`,
    },
  ];
  return <YearLineChart byYear={byYear} series={series} />;
}

function PercentAdmitTrendChart({ byYear }: { byYear: CampaignYearRow[] }) {
  const palette = useChartPalette();
  // % Admit is computed over plan-bearing programs only, so partial-plan years
  // are valid and plotted. Only years where NO program has a plan are dropped
  // (uncomputable). Programs without a plan are excluded from the calc, not the
  // whole year — so the rest of the data survives.
  const omitted = byYear.filter((r) => planState(r) === 'missing').map((r) => r.acadYearBE);
  const series: YearSeries[] = [
    {
      key: 'admit',
      label: '% Admit',
      color: palette.series[1] ?? palette.positive,
      axis: 'pct',
      valueOf: (r) => r.percentAdmit,
      display: (v) => pct(v),
      formula: 'Enrolled (plan-bearing) ÷ Plan',
      calc: (r) =>
        planState(r) === 'missing'
          ? 'no plan data — not plotted'
          : `${numf(r.enrolledWithPlan)} ÷ ${numf(r.plan)} = ${pct(r.percentAdmit)}` +
            (planState(r) === 'partial' ? ` · covers ${r.planProgramsWithPlan}/${r.planProgramsTotal} programs` : ''),
    },
  ];
  return (
    <div>
      <YearLineChart byYear={byYear} series={series} pctReference={{ value: 1, label: 'Plan (100%)' }} />
      {omitted.length > 0 && (
        <p className="mt-2 text-[11px] text-text-tertiary">
          Omitted — no plan data: {omitted.map((y) => `BE ${y}`).join(', ')}.
        </p>
      )}
    </div>
  );
}

function RoundPerformanceChart({ rows }: { rows: CampaignRoundRow[] }) {
  const palette = useChartPalette();
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">No round data.</p>;
  const points = rows.map((r) => ({
    round: r.round,
    ratio: r.seats != null && r.seats > 0 ? r.applicants / r.seats : 0,
    yieldR: r.sendCh > 0 ? r.enrolled / r.sendCh : 0,
  }));
  const W = 560, H = 268, PAD = { top: 46, right: 48, bottom: 40, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const slotW = innerW / n;
  const barW = Math.min(46, slotW * 0.5);
  const slotX = (i: number) => PAD.left + (i + 0.5) * slotW;
  const maxRatio = Math.max(...points.map((p) => p.ratio), 2);
  const yBar = (v: number) => PAD.top + (1 - v / maxRatio) * innerH;
  const yPct = (v: number) => PAD.top + (1 - v) * innerH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
      {[0, maxRatio / 4, maxRatio / 2, (3 * maxRatio) / 4, maxRatio].map((v, i) => (
        <g key={`l${i}`}>
          <line x1={PAD.left} y1={yBar(v)} x2={W - PAD.right} y2={yBar(v)} stroke={palette.grid} strokeDasharray="2 4" strokeWidth={0.6} />
          <text x={PAD.left - 6} y={yBar(v) + 4} textAnchor="end" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>{v.toFixed(1)}×</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <text key={`r${i}`} x={W - PAD.right + 6} y={yPct(v) + 4} textAnchor="start" className="text-[10px] font-tabular" fill={palette.positive} opacity={0.8}>{(v * 100).toFixed(0)}%</text>
      ))}
      {points.map((p, i) => (
        <g key={`bar-${p.round}`}>
          <rect x={slotX(i) - barW / 2} y={yBar(p.ratio)} width={barW} height={Math.max(0, PAD.top + innerH - yBar(p.ratio))} fill={palette.series[0] ?? palette.text} opacity={0.85} rx={2} />
          <text x={slotX(i)} y={Math.max(yBar(p.ratio) - 6, PAD.top + 10)} textAnchor="middle" className="text-[10px] font-tabular font-semibold" fill={palette.text}>{p.ratio.toFixed(1)}×</text>
          <text x={slotX(i)} y={H - PAD.bottom + 16} textAnchor="middle" className="text-[10px] font-tabular" fill={palette.text} opacity={0.75}>R{p.round}</text>
        </g>
      ))}
      <polyline points={points.map((p, i) => `${slotX(i)},${yPct(p.yieldR)}`).join(' ')} fill="none" stroke={palette.positive} strokeWidth={2} />
      {points.map((p, i) => (
        <circle key={`yd-${p.round}`} cx={slotX(i)} cy={yPct(p.yieldR)} r={3} fill={palette.positive} />
      ))}
      <g transform={`translate(${PAD.left}, 14)`}>
        <rect x={0} y={-7} width={12} height={8} fill={palette.series[0] ?? palette.text} opacity={0.85} rx={1} />
        <text x={18} y={0} className="text-[10px]" fill="currentColor">Competition (apps / seats, ×)</text>
        <line x1={232} y1={-3} x2={246} y2={-3} stroke={palette.positive} strokeWidth={2} />
        <circle cx={239} cy={-3} r={2.5} fill={palette.positive} />
        <text x={252} y={0} className="text-[10px]" fill="currentColor">Enrol yield (enrolled / send CH, %)</text>
      </g>
    </svg>
  );
}

// ─── Round table (sortable + tooltips) ──────────────────────────────────────

function RoundTable({ rows }: { rows: CampaignRoundRow[] }) {
  const enrolYield = (r: CampaignRoundRow) => (r.sendCh > 0 ? r.enrolled / r.sendCh : null);
  const { sorted, sort } = useSortableTable(rows ?? [], {
    round: (r) => r.round,
    seats: (r) => r.seats ?? -1,
    applicants: (r) => r.applicants,
    competitionRate: (r) => r.competitionRate ?? -1,
    passed: (r) => r.passed,
    sendCh: (r) => r.sendCh,
    confirmCh: (r) => r.confirmCh,
    sendReg: (r) => r.sendReg,
    enrolled: (r) => r.enrolled,
    enrolYield: (r) => enrolYield(r) ?? -1,
  });
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-text-tertiary">No rounds.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <SortableTh sortKey="round" sort={sort} className="px-3 py-2 text-left">Round</SortableTh>
            <SortableTh sortKey="seats" sort={sort} align="right" className="px-3 py-2 text-right">Seats</SortableTh>
            <SortableTh sortKey="applicants" sort={sort} align="right" className="px-3 py-2 text-right">Applicants</SortableTh>
            <SortableTh sortKey="competitionRate" sort={sort} align="right" className="px-3 py-2 text-right" title="Applicants ÷ Seats">Comp.</SortableTh>
            <SortableTh sortKey="passed" sort={sort} align="right" className="px-3 py-2 text-right">Passed</SortableTh>
            <SortableTh sortKey="sendCh" sort={sort} align="right" className="px-3 py-2 text-right">Send CH</SortableTh>
            <SortableTh sortKey="confirmCh" sort={sort} align="right" className="px-3 py-2 text-right">Confirm CH</SortableTh>
            <SortableTh sortKey="sendReg" sort={sort} align="right" className="px-3 py-2 text-right">Send Reg</SortableTh>
            <SortableTh sortKey="enrolled" sort={sort} align="right" className="px-3 py-2 text-right">Enrolled</SortableTh>
            <SortableTh sortKey="enrolYield" sort={sort} align="right" className="px-3 py-2 text-right" title="Enrolled ÷ Send CH">Enrol yield</SortableTh>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {sorted.map((r) => {
            const ey = enrolYield(r);
            return (
              <tr key={r.round}>
                <td className="px-3 py-2 font-tabular font-semibold">{r.round}</td>
                <td className="px-3 py-2 text-right font-tabular text-text-tertiary">{numf(r.seats)}</td>
                <td className="px-3 py-2 text-right font-tabular">{r.applicants.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-tabular">
                  <HoverTooltip content={<MetricTip col={COL_BY_KEY.get('competitionRate')!} m={r} />}>
                    <span className="cursor-help">{compf(r.competitionRate)}</span>
                  </HoverTooltip>
                </td>
                <td className="px-3 py-2 text-right font-tabular">{r.passed.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-tabular">{r.sendCh.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-tabular">{r.confirmCh.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-tabular">{r.sendReg.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-tabular">{r.enrolled.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-tabular">
                  <HoverTooltip content={<div className="text-xs"><div className="font-semibold">Enrol yield</div><div className="mt-1 text-text-secondary">Enrolled ÷ Send CH</div><div className="font-tabular text-text-secondary">{numf(r.enrolled)} ÷ {numf(r.sendCh)} = {pct(ey)}</div></div>}>
                    <span className="cursor-help">{pct(ey)}</span>
                  </HoverTooltip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Declining table (sortable) ─────────────────────────────────────────────

function DecliningTable({ rows }: { rows: DecliningProgramRow[] }) {
  const { sorted, sort } = useSortableTable(rows ?? [], {
    program: (r) => r.programNameTh,
    faculty: (r) => r.facultyNameTh,
    prior: (r) => r.priorCompetition ?? -1,
    current: (r) => r.currentCompetition ?? -1,
    change: (r) => r.avgYoYChange,
  });
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-text-tertiary">No at-risk programs — none have a competition rate below 5× that is also falling year-on-year.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <SortableTh sortKey="program" sort={sort} className="px-4 py-2 text-left">Program</SortableTh>
            <SortableTh sortKey="faculty" sort={sort} className="px-4 py-2 text-left">Faculty</SortableTh>
            <SortableTh sortKey="prior" sort={sort} align="right" className="px-4 py-2 text-right" title="Applicants ÷ Seats, prior year">Comp. prior</SortableTh>
            <SortableTh sortKey="current" sort={sort} align="right" className="px-4 py-2 text-right" title="Applicants ÷ Seats, latest year">Comp. current</SortableTh>
            <SortableTh sortKey="change" sort={sort} align="right" className="px-4 py-2 text-right" title="Mean year-on-year change in competition rate">Avg YoY Δ</SortableTh>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {sorted.map((r) => (
            <tr key={r.programKey} className="hover:bg-surface-1">
              <td className="px-4 py-2"><span lang="th">{r.programNameTh}</span></td>
              <td className="px-4 py-2 text-text-secondary" lang="th">{r.facultyNameTh}</td>
              <td className="px-4 py-2 text-right font-tabular text-text-tertiary">{compf(r.priorCompetition)}</td>
              <td className="px-4 py-2 text-right font-tabular">{compf(r.currentCompetition)}</td>
              <td className="px-4 py-2 text-right font-tabular font-semibold text-danger">
                <HoverTooltip content={<div className="text-xs"><div className="font-semibold">Avg YoY Δ competition</div><div className="mt-1 text-text-secondary">Mean of year-on-year changes in (Applicants ÷ Seats), over {r.yearsObserved} step{r.yearsObserved === 1 ? '' : 's'}.</div><div className="font-tabular text-text-secondary">{compf(r.priorCompetition)} → {compf(r.currentCompetition)} · avg {r.avgYoYChange.toFixed(2)}×/yr</div></div>}>
                  <span className="cursor-help">{r.avgYoYChange.toFixed(2)}×</span>
                </HoverTooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Drill pivot: Faculty → program → sub-program → round → track ───────────

function DrillTh({ col, sort, onSort }: { col: MetricCol; sort: DrillSort; onSort: (k: DrillSortKey) => void }) {
  const active = sort.key === col.key;
  return (
    <th className="px-2 py-2 cursor-pointer select-none text-right" title={col.source} onClick={() => onSort(col.key)}>
      <span className={`inline-flex items-center gap-0.5 ${active ? 'text-text-primary' : ''}`}>
        {col.label}
        {active && (sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

function CampaignDrill({ rows, zeroTrackCount }: { rows: CampaignProgramRow[]; zeroTrackCount: number }) {
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<DrillSort>({ key: 'applicants', dir: 'desc' });
  const onSort = (key: DrillSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const filtered = React.useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase().trim();
    return rows.filter(
      (r) =>
        r.programNameTh.toLowerCase().includes(q) ||
        (r.programNameEn ?? '').toLowerCase().includes(q) ||
        r.facultyNameTh.toLowerCase().includes(q) ||
        r.subPrograms.some((n) =>
          n.recruitmentProgramId.includes(q) || (n.currId ?? '').includes(q) || n.label.toLowerCase().includes(q) ||
          n.rounds.some((rd) => rd.tracks.some((t) => t.campaignName.toLowerCase().includes(q))),
        ),
    );
  }, [rows, search]);

  // Faculty groups carry computed metrics so they sort like every other tier.
  const groups = React.useMemo(() => {
    const map = new Map<string, { facultyNameTh: string; facultyId: string | null; programs: CampaignProgramRow[] }>();
    for (const p of filtered) {
      let g = map.get(p.facultyNameTh);
      if (!g) { g = { facultyNameTh: p.facultyNameTh, facultyId: p.facultyId, programs: [] }; map.set(p.facultyNameTh, g); }
      g.programs.push(p);
    }
    const withMetrics = [...map.values()].map((g) => ({ ...g, ...sumMetrics(g.programs) }));
    return sortNodes(withMetrics, sort, (g) => g.facultyNameTh);
  }, [filtered, sort]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <div className="w-72">
          <FilterSearch value={search} onChange={setSearch} placeholder="Search program, sub-program, track, CURR_ID…" />
        </div>
        <span className="ml-auto text-xs text-text-tertiary">{filtered.length} programs · {zeroTrackCount} empty tracks (0 applicants)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
            <tr>
              <th className="px-3 py-2 cursor-pointer select-none text-left" onClick={() => onSort('name')}>
                <span className={`inline-flex items-center gap-0.5 ${sort.key === 'name' ? 'text-text-primary' : ''}`}>
                  Faculty · program · sub-program · round · track
                  {sort.key === 'name' && (sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                </span>
              </th>
              {METRIC_COLS.map((col) => (
                <DrillTh key={col.key} col={col} sort={sort} onSort={onSort} />
              ))}
              <th className="px-2 py-2"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {groups.map((g) => (
              <FacultyGroup key={g.facultyNameTh} facultyNameTh={g.facultyNameTh} programs={g.programs} sort={sort} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => planState(r) !== 'complete') && (
        <p className="border-t border-border-subtle px-4 py-2 text-[11px] text-text-tertiary">
          <span aria-hidden>*</span> % Admit covers only the programs that have a plan — programs without one are
          excluded from both the numerator and the denominator (shown as “—” when none have a plan). Hover the
          cell for the exact coverage.
        </p>
      )}
    </div>
  );
}

function FacultyGroup({ facultyNameTh, programs, sort }: { facultyNameTh: string; programs: CampaignProgramRow[]; sort: DrillSort }) {
  const [open, setOpen] = React.useState(false);
  const m = sumMetrics(programs);
  const sorted = React.useMemo(() => sortNodes(programs, sort, (p) => p.programNameTh), [programs, sort]);
  return (
    <>
      <tr className="cursor-pointer bg-surface-2/60 font-medium hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3.5 w-3.5 text-text-secondary" /> : <ChevronDown className="h-3.5 w-3.5 text-text-secondary" />}
            <span className="text-xs font-semibold" lang="th">{facultyNameTh}</span>
            <span className="text-[11px] text-text-tertiary">· {programs.length} prog{programs.length === 1 ? '' : 's'}</span>
          </div>
        </td>
        <MetricCells m={m} />
        <td className="px-2 py-2" />
      </tr>
      {open && sorted.map((p) => <ProgramGroup key={p.programKey} program={p} sort={sort} />)}
    </>
  );
}

function ProgramGroup({ program: p, sort }: { program: CampaignProgramRow; sort: DrillSort }) {
  const [open, setOpen] = React.useState(false);
  const sorted = React.useMemo(() => sortNodes(p.subPrograms, sort, (s) => s.label), [p.subPrograms, sort]);
  return (
    <>
      <tr className="cursor-pointer bg-surface-1/40 hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-2 pl-7">
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3 w-3 text-text-tertiary" /> : <ChevronDown className="h-3 w-3 text-text-tertiary" />}
            <div>
              <div className={`text-xs font-semibold ${isUnmappedProgram(p.programId) && !p.isNewProgram ? 'text-text-tertiary italic' : ''}`} lang="th">
                {p.programNameTh}
                {p.isNewProgram && (
                  <span className="ml-1 rounded bg-info/15 px-1 text-[9px] font-normal text-info" title="Recruiting now; not yet in the curriculum catalog (no deep-dive yet)">
                    New program
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-tertiary">{p.subProgramCount} sub-program{p.subProgramCount === 1 ? '' : 's'}</div>
            </div>
          </div>
        </td>
        <MetricCells m={p} />
        <td className="px-2 py-2">
          {p.programId && (
            <Link href={`/programs/${p.programId}`} className="text-text-tertiary hover:text-accent-default" title="Open program deep-dive" onClick={(e) => e.stopPropagation()}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </td>
      </tr>
      {open && sorted.map((n) => <SubProgramGroup key={n.recruitmentProgramId} node={n} sort={sort} />)}
    </>
  );
}

function SubProgramGroup({ node: n, sort }: { node: CampaignSubProgramNode; sort: DrillSort }) {
  const [open, setOpen] = React.useState(false);
  // Rounds always read top-to-bottom by round number — the reader's column
  // sort applies to every other tier but not to the chronological round axis.
  const sorted = React.useMemo(
    () => [...n.rounds].sort((a, b) => roundOrder(a.round) - roundOrder(b.round)),
    [n.rounds],
  );
  return (
    <>
      <tr className="cursor-pointer bg-surface-2/30 hover:bg-surface-2" onClick={() => setOpen((o) => !o)}>
        <td className="px-3 py-1.5 pl-12">
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3 w-3 text-text-tertiary" /> : <ChevronDown className="h-3 w-3 text-text-tertiary" />}
            <div>
              <div className="text-xs text-text-secondary" lang="th">{n.label.slice(0, 54)}</div>
              <div className="font-tabular text-[11px] text-text-tertiary">{n.recruitmentProgramId}</div>
            </div>
          </div>
        </td>
        <MetricCells m={n} />
        <td className="px-2 py-1.5" />
      </tr>
      {open && sorted.map((rd) => <RoundLeaf key={rd.round} node={rd} sort={sort} />)}
    </>
  );
}

// Round tier — expandable to its individual campaign tracks when it has >1.
function RoundLeaf({ node: n, sort }: { node: CampaignRoundNode; sort: DrillSort }) {
  const [open, setOpen] = React.useState(false);
  const expandable = n.tracks.length > 1;
  const sorted = React.useMemo(() => sortNodes(n.tracks, sort, (t) => t.campaignName), [n.tracks, sort]);
  return (
    <>
      <tr className={`bg-surface-2/40 text-xs ${expandable ? 'cursor-pointer hover:bg-surface-2' : ''}`} onClick={expandable ? () => setOpen((o) => !o) : undefined}>
        <td className="px-3 py-1.5 pl-[68px]">
          <div className="flex items-center gap-1">
            {expandable && (open ? <ChevronUp className="h-3 w-3 text-text-tertiary" /> : <ChevronDown className="h-3 w-3 text-text-tertiary" />)}
            <span className="text-text-tertiary">Round {n.round}</span>
            {n.trackCount > 1 && <span className="ml-1 text-[10px] text-text-tertiary">({n.trackCount} tracks)</span>}
          </div>
        </td>
        <MetricCells m={n} />
        <td className="px-2 py-1.5" />
      </tr>
      {open && sorted.map((t) => (
        <tr key={t.wProgramId} className="bg-surface-2/20 text-xs">
          <td className="px-3 py-1.5 pl-[92px]">
            <span className="text-text-tertiary" lang="th">{t.campaignName}</span>
          </td>
          <MetricCells m={t} />
          <td className="px-2 py-1.5" />
        </tr>
      ))}
    </>
  );
}

export type { CampaignProgramRow };

'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Card,
  EmptyState,
  Section,
  SortableTh,
  useSortableTable,
} from '@kku/ui';
import { FunnelPipeline, useChartPalette, type FunnelStage } from '@kku/ui';
import { ChevronDown, ChevronUp, ExternalLink, Info } from 'lucide-react';
import {
  FilterField,
  FilterRail,
  FilterSearch,
  FilterSelect as SharedFilterSelect,
} from '@/components/filter-rail';

// ─── Types (mirror apps/api/src/education/recruitment.service.ts) ──────────

interface FunnelTotals {
  seats: number;
  /** Annual planned seats — the registrar's actual target, smaller
   *  than `seats` (per-round allocation deliberately over-allocated
   *  to compensate for no-show). */
  planPerYear: number;
  applicants: number;
  passed: number;
  sendCh: number;
  confirmCh: number;
  sendReg: number;
  regReported: number;
  rounds: number;
  programCount: number;
}

interface FacultyRow {
  facultyId: string;
  facultyCode: string;
  facultyNameTh: string;
  facultyNameEn: string;
  programCount: number;
  totals: FunnelTotals;
}

interface RoundRow {
  round: string;
  totals: FunnelTotals;
}

interface YearTrendRow {
  entryYearBE: number;
  isComplete: boolean;
  totals: FunnelTotals;
}

interface ProgramDrillRow {
  programId: string;
  programCode: string;
  facultyCode: string;
  facultyNameTh: string;
  programNameTh: string;
  programNameEn: string;
  level: string;
  mhesiCurrId: string;
  round: string;
  entryYearBE: number;
  enrollSeats: number | null;
  planPerYear: number | null;
  totalApplicants: number | null;
  totalPassed: number | null;
  sendClearinghouse: number | null;
  confirmClearinghouse: number | null;
  sendRegReported: number | null;
  regReported: number | null;
  competitionRatio: number | null;
  /** Reported-in ÷ annual planned seats (PLAN_PER_YEAR). */
  planYield: number | null;
}

export interface RecruitmentDashboardPayload {
  meta: {
    latestCompleteYear: number | null;
    latestYearOverall: number | null;
    inProgressYear: number | null;
    availableYears: number[];
    availableRounds: string[];
    selectedYear: number | null;
    selectedRound: string | null;
    appliedFilters: {
      entryYearBE?: number | null;
      facultyId?: string | null;
      level?: string | null;
      round?: string | null;
    };
    selectedYearIsComplete: boolean;
  };
  kpis: FunnelTotals & {
    competitionRatio: number | null;
    fillRate: number | null;
    regYield: number | null;
  };
  byFaculty: FacultyRow[];
  byRound: RoundRow[];
  byYear: YearTrendRow[];
  programs: ProgramDrillRow[];
  inProgressInfo: (FunnelTotals & { entryYearBE: number }) | null;
}

interface Faculty {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
}

const LEVELS = [
  { id: 'BACHELOR', label: 'Bachelor' },
  { id: 'MASTER', label: 'Master' },
  { id: 'DOCTORAL', label: 'Doctoral' },
  { id: 'HIGHER_GRAD_DIPLOMA', label: 'Higher Grad. Diploma' },
] as const;

const FUNNEL_LABELS = [
  'Allocated seats (rounds)',
  'Applicants',
  'Passed',
  'Send to Clearinghouse',
  'Confirm at Clearinghouse',
  'Send to registrar',
  'Reported in',
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export function RecruitmentClient({
  data,
  faculties,
  facultyFilterLocked = false,
}: {
  data: RecruitmentDashboardPayload;
  faculties: Faculty[];
  /** When true, hide the "All faculties" option and disable changes —
   *  FACULTY_USER scope. */
  facultyFilterLocked?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setFilter = (
    key: 'entryYearBE' | 'facultyId' | 'level' | 'round',
    value: string | null,
  ) => {
    const next = new URLSearchParams(params.toString());
    if (value && value.length > 0) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };

  const selectedRound = data.meta.selectedRound;
  // Suffix appended to the round-scoped section titles so it's obvious
  // the funnel / KPIs / faculty / drill reflect a single round.
  const roundSuffix = selectedRound ? ` · Round ${selectedRound}` : '';

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <FilterRail cols={4}>
        <FilterField label="Entry year (BE)">
          <SharedFilterSelect
            value={String(data.meta.selectedYear ?? '')}
            onChange={(e) => setFilter('entryYearBE', e.target.value)}
          >
            {data.meta.availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {`BE ${y} (CE ${y - 543})${
                  y === data.meta.latestCompleteYear
                    ? ' · latest complete'
                    : y === data.meta.inProgressYear
                      ? ' · in progress'
                      : ''
                }`}
              </option>
            ))}
          </SharedFilterSelect>
        </FilterField>
        <FilterField label="TCAS round">
          <SharedFilterSelect
            value={selectedRound ?? ''}
            onChange={(e) => setFilter('round', e.target.value || null)}
          >
            <option value="">All rounds</option>
            {data.meta.availableRounds.map((r) => (
              <option key={r} value={r}>
                Round {r}
              </option>
            ))}
          </SharedFilterSelect>
        </FilterField>
        <FilterField label="Faculty">
          <SharedFilterSelect
            value={data.meta.appliedFilters.facultyId ?? ''}
            onChange={(e) => setFilter('facultyId', e.target.value || null)}
            disabled={facultyFilterLocked}
          >
            {!facultyFilterLocked && <option value="">All faculties</option>}
            {faculties.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} · {f.nameEn}
              </option>
            ))}
          </SharedFilterSelect>
        </FilterField>
        <FilterField label="Level">
          <SharedFilterSelect
            value={data.meta.appliedFilters.level ?? ''}
            onChange={(e) => setFilter('level', e.target.value || null)}
          >
            <option value="">All levels</option>
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </SharedFilterSelect>
        </FilterField>
      </FilterRail>

      {/* In-progress banner */}
      {data.inProgressInfo && data.meta.selectedYearIsComplete && (
        <InProgressBanner
          inProgress={data.inProgressInfo}
          onSwitch={() => setFilter('entryYearBE', String(data.inProgressInfo!.entryYearBE))}
        />
      )}
      {data.meta.selectedYear && !data.meta.selectedYearIsComplete && (
        <PartialYearBanner
          year={data.meta.selectedYear}
          latestCompleteYear={data.meta.latestCompleteYear}
          onSwitch={() =>
            data.meta.latestCompleteYear !== null
              ? setFilter('entryYearBE', String(data.meta.latestCompleteYear))
              : null
          }
        />
      )}

      {/* KPI strip */}
      <KpiStrip kpis={data.kpis} year={data.meta.selectedYear} />

      {/* Funnel viz + faculty bar chart */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section
          title={`Recruitment funnel — BE ${data.meta.selectedYear ?? '—'}${roundSuffix}`}
        >
          <Card padding="md">
            {data.kpis.applicants > 0 ? (
              <>
                <FunnelPipeline
                  stages={buildFunnelStages(data.kpis)}
                  width={560}
                  height={340}
                />
                <PlanCheck kpis={data.kpis} />
              </>
            ) : (
              <EmptyState title="No funnel data" description="Filters returned no rows." />
            )}
          </Card>
        </Section>

        <Section
          title={
            selectedRound
              ? `Year-over-year trend · Round ${selectedRound}`
              : 'Year-over-year trend'
          }
        >
          <Card padding="md">
            <YearTrendChart byYear={data.byYear} />
          </Card>
        </Section>
      </div>

      {/* Round performance — per-round comparison (chart + table).
          With "All rounds" selected this compares every round side by
          side; picking a single round narrows it to that one. */}
      <Section title={`By TCAS round — BE ${data.meta.selectedYear ?? '—'}${roundSuffix}`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-start">
          <Card padding="md">
            <RoundPerformanceChart rows={data.byRound} />
          </Card>
          <Card padding="none">
            <RoundBreakdownTable rows={data.byRound} />
          </Card>
        </div>
      </Section>

      {/* Faculty rollup */}
      <Section
        title={`By faculty — BE ${data.meta.selectedYear ?? '—'}${roundSuffix}`}
      >
        <Card padding="none">
          <FacultyRollupTable rows={data.byFaculty} />
        </Card>
      </Section>

      {/* Drill-down table */}
      <Section
        title={`Program × round drill-down — BE ${data.meta.selectedYear ?? '—'}${roundSuffix}`}
      >
        <Card padding="none">
          <ProgramDrillTable rows={data.programs} />
        </Card>
      </Section>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function InProgressBanner({
  inProgress,
  onSwitch,
}: {
  inProgress: FunnelTotals & { entryYearBE: number };
  onSwitch: () => void;
}) {
  const ratio =
    inProgress.seats > 0 ? inProgress.applicants / inProgress.seats : 0;
  return (
    <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="flex-1">
          <div className="font-semibold text-info">
            BE {inProgress.entryYearBE} (CE {inProgress.entryYearBE - 543}) —
            recruitment in progress
          </div>
          <div className="mt-1 text-text-secondary">
            <span className="font-tabular">{inProgress.applicants.toLocaleString()}</span>{' '}
            applicants for <span className="font-tabular">{inProgress.seats.toLocaleString()}</span>{' '}
            seats ({ratio.toFixed(1)}× competition){inProgress.regReported > 0 && (
              <>
                {' '}· <span className="font-tabular">{inProgress.regReported.toLocaleString()}</span> have reported
              </>
            )}{' '}
            so far. Numbers update as later rounds run; not used for health-score scoring.
          </div>
          <button
            type="button"
            onClick={onSwitch}
            className="mt-1 text-xs text-accent-default hover:underline"
          >
            View partial data →
          </button>
        </div>
      </div>
    </div>
  );
}

function PartialYearBanner({
  year,
  latestCompleteYear,
  onSwitch,
}: {
  year: number;
  latestCompleteYear: number | null;
  onSwitch: () => void;
}) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1">
          <div className="font-semibold text-warning">
            BE {year} (CE {year - 543}) is the in-progress recruitment cycle
          </div>
          <div className="mt-1 text-text-secondary">
            Numbers below are partial — later rounds haven&apos;t run yet, so
            registration figures will rise. Health-score scoring uses the
            latest COMPLETE cohort instead.
          </div>
          {latestCompleteYear !== null && (
            <button
              type="button"
              onClick={onSwitch}
              className="mt-1 text-xs text-accent-default hover:underline"
            >
              Switch to BE {latestCompleteYear} (latest complete) →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiStrip({
  kpis,
  year,
}: {
  kpis: RecruitmentDashboardPayload['kpis'];
  year: number | null;
}) {
  const overAlloc =
    kpis.planPerYear > 0 ? kpis.seats / kpis.planPerYear : null;
  const yieldVsPlan =
    kpis.planPerYear > 0 ? kpis.regReported / kpis.planPerYear : null;
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: 'positive' | 'warning' }> = [
    {
      label: 'Programs',
      value: kpis.programCount.toLocaleString('en-US'),
      sub: `${kpis.rounds} program × round rows`,
    },
    {
      label: 'Planned seats',
      value: kpis.planPerYear.toLocaleString('en-US'),
      sub: 'annual target (PLAN_PER_YEAR)',
    },
    {
      label: 'Allocated seats',
      value: kpis.seats.toLocaleString('en-US'),
      sub:
        overAlloc !== null
          ? `${overAlloc.toFixed(2)}× over-allocated for no-show`
          : 'sum across rounds',
    },
    {
      label: 'Applicants',
      value: kpis.applicants.toLocaleString('en-US'),
      sub: kpis.competitionRatio !== null ? `${kpis.competitionRatio.toFixed(1)}× competition` : undefined,
    },
    {
      label: 'Reported in',
      value: kpis.regReported.toLocaleString('en-US'),
      sub:
        yieldVsPlan !== null
          ? `${(yieldVsPlan * 100).toFixed(0)} % of plan filled`
          : kpis.regYield !== null
            ? `${(kpis.regYield * 100).toFixed(0)} % CH yield`
            : undefined,
      tone:
        yieldVsPlan !== null && yieldVsPlan < 1
          ? 'warning'
          : 'positive',
    },
    {
      label: 'BE year',
      value: year !== null ? String(year) : '—',
      sub: year !== null ? `CE ${year - 543}` : undefined,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-4"
        >
          <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{t.label}</p>
          <p
            className={`font-tabular text-2xl font-semibold ${
              t.tone === 'warning'
                ? 'text-warning'
                : t.tone === 'positive'
                  ? 'text-positive'
                  : 'text-text-primary'
            }`}
          >
            {t.value}
          </p>
          {t.sub && <p className="text-[11px] text-text-tertiary">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function buildFunnelStages(kpis: RecruitmentDashboardPayload['kpis']): FunnelStage[] {
  const values = [
    kpis.seats,
    kpis.applicants,
    kpis.passed,
    kpis.sendCh,
    kpis.confirmCh,
    kpis.sendReg,
    kpis.regReported,
  ];
  return values.map((v, i) => ({
    key: `stage-${i}`,
    label: FUNNEL_LABELS[i] ?? `Stage ${i + 1}`,
    value: v,
  }));
}

// Plan-vs-reported readout shown beside the funnel. Planned seats is a
// target, not a conversion stage (applicants vastly outnumber seats), so
// it sits aside the funnel rather than as its first — misleadingly
// narrow — bar. Lets the reader confirm at a glance whether the bottom
// of the funnel (reported in) actually hit the annual plan.
function PlanCheck({ kpis }: { kpis: RecruitmentDashboardPayload['kpis'] }) {
  const plan = kpis.planPerYear;
  const reported = kpis.regReported;
  const ratio = plan > 0 ? reported / plan : null;
  const verdictClass =
    ratio === null
      ? 'text-text-tertiary'
      : ratio >= 1
        ? 'text-positive'
        : ratio >= 0.85
          ? 'text-warning'
          : 'text-danger';
  const verdict =
    ratio === null
      ? 'No plan on file'
      : ratio >= 1
        ? '✓ Plan met'
        : `${(ratio * 100).toFixed(0)}% of plan filled`;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-1 px-4 py-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary">
          Planned seats (annual)
        </p>
        <p className="font-tabular text-xl font-semibold">
          {plan.toLocaleString('en-US')}
        </p>
        <p className="text-[11px] text-text-tertiary">
          {reported.toLocaleString('en-US')} reported in
        </p>
      </div>
      <p className={`font-tabular text-sm font-semibold ${verdictClass}`}>{verdict}</p>
    </div>
  );
}

function YearTrendChart({ byYear }: { byYear: YearTrendRow[] }) {
  const palette = useChartPalette();
  if (byYear.length === 0) {
    return <p className="text-sm text-text-tertiary">No trend data.</p>;
  }
  // Compute three series across years: competition ratio, fill rate, reg yield.
  const points = byYear.map((y) => {
    const t = y.totals;
    return {
      year: y.entryYearBE,
      isComplete: y.isComplete,
      ratio: t.seats > 0 ? t.applicants / t.seats : 0,
      fill: t.seats > 0 ? t.passed / t.seats : 0,
      yieldR: t.sendCh > 0 ? t.regReported / t.sendCh : 0,
    };
  });
  const W = 560, H = 240, PAD = { top: 24, right: 24, bottom: 36, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const xMin = points[0]!.year;
  const xMax = points[points.length - 1]!.year;
  const xPx = (x: number) =>
    PAD.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
  const maxRatio = Math.max(...points.map((p) => p.ratio), 5);
  const yPxRatio = (v: number) => PAD.top + (1 - v / maxRatio) * innerH;
  const yPxPct = (v: number) => PAD.top + (1 - v) * innerH; // fill + yield are 0..1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
      {/* Y axis ticks for ratio (left) */}
      {[0, maxRatio / 4, maxRatio / 2, (3 * maxRatio) / 4, maxRatio].map((v, i) => (
        <g key={`r${i}`}>
          <line x1={PAD.left} y1={yPxRatio(v)} x2={W - PAD.right} y2={yPxRatio(v)} stroke={palette.grid} strokeDasharray="2 4" strokeWidth={0.6} />
          <text x={PAD.left - 6} y={yPxRatio(v) + 4} textAnchor="end" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>
            {v.toFixed(0)}×
          </text>
        </g>
      ))}
      {/* X axis ticks */}
      {points.map((p) => (
        <g key={p.year}>
          <text x={xPx(p.year)} y={H - PAD.bottom + 16} textAnchor="middle" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>
            BE {p.year}
          </text>
          {!p.isComplete && (
            <text x={xPx(p.year)} y={H - PAD.bottom + 28} textAnchor="middle" className="text-[9px]" fill={palette.text} opacity={0.55}>
              (in progress)
            </text>
          )}
        </g>
      ))}
      {/* Lines */}
      <polyline
        points={points.map((p) => `${xPx(p.year)},${yPxRatio(p.ratio)}`).join(' ')}
        fill="none"
        stroke={palette.series[0] ?? palette.text}
        strokeWidth={2}
      />
      <polyline
        points={points.map((p) => `${xPx(p.year)},${yPxPct(p.fill)}`).join(' ')}
        fill="none"
        stroke={palette.series[2] ?? palette.text}
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <polyline
        points={points.map((p) => `${xPx(p.year)},${yPxPct(p.yieldR)}`).join(' ')}
        fill="none"
        stroke={palette.positive}
        strokeWidth={2}
      />
      {/* Dots */}
      {points.map((p) => (
        <g key={`d-${p.year}`}>
          <circle cx={xPx(p.year)} cy={yPxRatio(p.ratio)} r={3} fill={palette.series[0] ?? palette.text} opacity={p.isComplete ? 1 : 0.5} />
          <circle cx={xPx(p.year)} cy={yPxPct(p.fill)} r={3} fill={palette.series[2] ?? palette.text} opacity={p.isComplete ? 1 : 0.5} />
          <circle cx={xPx(p.year)} cy={yPxPct(p.yieldR)} r={3} fill={palette.positive} opacity={p.isComplete ? 1 : 0.5} />
        </g>
      ))}
      {/* Legend */}
      <g transform={`translate(${PAD.left + 12}, ${PAD.top + 4})`}>
        <LegendDot color={palette.series[0] ?? palette.text} label="Competition (apps / seats)" x={0} />
        <LegendDot color={palette.series[2] ?? palette.text} label="Fill rate (passed / seats, 0–1)" x={170} dashed />
        <LegendDot color={palette.positive} label="Reg yield (reg / sendCh, 0–1)" x={400} />
      </g>
    </svg>
  );
}

function LegendDot({ color, label, x, dashed = false }: { color: string; label: string; x: number; dashed?: boolean }) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <line x1={0} y1={4} x2={14} y2={4} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '4 3' : undefined} />
      <text x={18} y={7} className="text-[10px]" fill="currentColor">
        {label}
      </text>
    </g>
  );
}

// ─── Tables ─────────────────────────────────────────────────────────────────

function FacultyRollupTable({ rows }: { rows: FacultyRow[] }) {
  const { sorted, sort } = useSortableTable(rows ?? [], {
    faculty: (r) => r.facultyNameTh,
    programCount: (r) => r.programCount,
    planPerYear: (r) => r.totals.planPerYear,
    seats: (r) => r.totals.seats,
    overAlloc: (r) =>
      r.totals.planPerYear > 0 ? r.totals.seats / r.totals.planPerYear : null,
    applicants: (r) => r.totals.applicants,
    compRatio: (r) =>
      r.totals.seats > 0 ? r.totals.applicants / r.totals.seats : 0,
    regReported: (r) => r.totals.regReported,
    vsPlan: (r) =>
      r.totals.planPerYear > 0 ? r.totals.regReported / r.totals.planPerYear : null,
  });
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-text-tertiary">No faculty data.</p>;
  }
  const maxApps = Math.max(...rows.map((r) => r.totals.applicants), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <SortableTh sortKey="faculty" sort={sort} className="px-4 py-2 text-left">Faculty</SortableTh>
            <SortableTh sortKey="programCount" sort={sort} align="right" className="px-4 py-2 text-right">Progs</SortableTh>
            <SortableTh sortKey="planPerYear" sort={sort} align="right" className="px-4 py-2 text-right" title="Annual plan target (PLAN_PER_YEAR)">Plan</SortableTh>
            <SortableTh sortKey="seats" sort={sort} align="right" className="px-4 py-2 text-right" title="Sum of ENROLLSEAT across rounds (over-allocated to compensate no-show)">Allocated</SortableTh>
            <SortableTh sortKey="overAlloc" sort={sort} align="right" className="px-4 py-2 text-right">Over-alloc</SortableTh>
            <SortableTh sortKey="applicants" sort={sort} align="right" className="px-4 py-2 text-right">Applicants</SortableTh>
            <SortableTh sortKey="compRatio" sort={sort} align="right" className="px-4 py-2 text-right">Comp. ratio</SortableTh>
            <SortableTh sortKey="regReported" sort={sort} align="right" className="px-4 py-2 text-right">Reported in</SortableTh>
            <SortableTh sortKey="vsPlan" sort={sort} align="right" className="px-4 py-2 text-right" title="Reported in / Planned seats — % of annual target filled">vs Plan</SortableTh>
            <th className="px-4 py-2 text-left">Applicants distribution</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {sorted.map((r) => {
            const ratio = r.totals.seats > 0 ? r.totals.applicants / r.totals.seats : 0;
            const overAlloc = r.totals.planPerYear > 0 ? r.totals.seats / r.totals.planPerYear : null;
            const yieldVsPlan = r.totals.planPerYear > 0 ? r.totals.regReported / r.totals.planPerYear : null;
            const w = (r.totals.applicants / maxApps) * 100;
            const planClass =
              yieldVsPlan === null
                ? ''
                : yieldVsPlan >= 1
                  ? 'text-positive'
                  : yieldVsPlan >= 0.85
                    ? 'text-warning'
                    : 'text-danger';
            return (
              <tr key={r.facultyId} className="hover:bg-surface-1">
                <td className="px-4 py-2">
                  <div className="font-medium" lang="th">
                    {r.facultyNameTh}
                  </div>
                  <div className="text-xs text-text-tertiary">{r.facultyNameEn}</div>
                </td>
                <td className="px-4 py-2 text-right font-tabular">{r.programCount}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.planPerYear.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.seats.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular text-text-tertiary">
                  {overAlloc === null ? '—' : `${overAlloc.toFixed(2)}×`}
                </td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.applicants.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{ratio.toFixed(1)}×</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.regReported.toLocaleString()}</td>
                <td className={`px-4 py-2 text-right font-tabular font-semibold ${planClass}`}>
                  {yieldVsPlan === null ? '—' : `${(yieldVsPlan * 100).toFixed(0)}%`}
                </td>
                <td className="px-4 py-2">
                  <div className="h-2 w-full rounded bg-surface-2">
                    <div
                      className="h-full rounded bg-accent-default"
                      style={{ width: `${w}%`, opacity: 0.85 }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Per-round performance combo chart. Bars = competition ratio
// (applicants / seats, the demand signal); line = registration yield
// (reported / send-to-Clearinghouse, the conversion signal). The two
// live on different scales (× vs 0–1) so they get separate axes — bars
// read off the left ×-axis, the line off the right %-axis. This is the
// round-bucketed sibling of YearTrendChart and uses the same metric
// vocabulary. Value labels make the scales unambiguous.
function RoundPerformanceChart({ rows }: { rows: RoundRow[] }) {
  const palette = useChartPalette();
  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary">No round data.</p>;
  }
  const points = rows.map((r) => {
    const t = r.totals;
    return {
      round: r.round,
      ratio: t.seats > 0 ? t.applicants / t.seats : 0,
      fill: t.seats > 0 ? t.passed / t.seats : 0,
      yieldR: t.sendCh > 0 ? t.regReported / t.sendCh : 0,
      applicants: t.applicants,
      reported: t.regReported,
    };
  });
  const W = 560;
  const H = 268;
  // Generous top band so the legend sits clear above the plot and the
  // tallest bar's value label never collides with it.
  const PAD = { top: 46, right: 48, bottom: 40, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = points.length;
  const slotW = innerW / n;
  const barW = Math.min(46, slotW * 0.5);
  const slotX = (i: number) => PAD.left + (i + 0.5) * slotW;
  const maxRatio = Math.max(...points.map((p) => p.ratio), 2);
  const yBar = (v: number) => PAD.top + (1 - v / maxRatio) * innerH;
  const yPct = (v: number) => PAD.top + (1 - v) * innerH; // 0..1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img">
      {/* Left axis (competition ×) */}
      {[0, maxRatio / 4, maxRatio / 2, (3 * maxRatio) / 4, maxRatio].map((v, i) => (
        <g key={`l${i}`}>
          <line
            x1={PAD.left}
            y1={yBar(v)}
            x2={W - PAD.right}
            y2={yBar(v)}
            stroke={palette.grid}
            strokeDasharray="2 4"
            strokeWidth={0.6}
          />
          <text x={PAD.left - 6} y={yBar(v) + 4} textAnchor="end" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>
            {v.toFixed(1)}×
          </text>
        </g>
      ))}
      {/* Right axis (reg yield %) */}
      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <text key={`r${i}`} x={W - PAD.right + 6} y={yPct(v) + 4} textAnchor="start" className="text-[10px] font-tabular" fill={palette.positive} opacity={0.8}>
          {(v * 100).toFixed(0)}%
        </text>
      ))}
      {/* Bars — competition ratio */}
      {points.map((p, i) => (
        <g key={`bar-${p.round}`}>
          <rect
            x={slotX(i) - barW / 2}
            y={yBar(p.ratio)}
            width={barW}
            height={Math.max(0, PAD.top + innerH - yBar(p.ratio))}
            fill={palette.series[0] ?? palette.text}
            opacity={0.85}
            rx={2}
          />
          {/* Competition × label above the bar, clamped so the tallest
              bar's label can't ride up into the legend band. */}
          <text x={slotX(i)} y={Math.max(yBar(p.ratio) - 6, PAD.top + 10)} textAnchor="middle" className="text-[10px] font-tabular font-semibold" fill={palette.text}>
            {p.ratio.toFixed(1)}×
          </text>
          {/* X label */}
          <text x={slotX(i)} y={H - PAD.bottom + 16} textAnchor="middle" className="text-[10px] font-tabular" fill={palette.text} opacity={0.75}>
            R{p.round}
          </text>
        </g>
      ))}
      {/* Reg-yield line + dots. The exact % is read off the right axis +
          the adjacent table, so no inline value labels here (they used
          to collide with the competition-× bar labels). */}
      <polyline
        points={points.map((p, i) => `${slotX(i)},${yPct(p.yieldR)}`).join(' ')}
        fill="none"
        stroke={palette.positive}
        strokeWidth={2}
      />
      {points.map((p, i) => (
        <circle key={`yd-${p.round}`} cx={slotX(i)} cy={yPct(p.yieldR)} r={3} fill={palette.positive} />
      ))}
      {/* Legend — own band at the very top, clear of the plot. */}
      <g transform={`translate(${PAD.left}, 14)`}>
        <rect x={0} y={-7} width={12} height={8} fill={palette.series[0] ?? palette.text} opacity={0.85} rx={1} />
        <text x={18} y={0} className="text-[10px]" fill="currentColor">
          Competition (apps / seats, ×)
        </text>
        <line x1={232} y1={-3} x2={246} y2={-3} stroke={palette.positive} strokeWidth={2} />
        <circle cx={239} cy={-3} r={2.5} fill={palette.positive} />
        <text x={252} y={0} className="text-[10px]" fill="currentColor">
          Reg yield (reported / send CH, %)
        </text>
      </g>
    </svg>
  );
}

function RoundBreakdownTable({ rows }: { rows: RoundRow[] }) {
  const { sorted, sort } = useSortableTable(rows ?? [], {
    round: (r) => r.round,
    programCount: (r) => r.totals.programCount,
    seats: (r) => r.totals.seats,
    applicants: (r) => r.totals.applicants,
    passed: (r) => r.totals.passed,
    sendCh: (r) => r.totals.sendCh,
    confirmCh: (r) => r.totals.confirmCh,
    sendReg: (r) => r.totals.sendReg,
    regReported: (r) => r.totals.regReported,
    regYield: (r) =>
      r.totals.sendCh > 0 ? r.totals.regReported / r.totals.sendCh : null,
  });
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-text-tertiary">No rounds.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <SortableTh sortKey="round" sort={sort} className="px-4 py-2 text-left">Round</SortableTh>
            <SortableTh sortKey="programCount" sort={sort} align="right" className="px-4 py-2 text-right">Programs</SortableTh>
            <SortableTh sortKey="seats" sort={sort} align="right" className="px-4 py-2 text-right">Seats</SortableTh>
            <SortableTh sortKey="applicants" sort={sort} align="right" className="px-4 py-2 text-right">Applicants</SortableTh>
            <SortableTh sortKey="passed" sort={sort} align="right" className="px-4 py-2 text-right">Passed</SortableTh>
            <SortableTh sortKey="sendCh" sort={sort} align="right" className="px-4 py-2 text-right">Send CH</SortableTh>
            <SortableTh sortKey="confirmCh" sort={sort} align="right" className="px-4 py-2 text-right">Confirm CH</SortableTh>
            <SortableTh sortKey="sendReg" sort={sort} align="right" className="px-4 py-2 text-right">Send Reg</SortableTh>
            <SortableTh sortKey="regReported" sort={sort} align="right" className="px-4 py-2 text-right">Reported in</SortableTh>
            <SortableTh sortKey="regYield" sort={sort} align="right" className="px-4 py-2 text-right">Reg yield</SortableTh>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {sorted.map((r) => {
            const yieldR = r.totals.sendCh > 0 ? r.totals.regReported / r.totals.sendCh : null;
            return (
              <tr key={r.round}>
                <td className="px-4 py-2 font-tabular font-semibold">{r.round}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.programCount}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.seats.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.applicants.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.passed.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.sendCh.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.confirmCh.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.sendReg.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">{r.totals.regReported.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-tabular">
                  {yieldR === null ? '—' : `${(yieldR * 100).toFixed(0)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type SortKey =
  | 'programCode' | 'round' | 'enrollSeats' | 'planPerYear'
  | 'totalApplicants' | 'competitionRatio' | 'totalPassed' | 'sendClearinghouse'
  | 'confirmClearinghouse' | 'regReported' | 'planYield';

function ProgramDrillTable({ rows }: { rows: ProgramDrillRow[] }) {
  const [sortKey, setSortKey] = React.useState<SortKey>('competitionRatio');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = React.useState('');
  const [grouping, setGrouping] = React.useState<'faculty' | 'program' | 'flat'>('faculty');

  const filtered = React.useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase().trim();
    return rows.filter(
      (r) =>
        r.programCode.toLowerCase().includes(q) ||
        r.programNameEn.toLowerCase().includes(q) ||
        r.programNameTh.toLowerCase().includes(q) ||
        r.facultyCode.toLowerCase().includes(q) ||
        r.mhesiCurrId.includes(q),
    );
  }, [rows, search]);

  const sorted = React.useMemo(() => {
    const compare = (a: ProgramDrillRow, b: ProgramDrillRow) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    };
    return [...filtered].sort(compare);
  }, [filtered, sortKey, sortDir]);

  // Group by program (2-tier: Program → round) for the program view.
  const grouped = React.useMemo(() => {
    if (grouping !== 'program') return null;
    const groups = new Map<string, ProgramDrillRow[]>();
    for (const r of sorted) {
      const arr = groups.get(r.programCode) ?? [];
      arr.push(r);
      groups.set(r.programCode, arr);
    }
    return Array.from(groups.entries());
  }, [sorted, grouping]);

  // Group by faculty (3-tier: Faculty → Program → round) for the
  // default view. Faculties and programs appear in the order their
  // first sorted row appears — consistent with the 2-tier program
  // grouping above (the row sort still drives ordering; group headers
  // follow first-appearance).
  const groupedByFaculty = React.useMemo(() => {
    if (grouping !== 'faculty') return null;
    interface FacAcc {
      facultyCode: string;
      facultyNameTh: string;
      progOrder: string[];
      progMap: Map<string, ProgramDrillRow[]>;
    }
    const order: string[] = [];
    const map = new Map<string, FacAcc>();
    for (const r of sorted) {
      let fac = map.get(r.facultyCode);
      if (!fac) {
        fac = {
          facultyCode: r.facultyCode,
          facultyNameTh: r.facultyNameTh,
          progOrder: [],
          progMap: new Map(),
        };
        map.set(r.facultyCode, fac);
        order.push(r.facultyCode);
      }
      let prog = fac.progMap.get(r.programCode);
      if (!prog) {
        prog = [];
        fac.progMap.set(r.programCode, prog);
        fac.progOrder.push(r.programCode);
      }
      prog.push(r);
    }
    return order.map((fc) => {
      const fac = map.get(fc)!;
      return {
        facultyCode: fac.facultyCode,
        facultyNameTh: fac.facultyNameTh,
        programs: fac.progOrder.map(
          (pc) => [pc, fac.progMap.get(pc)!] as [string, ProgramDrillRow[]],
        ),
      };
    });
  }, [sorted, grouping]);

  const groupCount =
    grouping === 'faculty'
      ? (groupedByFaculty?.length ?? 0)
      : grouping === 'program'
        ? (grouped?.length ?? 0)
        : sorted.length;
  const groupNoun = grouping === 'faculty' ? 'faculties' : 'groups';

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <div className="w-64">
          <FilterSearch
            value={search}
            onChange={setSearch}
            placeholder="Search code, name, CURR_ID…"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setGrouping('faculty')}
            className={`rounded px-2 py-1 ${grouping === 'faculty' ? 'bg-accent-subtle text-accent' : 'text-text-secondary'}`}
          >
            Faculty → program → round
          </button>
          <button
            type="button"
            onClick={() => setGrouping('program')}
            className={`rounded px-2 py-1 ${grouping === 'program' ? 'bg-accent-subtle text-accent' : 'text-text-secondary'}`}
          >
            Program → round
          </button>
          <button
            type="button"
            onClick={() => setGrouping('flat')}
            className={`rounded px-2 py-1 ${grouping === 'flat' ? 'bg-accent-subtle text-accent' : 'text-text-secondary'}`}
          >
            Flat (round rows)
          </button>
        </div>
        <span className="ml-auto text-xs text-text-tertiary">
          {sorted.length} rows · {groupCount} {groupNoun}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
            <tr>
              <SortHeader label="Faculty · program · round" k="programCode" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Round" k="round" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Plan/yr" k="planPerYear" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Seats" k="enrollSeats" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Applicants" k="totalApplicants" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Comp. ratio" k="competitionRatio" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Passed" k="totalPassed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Send CH" k="sendClearinghouse" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Confirm CH" k="confirmClearinghouse" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Reported in" k="regReported" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Plan yield" k="planYield" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th className="px-2 py-2"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {grouping === 'flat' &&
              sorted.map((r) => (
                <DrillRow key={`${r.programId}-${r.round}-${r.entryYearBE}`} r={r} indent={false} />
              ))}
            {grouping === 'program' &&
              grouped!.map(([code, items]) => (
                <ProgramGroup key={code} programCode={code} items={items} />
              ))}
            {grouping === 'faculty' &&
              groupedByFaculty!.map((fac) => (
                <FacultyGroup
                  key={fac.facultyCode}
                  facultyNameTh={fac.facultyNameTh}
                  programs={fac.programs}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortHeader({
  label, k, sortKey, sortDir, onClick, align = 'left',
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey === k;
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} cursor-pointer select-none`} onClick={() => onClick(k)}>
      <span className={`inline-flex items-center gap-1 ${active ? 'text-text-primary' : ''}`}>
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </th>
  );
}

function ProgramGroup({
  programCode,
  items,
  headIndentClass = '',
}: {
  programCode: string;
  items: ProgramDrillRow[];
  /** Extra left padding on the header's first cell when nested under a
   *  faculty group (3-tier view). */
  headIndentClass?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const head = items[0]!;
  // Aggregate the program across rounds for the header row. PLAN_PER_YEAR
  // is annual — take MAX (constant across rounds for the same year),
  // never SUM.
  const planPerYear =
    items.reduce<number | null>(
      (acc, r) =>
        r.planPerYear === null
          ? acc
          : acc === null
            ? r.planPerYear
            : Math.max(acc, r.planPerYear),
      null,
    ) ?? 0;
  const totals = items.reduce(
    (acc, r) => ({
      seats: acc.seats + (r.enrollSeats ?? 0),
      apps: acc.apps + (r.totalApplicants ?? 0),
      passed: acc.passed + (r.totalPassed ?? 0),
      sendCh: acc.sendCh + (r.sendClearinghouse ?? 0),
      confirmCh: acc.confirmCh + (r.confirmClearinghouse ?? 0),
      reg: acc.reg + (r.regReported ?? 0),
    }),
    { seats: 0, apps: 0, passed: 0, sendCh: 0, confirmCh: 0, reg: 0 },
  );
  const ratio = totals.seats > 0 ? totals.apps / totals.seats : null;
  const yieldVsPlan = planPerYear > 0 ? totals.reg / planPerYear : null;

  return (
    <>
      <tr
        className="cursor-pointer bg-surface-1/40 hover:bg-surface-2"
        onClick={() => setOpen((o) => !o)}
      >
        <td className={`px-3 py-2 ${headIndentClass}`}>
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3 w-3 text-text-tertiary" /> : <ChevronDown className="h-3 w-3 text-text-tertiary" />}
            <div>
              <div className="font-tabular text-xs font-semibold">{programCode}</div>
              <div className="truncate text-xs text-text-secondary">{head.programNameEn || head.programNameTh}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-right text-xs text-text-tertiary">{items.length} rounds</td>
        <td className="px-3 py-2 text-right font-tabular">{planPerYear || '—'}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.seats.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.apps.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{ratio === null ? '—' : `${ratio.toFixed(1)}×`}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.passed.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.sendCh.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.confirmCh.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.reg.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{yieldVsPlan === null ? '—' : `${(yieldVsPlan * 100).toFixed(0)}%`}</td>
        <td className="px-2 py-2">
          <Link
            href={`/programs/${head.programId}`}
            className="text-text-tertiary hover:text-accent-default"
            title="Open program deep-dive"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </td>
      </tr>
      {open &&
        items.map((r) => (
          <DrillRow key={`${r.programId}-${r.round}-${r.entryYearBE}`} r={r} indent />
        ))}
    </>
  );
}

// Top tier of the 3-level drill-down: Faculty → Program → round.
// Aggregates every (program × round) row under the faculty. PLAN_PER_YEAR
// is annual per program (constant across that program's rounds) — summed
// here as Σ of each program's MAX, never a naïve sum across round rows.
// Funnel columns sum across all rows. Each teacher-less metric mirrors
// the program-tier aggregation so the numbers nest cleanly.
function FacultyGroup({
  facultyNameTh,
  programs,
}: {
  facultyNameTh: string;
  programs: Array<[string, ProgramDrillRow[]]>;
}) {
  const [open, setOpen] = React.useState(false);
  const allRows = programs.flatMap(([, rows]) => rows);
  // Σ of per-program MAX(planPerYear).
  const planByProgram = new Map<string, number>();
  for (const r of allRows) {
    if (r.planPerYear === null) continue;
    planByProgram.set(
      r.programCode,
      Math.max(planByProgram.get(r.programCode) ?? 0, r.planPerYear),
    );
  }
  const planPerYear = [...planByProgram.values()].reduce((a, b) => a + b, 0);
  const totals = allRows.reduce(
    (acc, r) => ({
      seats: acc.seats + (r.enrollSeats ?? 0),
      apps: acc.apps + (r.totalApplicants ?? 0),
      passed: acc.passed + (r.totalPassed ?? 0),
      sendCh: acc.sendCh + (r.sendClearinghouse ?? 0),
      confirmCh: acc.confirmCh + (r.confirmClearinghouse ?? 0),
      reg: acc.reg + (r.regReported ?? 0),
    }),
    { seats: 0, apps: 0, passed: 0, sendCh: 0, confirmCh: 0, reg: 0 },
  );
  const ratio = totals.seats > 0 ? totals.apps / totals.seats : null;
  const yieldVsPlan = planPerYear > 0 ? totals.reg / planPerYear : null;

  return (
    <>
      <tr
        className="cursor-pointer bg-surface-2/60 font-medium hover:bg-surface-2"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3.5 w-3.5 text-text-secondary" /> : <ChevronDown className="h-3.5 w-3.5 text-text-secondary" />}
            <div className="text-xs font-semibold" lang="th">{facultyNameTh}</div>
          </div>
        </td>
        <td className="px-3 py-2 text-right text-xs text-text-tertiary">
          {programs.length} prog{programs.length === 1 ? '' : 's'}
        </td>
        <td className="px-3 py-2 text-right font-tabular">{planPerYear || '—'}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.seats.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.apps.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{ratio === null ? '—' : `${ratio.toFixed(1)}×`}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.passed.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.sendCh.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.confirmCh.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{totals.reg.toLocaleString()}</td>
        <td className="px-3 py-2 text-right font-tabular">{yieldVsPlan === null ? '—' : `${(yieldVsPlan * 100).toFixed(0)}%`}</td>
        <td className="px-2 py-2" />
      </tr>
      {open &&
        programs.map(([code, items]) => (
          <ProgramGroup key={code} programCode={code} items={items} headIndentClass="pl-7" />
        ))}
    </>
  );
}

function DrillRow({ r, indent }: { r: ProgramDrillRow; indent: boolean }) {
  const ratio = r.competitionRatio;
  const yieldR = r.planYield;
  return (
    <tr className={indent ? 'bg-surface-2/40 text-xs' : ''}>
      <td className={`px-3 py-1.5 ${indent ? 'pl-10' : ''}`}>
        {!indent && (
          <>
            <div className="font-tabular text-xs font-semibold">{r.programCode}</div>
            <div className="truncate text-xs text-text-secondary">{r.programNameEn}</div>
          </>
        )}
        {indent && <span className="text-text-tertiary">{r.programNameTh.slice(0, 30)}</span>}
      </td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.round}</td>
      <td className="px-3 py-1.5 text-right font-tabular text-text-tertiary">{r.planPerYear ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.enrollSeats ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.totalApplicants ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{ratio === null ? '—' : `${ratio.toFixed(1)}×`}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.totalPassed ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.sendClearinghouse ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.confirmClearinghouse ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{r.regReported ?? '—'}</td>
      <td className="px-3 py-1.5 text-right font-tabular">{yieldR === null ? '—' : `${(yieldR * 100).toFixed(0)}%`}</td>
      <td className="px-2 py-1.5">{!indent && (
        <Link href={`/programs/${r.programId}`} className="text-text-tertiary hover:text-accent-default" title="Open program deep-dive">
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}</td>
    </tr>
  );
}

export type { ProgramDrillRow, FacultyRow, RoundRow, YearTrendRow };

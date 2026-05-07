'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Badge,
  Card,
  EmptyState,
  Section,
} from '@kku/ui';
import { FunnelPipeline, useChartPalette, type FunnelStage } from '@kku/ui';
import { ChevronDown, ChevronUp, ExternalLink, Info } from 'lucide-react';

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
  registrationYield: number | null;
}

export interface RecruitmentDashboardPayload {
  meta: {
    latestCompleteYear: number | null;
    latestYearOverall: number | null;
    inProgressYear: number | null;
    availableYears: number[];
    selectedYear: number | null;
    appliedFilters: { entryYearBE?: number | null; facultyId?: string | null; level?: string | null };
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
  'Planned seats (annual)',
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
}: {
  data: RecruitmentDashboardPayload;
  faculties: Faculty[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setFilter = (key: 'entryYearBE' | 'facultyId' | 'level', value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value && value.length > 0) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <Card padding="sm" tone="quiet">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FilterSelect
            label="Entry year (BE)"
            value={String(data.meta.selectedYear ?? '')}
            options={data.meta.availableYears.map((y) => ({
              value: String(y),
              label: `BE ${y} (CE ${y - 543})${
                y === data.meta.latestCompleteYear
                  ? ' · latest complete'
                  : y === data.meta.inProgressYear
                    ? ' · in progress'
                    : ''
              }`,
            }))}
            onChange={(v) => setFilter('entryYearBE', v)}
          />
          <FilterSelect
            label="Faculty"
            value={data.meta.appliedFilters.facultyId ?? ''}
            options={[
              { value: '', label: 'All faculties' },
              ...faculties.map((f) => ({ value: f.id, label: `${f.code} · ${f.nameEn}` })),
            ]}
            onChange={(v) => setFilter('facultyId', v || null)}
          />
          <FilterSelect
            label="Level"
            value={data.meta.appliedFilters.level ?? ''}
            options={[
              { value: '', label: 'All levels' },
              ...LEVELS.map((l) => ({ value: l.id, label: l.label })),
            ]}
            onChange={(v) => setFilter('level', v || null)}
          />
        </div>
      </Card>

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
          title={`Recruitment funnel — BE ${data.meta.selectedYear ?? '—'}`}
        >
          <Card padding="md">
            {data.kpis.applicants > 0 ? (
              <FunnelPipeline
                stages={buildFunnelStages(data.kpis)}
                width={560}
                height={340}
              />
            ) : (
              <EmptyState title="No funnel data" description="Filters returned no rows." />
            )}
          </Card>
        </Section>

        <Section title="Year-over-year trend">
          <Card padding="md">
            <YearTrendChart byYear={data.byYear} />
          </Card>
        </Section>
      </div>

      {/* Faculty rollup */}
      <Section
        title={`By faculty — BE ${data.meta.selectedYear ?? '—'}`}
      >
        <Card padding="none">
          <FacultyRollupTable rows={data.byFaculty} />
        </Card>
      </Section>

      {/* Round breakdown */}
      <Section title={`By TCAS round — BE ${data.meta.selectedYear ?? '—'}`}>
        <Card padding="none">
          <RoundBreakdownTable rows={data.byRound} />
        </Card>
      </Section>

      {/* Drill-down table */}
      <Section
        title={`Program × round drill-down — BE ${data.meta.selectedYear ?? '—'}`}
      >
        <Card padding="none">
          <ProgramDrillTable rows={data.programs} />
        </Card>
      </Section>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="kku-select"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

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
    kpis.planPerYear,
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
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-text-tertiary">No faculty data.</p>;
  }
  const maxApps = Math.max(...rows.map((r) => r.totals.applicants), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-4 py-2 text-left">Faculty</th>
            <th className="px-4 py-2 text-right">Progs</th>
            <th className="px-4 py-2 text-right" title="Annual plan target (PLAN_PER_YEAR)">Plan</th>
            <th className="px-4 py-2 text-right" title="Sum of ENROLLSEAT across rounds (over-allocated to compensate no-show)">Allocated</th>
            <th className="px-4 py-2 text-right">Over-alloc</th>
            <th className="px-4 py-2 text-right">Applicants</th>
            <th className="px-4 py-2 text-right">Comp. ratio</th>
            <th className="px-4 py-2 text-right">Reported in</th>
            <th className="px-4 py-2 text-right" title="Reported in / Planned seats — % of annual target filled">vs Plan</th>
            <th className="px-4 py-2 text-left">Applicants distribution</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((r) => {
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

function RoundBreakdownTable({ rows }: { rows: RoundRow[] }) {
  if (rows.length === 0) return <p className="px-4 py-3 text-sm text-text-tertiary">No rounds.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-4 py-2 text-left">Round</th>
            <th className="px-4 py-2 text-right">Programs</th>
            <th className="px-4 py-2 text-right">Seats</th>
            <th className="px-4 py-2 text-right">Applicants</th>
            <th className="px-4 py-2 text-right">Passed</th>
            <th className="px-4 py-2 text-right">Send CH</th>
            <th className="px-4 py-2 text-right">Confirm CH</th>
            <th className="px-4 py-2 text-right">Send Reg</th>
            <th className="px-4 py-2 text-right">Reported in</th>
            <th className="px-4 py-2 text-right">Reg yield</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((r) => {
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
  | 'programCode' | 'level' | 'round' | 'enrollSeats' | 'planPerYear'
  | 'totalApplicants' | 'competitionRatio' | 'totalPassed' | 'sendClearinghouse'
  | 'confirmClearinghouse' | 'regReported' | 'registrationYield';

function ProgramDrillTable({ rows }: { rows: ProgramDrillRow[] }) {
  const [sortKey, setSortKey] = React.useState<SortKey>('competitionRatio');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = React.useState('');
  const [grouping, setGrouping] = React.useState<'flat' | 'program'>('program');

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

  // Group by program for the program-grouped view
  const grouped = React.useMemo(() => {
    if (grouping === 'flat') return null;
    const groups = new Map<string, ProgramDrillRow[]>();
    for (const r of sorted) {
      const arr = groups.get(r.programCode) ?? [];
      arr.push(r);
      groups.set(r.programCode, arr);
    }
    return Array.from(groups.entries());
  }, [sorted, grouping]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, name, CURR_ID…"
          className="w-64 rounded-md border border-border-default bg-surface-1 px-3 py-1.5 text-sm"
        />
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setGrouping('program')}
            className={`rounded px-2 py-1 ${grouping === 'program' ? 'bg-accent-subtle text-accent' : 'text-text-secondary'}`}
          >
            Group by program
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
          {sorted.length} rows · {grouped ? grouped.length : sorted.length} groups
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
            <tr>
              <SortHeader label="Code · Name" k="programCode" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Level" k="level" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortHeader label="Round" k="round" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Plan/yr" k="planPerYear" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Seats" k="enrollSeats" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Applicants" k="totalApplicants" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Comp. ratio" k="competitionRatio" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Passed" k="totalPassed" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Send CH" k="sendClearinghouse" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Confirm CH" k="confirmClearinghouse" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Reported in" k="regReported" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <SortHeader label="Reg yield" k="registrationYield" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} align="right" />
              <th className="px-2 py-2"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {grouping === 'flat'
              ? sorted.map((r) => <DrillRow key={`${r.programId}-${r.round}-${r.entryYearBE}`} r={r} indent={false} />)
              : grouped!.map(([code, items]) => (
                  <ProgramGroup key={code} programCode={code} items={items} />
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

function ProgramGroup({ programCode, items }: { programCode: string; items: ProgramDrillRow[] }) {
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
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            {open ? <ChevronUp className="h-3 w-3 text-text-tertiary" /> : <ChevronDown className="h-3 w-3 text-text-tertiary" />}
            <div>
              <div className="font-tabular text-xs font-semibold">{programCode}</div>
              <div className="truncate text-xs text-text-secondary">{head.programNameEn || head.programNameTh}</div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-xs">{head.level}</td>
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

function DrillRow({ r, indent }: { r: ProgramDrillRow; indent: boolean }) {
  const ratio = r.competitionRatio;
  const yieldR = r.registrationYield;
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
      <td className="px-3 py-1.5">{r.level}</td>
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

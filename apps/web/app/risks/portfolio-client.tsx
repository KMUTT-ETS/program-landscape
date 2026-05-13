'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import type { PortfolioResponse, PortfolioRiskRow, RiskTier, KkuRiskLevel } from './types';
import { TIER_LABEL, TIER_TONE, TIER_FILL_HEX, KKU_LEVEL_FILL, KKU_LEVEL_LABEL } from './types';
import {
  FacultyHeatmap,
  ErmScoreHistogram,
  DriverMixDonut,
  ConcentrationBars,
  KkuRiskMatrix,
  type FacultyHeatmapRow,
  type ConcentrationBar,
  type DriverMixSlice,
} from './viz';
import { Badge } from '@kku/ui';
import {
  FilterCrossLink,
  FilterCrossLinkGroup,
  FilterField,
  FilterRail,
  FilterSelect,
} from '@/components/filter-rail';

// Tier order kept for legacy references; the program-table grouping now
// uses ERM_ORDER (KKU L × I band) for consistency with the rest of the
// page (KPI tiles, 5×5 matrix, faculty heatmap, score histogram).
const TIER_ORDER: RiskTier[] = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'NEEDS_DATA'];
const ERM_ORDER: KkuRiskLevel[] = ['VERY_HIGH', 'HIGH', 'MODERATE', 'LOW', 'NEEDS_DATA'];

const ERM_LABEL_FULL: Record<KkuRiskLevel, string> = {
  NEEDS_DATA: 'Needs more data',
  LOW: 'Low risk',
  MODERATE: 'Moderate risk',
  HIGH: 'High risk',
  VERY_HIGH: 'Very high risk',
};

const ERM_TONE: Record<KkuRiskLevel, string> = {
  NEEDS_DATA: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30',
  LOW: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  MODERATE: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  HIGH: 'bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30',
  VERY_HIGH: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
};

function fmtThbCompact(n: number | null): string {
  if (n == null) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} K`;
  return Math.round(n).toLocaleString();
}

function tierIcon(tier: RiskTier): React.ReactNode {
  const cls = 'h-4 w-4';
  if (tier === 'CRITICAL') return <ShieldAlert className={cls} />;
  if (tier === 'HIGH') return <AlertCircle className={cls} />;
  if (tier === 'MODERATE') return <AlertTriangle className={cls} />;
  if (tier === 'NEEDS_DATA') return <HelpCircle className={cls} />;
  return <CheckCircle2 className={cls} />;
}

// Mirrors L2_COMPOSITE_DISCOUNT in @kku/db/risk-scoring (risk-scoring.v1.10).
// L2 (AI disruption) is dampened in the composite to avoid forcing expensive
// AI-readiness investments. The donut shows COMPOSITE-relevant dominance, so
// it must apply the same discount — otherwise an L1=60/L2=70 program is shown
// as L2-dominant even though L1 (60) > L2-effective (49) in the composite.
const L2_COMPOSITE_DISCOUNT = 0.7;

function dominantDriver(r: PortfolioRiskRow): 'L1' | 'L2' | 'L3' | null {
  const ls = [
    { k: 'L1' as const, v: r.l1 },
    { k: 'L2' as const, v: r.l2 != null ? r.l2 * L2_COMPOSITE_DISCOUNT : null },
    { k: 'L3' as const, v: r.l3 },
  ].filter((x) => x.v != null) as Array<{ k: 'L1' | 'L2' | 'L3'; v: number }>;
  if (ls.length === 0) return null;
  return ls.sort((a, b) => b.v - a.v)[0]!.k;
}

export function RisksPortfolioClient({
  portfolio,
  initialFilters,
}: {
  portfolio: PortfolioResponse;
  initialFilters: {
    erm: KkuRiskLevel | null;
    faculty: string;
    cellL: number | null;
    cellI: number | null;
  };
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const updateFilter = (key: 'erm' | 'faculty', value: string): void => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/risks?${next.toString()}`);
  };

  const setCellFilter = (l: number | null, i: number | null): void => {
    const next = new URLSearchParams(sp.toString());
    if (l != null && i != null) {
      next.set('l', String(l));
      next.set('i', String(i));
    } else {
      next.delete('l');
      next.delete('i');
    }
    router.replace(`/risks?${next.toString()}`);
  };

  // Filter chain: ERM filter → cell filter (both client-side; faculty
  // narrows the dataset at the API layer).
  const ermFilteredRows = React.useMemo(() => {
    if (!initialFilters.erm) return portfolio.rows;
    return portfolio.rows.filter((r) => r.kkuRiskLevel === initialFilters.erm);
  }, [portfolio.rows, initialFilters.erm]);

  const cellFilterActive = initialFilters.cellL != null && initialFilters.cellI != null;
  const cellFilteredRows = React.useMemo(() => {
    if (!cellFilterActive) return ermFilteredRows;
    return ermFilteredRows.filter(
      (r) => r.likelihoodBin === initialFilters.cellL && r.impactBin === initialFilters.cellI,
    );
  }, [cellFilterActive, ermFilteredRows, initialFilters.cellL, initialFilters.cellI]);

  const facultyOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const r of portfolio.rows) map.set(r.facultyId, r.facultyNameTh);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'th'));
  }, [portfolio.rows]);

  // Group by ERM level (KKU L × I band) for consistency with KPI tiles,
  // 5×5 matrix, and ERM score distribution histogram. Previously grouped
  // by composite tier (likelihood-only) which could put a HIGH-likelihood
  // × LOW-impact program in a different bucket than the rest of the page
  // showed it in.
  const groupedByErm = React.useMemo(() => {
    const out: Record<KkuRiskLevel, PortfolioRiskRow[]> = {
      VERY_HIGH: [],
      HIGH: [],
      MODERATE: [],
      LOW: [],
      NEEDS_DATA: [],
    };
    for (const r of cellFilteredRows) out[r.kkuRiskLevel].push(r);
    return out;
  }, [cellFilteredRows]);

  // Faculty heatmap data — counts by ERM level (L × I), matching the KPI
  // tiles + 5×5 matrix. Excludes NEEDS_DATA programs entirely (consistent
  // with the user's directive to keep them out of all comparative viz).
  // Faculties whose only undergrad programs are NEEDS_DATA drop out of
  // the heatmap (row.total would be 0). Sort by VERY_HIGH+HIGH first.
  const facultyHeatmap: FacultyHeatmapRow[] = React.useMemo(() => {
    const map = new Map<string, FacultyHeatmapRow>();
    for (const r of portfolio.rows) {
      if (r.kkuRiskLevel === 'NEEDS_DATA') continue;
      let row = map.get(r.facultyId);
      if (!row) {
        row = {
          facultyId: r.facultyId,
          facultyNameTh: r.facultyNameTh,
          facultyNameEn: r.facultyNameEn,
          total: 0,
          counts: { VERY_HIGH: 0, HIGH: 0, MODERATE: 0, LOW: 0, NEEDS_DATA: 0 },
        };
        map.set(r.facultyId, row);
      }
      row.total += 1;
      row.counts[r.kkuRiskLevel] += 1;
    }
    return [...map.values()].sort((a, b) => {
      const aHot = a.counts.VERY_HIGH + a.counts.HIGH;
      const bHot = b.counts.VERY_HIGH + b.counts.HIGH;
      if (aHot !== bHot) return bHot - aHot;
      return b.total - a.total;
    });
  }, [portfolio.rows]);

  // Driver mix — at-risk programs grouped by their composite-dominant driver.
  // Filter uses kkuRiskLevel (ERM L×I band) for consistency with the rest of
  // the page (KPI tiles, faculty heatmap, score histogram). Previously used
  // composite tier (likelihood-only), which silently excluded programs whose
  // ERM band was MODERATE/HIGH/VERY_HIGH but whose likelihood tier was LOW
  // (high impact + low likelihood). dominantDriver applies the L2 discount
  // so dominance reflects what actually drives the composite.
  const driverMix: DriverMixSlice[] = React.useMemo(() => {
    const counts = { L1: 0, L2: 0, L3: 0, none: 0 };
    for (const r of portfolio.rows) {
      if (r.kkuRiskLevel === 'NEEDS_DATA' || r.kkuRiskLevel === 'LOW') continue;
      const d = dominantDriver(r);
      if (!d) counts.none += 1;
      else counts[d] += 1;
    }
    const slices: DriverMixSlice[] = [
      { label: 'L1 — Recruitment decay', count: counts.L1, color: 'rgb(99 102 241)' },
      { label: 'L2 — AI disruption', count: counts.L2, color: 'rgb(236 72 153)' },
      { label: 'L3 — Demographic', count: counts.L3, color: 'rgb(249 115 22)' },
    ];
    // Only surface the "no driver data" slice when it actually has members,
    // so the donut total matches the at-risk program count exactly.
    if (counts.none > 0) {
      slices.push({ label: 'No driver data', count: counts.none, color: 'rgb(148 163 184)' });
    }
    return slices;
  }, [portfolio.rows]);

  // Top concentration by revenue at risk. Filter + colour key both use ERM
  // level (kkuRiskLevel) for consistency with the rest of the page. Bar
  // length = gross 5-yr tuition exposure (ERM Impact axis). Secondary
  // annotation = expected loss = exposure × composite/100 (likelihood-
  // weighted). Two views in one row so analysts can read both Pharmacy's
  // ฿0.43B exposure AND its much smaller expected loss given LOW likelihood.
  const topRevenue: ConcentrationBar[] = React.useMemo(() => {
    return [...portfolio.rows]
      .filter((r) => (r.directRevenueAtRiskThb ?? 0) > 0 && r.kkuRiskLevel !== 'NEEDS_DATA')
      .sort((a, b) => (b.directRevenueAtRiskThb ?? 0) - (a.directRevenueAtRiskThb ?? 0))
      .slice(0, 8)
      .map((r) => {
        const exposure = r.directRevenueAtRiskThb ?? 0;
        const composite = r.composite;
        const expectedLoss = composite != null ? exposure * (composite / 100) : null;
        const secondaryLabel =
          expectedLoss != null && composite != null
            ? `Expected loss ≈ ฿ ${fmtThbCompact(expectedLoss)} · likelihood ${Math.round(composite)} / 100`
            : 'Expected loss — likelihood data missing';
        return {
          programId: r.programId,
          label: r.programNameTh,
          sublabel: `${r.programNameEn} · ${r.facultyNameTh}`,
          value: exposure,
          secondaryLabel,
          kkuRiskLevel: r.kkuRiskLevel,
        };
      });
  }, [portfolio.rows]);

  return (
    <div className="space-y-6">
      {/* Top summary band — KPI tiles by ERM level (L × I score band, the
          institutional risk verdict). Previous version showed composite-
          likelihood tier here, but Risk = Likelihood × Impact, so the
          headline KPI must be ERM. Click a tile to filter the program list. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {(['VERY_HIGH', 'HIGH', 'MODERATE', 'LOW', 'NEEDS_DATA'] as KkuRiskLevel[]).map((lvl) => {
          const count = portfolio.summary.byKkuLevel[lvl];
          const fill = KKU_LEVEL_FILL[lvl];
          // Score range hint for the human-friendly L × I → band mapping.
          const range =
            lvl === 'VERY_HIGH'
              ? '16–25'
              : lvl === 'HIGH'
                ? '10–15'
                : lvl === 'MODERATE'
                  ? '5–9'
                  : lvl === 'LOW'
                    ? '1–4'
                    : '–';
          // Click filters the table below to programs at this ERM level.
          // The filter, table grouping, and tile colour all use the same
          // KkuRiskLevel — exact bijection, no "best-effort" guessing.
          const isSelected = initialFilters.erm === lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => updateFilter('erm', isSelected ? '' : lvl)}
              className={`flex flex-col rounded-lg border p-3 text-left transition-all ${
                isSelected
                  ? 'ring-2 ring-offset-2 ring-offset-surface-0'
                  : 'hover:scale-[1.02] hover:shadow-sm'
              }`}
              style={{
                background: lvl === 'NEEDS_DATA' ? `${fill}10` : `${fill}18`,
                borderColor: `${fill}66`,
                color: lvl === 'NEEDS_DATA' ? undefined : fill,
              }}
              title={`ERM ${KKU_LEVEL_LABEL[lvl].en} (${KKU_LEVEL_LABEL[lvl].th}) · L × I score ${range}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: fill }} />
                {KKU_LEVEL_LABEL[lvl].en}
                {lvl !== 'NEEDS_DATA' && (
                  <span className="text-[10px] font-normal opacity-70">· {range}</span>
                )}
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">{count}</div>
              <div className="text-xs opacity-80" lang="th">
                {KKU_LEVEL_LABEL[lvl].th}
              </div>
            </button>
          );
        })}
        <div className="flex flex-col rounded-lg border border-border-default bg-surface-1 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            5-year revenue at risk
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            ฿ {fmtThbCompact(portfolio.summary.totalRevenueAtRiskThb)}
          </div>
          <div className="text-xs text-text-tertiary">tuition exposure × 5 years</div>
        </div>
      </div>

      {/* Filter bar */}
      <FilterRail cols={2}>
        <FilterField label="Faculty">
          <FilterSelect
            aria-label="Faculty filter"
            value={initialFilters.faculty}
            onChange={(e) => updateFilter('faculty', e.target.value)}
          >
            <option value="">All faculties</option>
            {facultyOptions.map(([id, nameTh]) => (
              <option key={id} value={id}>
                {nameTh}
              </option>
            ))}
          </FilterSelect>
        </FilterField>
        <FilterField label="Cross-links">
          <FilterCrossLinkGroup>
            <FilterCrossLink href="/risks/matrix" tone="accent">
              Likelihood × impact matrix
            </FilterCrossLink>
            <FilterCrossLink href="/risks/indicators" tone="cardinal">
              Indicators
            </FilterCrossLink>
            <FilterCrossLink href="/risks/drivers" tone="warning">
              Drivers
            </FilterCrossLink>
          </FilterCrossLinkGroup>
        </FilterField>
      </FilterRail>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
        {cellFilterActive && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs text-accent">
            ERM cell · L{initialFilters.cellL} × I{initialFilters.cellI}
            <button
              type="button"
              onClick={() => setCellFilter(null, null)}
              className="rounded-sm px-1 hover:bg-accent/20"
              title="Clear cell filter"
            >
              ×
            </button>
          </span>
        )}
        {(initialFilters.erm || initialFilters.faculty || cellFilterActive) && (
          <button
            type="button"
            onClick={() => router.replace('/risks')}
            className="text-text-secondary underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto">
          {cellFilterActive ? (
            <>
              <span className="font-semibold text-text-primary">{cellFilteredRows.length}</span>{' '}
              of {portfolio.rows.length} programs match cell · {portfolio.methodologyVersion}
            </>
          ) : (
            <>
              {portfolio.rows.length} of {portfolio.rows.length + portfolio.summary.programsWithoutAssessment}{' '}
              programs assessed · {portfolio.methodologyVersion}
            </>
          )}
        </span>
      </div>

      {portfolio.summary.programsWithoutAssessment > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <strong>{portfolio.summary.programsWithoutAssessment} programs</strong> are missing risk assessments.
          Run <code className="font-mono">pnpm risks:assess --all</code> to populate them.
        </div>
      )}

      {/* 3-col viz row: ERM 5×5 matrix · Composite distribution · At-risk drivers */}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
        <section className="flex flex-col rounded-lg border border-border-default bg-surface-0 p-4">
          <header className="mb-3 flex items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                ERM 5×5 matrix
              </h3>
              <p className="mt-0.5 text-[10px] text-text-tertiary">L × I (1–25) cell counts</p>
            </div>
            <Link
              href="/risks/matrix"
              className="rounded-md border border-border-default bg-surface-2 px-2 py-0.5 text-[10px] hover:bg-surface-3"
            >
              Full →
            </Link>
          </header>
          <div className="flex-1">
            <KkuRiskMatrix
              cells={portfolio.summary.kkuMatrixCells}
              compact
              selectedLikelihood={initialFilters.cellL}
              selectedImpact={initialFilters.cellI}
              onCellClick={(l, i) => {
                // Toggle: clicking the same cell clears the filter.
                if (initialFilters.cellL === l && initialFilters.cellI === i) {
                  setCellFilter(null, null);
                } else {
                  setCellFilter(l, i);
                }
                if (typeof window !== 'undefined') {
                  // Scroll to the program list so the user sees the result.
                  setTimeout(() => {
                    const tableEl = document.getElementById('program-risk-table');
                    if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 50);
                }
              }}
            />
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-lg border border-border-default bg-surface-0 p-4">
          <header className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              ERM score distribution
            </h3>
            <span className="text-[10px] text-text-tertiary">
              {portfolio.rows.filter((r) => r.kkuMatrixScore != null).length} scored
            </span>
          </header>
          <ErmScoreHistogram
            scores={portfolio.rows.map((r) => r.kkuMatrixScore)}
          />
        </section>
        <section className="flex min-h-0 flex-col rounded-lg border border-border-default bg-surface-0 p-4">
          <header className="mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              At-risk drivers
            </h3>
            <p className="mt-0.5 text-[10px] text-text-tertiary">
              ERM Moderate/High/Very high only · L2 weighted ×0.7 to match composite
            </p>
          </header>
          <DriverMixDonut
            slices={driverMix}
            title="Dominant driver"
            footnote="ERM Moderate+ only · L1/L2-discounted/L3 compete for top score"
          />
        </section>
      </div>

      {/* Faculty heatmap + top revenue concentration */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-border-default bg-surface-0 p-4 lg:col-span-2">
          <header className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Faculty risk heatmap
            </h3>
            <span className="text-xs text-text-tertiary">
              Sorted by CRITICAL + HIGH count
            </span>
          </header>
          <FacultyHeatmap
            rows={facultyHeatmap}
            onCellClick={(facultyId, ermLevel) => {
              const next = new URLSearchParams(sp.toString());
              next.set('faculty', facultyId);
              next.set('erm', ermLevel);
              // Drop the cell filter (l/i) — would intersect with the band
              // filter and almost always produce an empty list.
              next.delete('l');
              next.delete('i');
              router.replace(`/risks?${next.toString()}`);
              if (typeof window !== 'undefined') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            }}
          />
        </section>
        <section className="rounded-lg border border-border-default bg-surface-0 p-4">
          <header className="mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
              Top revenue at risk{' '}
              <Badge
                tone="warning"
                size="sm"
                className="ml-1.5 align-middle"
                title="Per-program cost allocation uses cost-allocation.v0 (placeholder). Tuition exposure itself is real; net-contribution / loss figures pending Finance Committee sign-off."
              >
                PREVIEW
              </Badge>
            </h3>
            <p className="mt-0.5 text-xs text-text-tertiary">
              5-yr tuition exposure · bar colour = ERM L × I band
            </p>
          </header>
          {topRevenue.length > 0 ? (
            <>
              <ConcentrationBars rows={topRevenue} formatValue={(n) => `฿ ${fmtThbCompact(n)}`} />
              <details className="mt-3 rounded-md border border-border-subtle bg-surface-1/60 p-3 text-[11px] leading-relaxed text-text-secondary">
                <summary className="cursor-pointer font-medium text-text-secondary">
                  How is "revenue at risk" computed, and why is it a risk?
                </summary>
                <div className="mt-2 space-y-2">
                  <p>
                    <strong className="text-text-primary">Bar length</strong> ={' '}
                    <code className="font-mono">latest annual tuition revenue × 5</code>. This is the
                    program's gross 5-year tuition exposure — what KKU stands to lose if enrolment
                    collapsed completely. In the KKU ERM 5×5 framework this is the{' '}
                    <strong>Impact</strong> axis (potential loss <em>if</em> the risk event materialises).
                    Tuition is the only revenue line we use here — government salary subsidy is paid to
                    the staff regardless of cohort size, and per-program expense allocation is still
                    placeholder data (cost-allocation methodology v0).
                  </p>
                  <p>
                    <strong className="text-text-primary">Bar colour</strong> = the program's ERM L × I
                    band (1–25 score), so the visual ranking already reflects the likelihood side.
                    Pharmacy at ฿0.43B with LOW likelihood and Medicine at ฿0.39B with LOW likelihood
                    rank by exposure but render orange/red because their{' '}
                    <em>impact</em> binning lands them at the high-impact rows of the matrix.
                  </p>
                  <p>
                    <strong className="text-text-primary">"Expected loss" annotation</strong> ={' '}
                    <code className="font-mono">exposure × composite ÷ 100</code> — the likelihood-
                    weighted view. If a program has 20 / 100 likelihood, the expected loss is one-fifth
                    of its exposure. This is the closer analogue to a risk-managed "value at risk"
                    figure and may be a better number to lead with on Council slides; the gross
                    exposure is what the treasurer needs to see for concentration analysis.
                  </p>
                  <p className="text-text-tertiary">
                    Why we still rank by gross exposure: a low-likelihood × very-high-impact program
                    is exactly the case ERM tells you not to ignore — small chance of catastrophic
                    loss. Sorting by expected loss alone hides those tail-risk programs.
                  </p>
                </div>
              </details>
            </>
          ) : (
            <div className="text-xs text-text-tertiary">
              No tuition revenue data linked to at-risk programs yet.
            </div>
          )}
        </section>
      </div>

      {/* Tier-grouped table */}
      <div id="program-risk-table" className="space-y-4 scroll-mt-4">
        {cellFilterActive && cellFilteredRows.length === 0 && (
          <div className="rounded-md border border-border-default bg-surface-1 p-4 text-center text-sm text-text-secondary">
            No programs in cell L{initialFilters.cellL} × I{initialFilters.cellI}.{' '}
            <button
              type="button"
              onClick={() => setCellFilter(null, null)}
              className="text-accent-default underline-offset-2 hover:underline"
            >
              Clear cell filter
            </button>
          </div>
        )}
        {ERM_ORDER.map((lvl) => {
          const rows = groupedByErm[lvl];
          if (rows.length === 0) return null;
          const ermScoreRange =
            lvl === 'VERY_HIGH'
              ? '16–25'
              : lvl === 'HIGH'
                ? '10–15'
                : lvl === 'MODERATE'
                  ? '5–9'
                  : lvl === 'LOW'
                    ? '1–4'
                    : '–';
          const ermIcon = (() => {
            const cls = 'h-4 w-4';
            if (lvl === 'VERY_HIGH') return <ShieldAlert className={cls} />;
            if (lvl === 'HIGH') return <AlertCircle className={cls} />;
            if (lvl === 'MODERATE') return <AlertTriangle className={cls} />;
            if (lvl === 'NEEDS_DATA') return <HelpCircle className={cls} />;
            return <CheckCircle2 className={cls} />;
          })();
          return (
            <section key={lvl} className="rounded-lg border border-border-default bg-surface-0">
              <header
                className={`flex items-center justify-between border-b border-border-default px-4 py-2 ${ERM_TONE[lvl]}`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {ermIcon} {ERM_LABEL_FULL[lvl]}
                  {lvl !== 'NEEDS_DATA' && (
                    <span className="text-[11px] font-normal opacity-70">· score {ermScoreRange}</span>
                  )}
                  <span className="opacity-80">({rows.length})</span>
                </div>
                {lvl === 'NEEDS_DATA' && (
                  <span className="text-[11px] opacity-80">
                    Missing TCAS funnel, skill-automation tags, or financial data · excluded from comparative viz · do not interpret as healthy
                  </span>
                )}
              </header>
              <div className="overflow-x-auto">
                {/* Column-group palette — distinguishes Identity (default),
                    Scores (subtle indigo), Drivers (slate), Impact (amber).
                    Cells reuse these via className token below. */}
                <table className="w-full text-sm">
                  <colgroup>
                    {/* Identity */}
                    <col />
                    <col />
                    {/* Scores group */}
                    <col className="bg-indigo-500/[0.04] dark:bg-indigo-400/[0.05]" />
                    <col className="bg-indigo-500/[0.04] dark:bg-indigo-400/[0.05]" />
                    {/* Drivers group */}
                    <col className="bg-surface-2/40" />
                    <col className="bg-surface-2/40" />
                    <col className="bg-surface-2/40" />
                    {/* Impact group — single column since v1.10 (stranded
                        cost dropped: not in the data, methodology v0). */}
                    <col className="bg-amber-500/[0.05] dark:bg-amber-400/[0.05]" />
                  </colgroup>
                  <thead className="text-[11px] uppercase tracking-wide text-text-tertiary">
                    {/* Group header row */}
                    <tr className="border-b border-border-subtle">
                      <th colSpan={2} className="px-4 py-1.5 text-left font-semibold">
                        Identity
                      </th>
                      <th
                        colSpan={2}
                        className="border-l border-border-subtle bg-indigo-500/[0.06] px-4 py-1.5 text-center font-semibold text-indigo-700 dark:bg-indigo-400/[0.08] dark:text-indigo-300"
                      >
                        Scores
                      </th>
                      <th
                        colSpan={3}
                        className="border-l border-border-subtle bg-surface-2/60 px-4 py-1.5 text-center font-semibold text-text-secondary"
                      >
                        Likelihood drivers
                      </th>
                      <th
                        className="border-l border-border-subtle bg-amber-500/[0.08] px-4 py-1.5 text-center font-semibold text-amber-700 dark:bg-amber-400/[0.10] dark:text-amber-300"
                      >
                        Impact (5-year)
                      </th>
                    </tr>
                    {/* Column header row */}
                    <tr className="border-b border-border-subtle text-xs text-text-secondary">
                      <th className="px-4 py-2 text-left font-medium">Program</th>
                      <th className="px-4 py-2 text-left font-medium">Faculty</th>
                      <th className="border-l border-border-subtle px-4 py-2 text-right font-medium">
                        Composite
                      </th>
                      <th className="px-4 py-2 text-center font-medium">ERM score</th>
                      <th className="border-l border-border-subtle px-4 py-2 text-right font-medium">
                        L1 Recruitment
                      </th>
                      <th className="px-4 py-2 text-right font-medium">L2 AI risk</th>
                      <th className="px-4 py-2 text-right font-medium">L3 Demographic</th>
                      <th className="border-l border-border-subtle px-4 py-2 text-right font-medium">
                        Revenue at risk
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.programId}
                        className="cursor-pointer border-b border-border-subtle transition-colors hover:bg-surface-1"
                        onClick={() => {
                          if (typeof window !== 'undefined') {
                            window.location.href = `/risks/${r.programId}`;
                          }
                        }}
                      >
                        <td className="px-4 py-2">
                          <Link
                            href={`/risks/${r.programId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block transition-colors hover:text-accent-default"
                          >
                            <div
                              className="font-medium underline-offset-2 group-hover:underline"
                              lang="th"
                            >
                              {r.programNameTh}
                            </div>
                            <div className="text-xs text-text-tertiary">
                              {r.programNameEn} · {r.programCode}
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          <div className="text-sm" lang="th">
                            {r.facultyNameTh}
                          </div>
                          <div className="text-xs text-text-tertiary">{r.facultyNameEn}</div>
                        </td>
                        <td className="border-l border-border-subtle px-4 py-2 text-right tabular-nums">
                          <span
                            className="font-semibold"
                            style={{ color: r.composite != null ? TIER_FILL_HEX[r.tier] : 'inherit' }}
                          >
                            {r.composite?.toFixed(0) ?? '–'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {r.kkuMatrixScore != null ? (
                            <span
                              className="inline-flex items-baseline gap-1 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums"
                              style={{
                                color: KKU_LEVEL_FILL[r.kkuRiskLevel],
                                background: `${KKU_LEVEL_FILL[r.kkuRiskLevel]}18`,
                                border: `1px solid ${KKU_LEVEL_FILL[r.kkuRiskLevel]}55`,
                              }}
                              title={`L${r.likelihoodBin} × I${r.impactBin} = ${r.kkuMatrixScore} — ${KKU_LEVEL_LABEL[r.kkuRiskLevel].en} (${KKU_LEVEL_LABEL[r.kkuRiskLevel].th})`}
                            >
                              {r.kkuMatrixScore}
                              <span className="text-[9px] opacity-70">
                                L{r.likelihoodBin}·I{r.impactBin}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-text-tertiary">–</span>
                          )}
                        </td>
                        <td className="border-l border-border-subtle px-4 py-2 text-right tabular-nums text-text-secondary">
                          {r.l1?.toFixed(0) ?? '–'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                          {r.l2?.toFixed(0) ?? '–'}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-text-secondary">
                          {r.l3?.toFixed(0) ?? '–'}
                        </td>
                        <td className="border-l border-border-subtle px-4 py-2 text-right tabular-nums text-text-secondary">
                          {fmtThbCompact(r.directRevenueAtRiskThb)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

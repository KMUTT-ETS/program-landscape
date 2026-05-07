'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, useChartPalette } from '@kku/ui';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Database,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type {
  OpportunityResponse,
  ProgramDemandGapResponse,
  SkillGapResponse,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Demand-Supply Gap Analyzer — redesigned 2026-05-03 around real data only.
//
// Drops:
//   - Region selector (no per-province data populated)
//   - Horizon / forecast selector (ForecastRun is empty)
//   - Comparison selector (per-capita / growth-adjusted: cosmetic, not real)
//   - Occupation panel (OccupationDemand is 0 rows — never repointed after
//     the JobThai/JobsDB→KMITL connector swap)
//   - Sector panel (skillSectors → JobPostingSkill chain is empty)
//   - Regional Thailand map (no province-level supply or demand data)
//
// Keeps + adds:
//   - Hero KPIs anchored in reality (alumni coverage, KMITL coverage,
//     overall gap counts)
//   - Two-side skill split: shortage (need more grads) vs oversupply
//     (too many grads for the demand signal we have)
//   - Fastest-growing skills (KmitlSkillGrowth) with KKU coverage flag
//   - Per-program demand-match gaps (NEW data — 1,282 AI-resolved
//     discipline-relevant gaps across 207 programs)
// ─────────────────────────────────────────────────────────────────────────────

interface Filters {
  scope: string;
  scopeId: string;
}

interface PageData {
  skillGap: SkillGapResponse | null;
  opportunities: OpportunityResponse | null;
  programGaps: ProgramDemandGapResponse | null;
}

export function GapAnalysisClient({
  initialFilters,
  data,
}: {
  initialFilters: Filters;
  data: PageData;
}) {
  const router = useRouter();
  const [filters] = React.useState(initialFilters);

  // Compute KPI inputs from the live responses.
  const skillsRows = data.skillGap?.rows ?? [];
  const shortages = skillsRows.filter((r) => r.gap > 0);
  const oversupplies = skillsRows.filter((r) => r.gap < 0);
  const programGaps = data.programGaps;
  const opps = data.opportunities;
  const totalProgramsAssessed = (programGaps?.rows.length ?? 0) + (programGaps?.uncoveredProgramCount ?? 0);
  const programCoveragePct =
    totalProgramsAssessed > 0
      ? ((programGaps?.rows.length ?? 0) / totalProgramsAssessed) * 100
      : null;
  const topGrowthSkill = (opps?.rows ?? [])
    .filter((r) => r.demandGrowthPct > 0)
    .sort((a, b) => b.demandGrowthPct - a.demandGrowthPct)[0];

  void router;

  return (
    <div className="flex flex-col gap-6">
      {/* Provenance line — replaces the fake-filter bar */}
      <Card padding="sm" className="bg-surface-2/40">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" aria-hidden />
            <strong className="text-text-secondary">Demand</strong> · LinkedIn skill data (subscribed by MHESI; LinkedIn profiles × Thai job postings)
          </span>
          <span>·</span>
          <span>
            <strong className="text-text-secondary">Supply</strong> · KKU AlumniCohortStatus (real cohort outcomes) ·
            fallback to admission-side enrolment proxy
          </span>
          <span>·</span>
          <span>
            <strong className="text-text-secondary">Per-program gaps</strong> · AI-resolved, discipline-filtered
          </span>
          <span>·</span>
          <span title="transferable / language / soft skills are excluded because job-posting taxonomies systematically under-list them">
            <strong className="text-text-secondary">Soft skills</strong> excluded
          </span>
          {filters.scope !== 'university' && (
            <span className="ml-auto rounded bg-accent-subtle px-2 py-0.5 text-text-secondary">
              Scope: {filters.scope}
            </span>
          )}
        </div>
      </Card>

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroStat
          tone="warning"
          icon={<AlertTriangle />}
          label="Skills in shortage"
          value={shortages.length.toString()}
          sub="demand > supply (top 20 considered)"
        />
        <HeroStat
          tone="positive"
          icon={<TrendingUp />}
          label="Skills in oversupply"
          value={oversupplies.length.toString()}
          sub="supply > demand (re-balance candidates)"
        />
        <HeroStat
          tone="default"
          icon={<Sparkles />}
          label="Top growth skill"
          value={topGrowthSkill ? `+${topGrowthSkill.demandGrowthPct.toFixed(0)}%` : '—'}
          sub={topGrowthSkill?.nameEn ?? 'no growth-tagged skills'}
        />
        <HeroStat
          tone="default"
          icon={<Database />}
          label="Per-program coverage"
          value={programCoveragePct === null ? '—' : `${programCoveragePct.toFixed(0)}%`}
          sub={`${programGaps?.rows.length ?? 0} of ${totalProgramsAssessed} programs assessed`}
        />
      </div>

      {/* Shortage + oversupply twin columns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Need more graduates"
          subtitle="Skills where labour demand exceeds KKU supply. Sorted by gap."
          icon={<ArrowUpRight className="text-warning" />}
          tone="warning"
        >
          <SkillGapList rows={shortages.slice(0, 10)} variant="shortage" />
        </Panel>
        <Panel
          title="Too many graduates"
          subtitle="Skills where KKU produces more than the demand signal. Re-balance candidates."
          icon={<ArrowDownRight className="text-positive" />}
          tone="positive"
        >
          <SkillGapList rows={oversupplies.slice(0, 10)} variant="oversupply" />
        </Panel>
      </div>

      {/* Growth signal */}
      <Panel
        title="Fastest-growing skills (Thailand · LinkedIn job postings)"
        subtitle="From the LinkedIn-derived labour-market growth signal (subscribed by MHESI). Green dot = at least one KKU program teaches it."
        icon={<Sparkles className="text-accent" />}
      >
        <GrowthList rows={(opps?.rows ?? []).filter((r) => r.demandGrowthPct > 0).sort((a, b) => b.demandGrowthPct - a.demandGrowthPct).slice(0, 10)} />
      </Panel>

      {/* Per-program demand-match gaps */}
      <Panel
        title="Per-program demand-match gaps"
        subtitle={
          programGaps
            ? `Programs with the largest curriculum gaps in their own discipline. ${programGaps.uncoveredProgramCount} programs excluded — AI demand-match hasn't run for them yet.`
            : 'Loading…'
        }
        icon={<AlertTriangle className="text-warning" />}
      >
        <ProgramGapTable rows={programGaps?.rows.slice(0, 12) ?? []} />
      </Panel>

      {/* Footer disclosures */}
      <Card padding="sm" className="text-[11px] text-text-tertiary">
        <p>
          This page renders only what is backed by populated tables. Region, occupation, sector,
          and forecast horizon views are intentionally omitted because their underlying data
          sources are not yet wired (OccupationDemand 0 rows; per-province alumni tracking
          deferred; ForecastRun 0 rows). Soft / transferable / language skills are also
          excluded — LinkedIn and other job-posting taxonomies under-list them, so including
          them would create artificial "oversupply" rows (every program teaches teamwork;
          no posting demands it by name).
        </p>
        {data.skillGap?.lowConfidenceReason && (
          <p className="mt-1 text-warning">⚠ {data.skillGap.lowConfidenceReason}</p>
        )}
        <p className="mt-2 flex items-center gap-3">
          <Link href="/gap-analysis/opportunities" className="underline hover:text-accent-default">
            Opportunities (white-spaces) →
          </Link>
          <Link href="/gap-analysis/risks" className="underline hover:text-accent-default">
            Risks (oversupply forecast) →
          </Link>
        </p>
      </Card>
    </div>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function HeroStat({
  tone,
  icon,
  label,
  value,
  sub,
}: {
  tone: 'default' | 'positive' | 'warning' | 'danger';
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  const valueClass = {
    default: 'text-text-primary',
    positive: 'text-positive',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</p>
        <span className="text-text-tertiary">{icon}</span>
      </div>
      <p className={`font-tabular text-2xl font-semibold ${valueClass}`}>{value}</p>
      <p className="line-clamp-2 text-[11px] text-text-tertiary">{sub}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon,
  tone,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tone?: 'warning' | 'positive';
  children: React.ReactNode;
}) {
  const stripe =
    tone === 'warning' ? 'border-l-warning/60' : tone === 'positive' ? 'border-l-positive/60' : 'border-l-border-default';
  return (
    <Card padding="md" className={`border-l-4 ${stripe}`}>
      <header className="mb-3 flex items-start gap-2">
        {icon && <span className="mt-0.5 h-4 w-4 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-text-tertiary">{subtitle}</p>}
        </div>
      </header>
      {children}
    </Card>
  );
}

function SkillGapList({
  rows,
  variant,
}: {
  rows: SkillGapResponse['rows'];
  variant: 'shortage' | 'oversupply';
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary">No skills in this bucket.</p>;
  }
  // Find the bar baseline: largest abs(gap) in this list.
  const maxAbsGap = Math.max(...rows.map((r) => Math.abs(r.gap)), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const widthPct = Math.max(4, (Math.abs(r.gap) / maxAbsGap) * 100);
        const sign = variant === 'shortage' ? '+' : '−';
        const toneClass = variant === 'shortage' ? 'bg-warning/70' : 'bg-positive/70';
        const labelTone = variant === 'shortage' ? 'text-warning' : 'text-positive';
        return (
          <li key={r.skillId} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-text-primary" title={r.nameTh}>
                {r.nameEn}
              </span>
              <span className={`shrink-0 font-tabular text-xs font-semibold ${labelTone}`}>
                {sign}
                {Math.abs(r.gap).toFixed(0)}
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className={`h-full ${toneClass}`} style={{ width: `${widthPct}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-text-tertiary">
              <span>demand {r.demand.toFixed(0)} · supply {r.supply.toFixed(0)}</span>
              {r.topDemandingEmployers.length > 0 && (
                <span className="truncate" title={r.topDemandingEmployers.join(' · ')}>
                  top: {r.topDemandingEmployers.slice(0, 2).join(' · ')}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function GrowthList({ rows }: { rows: OpportunityResponse['rows'] }) {
  const palette = useChartPalette();
  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary">No skills with positive growth in the current window.</p>;
  }
  const maxGrowth = Math.max(...rows.map((r) => r.demandGrowthPct), 1);
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const widthPct = Math.max(4, (r.demandGrowthPct / maxGrowth) * 100);
        const isCovered = r.existingProgramCount > 0;
        return (
          <li key={r.skillId} className="flex items-center gap-3">
            <span
              title={isCovered ? `${r.existingProgramCount} KKU programs teach this` : 'No KKU coverage'}
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: isCovered ? palette.positive : palette.negative, opacity: 0.85 }}
            />
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-text-primary">{r.nameEn}</span>
                <span className="font-tabular text-xs font-semibold text-accent">
                  +{r.demandGrowthPct.toFixed(0)}%
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full bg-accent-default/70" style={{ width: `${widthPct}%` }} />
              </div>
              <div className="text-[10px] text-text-tertiary">
                demand {r.recentDemand.toFixed(0)} · {isCovered
                  ? `${r.existingProgramCount} KKU program${r.existingProgramCount === 1 ? '' : 's'}`
                  : 'no KKU coverage'}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ProgramGapTable({ rows }: { rows: ProgramDemandGapResponse['rows'] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary">No per-program gap data yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-subtle text-left text-text-tertiary">
            <th className="py-2 pr-3 font-normal">Program</th>
            <th className="py-2 pr-3 font-normal">Faculty</th>
            <th className="py-2 pr-3 text-right font-normal">Demand-relevant skills</th>
            <th className="py-2 pr-3 text-right font-normal">Covered</th>
            <th className="py-2 pr-3 text-right font-normal">Gaps</th>
            <th className="py-2 pr-3 text-right font-normal">Coverage</th>
            <th className="py-2 pr-3 font-normal">Top gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.programId} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/40">
              <td className="py-2 pr-3">
                <Link
                  href={`/programs/${r.programId}`}
                  className="font-medium text-text-primary hover:text-accent-default"
                >
                  {(r.programNameEn || r.programNameTh).slice(0, 50)}
                </Link>
                <div className="text-[10px] text-text-tertiary font-tabular">{r.programCode}</div>
              </td>
              <td className="py-2 pr-3 text-text-secondary">{r.facultyCode}</td>
              <td className="py-2 pr-3 text-right font-tabular">{r.relevantSkillCount}</td>
              <td className="py-2 pr-3 text-right font-tabular text-positive">{r.coveredCount}</td>
              <td className="py-2 pr-3 text-right font-tabular text-warning">{r.gapCount}</td>
              <td className="py-2 pr-3 text-right">
                <CoverageBar pct={r.coverageRatio * 100} />
              </td>
              <td className="py-2 pr-3 text-text-secondary">
                {r.topGaps[0] ? r.topGaps[0].skillNameEn : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageBar({ pct }: { pct: number }) {
  const tone = pct >= 70 ? 'bg-positive/70' : pct >= 40 ? 'bg-warning/70' : 'bg-danger/70';
  return (
    <div className="inline-flex items-center gap-1.5 align-middle">
      <span className="font-tabular text-[11px] text-text-secondary">{pct.toFixed(0)}%</span>
      <div className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

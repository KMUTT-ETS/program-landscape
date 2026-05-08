import * as React from 'react';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import { RisksBackNav } from '../viz';
import type { DriversResponseV2 } from '../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Risk Drivers' };

const AR_FILL: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN', string> = {
  LOW: 'rgb(34 197 94)',
  MEDIUM: 'rgb(234 179 8)',
  HIGH: 'rgb(244 63 94)',
  UNKNOWN: 'rgb(100 116 139)',
};

const SEV_FILL = { major: 'rgb(244 63 94)', moderate: 'rgb(234 179 8)', minor: 'rgb(100 116 139)' };

export default async function DriversPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const drivers = await apiFetch<DriversResponseV2>('/risks/drivers').catch(() => null);

  return (
    <AuthedAppShell user={user}>
      <RisksBackNav current="Drivers · inputs to the model" />
      <PageHeader
        title="Drivers · Inputs to the Risk Model"
        subtitle="Three external drivers feed the engine. Council can challenge inputs here, not just outputs. Hover any chart for detail."
      />
      {drivers ? (
        <div className="space-y-4">
          {/* L3 Demographic */}
          <article className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="flex items-baseline justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">Demographic ceiling — Thailand 18–22 cohort</h3>
                <p className="text-xs text-text-tertiary">Source: {drivers.cohort.source}</p>
              </div>
              <span className="text-xs text-text-tertiary">L3 driver</span>
            </header>
            <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="grid gap-3">
                <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
                  <div className="text-xs uppercase tracking-wide text-text-tertiary">Annual decline</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    −{drivers.cohort.yearlyDeclinePct.toFixed(1)}%
                  </div>
                  <div className="text-xs text-text-secondary">per year, NESDC projection</div>
                </div>
                <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
                  <div className="text-xs uppercase tracking-wide text-text-tertiary">5-year compound</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    −{drivers.cohort.fiveYearProjectionPct.toFixed(1)}%
                  </div>
                  <div className="text-xs text-text-secondary">universal — affects every program</div>
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  Cohort projection (BE 2569 = 100, today)
                </div>
                <CohortProjectionChart projection={drivers.cohort.projection} />
              </div>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              The cohort decline is a constant in the model — it&apos;s the baseline pressure every program faces.
              What differentiates programs in L3 is their TCAS competitiveness percentile: a program in the bottom
              quartile of competition will feel the cohort decline first.
            </p>
          </article>

          {/* L2 AI disruption */}
          <article className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">AI-disruption · Skill automation classification</h3>
              <span className="text-xs text-text-tertiary">L2 component 1 of 3</span>
            </header>
            <p className="mt-1 text-sm text-text-secondary">
              Each Skill in the taxonomy is tagged with an automation-risk tier. Heuristic seed first
              (Frey-Osborne, WEF Future of Jobs 2023, ILO sectoral studies), then refined by the per-skill
              AI sweep when programs are fully assessed.
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
              <AutomationRiskDonut counts={drivers.automationRisk.counts} total={drivers.automationRisk.total} />
              <div className="grid gap-3 sm:grid-cols-3">
                {(['LOW', 'MEDIUM', 'HIGH'] as const).map((tier) => (
                  <div key={tier} className="rounded-md border border-border-subtle bg-surface-1 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: AR_FILL[tier] }} />
                      {tier} automation risk
                    </div>
                    <ul className="space-y-1 text-xs text-text-secondary">
                      {drivers.automationRisk.sampleByTier[tier].slice(0, 7).map((s) => (
                        <li key={s.id} title={s.nameTh}>
                          {s.nameEn}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              Source: Frey &amp; Osborne (2017), WEF Future of Jobs Report 2023, ILO sectoral automation
              studies. The {drivers.automationRisk.counts.UNKNOWN} UNKNOWN rows will be classified by the AI
              sweep when programs are individually assessed (<code className="font-mono">pnpm risks:assess</code>).
            </p>
          </article>

          {/* AI readiness from program-ai-readiness.v2 */}
          <article className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Discipline-aware AI readiness — deep-dive</h3>
              <span className="text-xs text-text-tertiary">L2 components 2 + 3 of 3</span>
            </header>
            <p className="mt-1 text-sm text-text-secondary">
              The deep-dive runs <code className="font-mono">program-ai-readiness.v2</code> per program — a
              discipline-grounded AI analysis that names concrete gaps (e.g. &quot;AI in music information
              retrieval&quot;) and recommendations. L2 reads both the relevance score (preparedness deficit)
              and the gap volume (disruption signal).
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  Relevance score distribution ({drivers.aiReadiness.total} programs)
                </div>
                <ReadinessHistogram buckets={drivers.aiReadiness.buckets} />
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  Gap severity volume across programs
                </div>
                <SeverityCountBars counts={drivers.aiReadiness.severityCounts} />
                <p className="mt-3 text-xs text-text-tertiary">
                  More major gaps = stronger disruption pressure on the program&apos;s discipline. Each
                  named gap is surfaced inline on the per-program profile and into the AI risk-mitigation
                  prompt.
                </p>
              </div>
            </div>
          </article>

          {/* TCAS competitiveness */}
          <article className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Recruitment · TCAS competition ratio</h3>
              <span className="text-xs text-text-tertiary">L1 driver + L3 percentile</span>
            </header>
            <p className="mt-1 text-sm text-text-secondary">
              Per-program TCAS funnel from KKU Registry (<code className="font-mono">POWERBI.ADMISSION_STAT_CURRID</code>).
              {' '}
              {drivers.competitiveness.programsRankedCount} undergraduate programs have funnel data and are
              ranked by competition ratio. The in-progress cycle is excluded.
            </p>
            <div className="mt-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                Latest-cycle competition ratio histogram (applicants ÷ planned seats)
              </div>
              <RatioHistogram buckets={drivers.competitiveness.ratioHistogram} />
            </div>
            <p className="mt-3 text-xs text-text-tertiary">
              Programs without TCAS funnel data return <code className="font-mono">null</code> on L1 + L3 percentile —
              data gap, not a clean bill of health.
            </p>
          </article>

          <div className="text-xs text-text-tertiary">
            Methodology: <code className="font-mono">{drivers.methodology.version}</code> · doc{' '}
            <code className="font-mono">{drivers.methodology.docPath}</code>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border-default bg-surface-1 p-6 text-text-secondary">
          Unable to load drivers data.
        </div>
      )}
    </AuthedAppShell>
  );
}

// ── Embedded charts ────────────────────────────────────────────────────────

function CohortProjectionChart({ projection }: { projection: Array<{ yearBE: number; cohortIndex: number }> }) {
  if (projection.length === 0) return null;
  const W = 500;
  const H = 120;
  const pad = { l: 36, r: 12, t: 8, b: 26 };
  const max = Math.max(100, ...projection.map((p) => p.cohortIndex));
  const min = Math.min(...projection.map((p) => p.cohortIndex));
  const range = max - min;
  const x = (i: number) => pad.l + (i / Math.max(1, projection.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min + 5) / (range + 10)) * (H - pad.t - pad.b);
  const path = projection
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.cohortIndex).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="currentColor" strokeOpacity={0.15} />
      <path d={path} fill="none" stroke="rgb(249 115 22)" strokeWidth={2} />
      {projection.map((p, i) => (
        <g key={p.yearBE}>
          <circle cx={x(i)} cy={y(p.cohortIndex)} r={3} fill="rgb(249 115 22)" />
          <text
            x={x(i)}
            y={y(p.cohortIndex) - 8}
            textAnchor="middle"
            className="fill-current"
            fontSize="9"
          >
            {p.cohortIndex.toFixed(1)}
          </text>
          <text
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-current opacity-60"
            fontSize="9"
          >
            BE {p.yearBE}
          </text>
        </g>
      ))}
      <text x={pad.l - 4} y={pad.t + 6} textAnchor="end" className="fill-current opacity-60" fontSize="9">
        100
      </text>
      <text x={pad.l - 4} y={H - pad.b} textAnchor="end" className="fill-current opacity-60" fontSize="9">
        {(min - 5).toFixed(0)}
      </text>
    </svg>
  );
}

function AutomationRiskDonut({
  counts,
  total,
}: {
  counts: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN', number>;
  total: number;
}) {
  if (total === 0) return null;
  const cx = 100;
  const cy = 100;
  const r = 80;
  const inner = 50;
  let cum = -Math.PI / 2;
  const order: Array<'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'> = ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'];
  return (
    <div className="flex items-center gap-4">
      <svg width={200} height={200} viewBox="0 0 200 200">
        {order.map((tier) => {
          const value = counts[tier] ?? 0;
          if (value === 0) return null;
          const angle = (value / total) * Math.PI * 2;
          const start = cum;
          const end = cum + angle;
          cum = end;
          const x1 = cx + r * Math.cos(start);
          const y1 = cy + r * Math.sin(start);
          const x2 = cx + r * Math.cos(end);
          const y2 = cy + r * Math.sin(end);
          const ix1 = cx + inner * Math.cos(start);
          const iy1 = cy + inner * Math.sin(start);
          const ix2 = cx + inner * Math.cos(end);
          const iy2 = cy + inner * Math.sin(end);
          const large = angle > Math.PI ? 1 : 0;
          const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`;
          return (
            <path key={tier} d={d} fill={AR_FILL[tier]} stroke="var(--color-surface-0)" strokeWidth={2}>
              <title>{`${tier}: ${value} skills (${((value / total) * 100).toFixed(0)}%)`}</title>
            </path>
          );
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-current" fontSize="22" fontWeight="600">
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="fill-current opacity-60" fontSize="10">
          skills
        </text>
      </svg>
      <div className="flex flex-col gap-1.5 text-xs">
        {order.map((tier) => {
          const value = counts[tier] ?? 0;
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <div key={tier} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: AR_FILL[tier] }} />
              <span className="text-text-secondary">{tier}</span>
              <span className="ml-auto tabular-nums">
                <span className="font-semibold">{value}</span>
                <span className="ml-1 text-text-tertiary">({pct.toFixed(0)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReadinessHistogram({
  buckets,
}: {
  buckets: Array<{ range: string; count: number; meanScore: number }>;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  // Color bands: <30 = rose, 30-50 = amber, 50-70 = blue, 70+ = emerald
  const fillFor = (range: string) => {
    if (range.startsWith('<30')) return 'rgb(244 63 94)';
    if (range.startsWith('30')) return 'rgb(234 179 8)';
    if (range.startsWith('50')) return 'rgb(59 130 246)';
    return 'rgb(16 185 129)';
  };
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 110 }}>
        {buckets.map((b) => {
          const h = (b.count / max) * 100;
          return (
            <div
              key={b.range}
              className="flex flex-1 flex-col items-center justify-end"
              title={`${b.range} relevance score: ${b.count} program${b.count === 1 ? '' : 's'} · mean ${b.meanScore}`}
            >
              <div className="text-[10px] tabular-nums text-text-tertiary">{b.count > 0 ? b.count : ''}</div>
              <div
                className="w-full rounded-t-sm"
                style={{ height: `${h}px`, background: fillFor(b.range), opacity: 0.85 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2 text-[10px] text-text-tertiary">
        {buckets.map((b) => (
          <span key={b.range} className="flex-1 text-center">
            {b.range}
          </span>
        ))}
      </div>
    </div>
  );
}

function SeverityCountBars({
  counts,
}: {
  counts: { major: number; moderate: number; minor: number };
}) {
  const total = counts.major + counts.moderate + counts.minor;
  const max = Math.max(1, counts.major, counts.moderate, counts.minor);
  const rows = [
    { label: 'Major gaps', value: counts.major, color: SEV_FILL.major },
    { label: 'Moderate gaps', value: counts.moderate, color: SEV_FILL.moderate },
    { label: 'Minor gaps', value: counts.minor, color: SEV_FILL.minor },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <div key={r.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-text-secondary">{r.label}</span>
              <span className="tabular-nums">
                <span className="font-semibold">{r.value}</span>
                <span className="ml-1 text-text-tertiary">
                  {total > 0 ? `(${Math.round((r.value / total) * 100)}%)` : ''}
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RatioHistogram({ buckets }: { buckets: Array<{ range: string; count: number }> }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const fillFor = (range: string) => {
    // Lower ratio = riskier
    if (range === '<0.5' || range === '0.5–1') return 'rgb(244 63 94)';
    if (range === '1–1.5') return 'rgb(234 179 8)';
    if (range === '1.5–3') return 'rgb(59 130 246)';
    return 'rgb(16 185 129)';
  };
  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 100 }}>
        {buckets.map((b) => {
          const h = (b.count / max) * 90;
          return (
            <div
              key={b.range}
              className="flex flex-1 flex-col items-center justify-end"
              title={`Ratio ${b.range}: ${b.count} program${b.count === 1 ? '' : 's'}`}
            >
              <div className="text-[10px] tabular-nums text-text-tertiary">{b.count > 0 ? b.count : ''}</div>
              <div
                className="w-full rounded-t-sm"
                style={{ height: `${h}px`, background: fillFor(b.range), opacity: 0.85 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2 text-[10px] text-text-tertiary">
        {buckets.map((b) => (
          <span key={b.range} className="flex-1 text-center">
            {b.range}
          </span>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-text-tertiary">
        <span>← under-applied (risk)</span>
        <span>over-subscribed →</span>
      </div>
    </div>
  );
}

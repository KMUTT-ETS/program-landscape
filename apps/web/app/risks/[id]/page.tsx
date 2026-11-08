import { orgShortNamesForRequest } from '@/lib/branding';
import * as React from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import type { ProgramProfileResponse, RiskTier, RiskMeasureHorizon } from '../types';
import { TIER_LABEL, TIER_TONE, MEASURE_KIND_LABEL, HORIZON_LABEL, HORIZON_TONE } from '../types';
import {
  DriverRadar,
  KriTile,
  SkillAutomationBar,
  TcasSparkline,
  ImpactBars,
  L2ComponentBreakdown,
  KkuScoreBadge,
  RisksBackNav,
} from '../viz';

export const dynamic = 'force-dynamic';

function tierIcon(tier: RiskTier): React.ReactNode {
  const cls = 'size-icon-lg';
  if (tier === 'CRITICAL') return <ShieldAlert className={cls} />;
  if (tier === 'HIGH') return <AlertCircle className={cls} />;
  if (tier === 'MODERATE') return <AlertTriangle className={cls} />;
  if (tier === 'NEEDS_DATA') return <HelpCircle className={cls} />;
  return <CheckCircle2 className={cls} />;
}

function fmtThbCompact(n: number | null): string {
  if (n == null) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} K`;
  return Math.round(n).toLocaleString();
}

const COST_TONE: Record<string, string> = {
  LOW: 'text-emerald-700 dark:text-emerald-300',
  MEDIUM: 'text-amber-700 dark:text-amber-300',
  HIGH: 'text-rose-700 dark:text-rose-300',
};

const MEASURE_STATUS_TONE: Record<string, string> = {
  PROPOSED: 'border-border-default bg-surface-2 text-text-secondary',
  ACCEPTED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  IN_PROGRESS: 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  COMPLETED: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
};

export default async function ProgramRiskPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const org = await orgShortNamesForRequest();
  const { id } = await params;

  const profileRes = await apiFetchSafe<ProgramProfileResponse>(`/risks/programs/${id}`);
  const profile = profileRes.ok ? profileRes.data : null;

  if (!profile) {
    return (
      <AuthedAppShell user={user}>
        <PageHeader title="Risk profile" />
        <DiagnosticEmptyState
          surface="this program's risk profile"
          error={profileRes.ok ? null : profileRes.error}
          emptyMessage="No risk assessment has been computed for this program yet."
        />
        <div className="mt-3">
          <Link href="/risks" className="text-xs text-accent-default hover:underline">
            ← back to portfolio
          </Link>
        </div>
      </AuthedAppShell>
    );
  }

  const a = profile.latestAssessment;
  const dataGaps = (a?.dataGaps ?? []) as Array<{ field: string; reason: string }>;

  return (
    <AuthedAppShell user={user}>
      <RisksBackNav current={profile.program.code} hint={profile.program.facultyNameTh} />
      <PageHeader
        title={profile.program.nameTh}
        subtitle={`${profile.program.nameEn} · ${profile.program.code} · ${profile.program.facultyNameTh}`}
      />

      {!a ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-800 dark:text-amber-200">
          No risk assessment yet. Run{' '}
          <code className="font-mono">pnpm risks:assess {profile.program.code}</code>.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Hero row: ERM risk verdict (PRIMARY — L×I) + likelihood tier (SECONDARY)
              + impact summary. Reframed in v1.10 — the ERM band is the risk
              verdict; composite tier is the LIKELIHOOD detail underneath. */}
          <section className={`rounded-lg border p-4 ${TIER_TONE[a.tier]}`}>
            <div className="flex flex-wrap items-center gap-4">
              {/* PRIMARY: ERM risk verdict (likelihood × impact) */}
              <KkuScoreBadge
                matrixScore={a.kkuMatrixScore}
                level={a.kkuRiskLevel}
                likelihoodBin={a.likelihoodBin}
                impactBin={a.impactBin}
                size="lg"
              />
              {/* SECONDARY: composite-likelihood tier (L drivers only — no impact) */}
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {tierIcon(a.tier)} {TIER_LABEL[a.tier]}
                </div>
                <div className="text-[10px] opacity-70">composite of L1/L2/L3 — likelihood only</div>
              </div>
              {a.tier === 'NEEDS_DATA' && (
                <div className="text-xs opacity-80">
                  Insufficient data for a risk verdict — likelihood drivers (L1 + L2) and/or impact
                  (financial baseline) are missing.
                </div>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-6 text-sm">
                <div>
                  <div className="text-[10px] uppercase tracking-wide opacity-70">Composite (0–100)</div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {a.composite?.toFixed(0) ?? '–'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide opacity-70">5y revenue at risk</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    ฿ {fmtThbCompact(a.directRevenueAtRiskThb)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide opacity-70">Last assessed</div>
                  <div className="text-sm tabular-nums">
                    {new Date(a.assessedAt).toLocaleDateString('en-GB')}
                  </div>
                </div>
              </div>
            </div>
            {/* Divergence explainer — surfaces only when likelihood and ERM
                bands disagree (e.g. moderate likelihood × tiny impact = LOW
                ERM). This is the user's reported confusion: "Moderate risk
                while also display Low score (3×1)". Both are correct; this
                line names the relationship. */}
            {a.tier !== 'NEEDS_DATA' && a.kkuRiskLevel !== 'NEEDS_DATA' && a.likelihoodBin && a.impactBin && (
              <DivergenceExplainer
                tier={a.tier}
                kkuRiskLevel={a.kkuRiskLevel}
                likelihoodBin={a.likelihoodBin}
                impactBin={a.impactBin}
                matrixScore={a.kkuMatrixScore}
                orgName={org.en}
              />
            )}
          </section>

          {/* Driver radar + impact breakdown */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-border-default bg-surface-0 p-4 lg:col-span-2">
              <header className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                  Likelihood drivers
                </h3>
                <span className="text-xs text-text-tertiary">
                  Composite = max(L1, L2, L3) over scored drivers
                </span>
              </header>
              <DriverRadar
                l1={a.l1RecruitmentScore}
                l2={a.l2AiDisruptionScore}
                l3={a.l3DemographicScore}
                universityAverages={profile.universityAverages}
              />
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <DriverNote
                  label="L1 Recruitment"
                  score={a.l1RecruitmentScore}
                  confidence={a.l1RecruitmentConfidence}
                  description="Application–to–seat ratio, fill rate, applicant CAGR, late-round dependency."
                />
                <DriverNote
                  label="L2 AI risk"
                  score={a.l2AiDisruptionScore}
                  confidence={a.l2AiDisruptionConfidence}
                  description="Skill automation pressure × discipline AI-readiness deficit × disruption signal from deep-dive gaps."
                />
                <DriverNote
                  label="L3 Demographic"
                  score={a.l3DemographicScore}
                  confidence={a.l3DemographicConfidence}
                  description="Cohort decline (universal) × this program's TCAS competitiveness percentile."
                />
              </div>
            </section>
            <section className="rounded-lg border border-border-default bg-surface-0 p-4">
              <header className="mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                  Impact breakdown (5-year)
                </h3>
              </header>
              <ImpactBars directThb={a.directRevenueAtRiskThb} />
              {a.impactScore != null && (
                <div className="mt-3 text-[11px] text-text-tertiary">
                  Portfolio-normalised impact score: <span className="font-semibold tabular-nums text-text-secondary">{a.impactScore.toFixed(0)}/100</span>
                  <span className="ml-1">(log-scaled across all programs)</span>
                </div>
              )}
            </section>
          </div>

          {/* KRI dashboard grid */}
          <section className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                Key risk indicators
              </h3>
              <span className="text-xs text-text-tertiary">{profile.indicatorStatus.length} indicators</span>
            </header>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {profile.indicatorStatus.map((ind) => (
                <KriTile
                  key={ind.slug}
                  labelEn={ind.labelEn}
                  labelTh={ind.labelTh}
                  severity={ind.severity}
                  value={ind.value}
                  warnThreshold={ind.warnThreshold}
                  criticalThreshold={ind.criticalThreshold}
                  alarmDirection={ind.alarmDirection}
                />
              ))}
            </div>
          </section>

          {/* L2 deep dive — component breakdown + readiness gaps */}
          <section className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                L2 AI-disruption · component breakdown
              </h3>
              <span className="text-xs text-text-tertiary">
                Risk = 0.35×skill pressure + 0.35×readiness deficit + 0.30×disruption signal
              </span>
            </header>
            <div className="grid gap-6 lg:grid-cols-2">
              <L2ComponentBreakdown
                overallScore={profile.l2Breakdown.overallScore}
                composition={profile.l2Breakdown.composition}
              />
              <div>
                {profile.l2Breakdown.readinessSummary ? (
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Discipline-aware AI readiness
                      </span>
                      <span className="text-sm tabular-nums">
                        <span className="font-semibold">
                          {profile.l2Breakdown.readinessRelevanceScore?.toFixed(0) ?? '–'}
                        </span>
                        <span className="text-text-tertiary">/100</span>
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-text-secondary">
                      {profile.l2Breakdown.readinessSummary}
                    </p>
                    {profile.l2Breakdown.readinessMethodVersion && (
                      <div className="text-[10px] text-text-tertiary">
                        Source: {profile.l2Breakdown.readinessMethodVersion}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border-default bg-surface-1 p-3 text-xs text-text-tertiary">
                    No discipline-aware AI readiness assessment yet — run{' '}
                    <code className="font-mono">pnpm programs:ai-readiness {profile.program.code}</code>.
                    Without it, L2 falls back to skill-pressure only.
                  </div>
                )}
              </div>
            </div>

            {(profile.l2Breakdown.topGaps.length > 0 ||
              profile.l2Breakdown.topRecommendations.length > 0) && (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {profile.l2Breakdown.topGaps.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Top AI readiness gaps (deep-dive)
                    </div>
                    <ul className="space-y-1.5">
                      {profile.l2Breakdown.topGaps.map((g, i) => {
                        const tone =
                          g.severity === 'major'
                            ? 'border-rose-500/40 bg-rose-500/10'
                            : g.severity === 'moderate'
                              ? 'border-amber-500/40 bg-amber-500/10'
                              : 'border-slate-500/30 bg-slate-500/10';
                        return (
                          <li key={i} className={`rounded-md border ${tone} p-2`}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-semibold">{g.topic}</span>
                              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                                {g.severity}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
                              {g.observation}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {profile.l2Breakdown.topRecommendations.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Top deep-dive recommendations
                    </div>
                    <ul className="space-y-1.5">
                      {profile.l2Breakdown.topRecommendations.map((r, i) => {
                        const tone =
                          r.priority === 'high'
                            ? 'border-emerald-500/40 bg-emerald-500/10'
                            : r.priority === 'medium'
                              ? 'border-blue-500/40 bg-blue-500/10'
                              : 'border-slate-500/30 bg-slate-500/10';
                        return (
                          <li key={i} className={`rounded-md border ${tone} p-2`}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-semibold">{r.title}</span>
                              <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                                {r.priority}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
                              {r.detail}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* TCAS sparkline + skill automation */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-border-default bg-surface-0 p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                  TCAS funnel — last 5 years
                </h3>
                <span className="text-xs text-text-tertiary">Plan vs applicants vs reported</span>
              </header>
              <TcasSparkline years={profile.tcasYears} />
            </section>
            <section className="rounded-lg border border-border-default bg-surface-0 p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                  Skill automation profile
                </h3>
                <span className="text-xs text-text-tertiary">
                  {profile.skillAutomation.total} skills, weighted
                </span>
              </header>
              {profile.skillAutomation.total > 0 ? (
                <>
                  <SkillAutomationBar shares={profile.skillAutomation.weightedShares} />
                  {profile.skillAutomation.topHighRiskSkills.length > 0 && (
                    <div className="mt-4">
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                        Top HIGH-risk skills (this program)
                      </div>
                      <ul className="space-y-1 text-sm">
                        {profile.skillAutomation.topHighRiskSkills.slice(0, 5).map((s) => (
                          <li
                            key={s.skillId}
                            className="flex items-center justify-between gap-2 rounded-md border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-rose-800 dark:text-rose-200"
                          >
                            <span>
                              {s.nameEn}
                              <span className="ml-1 text-[10px] text-rose-700/70 dark:text-rose-300/70">
                                / {s.nameTh}
                              </span>
                            </span>
                            <span className="text-[10px] tabular-nums">weight {s.weight.toFixed(2)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-text-tertiary">No skills mapped to this program yet.</div>
              )}
            </section>
          </div>

          {/* AI narrative */}
          {a.narrativeTh && (
            <section className="rounded-lg border border-border-default bg-surface-0 p-4">
              <header className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                  Risk narrative
                </h3>
                <span className="text-xs text-text-tertiary">
                  {a.methodologyVersion}
                  {a.confidence != null && ` · AI confidence ${(a.confidence * 100).toFixed(0)}%`}
                </span>
              </header>
              <p className="whitespace-pre-line text-sm leading-relaxed" lang="th">
                {a.narrativeTh}
              </p>
            </section>
          )}

          {/* Recommended measures — grouped by time horizon */}
          <section className="rounded-lg border border-border-default bg-surface-0 p-4">
            <header className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                Recommended measures
              </h3>
              <span className="text-xs text-text-tertiary">
                {a.measures.length} {a.measures.length === 1 ? 'measure' : 'measures'} · grouped by horizon
              </span>
            </header>
            {a.measures.length === 0 ? (
              <div className="text-xs text-text-tertiary">
                No measures yet. Run{' '}
                <code className="font-mono">pnpm risks:seed-measures</code> for rule-based baseline or{' '}
                <code className="font-mono">pnpm risks:assess {profile.program.code}</code> for AI-generated.
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {(['SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM'] as RiskMeasureHorizon[]).map((horizon) => {
                  const inHorizon = a.measures
                    .filter((m) => m.horizon === horizon)
                    .sort((a, b) => a.priority - b.priority);
                  return (
                    <div key={horizon} className="flex flex-col">
                      <div
                        className={`mb-2 rounded-md border px-3 py-1.5 text-xs ${HORIZON_TONE[horizon]}`}
                      >
                        <div className="font-semibold uppercase tracking-wide">
                          {HORIZON_LABEL[horizon].en}
                        </div>
                        <div className="text-[10px] opacity-80">
                          {HORIZON_LABEL[horizon].window} · {inHorizon.length}{' '}
                          {inHorizon.length === 1 ? 'measure' : 'measures'}
                        </div>
                      </div>
                      {inHorizon.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-tertiary">
                          No measures at this horizon
                        </div>
                      ) : (
                        <ol className="space-y-2">
                          {inHorizon.map((m) => (
                            <li
                              key={m.id}
                              className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-1 p-2.5"
                            >
                              <div className="flex flex-wrap items-baseline justify-between gap-1.5">
                                <span className="flex items-baseline gap-1">
                                  <span className="rounded-md bg-accent/10 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-accent">
                                    #{m.priority}
                                  </span>
                                  <span className="text-sm font-semibold" lang="th">
                                    {m.titleTh}
                                  </span>
                                </span>
                                <span
                                  className={`rounded-md border px-1.5 py-0 text-[9px] font-medium ${MEASURE_STATUS_TONE[m.status]}`}
                                >
                                  {m.status}
                                </span>
                              </div>
                              <div className="text-[10px] text-text-tertiary">
                                {MEASURE_KIND_LABEL[m.kind]}
                              </div>
                              <p className="text-xs text-text-secondary" lang="th">
                                {m.rationaleTh}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-text-tertiary">
                                {m.costClass && (
                                  <span>
                                    Cost{' '}
                                    <span
                                      className={`font-semibold ${COST_TONE[m.costClass] ?? 'text-text-secondary'}`}
                                    >
                                      {m.costClass}
                                    </span>
                                  </span>
                                )}
                                {m.expectedDeltaThb != null && (
                                  <span>
                                    Δ{' '}
                                    <span
                                      className={
                                        m.expectedDeltaThb >= 0
                                          ? 'font-semibold text-emerald-700 dark:text-emerald-300'
                                          : 'font-semibold text-rose-700 dark:text-rose-300'
                                      }
                                    >
                                      ฿
                                      {m.expectedDeltaThb >= 0 ? '+' : ''}
                                      {fmtThbCompact(m.expectedDeltaThb)}
                                    </span>
                                  </span>
                                )}
                                {m.titleEn && (
                                  <span className="ml-auto truncate opacity-70" title={m.titleEn}>
                                    {m.titleEn}
                                  </span>
                                )}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Data gaps */}
          {dataGaps.length > 0 && (
            <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                Data gaps
              </h3>
              <ul className="space-y-1 text-xs text-text-secondary">
                {dataGaps.map((g, i) => (
                  <li key={`${g.field}-${i}`}>
                    <span className="font-mono text-text-tertiary">{g.field}</span> — {g.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Assessment history — collapsed by default to keep the page tight.
              Native <details> element keeps this a server component (no
              client state needed for the toggle). */}
          {profile.history.length > 1 && (
            <section className="rounded-lg border border-border-default bg-surface-0">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg p-4 transition-colors hover:bg-surface-1">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-text-secondary">
                    Assessment history
                  </h3>
                  <span className="flex items-center gap-2 text-xs text-text-tertiary">
                    {profile.history.length} entries
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="transition-transform group-open:rotate-180"
                      aria-hidden
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </summary>
                <ul className="space-y-1 border-t border-border-subtle px-4 py-3 text-xs">
                  {profile.history.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center justify-between text-text-secondary"
                    >
                      <span>{new Date(h.assessedAt).toLocaleString('en-GB')}</span>
                      <span className="tabular-nums">
                        composite {h.composite?.toFixed(0) ?? '–'} · {TIER_LABEL[h.tier]}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
        </div>
      )}
    </AuthedAppShell>
  );
}

// Surfaces the relationship between the analytic likelihood tier and the
// ERM L×I band so the two badges in the hero never look contradictory.
// Only shown when both are computed (NEEDS_DATA suppresses).
function DivergenceExplainer({
  tier,
  kkuRiskLevel,
  likelihoodBin,
  impactBin,
  matrixScore,
  orgName,
}: {
  tier: RiskTier;
  kkuRiskLevel: 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  likelihoodBin: number;
  impactBin: number;
  matrixScore: number | null;
  orgName: string;
}) {
  const likelihoodWord =
    tier === 'CRITICAL'
      ? 'critical'
      : tier === 'HIGH'
        ? 'high'
        : tier === 'MODERATE'
          ? 'moderate'
          : 'low';
  const impactWord =
    impactBin >= 5
      ? 'catastrophic'
      : impactBin === 4
        ? 'major'
        : impactBin === 3
          ? 'moderate'
          : impactBin === 2
            ? 'minor'
            : 'insignificant';
  const ermWord =
    kkuRiskLevel === 'VERY_HIGH'
      ? 'very high'
      : kkuRiskLevel === 'HIGH'
        ? 'high'
        : kkuRiskLevel === 'MODERATE'
          ? 'moderate'
          : 'low';
  return (
    <div className="mt-3 rounded-md border border-border-subtle bg-surface-1/60 px-3 py-2 text-xs text-text-secondary">
      <span className="font-medium">Reading the verdict:</span>{' '}
      <span className="capitalize">{likelihoodWord}</span> likelihood{' '}
      <span className="text-text-tertiary">(L={likelihoodBin})</span> ×{' '}
      <span className="capitalize">{impactWord}</span> impact{' '}
      <span className="text-text-tertiary">(I={impactBin})</span> = matrix score{' '}
      <span className="font-semibold tabular-nums">{matrixScore}</span>{' '}
      <span className="text-text-tertiary">→ ERM band</span>{' '}
      <span className="font-semibold capitalize">{ermWord}</span>
      <span className="ml-2 text-[10px] text-text-tertiary">
        Risk = Likelihood × Impact ({orgName} criteria: 1–4 low · 5–9 moderate · 10–15 high · 16–25 very high)
      </span>
    </div>
  );
}

function DriverNote({
  label,
  score,
  confidence,
  description,
}: {
  label: string;
  score: number | null;
  confidence: number | null;
  description: string;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</span>
        <span className="text-base font-semibold tabular-nums">{score?.toFixed(0) ?? '–'}</span>
      </div>
      <p className="mt-0.5 text-[10px] leading-relaxed text-text-tertiary">{description}</p>
      {confidence != null && (
        <div className="mt-1 text-[9px] uppercase tracking-wide text-text-tertiary">
          confidence {Math.round(confidence * 100)}%
        </div>
      )}
    </div>
  );
}

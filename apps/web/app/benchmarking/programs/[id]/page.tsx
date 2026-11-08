import { orgShortNamesForRequest } from '@/lib/branding';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { Badge, Card, PageHeader } from '@kku/ui';
import type { ProgramPeersResponse } from '../../types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program Benchmarking' };

// ── Shapes ─────────────────────────────────────────────────────────────────
// Mirrors the program deep-dive's /programs/:id/ai-peers payload — the SAME
// AI peer-review data the deep-dive surfaces, rendered here with a sharper
// content-positioning focus + explicit, linked benchmark references.

interface ProgramOverview {
  program: { id: string; nameEn: string; nameTh: string; level: string; code: string };
}

interface AiPeerEntry {
  rankInTier: number;
  institutionName: string;
  country: string;
  qsWorldRank: number | null;
  theWorldRank: number | null;
  qsAsiaRank: number | null;
  websiteUrl: string | null;
  peerProgramName: string;
  peerProgramUrl: string | null;
  rationale: string;
  confidence: number;
  subjectArea: string | null;
}
interface AiPeerBullet {
  claim: string;
  evidence: string;
}
interface AiPeerRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  effortHorizon: 'short' | 'medium' | 'long';
}
interface ContentGap {
  topic: string;
  kkuStatus: string;
  peerExamples: string;
  severity: 'major' | 'moderate' | 'minor';
  recommendation: string;
}
type Tier = 'WORLD' | 'ASIA' | 'SOUTHEAST_ASIA' | 'THAILAND_PEER';
type Verdict = 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER';
interface AiPeerReview {
  strengths: AiPeerBullet[];
  weaknesses: AiPeerBullet[];
  tierVerdicts: Record<Tier, string>;
  contentModernity: { verdict: Verdict; narrative: string } | null;
  contentGaps: ContentGap[] | null;
  recommendations: AiPeerRecommendation[];
  subjectBenchmarkSummary: string;
  confidence: number;
  generatedAt: string;
  methodVersion: string;
  peerCountTotal: number;
}
interface AiPeers {
  subjectSignature: string | null;
  tiers: Record<Tier, AiPeerEntry[]>;
  selectedAt: string | null;
  rankingYear: number | null;
  review: AiPeerReview | null;
}

interface AiReadiness {
  overallScore: number;
  subScores: {
    curriculumIntegration: number;
    skillResilience: number;
    researchPresence: number;
    pedagogicalReadiness: number | null;
  };
  skillBreakdown: { aiNative: number; aiAugmented: number; aiDisplaceable: number; neutral: number };
  aiPublicationsLast3Years: number;
  totalPublicationsLast3Years: number;
  summary: string;
}

const TIER_ORDER: Tier[] = ['WORLD', 'ASIA', 'SOUTHEAST_ASIA', 'THAILAND_PEER'];
const TIER_LABEL: Record<Tier, string> = {
  WORLD: 'World',
  ASIA: 'Asia',
  SOUTHEAST_ASIA: 'Southeast Asia',
  THAILAND_PEER: 'Thailand peers',
};
const SPECTRUM: { verdict: Verdict; label: string }[] = [
  { verdict: 'OLD_SCHOOL', label: 'Old school' },
  { verdict: 'IN_BETWEEN', label: 'In between' },
  { verdict: 'FRONTIER', label: 'Frontier' },
];
// Token-based colour sets per verdict (text + border + fill), no hardcoded hex.
const VERDICT_STYLE: Record<Verdict, { ink: string; fill: string; chip: string }> = {
  FRONTIER: { ink: 'text-success', fill: 'bg-success', chip: 'bg-success-subtle text-success' },
  IN_BETWEEN: { ink: 'text-info', fill: 'bg-info', chip: 'bg-info-subtle text-info' },
  OLD_SCHOOL: { ink: 'text-warning', fill: 'bg-warning', chip: 'bg-warning-subtle text-warning' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Severity → visual treatment for the "Content gaps vs peer curricula" panel.
// `rank` drives the major-first sort; the rest are token-only utility classes
// (no hardcoded colour) so light/dark both resolve.
const GAP_SEVERITY: Record<
  ContentGap['severity'],
  { rank: number; spine: string; chip: string; dot: string; label: string }
> = {
  major: {
    rank: 0,
    spine: 'bg-danger',
    chip: 'bg-danger-subtle text-danger',
    dot: 'bg-danger',
    label: 'major',
  },
  moderate: {
    rank: 1,
    spine: 'bg-warning',
    chip: 'bg-warning-subtle text-warning',
    dot: 'bg-warning',
    label: 'moderate',
  },
  minor: {
    rank: 2,
    spine: 'bg-border-strong',
    chip: 'bg-surface-3 text-text-secondary',
    dot: 'bg-border-strong',
    label: 'minor',
  },
};

// Rubber-stamp visualisation of the curriculum-modernity verdict.
function ModernityStamp({ verdict }: { verdict: Verdict }) {
  const label = SPECTRUM.find((s) => s.verdict === verdict)!.label;
  const { ink } = VERDICT_STYLE[verdict];
  return (
    <div
      className={`relative inline-flex shrink-0 -rotate-[8deg] select-none flex-col items-center rounded-xl border-[3px] border-current px-5 py-2.5 ring-1 ring-inset ring-current ${ink}`}
    >
      <span className="text-[8px] font-bold uppercase tracking-[0.3em] opacity-70">★ Curriculum ★</span>
      <span className="text-2xl font-black uppercase leading-none tracking-wider">{label}</span>
      <span className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.3em] opacity-70">Positioning</span>
    </div>
  );
}

// ── Content gaps vs peer curricula ───────────────────────────────────────────
// Reframes each gap as an ADOPTION OPPORTUNITY. The heaviest visual weight goes
// to what leading peers actually do (the implementable insight the Council can
// act on); KKU's current state is context; the recommendation is an explicit
// "move to adopt" action. Gaps are sorted most-material first and carry a
// severity spine + tally so the panel reads at a glance.
function ContentGapsPanel({
  gaps,
  programName,
  orgName,
}: {
  gaps: ContentGap[];
  programName: string;
  orgName: string;
}) {
  const sorted = [...gaps].sort(
    (a, b) => GAP_SEVERITY[a.severity].rank - GAP_SEVERITY[b.severity].rank,
  );
  const tally = (['major', 'moderate', 'minor'] as const)
    .map((s) => ({ s, n: gaps.filter((g) => g.severity === s).length }))
    .filter((t) => t.n > 0);

  return (
    <Card padding="md">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">
          Content gaps vs peer curricula
        </h3>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-tertiary">
          {gaps.length} {gaps.length === 1 ? 'gap' : 'gaps'}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-text-secondary">
        What leading peer programmes teach that{' '}
        <span className="font-medium text-text-primary">{programName}</span> could adopt —
        ranked by how material the gap is.
      </p>

      {tally.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-border-subtle py-2">
          {tally.map(({ s, n }) => (
            <span
              key={s}
              className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary"
            >
              <span className={`h-2 w-2 rounded-full ${GAP_SEVERITY[s].dot}`} aria-hidden />
              <span className="font-mono tabular-nums text-text-primary">{n}</span>
              <span>{GAP_SEVERITY[s].label}</span>
            </span>
          ))}
        </div>
      )}

      <ol className="mt-4 flex flex-col gap-3">
        {sorted.map((g, i) => {
          const sev = GAP_SEVERITY[g.severity];
          return (
            <li
              key={i}
              className="group relative overflow-hidden rounded-lg border border-border-subtle bg-surface-1 py-3 pl-4 pr-3.5 transition-colors hover:border-border-default"
            >
              {/* severity spine */}
              <span className={`absolute inset-y-0 left-0 w-1 ${sev.spine}`} aria-hidden />

              {/* topic + severity */}
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h4 className="min-w-0 text-sm font-semibold leading-snug text-text-primary">
                    {g.topic}
                  </h4>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sev.chip}`}
                >
                  {g.severity}
                </span>
              </div>

              {/* KKU today — context */}
              {g.kkuStatus && (
                <p className="mb-2 text-xs leading-relaxed text-text-secondary">
                  <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                    {orgName} today
                  </span>
                  {g.kkuStatus}
                </p>
              )}

              {/* What leading peers do — the implementable insight (hero) */}
              {g.peerExamples && (
                <div className="rounded-md border-l-2 border-accent-default bg-accent-subtle/40 px-3 py-2">
                  <div className="mb-0.5 flex items-center gap-1.5">
                    <span aria-hidden className="text-accent-default">
                      ▸
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-accent-default">
                      What leading peers do
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-text-primary">
                    {g.peerExamples}
                  </p>
                </div>
              )}

              {/* Move to adopt — the action */}
              {g.recommendation && (
                <div className="mt-2 flex items-start gap-1.5">
                  <span aria-hidden className="mt-px text-accent-default">
                    →
                  </span>
                  <p className="text-xs leading-relaxed text-text-secondary">
                    <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
                      Move to adopt
                    </span>
                    {g.recommendation}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

export default async function ProgramBenchmarkingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const org = await orgShortNamesForRequest();

  const { id } = await params;

  const overviewRes = await apiFetchSafe<ProgramOverview>(`/programs/${id}/overview`);
  if (!overviewRes.ok) {
    if (overviewRes.error.category === 'notFound') notFound();
    return (
      <AuthedAppShell user={user}>
        <PageHeader title="Benchmarking" />
        <DiagnosticEmptyState surface="this program's benchmarking view" error={overviewRes.error} />
      </AuthedAppShell>
    );
  }
  const program = overviewRes.data.program;

  const [aiPeers, peersResp, aiReadiness] = await Promise.all([
    apiFetch<AiPeers>(`/programs/${id}/ai-peers`).catch(() => null),
    apiFetch<ProgramPeersResponse>(`/benchmarking/programs/${id}/peers?limit=8`).catch(() => null),
    apiFetch<AiReadiness>(`/programs/${id}/ai-readiness`).catch(() => null),
  ]);

  const review = aiPeers?.review ?? null;
  const hasPicks =
    aiPeers !== null && TIER_ORDER.some((t) => (aiPeers.tiers[t]?.length ?? 0) > 0);
  const totalRefs = aiPeers
    ? TIER_ORDER.reduce((n, t) => n + (aiPeers.tiers[t]?.length ?? 0), 0)
    : 0;

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title={`Benchmarking · ${program.nameEn}`}
        subtitle={`${program.nameTh} · ${program.level} · ${program.code}`}
      />

      <div className="flex flex-col gap-5">
        {/* Breadcrumb */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <Link href="/benchmarking" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            ← Benchmarking home
          </Link>
          <Link href={`/programs/${id}`} className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
            Program deep-dive →
          </Link>
        </div>

        {!hasPicks || !review ? (
          <Card padding="lg">
            <h3 className="mb-1 text-sm font-semibold text-text-primary">
              No AI benchmarking for this program yet
            </h3>
            <p className="text-sm text-text-secondary">
              The AI picks best-fit peer programs across QS/THE-ranked universities and writes a
              comparative content-positioning review. Generate it by running{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">
                pnpm peers:select {program.code}
              </code>
              {hasPicks && !review ? (
                <>
                  {' '}— picks already landed; add{' '}
                  <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">--review-only</code>{' '}
                  to write the review.
                </>
              ) : (
                ' (or re-run the program pipeline).'
              )}
            </p>
          </Card>
        ) : (
          <>
            {/* ── Curriculum spectrum — stamp banner ───────────────────── */}
            {review.contentModernity && (
              <Card padding="md" tone="glossy">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <ModernityStamp verdict={review.contentModernity.verdict} />
                  <div className="min-w-0 flex-1">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                      Curriculum spectrum
                    </h2>
                    {/* segmented spectrum bar */}
                    <div className="mb-1.5 flex items-stretch gap-1.5">
                      {SPECTRUM.map((s) => {
                        const active = s.verdict === review.contentModernity!.verdict;
                        return (
                          <div key={s.verdict} className="flex-1">
                            <div
                              className={`h-2 rounded-full ${
                                active ? VERDICT_STYLE[s.verdict].fill : 'bg-surface-2'
                              }`}
                            />
                            <div
                              className={`mt-1 text-center text-[11px] ${
                                active
                                  ? `font-semibold ${VERDICT_STYLE[s.verdict].ink}`
                                  : 'text-text-tertiary'
                              }`}
                            >
                              {s.label}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                      {review.contentModernity.narrative}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* ── Positioning summary ──────────────────────────────────── */}
            <Card padding="md">
              <h2 className="mb-2 text-base font-semibold text-text-primary">
                Where this program sits
              </h2>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                <span className="text-text-tertiary">
                  Benchmarked vs{' '}
                  <span className="font-semibold text-text-secondary">{review.peerCountTotal}</span>{' '}
                  peer programs
                </span>
                {aiPeers?.subjectSignature && (
                  <span className="text-text-tertiary">
                    · Subject lens{' '}
                    <span className="font-tabular text-text-secondary">
                      {aiPeers.subjectSignature}
                    </span>
                  </span>
                )}
                {aiPeers?.rankingYear && (
                  <span className="text-text-tertiary">· QS/THE rankings {aiPeers.rankingYear}</span>
                )}
                {peersResp && (
                  <Badge tone="accent" size="sm">
                    Distinctiveness {peersResp.distinctiveness.score}/100
                  </Badge>
                )}
              </div>
              <p className="text-sm leading-relaxed text-text-secondary">
                {review.subjectBenchmarkSummary}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
                <span>{review.methodVersion}</span>
                <span>· confidence {(review.confidence * 100).toFixed(0)}%</span>
                <span>· generated {fmtDate(review.generatedAt)}</span>
              </div>
            </Card>

            {/* ── AI readiness ─────────────────────────────────────────── */}
            {aiReadiness && (
              <Card padding="md">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text-primary">AI readiness</h3>
                  <Badge
                    tone={
                      aiReadiness.overallScore >= 66
                        ? 'success'
                        : aiReadiness.overallScore >= 33
                          ? 'info'
                          : 'warning'
                    }
                    size="sm"
                  >
                    {aiReadiness.overallScore}/100 overall
                  </Badge>
                </div>
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Curriculum AI integration', v: aiReadiness.subScores.curriculumIntegration },
                    { label: 'Skill resilience to AI', v: aiReadiness.subScores.skillResilience },
                    { label: 'AI research presence', v: aiReadiness.subScores.researchPresence },
                  ].map((s) => (
                    <div key={s.label}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-text-tertiary">{s.label}</span>
                        <span className="font-tabular text-text-secondary">{s.v}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-info"
                          style={{ width: `${Math.max(0, Math.min(100, s.v))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <h4 className="mb-1.5 text-xs uppercase tracking-wide text-text-tertiary">
                  Curriculum skill mix vs AI
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="success" size="sm">{aiReadiness.skillBreakdown.aiNative} AI-native</Badge>
                  <Badge tone="info" size="sm">{aiReadiness.skillBreakdown.aiAugmented} AI-augmented</Badge>
                  <Badge tone="warning" size="sm">
                    {aiReadiness.skillBreakdown.aiDisplaceable} AI-displaceable
                  </Badge>
                  <Badge tone="neutral" size="sm">{aiReadiness.skillBreakdown.neutral} neutral</Badge>
                </div>
                {aiReadiness.summary && (
                  <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                    {aiReadiness.summary}
                  </p>
                )}
              </Card>
            )}

            {/* ── Strengths / weaknesses ───────────────────────────────── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card padding="md" className="border-l-4 border-l-success">
                <h3 className="mb-2 text-sm font-semibold text-success">Where {org.en} leads</h3>
                {review.strengths.length === 0 ? (
                  <p className="text-xs text-text-tertiary">None noted.</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {review.strengths.map((s, i) => (
                      <li key={i} className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0">
                        <p className="text-sm font-medium text-text-primary">{s.claim}</p>
                        {s.evidence && (
                          <p className="mt-0.5 text-xs text-text-tertiary">→ {s.evidence}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card padding="md" className="border-l-4 border-l-warning">
                <h3 className="mb-2 text-sm font-semibold text-warning">Where {org.en} falls behind</h3>
                {review.weaknesses.length === 0 ? (
                  <p className="text-xs text-text-tertiary">None noted.</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {review.weaknesses.map((w, i) => (
                      <li key={i} className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0">
                        <p className="text-sm font-medium text-text-primary">{w.claim}</p>
                        {w.evidence && (
                          <p className="mt-0.5 text-xs text-text-tertiary">→ {w.evidence}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            {/* ── Content gaps vs peer curricula ───────────────────────── */}
            {review.contentGaps && review.contentGaps.length > 0 && (
              <ContentGapsPanel gaps={review.contentGaps} programName={program.nameEn} orgName={org.en} />
            )}

            {/* ── Skill distinctiveness (additional detail) ────────────── */}
            {peersResp && (
              <Card padding="md">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text-primary">Skill distinctiveness</h3>
                  <span className="text-xs text-text-tertiary">
                    {peersResp.distinctiveness.score}/100 ·{' '}
                    <span className="font-mono">{peersResp.scorerUsed}</span>
                  </span>
                </div>
                <p className="mb-3 text-xs leading-relaxed text-text-secondary">
                  {peersResp.distinctiveness.score >= 60
                    ? 'Distinctive — many taught skills are absent from peer curricula.'
                    : peersResp.distinctiveness.score >= 30
                      ? 'Moderately distinctive — some unique strengths, significant overlap with peers.'
                      : 'Undifferentiated — most taught skills are also taught by peers.'}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {peersResp.distinctiveness.distinctiveSkills.length > 0 && (
                    <div>
                      <h4 className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">
                        Unique to {org.en}
                      </h4>
                      <ul className="space-y-1 text-sm">
                        {peersResp.distinctiveness.distinctiveSkills.slice(0, 8).map((s) => (
                          <li key={s.id} className="text-text-secondary">
                            {s.nameEn}
                            <span className="ml-1 text-xs text-text-tertiary">· {s.nameTh}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {peersResp.distinctiveness.sharedWithNPeers.length > 0 && (
                    <div>
                      <h4 className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">
                        Shared with peers
                      </h4>
                      <ul className="space-y-1 text-sm">
                        {peersResp.distinctiveness.sharedWithNPeers.slice(0, 8).map((s) => (
                          <li key={s.skillId} className="flex items-center justify-between gap-2">
                            <span className="text-text-secondary">{s.nameEn}</span>
                            <Badge tone="outline" size="sm">
                              {s.count} peers
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* ── Recommendations ──────────────────────────────────────── */}
            {review.recommendations.length > 0 && (
              <Card padding="md">
                <h3 className="mb-2 text-sm font-semibold text-text-primary">
                  Improvement recommendations
                </h3>
                <ol className="flex flex-col gap-3">
                  {(['high', 'medium', 'low'] as const).flatMap((priority) =>
                    review.recommendations
                      .filter((r) => r.priority === priority)
                      .map((rec, i) => (
                        <li
                          key={`${priority}-${i}`}
                          className={`border-l-4 pl-3 ${
                            priority === 'high'
                              ? 'border-l-warning'
                              : priority === 'medium'
                                ? 'border-l-info'
                                : 'border-l-border-strong'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-sm font-semibold text-text-primary">{rec.title}</h4>
                            <div className="flex items-center gap-2 text-xs text-text-tertiary">
                              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 uppercase">
                                {priority}
                              </span>
                              <span>
                                {rec.effortHorizon === 'short'
                                  ? '< 12 mo'
                                  : rec.effortHorizon === 'medium'
                                    ? '12–24 mo'
                                    : '24–36 mo'}
                              </span>
                            </div>
                          </div>
                          <p className="mt-1 text-sm text-text-secondary">{rec.detail}</p>
                        </li>
                      )),
                  )}
                </ol>
              </Card>
            )}

            {/* ── Benchmarked references (collapsible) ─────────────────── */}
            <Card padding="none" className="overflow-hidden">
              <details className="group" open>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Benchmarked references</h3>
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      {totalRefs} peer program{totalRefs === 1 ? '' : 's'} across QS/THE-ranked
                      universities
                      {aiPeers?.rankingYear ? ` · ${aiPeers.rankingYear} rankings` : ''} — verify at
                      source
                    </p>
                  </div>
                  <span className="shrink-0 text-text-tertiary transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>

                <div className="flex flex-col gap-5 border-t border-border-subtle px-5 py-4">
                  {TIER_ORDER.map((tier) => {
                    const entries = aiPeers?.tiers[tier] ?? [];
                    if (entries.length === 0) return null;
                    return (
                      <div key={tier}>
                        <div className="mb-1.5 flex items-baseline gap-2">
                          <h4 className="text-sm font-semibold text-text-primary">
                            {TIER_LABEL[tier]}
                          </h4>
                          <span className="text-xs text-text-tertiary">
                            {entries.length} reference{entries.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        {review.tierVerdicts[tier] && (
                          <p className="mb-2 text-xs leading-relaxed text-text-secondary">
                            {review.tierVerdicts[tier]}
                          </p>
                        )}
                        <ul className="flex flex-col gap-2">
                          {entries.map((p) => (
                            <li
                              key={`${tier}-${p.rankInTier}`}
                              className="flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-1 p-3"
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 font-tabular text-xs font-semibold text-text-secondary">
                                {p.rankInTier}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  {p.websiteUrl ? (
                                    <a
                                      href={p.websiteUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-sm font-semibold text-accent-default underline-offset-2 hover:underline"
                                    >
                                      {p.institutionName}
                                    </a>
                                  ) : (
                                    <span className="text-sm font-semibold text-text-primary">
                                      {p.institutionName}
                                    </span>
                                  )}
                                  <span className="text-xs text-text-tertiary">·</span>
                                  <span className="text-xs text-text-tertiary">{p.country}</span>
                                  {p.qsWorldRank ? (
                                    <Badge tone="neutral" size="sm">QS #{p.qsWorldRank}</Badge>
                                  ) : null}
                                  {p.theWorldRank ? (
                                    <Badge tone="neutral" size="sm">THE #{p.theWorldRank}</Badge>
                                  ) : null}
                                  {p.qsAsiaRank ? (
                                    <Badge tone="neutral" size="sm">QS Asia #{p.qsAsiaRank}</Badge>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-sm text-text-secondary">
                                  {p.peerProgramUrl ? (
                                    <a
                                      href={p.peerProgramUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline-offset-2 hover:underline"
                                    >
                                      {p.peerProgramName} ↗
                                    </a>
                                  ) : (
                                    p.peerProgramName
                                  )}
                                </div>
                                {p.rationale && (
                                  <p className="mt-1 text-xs leading-relaxed text-text-tertiary">
                                    {p.rationale}
                                  </p>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </details>
            </Card>
          </>
        )}
      </div>
    </AuthedAppShell>
  );
}

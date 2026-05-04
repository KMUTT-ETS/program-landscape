'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  EmptyState,
  FreshnessBadge,
  FunnelPipeline,
  Input,
  RadarChartSmall,
  Section,
  Waterfall,
} from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import {
  regenerateNarrativeAction,
  submitDisagreementAction,
} from '@/lib/actions/program-deep-dive';
import ReactMarkdown from 'react-markdown';
import type {
  DeepDiveAiPeers,
  DeepDiveAiReadiness,
  DeepDiveStrategicNarrative,
  DeepDiveDemandFunnel,
  DeepDiveDemographicOutlook,
  DeepDiveFaculty,
  DeepDiveFinancials,
  DeepDiveLifecycle,
  DeepDiveOutcomes,
  DeepDiveOverview,
  DeepDivePeers,
  DeepDiveSkills,
  DeepDiveStudentCohorts,
  DeepDiveTcasStats,
  DeepDiveTrends,
} from './types';

// Anchored-nav deep-dive page. Left rail has section anchors; main
// column scrolls. IntersectionObserver highlights the current section
// in the left rail.

interface Props {
  user: SessionUser;
  programId: string;
  overview: DeepDiveOverview;
  demandFunnel: DeepDiveDemandFunnel | null;
  studentCohorts: DeepDiveStudentCohorts | null;
  tcasStats: DeepDiveTcasStats | null;
  aiPeers: DeepDiveAiPeers | null;
  aiReadiness: DeepDiveAiReadiness | null;
  lifecycle: DeepDiveLifecycle | null;
  strategicNarrative: DeepDiveStrategicNarrative | null;
  demographicOutlook: DeepDiveDemographicOutlook | null;
  financials: DeepDiveFinancials | null;
  skills: DeepDiveSkills | null;
  outcomes: DeepDiveOutcomes | null;
  faculty: DeepDiveFaculty | null;
  peers: DeepDivePeers | null;
  trends: DeepDiveTrends | null;
}

/**
 * Locale-stable date formatter to avoid Next.js hydration mismatches.
 * `toLocaleDateString()` without an explicit locale falls back to the
 * runtime's default — Node (server) and the browser (client)
 * frequently disagree, so the SSR'd HTML doesn't match what the
 * client re-renders on hydration. ISO `YYYY-MM-DD` is deterministic
 * everywhere.
 */
function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  // Use UTC slicing so the displayed date matches the stored UTC date
  // regardless of the viewer's local timezone (no off-by-one near
  // midnight UTC).
  return d.toISOString().slice(0, 10);
}

// Section ordering — top-down "Council reading flow":
//   1. Snapshot (program identity + health radar + lifecycle verdict, all in one panel)
//   2. Strategic narrative
//   → strategic drivers (AI readiness)
//   → student lifecycle (demand → TCAS → cohort → demographic → outcomes)
//   → curriculum & team (skills → faculty)
//   → economics (financials)
//   → external context (peers → trends)
//
// Note: the lifecycle-verdict card lives inside the Snapshot panel
// (left column, below the identity card), so it does not get its own
// side-nav entry — that would point at the same scroll position. The
// `id="verdict"` anchor remains for deep-linking.
const SECTIONS = [
  { id: 'header', label: 'Snapshot' },
  { id: 'narrative', label: 'Strategic narrative' },
  { id: 'ai-readiness', label: 'AI readiness' },
  { id: 'demand', label: 'Demand funnel' },
  { id: 'tcas', label: 'TCAS3 admissions' },
  { id: 'cohorts', label: 'Cohort distribution' },
  { id: 'demographic', label: 'Demographic outlook' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'skills', label: 'Skills coverage' },
  { id: 'faculty', label: 'Faculty capability' },
  { id: 'financials', label: 'Financials' },
  { id: 'peers', label: 'Peer comparison' },
  { id: 'trends', label: 'Trend exposure' },
];

export function DeepDiveClient(props: Props) {
  const [activeSection, setActiveSection] = React.useState('header');
  const [narrative, setNarrative] = React.useState<string | null>(null);
  const [narrativeBusy, setNarrativeBusy] = React.useState(false);
  const [narrativeAiId, setNarrativeAiId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const onRegenerateNarrative = async () => {
    setNarrativeBusy(true);
    const r = await regenerateNarrativeAction(props.programId, 'thai-narrative');
    setNarrativeBusy(false);
    if (r.ok) {
      setNarrative(r.text);
      setNarrativeAiId(r.aiInferenceId);
    } else {
      toast.error(r.message);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      {/* Left rail */}
      <aside className="sticky top-16 h-fit self-start">
        <ul className="flex flex-col gap-1 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={
                  'block rounded px-2 py-1 transition-colors ' +
                  (activeSection === s.id
                    ? 'bg-accent-subtle text-accent'
                    : 'text-text-secondary hover:bg-surface-2')
                }
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex flex-col gap-8">
        <HeaderSection overview={props.overview} lifecycle={props.lifecycle} />
        <NarrativeSection
          programId={props.programId}
          narrative={narrative}
          busy={narrativeBusy}
          onRegenerate={onRegenerateNarrative}
          aiInferenceId={narrativeAiId}
          preComputed={props.strategicNarrative}
        />
        <AiReadinessSection data={props.aiReadiness} />
        <DemandFunnelSection data={props.demandFunnel} />
        <TcasStatsSection data={props.tcasStats} />
        <StudentCohortsSection data={props.studentCohorts} />
        <DemographicOutlookSection data={props.demographicOutlook} />
        <OutcomesSection data={props.outcomes} />
        <SkillsSection data={props.skills} programId={props.programId} />
        <FacultySection data={props.faculty} />
        <FinancialsSection data={props.financials} />
        <PeersSection data={props.peers} aiPeers={props.aiPeers} />
        <TrendsSection data={props.trends} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sections
// ──────────────────────────────────────────────────────────────────────────

function HeaderSection({
  overview,
  lifecycle,
}: {
  overview: DeepDiveOverview;
  lifecycle: DeepDiveLifecycle | null;
}) {
  const h = overview.health;
  const dims = h
    ? [
        { label: 'Attractiveness', value: h.dimensions.attractiveness.score },
        { label: 'Financial', value: h.dimensions.financial.score },
        { label: 'Capability', value: h.dimensions.capability.score },
        { label: 'Outcomes', value: h.dimensions.outcomes.score },
        { label: 'Relevance', value: h.dimensions.relevance.score },
      ]
    : [];
  const breakdownRows = h
    ? [
        { key: 'attractiveness' as const, label: 'Attractiveness', cell: h.dimensions.attractiveness },
        { key: 'financial' as const, label: 'Financial', cell: h.dimensions.financial },
        { key: 'capability' as const, label: 'Capability', cell: h.dimensions.capability },
        { key: 'outcomes' as const, label: 'Outcomes', cell: h.dimensions.outcomes },
        { key: 'relevance' as const, label: 'Relevance', cell: h.dimensions.relevance },
      ]
    : [];
  return (
    <section id="header" className="scroll-mt-16">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_320px] md:items-stretch">
        <div className="flex h-full flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge tone={statusTone(overview.program.status)}>{overview.program.status}</Badge>
                <span className="text-xs text-text-tertiary">
                  {overview.program.level}
                  {overview.program.yearEstablished
                    ? ` · est. ${overview.program.yearEstablished}`
                    : ''}
                </span>
              </div>
              <h2 className="text-2xl font-semibold">{overview.program.nameTh}</h2>
              <p className="text-sm text-text-secondary">
                {overview.program.nameEn} · {overview.program.code}
              </p>
            </div>
            {h && (
              <div className="mt-4 flex items-center gap-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs uppercase tracking-wide text-text-tertiary">
                    Overall
                  </span>
                  <span
                    className={
                      'font-tabular text-3xl font-semibold ' +
                      (h.overall.score === null
                        ? 'text-text-tertiary'
                        : h.overall.score < 40
                          ? 'text-danger'
                          : h.overall.score < 65
                            ? 'text-warning'
                            : 'text-success')
                    }
                  >
                    {h.overall.score === null ? '—' : Math.round(h.overall.score)}
                  </span>
                </div>
                {h.latestFreshness && <FreshnessBadge freshnessDate={h.latestFreshness} />}
                <span className="text-xs text-text-tertiary">
                  {h.methodologyVersion} · data completeness {Math.round(h.overall.dataCompletenessPct)}%
                </span>
              </div>
            )}
          </Card>
          {/* Full lifecycle verdict — moved up here from its previous
              standalone section below. Keeps id="verdict" so the side-
              nav anchor still works. */}
          <LifecycleVerdictSection data={lifecycle} />
        </div>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Health radar</h3>
          {h ? (
            <>
              <RadarChartSmall points={dims} />
              <HealthScoreBreakdown rows={breakdownRows} methodologyVersion={h.methodologyVersion} />
            </>
          ) : (
            <p className="text-sm text-text-tertiary">Health score unavailable.</p>
          )}
        </Card>
      </div>
    </section>
  );
}

function AiReadinessSection({ data }: { data: DeepDiveAiReadiness | null }) {
  if (!data) return null;
  const score = data.overallScore;
  const verdict =
    score >= 70 ? 'strong' : score >= 45 ? 'partial' : score >= 20 ? 'low' : 'critical';
  const verdictMeta = {
    strong: { label: 'Strong AI readiness', tone: 'text-success', bg: 'bg-success/10', stripe: 'border-l-success' },
    partial: { label: 'Partial AI readiness', tone: 'text-chart-2', bg: 'bg-chart-2/10', stripe: 'border-l-chart-2' },
    low: { label: 'Low AI readiness', tone: 'text-chart-3', bg: 'bg-chart-3/10', stripe: 'border-l-chart-3' },
    critical: { label: 'Critical AI gap', tone: 'text-warning', bg: 'bg-warning/10', stripe: 'border-l-warning' },
  } as const;
  const meta = verdictMeta[verdict];
  const horizonLabel = (h: 'short' | 'medium' | 'long'): string =>
    h === 'short' ? '< 12 mo' : h === 'medium' ? '12-24 mo' : '24-36 mo';
  const sevTone = (s: 'major' | 'moderate' | 'minor'): string =>
    s === 'major'
      ? 'bg-warning/20 text-warning'
      : s === 'moderate'
        ? 'bg-chart-3/20 text-chart-3'
        : 'bg-border-subtle/50 text-text-tertiary';
  const totalSkills =
    data.skillBreakdown.aiNative +
    data.skillBreakdown.aiAugmented +
    data.skillBreakdown.aiDisplaceable +
    data.skillBreakdown.neutral;
  const sub = data.subScores;
  const recsByPriority: Record<'high' | 'medium' | 'low', typeof data.recommendations> = {
    high: data.recommendations.filter((r) => r.priority === 'high'),
    medium: data.recommendations.filter((r) => r.priority === 'medium'),
    low: data.recommendations.filter((r) => r.priority === 'low'),
  };

  return (
    <section id="ai-readiness" className="scroll-mt-16">
      <Card className={`border-l-4 ${meta.stripe}`}>
        {/* Header strip */}
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              AI readiness
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className={`rounded-md px-3 py-1 text-2xl font-semibold uppercase tracking-wide ${meta.bg} ${meta.tone}`}>
                {score.toFixed(0)} / 100
              </span>
              <span className={`text-sm font-semibold ${meta.tone}`}>{meta.label}</span>
            </div>
            <p className="mt-1 text-xs text-text-tertiary">{data.summary}</p>
          </div>
          <span className="text-xs text-text-tertiary">{data.methodologyVersion}</span>
        </div>

        {/* Sub-score strip */}
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            {
              key: 'curriculumIntegration',
              label: 'Curriculum integration',
              score: sub.curriculumIntegration,
              hint: 'AI/ML coverage in program skills',
            },
            {
              key: 'skillResilience',
              label: 'Skill resilience',
              score: sub.skillResilience,
              hint: 'AI-augmented vs displaceable balance',
            },
            {
              key: 'researchPresence',
              label: 'AI research presence',
              score: sub.researchPresence,
              hint: `${data.aiPublicationsLast3Years}/${data.totalPublicationsLast3Years} pubs (3y)`,
            },
            {
              key: 'pedagogicalReadiness',
              label: 'Pedagogical readiness',
              score: sub.pedagogicalReadiness,
              hint:
                sub.pedagogicalReadiness === null
                  ? 'data not yet collected'
                  : 'how staff and students adopt AI tools',
            },
          ].map((s) => (
            <Card key={s.key} tone={s.score === null ? 'quiet' : undefined}>
              <div className="text-xs uppercase tracking-wide text-text-tertiary">
                {s.label}
              </div>
              <div className="mt-1 font-tabular text-2xl font-semibold">
                {s.score === null ? 'no data' : s.score.toFixed(0)}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className={
                    s.score === null
                      ? ''
                      : s.score >= 70
                        ? 'h-full bg-success/70'
                        : s.score >= 45
                          ? 'h-full bg-chart-2/70'
                          : s.score >= 20
                            ? 'h-full bg-chart-3/70'
                            : 'h-full bg-warning/70'
                  }
                  style={{ width: `${s.score ?? 0}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-text-tertiary">{s.hint}</div>
            </Card>
          ))}
        </div>

        {/* Skill-by-AI-resilience composition */}
        {totalSkills > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="uppercase tracking-wide text-text-tertiary">
                How program skills relate to AI ({totalSkills} skills)
              </span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full">
              {data.skillBreakdown.aiNative > 0 && (
                <div
                  title={`AI-native: ${data.skillBreakdown.aiNative}`}
                  className="h-full bg-success/70"
                  style={{ flexBasis: `${(data.skillBreakdown.aiNative / totalSkills) * 100}%` }}
                />
              )}
              {data.skillBreakdown.aiAugmented > 0 && (
                <div
                  title={`AI-augmented: ${data.skillBreakdown.aiAugmented}`}
                  className="h-full bg-chart-2/70"
                  style={{ flexBasis: `${(data.skillBreakdown.aiAugmented / totalSkills) * 100}%` }}
                />
              )}
              {data.skillBreakdown.neutral > 0 && (
                <div
                  title={`Neutral: ${data.skillBreakdown.neutral}`}
                  className="h-full bg-border-subtle"
                  style={{ flexBasis: `${(data.skillBreakdown.neutral / totalSkills) * 100}%` }}
                />
              )}
              {data.skillBreakdown.aiDisplaceable > 0 && (
                <div
                  title={`AI-displaceable: ${data.skillBreakdown.aiDisplaceable}`}
                  className="h-full bg-warning/70"
                  style={{ flexBasis: `${(data.skillBreakdown.aiDisplaceable / totalSkills) * 100}%` }}
                />
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-text-tertiary">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-success/70" />
                AI-native · {data.skillBreakdown.aiNative}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-chart-2/70" />
                AI-augmented · {data.skillBreakdown.aiAugmented}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-border-subtle" />
                Neutral · {data.skillBreakdown.neutral}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-warning/70" />
                AI-displaceable · {data.skillBreakdown.aiDisplaceable}
              </span>
            </div>
          </div>
        )}

        {/* AI gaps */}
        {data.gaps.length > 0 && (
          <Card tone="quiet" className="mb-3">
            <h5 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
              AI-readiness gaps ({data.gaps.length})
            </h5>
            <ul className="flex flex-col gap-2">
              {data.gaps.map((g, i) => (
                <li
                  key={i}
                  className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{g.topic}</span>
                    <span className={`rounded-sm px-1.5 py-0.5 text-xs uppercase ${sevTone(g.severity)}`}>
                      {g.severity}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">{g.observation}</p>
                  {g.peerReference && (
                    <p className="mt-0.5 text-xs text-text-tertiary">
                      <span className="font-tabular">→</span> peers: {g.peerReference}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* AI recommendations */}
        {data.recommendations.length > 0 && (
          <div>
            <h5 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
              Recommendations to raise AI readiness
            </h5>
            <ol className="flex flex-col gap-2.5">
              {(['high', 'medium', 'low'] as const).flatMap((priority) =>
                recsByPriority[priority].map((rec, i) => {
                  const stripeColor =
                    priority === 'high'
                      ? 'border-l-warning'
                      : priority === 'medium'
                        ? 'border-l-chart-3'
                        : 'border-l-border-strong';
                  return (
                    <li key={`${priority}-${i}`} className={`border-l-4 ${stripeColor} pl-3`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <h6 className="text-sm font-semibold">{rec.title}</h6>
                        <div className="flex items-center gap-2 text-xs text-text-tertiary">
                          <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 uppercase">
                            {rec.priority}
                          </span>
                          <span>{horizonLabel(rec.effortHorizon)}</span>
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-text-secondary">{rec.detail}</p>
                    </li>
                  );
                }),
              )}
            </ol>
          </div>
        )}
      </Card>
    </section>
  );
}

function LifecycleVerdictSection({ data }: { data: DeepDiveLifecycle | null }) {
  if (!data) return null;
  const verdictMeta: Record<
    DeepDiveLifecycle['verdict'],
    {
      label: string;
      tagline: string;
      bg: string;
      text: string;
      stripe: string;
      icon: string;
      bandIndex: number;
    }
  > = {
    SUNSET: {
      label: 'Sunset',
      tagline: 'Multiple signals declining — closure / merger / restructure on the table',
      bg: 'bg-warning/10',
      text: 'text-warning',
      stripe: 'border-l-warning',
      icon: '↓',
      bandIndex: 0,
    },
    STABLE: {
      label: 'Stable',
      tagline: 'Meeting expectations — hold + monitor',
      bg: 'bg-border-subtle/40',
      text: 'text-text-secondary',
      stripe: 'border-l-border-strong',
      icon: '→',
      bandIndex: 1,
    },
    RISING: {
      label: 'Rising',
      tagline: 'Improving across multiple signals — fund continued development',
      bg: 'bg-chart-2/10',
      text: 'text-chart-2',
      stripe: 'border-l-chart-2',
      icon: '↑',
      bandIndex: 2,
    },
    FRONTIER: {
      label: 'Frontier',
      tagline: 'Leading-edge program, future-defining — showcase + scale',
      bg: 'bg-success/10',
      text: 'text-success',
      stripe: 'border-l-success',
      icon: '⬆',
      bandIndex: 3,
    },
  };
  const meta = verdictMeta[data.verdict];
  // Marker position on the spectrum bar (0-100). Trajectory score
  // already lives on this scale.
  const markerPct = Math.max(0, Math.min(100, data.trajectoryScore));

  // Top contributing drivers — split into lifters + drags by sign.
  const lifters = data.drivers.filter((d) => d.contribution > 0).slice(0, 4);
  const drags = data.drivers.filter((d) => d.contribution < 0).slice(0, 4);

  const phrases: Record<string, string> = {
    health_overall: 'Overall health',
    enrollment_trend: 'Enrollment growth',
    tuition_trend: 'Tuition growth',
    content_modernity: 'Curriculum modernity',
    major_content_gaps: 'Major content gaps vs peers',
    demographic_resilience: 'Demographic resilience',
    delayed_graduation_share: 'Delayed-graduation share',
    capability_strength: 'Faculty capability',
    ai_readiness: 'AI readiness',
  };
  const labelOf = (lbl: string) => phrases[lbl] ?? lbl.replace(/_/g, ' ');

  return (
    <section id="verdict" className="flex flex-1 flex-col scroll-mt-16">
      <Card className={`flex flex-1 flex-col border-l-4 ${meta.stripe}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-text-tertiary">
              Lifecycle verdict
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span
                className={`rounded-md px-3 py-1 text-2xl font-semibold uppercase tracking-wide ${meta.bg} ${meta.text}`}
              >
                <span className="mr-2 font-tabular">{meta.icon}</span>
                {meta.label}
              </span>
              <span className="font-tabular text-sm text-text-tertiary">
                Trajectory {data.trajectoryScore.toFixed(0)}/100
              </span>
            </div>
            <p className="mt-1 text-xs text-text-tertiary">{meta.tagline}</p>
          </div>
          <span className="text-xs text-text-tertiary">
            {data.methodologyVersion}
          </span>
        </div>

        {/* Spectrum bar with marker */}
        <div className="mt-4">
          <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md">
            <div
              className={`h-7 bg-warning/30 px-2 text-xs uppercase tracking-wide flex items-center ${
                data.verdict === 'SUNSET' ? 'font-semibold text-warning' : 'text-text-tertiary'
              }`}
            >
              Sunset
            </div>
            <div
              className={`h-7 bg-border-subtle/60 px-2 text-xs uppercase tracking-wide flex items-center ${
                data.verdict === 'STABLE' ? 'font-semibold text-text-primary' : 'text-text-tertiary'
              }`}
            >
              Stable
            </div>
            <div
              className={`h-7 bg-chart-2/30 px-2 text-xs uppercase tracking-wide flex items-center ${
                data.verdict === 'RISING' ? 'font-semibold text-chart-2' : 'text-text-tertiary'
              }`}
            >
              Rising
            </div>
            <div
              className={`h-7 bg-success/30 px-2 text-xs uppercase tracking-wide flex items-center ${
                data.verdict === 'FRONTIER' ? 'font-semibold text-success' : 'text-text-tertiary'
              }`}
            >
              Frontier
            </div>
          </div>
          {/* Marker line */}
          <div className="relative mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1 ${meta.bg.replace('/10', '/80')}`}
              style={{ left: `${markerPct}%` }}
              aria-hidden
            />
          </div>
          <div className="mt-1 flex justify-between font-tabular text-[0.65rem] text-text-tertiary">
            <span>0</span>
            <span>45</span>
            <span>65</span>
            <span>80</span>
            <span>100</span>
          </div>
        </div>

        {/* Narrative */}
        <p className="mt-4 text-sm text-text-secondary">{data.narrative}</p>

        {/* Driver split */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <h5 className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">
              Lifting forces
            </h5>
            {lifters.length === 0 ? (
              <p className="text-xs text-text-tertiary">(no positive contributors)</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {lifters.map((d) => (
                  <li key={d.label} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary">{labelOf(d.label)}</span>
                    <span className="font-tabular text-success">
                      +{d.contribution.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h5 className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">
              Drag forces
            </h5>
            {drags.length === 0 ? (
              <p className="text-xs text-text-tertiary">(no negative contributors)</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {drags.map((d) => (
                  <li key={d.label} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary">{labelOf(d.label)}</span>
                    <span className="font-tabular text-warning">
                      {d.contribution.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}

function NarrativeSection({
  narrative,
  busy,
  onRegenerate,
  aiInferenceId,
  programId,
  preComputed,
}: {
  programId: string;
  narrative: string | null;
  busy: boolean;
  onRegenerate: () => void;
  aiInferenceId: string | null;
  preComputed: DeepDiveStrategicNarrative | null;
}) {
  const [disagreeOpen, setDisagreeOpen] = React.useState(false);
  const [disagreeText, setDisagreeText] = React.useState('');
  const router = useRouter();
  const onSubmit = async () => {
    if (!disagreeText.trim()) {
      toast.error('Describe your disagreement');
      return;
    }
    const r = await submitDisagreementAction({
      programId,
      sectionKey: 'narrative',
      aiInferenceId: aiInferenceId ?? undefined,
      bodyEn: disagreeText,
    });
    if (r.ok) {
      toast.success('Disagreement recorded — thank you');
      setDisagreeOpen(false);
      setDisagreeText('');
      router.refresh();
    } else toast.error(r.message);
  };

  // Pre-computed narrative wins over the on-demand `narrative` state.
  // The on-demand path stays as a "regenerate" affordance.
  const liveOverride = narrative;
  const showPreComputed = !liveOverride && preComputed !== null;

  return (
    <Section id="narrative" title="Strategic narrative">
      <Card>
        {showPreComputed ? (
          <>
            <article className="kku-narrative-md prose prose-sm max-w-none text-text-primary">
              <ReactMarkdown
                components={{
                  h1: ({ children }) => (
                    <h2 className="mt-3 mb-1 text-base font-semibold text-text-primary first:mt-0">
                      {children}
                    </h2>
                  ),
                  h2: ({ children }) => (
                    <h3 className="mt-3 mb-1 text-sm font-semibold uppercase tracking-wide text-text-secondary first:mt-0">
                      {children}
                    </h3>
                  ),
                  h3: ({ children }) => (
                    <h4 className="mt-2 mb-1 text-sm font-semibold text-text-secondary first:mt-0">
                      {children}
                    </h4>
                  ),
                  p: ({ children }) => (
                    <p className="my-1.5 text-sm leading-relaxed">{children}</p>
                  ),
                  ul: ({ children }) => (
                    <ul className="my-1.5 ml-5 list-disc space-y-1 text-sm leading-relaxed">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="my-1.5 ml-5 list-decimal space-y-1 text-sm leading-relaxed">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="text-sm">{children}</li>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-text-primary">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-text-secondary">{children}</em>
                  ),
                }}
              >
                {preComputed.contentMarkdown}
              </ReactMarkdown>
            </article>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
              <span>
                {preComputed.methodVersion} · confidence {(preComputed.confidence * 100).toFixed(0)}% ·
                generated {formatDate(preComputed.generatedAt)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Button size="xs" variant="ghost" onClick={() => setDisagreeOpen(true)}>
                  Disagree
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={onRegenerate}>
                  {busy ? 'Regenerating…' : 'Regenerate'}
                </Button>
              </span>
            </div>
          </>
        ) : liveOverride ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed" lang="th">
              {liveOverride}
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-text-tertiary">
              <span>AI-generated (live). See /admin/ai-inferences.</span>
              <Button size="xs" variant="ghost" onClick={() => setDisagreeOpen(true)}>
                Disagree
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={onRegenerate}>
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              No strategic narrative yet. Run <span className="font-tabular">pnpm programs:pipeline &lt;code&gt;</span> to generate the official Council brief during the per-program PDF processing run, or click Generate to draft on demand.
            </p>
            <Button disabled={busy} onClick={onRegenerate}>
              {busy ? 'Generating…' : 'Generate narrative'}
            </Button>
          </div>
        )}

        {disagreeOpen && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3">
            <div className="text-sm font-semibold">Disagreement with this narrative</div>
            <textarea
              className="rounded border border-border-default bg-surface-0 p-2 text-sm"
              rows={3}
              value={disagreeText}
              onChange={(e) => setDisagreeText(e.target.value)}
              placeholder="What's wrong / missing / misleading? Specifics help the next model version."
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="danger" onClick={() => void onSubmit()}>
                Submit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDisagreeOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Card>
    </Section>
  );
}

function DemandFunnelSection({ data }: { data: DeepDiveDemandFunnel | null }) {
  if (!data) return <EmptyCard title="Demand funnel" note="No data — run kku-registry + alumni links." />;
  const stages = data.stages.filter((s) => s.value > 0);
  if (stages.length === 0) {
    return (
      <Section id="demand" title="Demand funnel">
        <Card>
          <EmptyState
            title="No funnel data"
            description="Run `pnpm programs:link-cohorts <code>` and `pnpm programs:link-alumni <code>` to populate cohort-by-year + alumni-status data, then `pnpm registry:capture` for TCAS3 applicant counts."
          />
        </Card>
      </Section>
    );
  }

  // Status bucket → display label + color
  const bucketStyle: Record<string, { label: string; bg: string; text: string }> = {
    GRADUATED:         { label: 'Graduated',         bg: 'bg-success/70',       text: 'text-success' },
    RENOUNCED:         { label: 'Renounced',         bg: 'bg-chart-3/60',       text: 'text-chart-3' },
    NO_REPORT:         { label: 'No-show / no-report', bg: 'bg-chart-3/40',     text: 'text-chart-3' },
    DROPPED_FINANCIAL: { label: 'Dropped (financial)', bg: 'bg-warning/70',     text: 'text-warning' },
    DROPPED_ACADEMIC:  { label: 'Dropped (academic)',  bg: 'bg-warning/55',     text: 'text-warning' },
    DROPPED_VOLUNTARY: { label: 'Dropped (voluntary)', bg: 'bg-warning/40',     text: 'text-warning' },
    TRANSFERRED:       { label: 'Transferred',       bg: 'bg-border-strong',    text: 'text-text-secondary' },
    OTHER:             { label: 'Other',             bg: 'bg-border-subtle',    text: 'text-text-tertiary' },
  };
  const totalAlumni = data.alumniBreakdown.reduce((s, b) => s + b.count, 0);

  return (
    <Section id="demand" title="Demand funnel">
      {/* Cohort anchor banner */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-text-tertiary">
          {data.anchorEntryYearBE !== null ? (
            <>
              Anchored on cohort{' '}
              <span className="font-tabular">BE {data.anchorEntryYearBE} (CE {data.anchorEntryYearCE})</span>
              {data.cohortCompleted ? (
                <> — full cohort lifecycle complete</>
              ) : (
                <> — <span className="text-warning">in-progress cohort, funnel ends incomplete</span></>
              )}
              {data.programDurationYears && (
                <> · {data.programDurationYears}-year program</>
              )}
            </>
          ) : 'No cohort data'}
        </p>
        <span className="text-xs text-text-tertiary">{data.methodologyVersion}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h4 className="mb-2 text-sm font-semibold">Funnel for this cohort</h4>
          <FunnelPipeline stages={stages} />
        </Card>
        <Card>
          <h4 className="mb-2 text-sm font-semibold">Stage conversions</h4>
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.conversions.map((c) => (
              <li key={`${c.fromKey}-${c.toKey}`} className="flex justify-between border-t border-border-subtle pt-1.5 first:border-t-0 first:pt-0">
                <span className="text-text-secondary">
                  {c.fromKey} → {c.toKey}
                </span>
                <span className="font-tabular">
                  {c.rate === null ? '—' : `${(c.rate * 100).toFixed(1)}%`}
                </span>
              </li>
            ))}
          </ul>
          {data.benchmarks && (
            <div className="mt-3 border-t border-border-subtle pt-3 text-xs text-text-tertiary">
              Faculty admit yield:{' '}
              {data.benchmarks.faculty?.admissionYield !== null &&
              data.benchmarks.faculty?.admissionYield !== undefined
                ? `${(data.benchmarks.faculty.admissionYield * 100).toFixed(1)}%`
                : '—'}
              &nbsp;· University admit yield:{' '}
              {data.benchmarks.university?.admissionYield !== null &&
              data.benchmarks.university?.admissionYield !== undefined
                ? `${(data.benchmarks.university.admissionYield * 100).toFixed(1)}%`
                : '—'}
            </div>
          )}
        </Card>
      </div>

      {/* Alumni status breakdown for the anchor cohort */}
      {data.alumniBreakdown.length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold">
              Cohort exit status — alumni rows for BE {data.anchorEntryYearBE}
            </h4>
            <span className="text-xs text-text-tertiary">
              {totalAlumni} students with terminal status
              {data.stillEnrolledForAnchor > 0 && (
                <> · {data.stillEnrolledForAnchor} still enrolled</>
              )}
            </span>
          </div>
          {/* Stacked-bar visualization */}
          <div className="mb-2 flex h-3 w-full overflow-hidden rounded-full">
            {data.alumniBreakdown.map((b) => {
              const style = bucketStyle[b.bucket] ?? bucketStyle.OTHER!;
              return (
                <div
                  key={b.bucket}
                  className={`h-full ${style.bg}`}
                  style={{ flexBasis: `${b.pct}%` }}
                  title={`${style.label}: ${b.count} (${b.pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          {/* Legend + table */}
          <ul className="flex flex-col gap-1 text-sm">
            {data.alumniBreakdown.map((b) => {
              const style = bucketStyle[b.bucket] ?? bucketStyle.OTHER!;
              return (
                <li key={b.bucket} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-sm ${style.bg}`} />
                    <span className={style.text}>{style.label}</span>
                  </span>
                  <span className="font-tabular text-text-secondary">
                    {b.count} <span className="text-xs text-text-tertiary">({b.pct.toFixed(1)}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Multi-cohort trend table */}
      {data.cohortTrend.length > 0 && (
        <Card className="mt-3">
          <h4 className="mb-2 text-sm font-semibold">Cohort outcomes — recent {data.cohortTrend.length} years</h4>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-tertiary">
              <tr>
                <th className="py-1.5 font-medium">Cohort</th>
                <th className="py-1.5 text-right font-medium">Admitted (all)</th>
                <th className="py-1.5 text-right font-medium">Enrolled</th>
                <th className="py-1.5 text-right font-medium">Graduated</th>
                <th className="py-1.5 text-right font-medium">Dropped</th>
                <th className="py-1.5 text-right font-medium">Still in program</th>
                <th className="py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...data.cohortTrend]
                .sort((a, b) => b.entryYearBE - a.entryYearBE)
                .map((t) => (
                  <tr key={t.entryYearBE} className="border-t border-border-subtle">
                    <td className="py-1.5 font-tabular">
                      BE {t.entryYearBE}
                      <span className="ml-1 text-xs text-text-tertiary">(CE {t.entryYearCE})</span>
                    </td>
                    <td className="py-1.5 text-right font-tabular">{t.admittedTotal}</td>
                    <td className="py-1.5 text-right font-tabular">{t.enrolled}</td>
                    <td className="py-1.5 text-right font-tabular text-success">{t.graduated}</td>
                    <td className="py-1.5 text-right font-tabular text-warning">{t.droppedTotal}</td>
                    <td className="py-1.5 text-right font-tabular text-chart-2">{t.stillEnrolled}</td>
                    <td className="py-1.5 text-right text-xs">
                      {t.cohortCompleted ? (
                        <span className="text-success">complete</span>
                      ) : (
                        <span className="text-text-tertiary">in progress</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="mt-3 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
            Sources: TCAS3 applicants from <span className="font-tabular">tcas_admission_stats</span> ·
            Cohort outcomes from <span className="font-tabular">alumni_cohort_statuses</span> (registrar's STUDENTSTATUS bucketed) +
            <span className="font-tabular"> student_cohort_distributions</span> (currently enrolled). "Admitted (all)" =
            alumni rows + still-enrolled = everyone who received a STUDENTCODE; "Enrolled" subtracts renounced + no-show.
          </p>
        </Card>
      )}
    </Section>
  );
}

function StatusKpi({
  label,
  swatchClass,
  stripClass,
  count,
  pct,
  subtitle,
  fillClass,
  numberToneWhenNonzero,
}: {
  label: string;
  swatchClass: string;
  /** Tailwind class for the left-edge colour strip — must include
   *  `border-l-…` so the JIT compiles it. */
  stripClass: string;
  count: number;
  pct: number;
  subtitle: string;
  /** Bar fill colour — same hue as the strip, slightly transparent. */
  fillClass: string;
  /** Optional number tint when count > 0 (e.g., `text-warning`). */
  numberToneWhenNonzero?: string;
}) {
  return (
    <Card className={`border-l-4 ${stripClass}`}>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-text-tertiary">
        <span className={`h-2.5 w-2.5 rounded-sm ${swatchClass}`} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className={`font-tabular text-2xl font-semibold ${
            count > 0 && numberToneWhenNonzero ? numberToneWhenNonzero : ''
          }`}
        >
          {count.toLocaleString('en-US')}
        </span>
        <span className="font-tabular text-sm text-text-tertiary">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full transition-all ${fillClass}`}
          style={{ width: `${Math.min(100, pct)}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1 text-xs text-text-tertiary">{subtitle}</div>
    </Card>
  );
}

function StudentCohortsSection({ data }: { data: DeepDiveStudentCohorts | null }) {
  if (!data || data.cohorts.length === 0) {
    return (
      <Section id="cohorts" title="Cohort distribution by entry year">
        <EmptyCard
          title="No cohort data"
          note="Run `pnpm programs:link-cohorts <code>` to populate from registrar data."
        />
      </Section>
    );
  }
  const max = Math.max(...data.cohorts.map((c) => c.studentCount), 1);
  const statusBgColor = (s: 'incoming' | 'on-track' | 'delayed') =>
    s === 'incoming'
      ? 'bg-chart-3/70'
      : s === 'delayed'
        ? 'bg-warning/80'
        : 'bg-chart-2/80';
  const statusLabel = (s: 'incoming' | 'on-track' | 'delayed') =>
    s === 'incoming' ? 'Incoming' : s === 'delayed' ? 'Delayed' : 'On track';
  const statusTextColor = (s: 'incoming' | 'on-track' | 'delayed') =>
    s === 'incoming'
      ? 'text-text-tertiary'
      : s === 'delayed'
        ? 'text-warning'
        : 'text-text-secondary';
  const pct = (n: number) => (data.totalActive > 0 ? (n / data.totalActive) * 100 : 0);
  const incomingPct = pct(data.incomingCount);
  const onTrackPct = pct(data.onTrackCount);
  const delayedPct = pct(data.delayedCount);
  return (
    <Section id="cohorts" title="Cohort distribution by entry year">
      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Total active</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.totalActive.toLocaleString('en-US')}
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-surface-2" aria-hidden />
          <div className="mt-1 text-xs text-text-tertiary">
            Anchored to BE {data.currentAcademicYearBE}
            {data.programDurationYears !== null && <> · {data.programDurationYears}-year program</>}
          </div>
        </Card>
        <StatusKpi
          label="Incoming"
          swatchClass="bg-chart-3/70"
          stripClass="border-l-chart-3/80"
          count={data.incomingCount}
          pct={incomingPct}
          subtitle="Year 0 · before June 1"
          fillClass="bg-chart-3/70"
        />
        <StatusKpi
          label="On-track"
          swatchClass="bg-chart-2/80"
          stripClass="border-l-chart-2"
          count={data.onTrackCount}
          pct={onTrackPct}
          subtitle={
            data.programDurationYears
              ? `Years 1–${data.programDurationYears}`
              : 'Within nominal duration'
          }
          fillClass="bg-chart-2/80"
        />
        <StatusKpi
          label="Delayed"
          swatchClass="bg-warning/80"
          stripClass="border-l-warning"
          count={data.delayedCount}
          pct={delayedPct}
          subtitle={
            data.programDurationYears
              ? `Year ${data.programDurationYears + 1}+`
              : 'Duration unknown'
          }
          fillClass="bg-warning/80"
          numberToneWhenNonzero="text-warning"
        />
      </div>

      {/* ── Chart + table consolidated panel ──────────────────────── */}
      <Card>
        <h4 className="mb-2 text-sm font-semibold">Currently enrolled by entry cohort</h4>
        <div className="flex h-56 items-end gap-2">
          {data.cohorts.map((c) => {
            const pct = (c.studentCount / max) * 100;
            return (
              <div key={c.entryYearBE} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-tabular text-text-secondary">{c.studentCount}</span>
                <div
                  className={`w-full rounded-t-sm transition-all ${statusBgColor(c.status)}`}
                  style={{ height: `${pct}%`, minHeight: c.studentCount > 0 ? '4px' : 0 }}
                  title={`BE ${c.entryYearBE} (CE ${c.entryYearCE}) — ${
                    c.yearInProgramme <= 0 ? 'Incoming' : `Year ${c.yearInProgramme}`
                  } — ${statusLabel(c.status)} — ${c.studentCount} students`}
                />
                <span className="text-xs font-tabular text-text-tertiary">BE {c.entryYearBE}</span>
              </div>
            );
          })}
        </div>

        <table className="mt-5 w-full border-t border-border-subtle text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="py-1.5 font-medium">Cohort</th>
              <th className="py-1.5 font-medium">Status</th>
              <th className="py-1.5 text-right font-medium">Students</th>
              <th className="py-1.5 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {[...data.cohorts]
              .sort((a, b) => b.entryYearBE - a.entryYearBE)
              .map((c) => {
                const share = data.totalActive > 0 ? c.studentCount / data.totalActive : 0;
                return (
                  <tr key={c.entryYearBE} className="border-t border-border-subtle">
                    <td className="py-1.5 font-tabular">
                      BE {c.entryYearBE}
                      <span className="ml-1 text-xs text-text-tertiary">(CE {c.entryYearCE})</span>
                    </td>
                    <td className={`py-1.5 font-tabular ${statusTextColor(c.status)}`}>
                      {c.yearInProgramme <= 0
                        ? 'Year 0 · Incoming'
                        : `Year ${c.yearInProgramme} · ${statusLabel(c.status)}`}
                    </td>
                    <td className="py-1.5 text-right font-tabular">{c.studentCount.toLocaleString('en-US')}</td>
                    <td className="py-1.5 text-right font-tabular text-text-secondary">
                      {(share * 100).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>

        <p className="mt-3 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
          Entry year is taken from each student&apos;s registration code (Buddhist Era). KKU&apos;s
          academic year starts in June — students admitted before June 1 of their entry year are
          still classed as Incoming (Year 0).
          {data.programDurationYears !== null && (
            <>
              {' '}For a {data.programDurationYears}-year program, anyone in Year{' '}
              {data.programDurationYears + 1} or beyond is flagged as{' '}
              <span className="text-warning">delayed graduation</span>.
            </>
          )}
          {data.refreshedAt && <> · Last refreshed {formatDate(data.refreshedAt)}.</>}
        </p>
      </Card>
    </Section>
  );
}

interface PeerCompetitionVerdict {
  /** Tailwind classes applied to the competition cell. */
  cellClass: string;
  /** Glyph indicating direction. */
  arrow: string;
  /** Compact label of the relative gap (e.g. '+38%' or '−15%'). */
  deltaLabel: string;
  /** Hover-reveal explanation. */
  tooltip: string;
}

/** Compare a peer's competition ratio against KKU's and bucket the
 *  difference into a 5-step verdict. Higher peer ratio = peer is MORE
 *  competitive than KKU = unfavorable for KKU (warning colours).
 *  Lower peer ratio = KKU is more in-demand (success colours). */
function competitionVerdict(
  peerRatio: number,
  kkuRatio: number,
): PeerCompetitionVerdict {
  if (kkuRatio <= 0) {
    return {
      cellClass: 'bg-border-subtle/40 text-text-secondary',
      arrow: '·',
      deltaLabel: 'n/a',
      tooltip: 'KKU has no quota — comparison unavailable',
    };
  }
  const ratioOfRatios = peerRatio / kkuRatio;
  const deltaPct = (ratioOfRatios - 1) * 100;
  const sign = deltaPct >= 0 ? '+' : '−';
  const deltaLabel = `${sign}${Math.abs(deltaPct).toFixed(0)}%`;
  const tooltip = `Peer ${peerRatio.toFixed(2)}× vs KKU ${kkuRatio.toFixed(2)}× (${deltaLabel})`;

  if (ratioOfRatios >= 1.5) {
    return {
      cellClass: 'bg-warning/20 text-warning',
      arrow: '▲',
      deltaLabel,
      tooltip,
    };
  }
  if (ratioOfRatios >= 1.1) {
    return {
      cellClass: 'bg-chart-3/20 text-chart-3',
      arrow: '▲',
      deltaLabel,
      tooltip,
    };
  }
  if (ratioOfRatios >= 0.9) {
    return {
      cellClass: 'bg-border-subtle/50 text-text-secondary',
      arrow: '≈',
      deltaLabel,
      tooltip,
    };
  }
  if (ratioOfRatios >= 0.5) {
    return {
      cellClass: 'bg-chart-2/20 text-chart-2',
      arrow: '▼',
      deltaLabel,
      tooltip,
    };
  }
  return {
    cellClass: 'bg-success/20 text-success',
    arrow: '▼',
    deltaLabel,
    tooltip,
  };
}

function TcasStatsSection({ data }: { data: DeepDiveTcasStats | null }) {
  if (!data || data.history.length === 0) {
    return (
      <Section id="tcas" title="TCAS3 admissions">
        <EmptyCard
          title="No TCAS3 data"
          note="Run `pnpm connector:run tcas` (with CONNECTOR_TCAS_MODE=real) to ingest mytcas.com TCAS62–TCAS68 maxmin xlsx files. Round 1 / Round 2 connectors land later."
        />
      </Section>
    );
  }
  const latestRow =
    data.latestEntryYearBE !== null
      ? data.history.find((h) => h.entryYearBE === data.latestEntryYearBE) ?? data.history.at(-1)!
      : data.history.at(-1)!;
  const peerCompetitionAvg =
    data.peers.length > 0
      ? data.peers.reduce((s, p) => s + p.competitionRatio, 0) / data.peers.length
      : null;
  return (
    <Section id="tcas" title="TCAS3 admissions">
      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Quota · BE {latestRow.entryYearBE} R{latestRow.round}
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {latestRow.quota.toLocaleString('en-US')}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            Round {latestRow.round} seats published by CUPT
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Applicants</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {latestRow.applicants.toLocaleString('en-US')}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-chart-2/80"
              style={{ width: `${Math.min(100, (latestRow.applicants / Math.max(latestRow.quota, 1)) * 25)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            Submitted choices to TCAS3
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Competition ratio
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {latestRow.competitionRatio.toFixed(2)}×
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            applicants / quota
            {peerCompetitionAvg !== null && (
              <> · peer avg {peerCompetitionAvg.toFixed(2)}×</>
            )}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Min score (pass 1)
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {latestRow.minScorePass1 !== null ? latestRow.minScorePass1.toFixed(2) : '—'}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            {latestRow.maxScorePass1 !== null && latestRow.minScorePass1 !== null
              ? `Range ${latestRow.minScorePass1.toFixed(1)}–${latestRow.maxScorePass1.toFixed(1)}`
              : 'Score range unknown'}
          </div>
        </Card>
      </div>

      {/* ── Year-over-year history table ──────────────────────────── */}
      <Card>
        <h4 className="mb-2 text-sm font-semibold">Year-over-year admissions history</h4>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="py-1.5 font-medium">Year · Round</th>
              <th className="py-1.5 text-right font-medium">Quota</th>
              <th className="py-1.5 text-right font-medium">Applicants</th>
              <th className="py-1.5 text-right font-medium">Competition</th>
              <th className="py-1.5 text-right font-medium">Fill rate</th>
              <th className="py-1.5 text-right font-medium">Min score</th>
              <th className="py-1.5 text-right font-medium">Max score</th>
            </tr>
          </thead>
          <tbody>
            {[...data.history]
              .sort((a, b) => b.entryYearBE - a.entryYearBE || b.round.localeCompare(a.round))
              .map((h) => (
                <tr key={`${h.entryYearBE}-${h.round}`} className="border-t border-border-subtle">
                  <td className="py-1.5 font-tabular">
                    BE {h.entryYearBE} <span className="text-xs text-text-tertiary">R{h.round}</span>
                  </td>
                  <td className="py-1.5 text-right font-tabular">{h.quota.toLocaleString('en-US')}</td>
                  <td className="py-1.5 text-right font-tabular">
                    {h.applicants.toLocaleString('en-US')}
                  </td>
                  <td className="py-1.5 text-right font-tabular text-text-secondary">
                    {h.competitionRatio.toFixed(2)}×
                  </td>
                  <td className="py-1.5 text-right font-tabular text-text-secondary">
                    {(h.fillRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-1.5 text-right font-tabular">
                    {h.minScorePass1 !== null ? h.minScorePass1.toFixed(2) : '—'}
                  </td>
                  <td className="py-1.5 text-right font-tabular">
                    {h.maxScorePass1 !== null ? h.maxScorePass1.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-3 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
          Source: <a href={latestRow.sourceUrl} target="_blank" rel="noreferrer" className="underline">{latestRow.sourceUrl.split('/').pop()}</a> ·
          Round 3 ("Admission") published by CUPT / mytcas.com. Pass 1 = initial allocation; Pass 2 = clearing
          (reuses seats declined by Pass-1 placements). TCAS1 (Portfolio) and TCAS2 (Quota) connectors land later.
        </p>
      </Card>

      {/* ── Peer comparison panel ─────────────────────────────────── */}
      {data.peers.length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold">
              Peer programs · same subject · BE {data.latestEntryYearBE} R{latestRow.round}
            </h4>
            <span className="text-xs text-text-tertiary">
              {data.peers.filter((p) => p.matchTier === 'exact').length} exact ·{' '}
              {data.peers.filter((p) => p.matchTier === 'subject').length} similar
            </span>
          </div>
          <p className="mb-3 text-xs text-text-tertiary">
            Peers matched on the program's <span className="font-tabular">subject signature
            {data.peerMatchKey && <> "{data.peerMatchKey}"</>}</span> — NOT the faculty name. <span className="font-medium">Exact</span> = same Thai programme name
            string across institutions; <span className="font-medium">similar</span> = same major /
            field with slightly different programme wording. Sorted by applicant volume.
          </p>
          {/* Competition-rate legend */}
          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-text-tertiary">
            <span>Competition vs KKU ({latestRow.competitionRatio.toFixed(2)}×):</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning/70" />
              ≥ 1.5× higher (peer much more competitive)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-3/70" />
              1.1–1.5× higher
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-border-subtle" />
              parity
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-success/70" />
              lower (KKU more competitive)
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-tertiary">
              <tr>
                <th className="py-1.5 font-medium">Match</th>
                <th className="py-1.5 font-medium">Institution</th>
                <th className="py-1.5 font-medium">Programme</th>
                <th className="py-1.5 text-right font-medium">Quota</th>
                <th className="py-1.5 text-right font-medium">Applicants</th>
                <th className="py-1.5 text-right font-medium">Competition vs KKU</th>
                <th className="py-1.5 text-right font-medium">Min score</th>
              </tr>
            </thead>
            <tbody>
              {[...data.peers]
                .sort((a, b) => b.competitionRatio - a.competitionRatio)
                .slice(0, 25)
                .map((p, i) => {
                const verdict = competitionVerdict(p.competitionRatio, latestRow.competitionRatio);
                return (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="py-1.5 text-xs">
                      <span
                        className={
                          p.matchTier === 'exact'
                            ? 'rounded-sm bg-success/15 px-1.5 py-0.5 text-success'
                            : 'rounded-sm bg-chart-3/15 px-1.5 py-0.5 text-chart-3'
                        }
                      >
                        {p.matchTier}
                      </span>
                    </td>
                    <td className="py-1.5 text-text-secondary">{p.institutionName}</td>
                    <td className="py-1.5 text-xs text-text-tertiary">{p.programmeName}</td>
                    <td className="py-1.5 text-right font-tabular">{p.quota.toLocaleString('en-US')}</td>
                    <td className="py-1.5 text-right font-tabular">
                      {p.applicants.toLocaleString('en-US')}
                    </td>
                    <td className="py-1.5 text-right">
                      <span
                        className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-tabular ${verdict.cellClass}`}
                        title={verdict.tooltip}
                      >
                        <span>{verdict.arrow}</span>
                        <span>{p.competitionRatio.toFixed(2)}×</span>
                        <span className="text-[0.65rem] opacity-70">
                          ({verdict.deltaLabel})
                        </span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-tabular">
                      {p.minScorePass1 !== null ? p.minScorePass1.toFixed(2) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Section>
  );
}

function DemographicOutlookSection({
  data,
}: {
  data: DeepDiveDemographicOutlook | null;
}) {
  if (!data || data.projections.length === 0) {
    return (
      <Section id="demographic" title="Demographic outlook">
        <EmptyCard
          title="No demographic projection"
          note="Run `pnpm demographics:seed` to populate NESDC population projections."
        />
      </Section>
    );
  }
  const riskBgClass: Record<DeepDiveDemographicOutlook['riskLevel'], string> = {
    low: 'border-l-success',
    medium: 'border-l-chart-3',
    high: 'border-l-warning',
    unknown: 'border-l-border-strong',
  };
  const riskTextColor: Record<DeepDiveDemographicOutlook['riskLevel'], string> = {
    low: 'text-success',
    medium: 'text-chart-3',
    high: 'text-warning',
    unknown: 'text-text-tertiary',
  };
  const riskLabel: Record<DeepDiveDemographicOutlook['riskLevel'], string> = {
    low: 'Low — well below ceiling',
    medium: 'Medium — watch the trajectory',
    high: 'High — approaching ceiling',
    unknown: 'Unknown — no Year-1 baseline',
  };
  const tenYear = data.projections.find((p) => p.year === data.projections[0]!.year + 10);
  const fifteenYear = data.projections.find((p) => p.year === data.projections[0]!.year + 15);
  // Bar visual — cohort population at each horizon, scaled to anchor.
  const anchorPop = data.projections[0]!.cohortPopulation;
  const peakWidth = anchorPop > 0 ? anchorPop : 1;
  return (
    <Section id="demographic" title="Demographic outlook">
      {/* ── KPI strip ─────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Catchment
          </div>
          <div className="mt-1 font-tabular text-lg font-semibold">
            {data.catchmentRegion === 'Northeast' ? 'Northeast Thailand' : 'Thailand'}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            Cohort {data.ageCohort} · NESDC mid-variant
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Today's Year-1 intake
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.baselineYearOneIntake !== null
              ? data.baselineYearOneIntake.toLocaleString('en-US')
              : '—'}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            {data.baselineYearOneIntake !== null
              ? 'Latest complete academic year'
              : 'No enrollment data'}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            +15y cohort contraction
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            −{data.fifteenYearContraction.toFixed(1)}%
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-warning/70 transition-all"
              style={{ width: `${Math.min(100, data.fifteenYearContraction)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            {data.catchmentRegion === 'Northeast' ? 'NE' : 'TH'} {data.ageCohort} cohort
          </div>
        </Card>
        <Card className={`border-l-4 ${riskBgClass[data.riskLevel]}`}>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Demographic ceiling
          </div>
          <div className={`mt-1 font-tabular text-lg font-semibold ${riskTextColor[data.riskLevel]}`}>
            {data.riskLevel.toUpperCase()}
          </div>
          <div className="mt-1 text-xs text-text-tertiary">
            {riskLabel[data.riskLevel]}
          </div>
          {tenYear?.requiredShareOfCohort !== null && tenYear?.requiredShareOfCohort !== undefined && (
            <div className="mt-1 text-xs text-text-tertiary">
              +10y share needed: {(tenYear.requiredShareOfCohort * 100).toFixed(3)}%
            </div>
          )}
        </Card>
      </div>

      {/* ── Projection chart + table ──────────────────────────────── */}
      <Card>
        <h4 className="mb-2 text-sm font-semibold">
          Cohort projection — {data.catchmentRegion === 'Northeast' ? 'Northeast' : 'Thailand'} {data.ageCohort}
        </h4>
        <div className="space-y-2">
          {data.projections.map((p) => {
            const widthPct = (p.cohortPopulation / peakWidth) * 100;
            const yearLabel = p.year === data.projections[0]!.year ? `${p.year} (today)` : `+${p.year - data.projections[0]!.year}y · ${p.year}`;
            return (
              <div key={p.year} className="flex items-center gap-3">
                <span className="w-32 text-xs font-tabular text-text-secondary">
                  {yearLabel}
                </span>
                <div className="relative flex-1 h-7 rounded-md bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded-md bg-chart-2/70 transition-all"
                    style={{ width: `${widthPct}%` }}
                  />
                  <span className="absolute inset-0 flex items-center px-2 text-xs font-tabular">
                    {(p.cohortPopulation / 1_000_000).toFixed(2)}M
                    {p.cohortDeclinePct > 0 && (
                      <span className="ml-2 text-text-tertiary">
                        −{p.cohortDeclinePct.toFixed(1)}%
                      </span>
                    )}
                  </span>
                </div>
                <span className="w-28 text-right text-xs font-tabular text-text-tertiary">
                  {p.requiredShareOfCohort !== null
                    ? `${(p.requiredShareOfCohort * 100).toFixed(3)}% share`
                    : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <table className="mt-5 w-full border-t border-border-subtle text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="py-1.5 font-medium">Horizon</th>
              <th className="py-1.5 text-right font-medium">{data.catchmentRegion === 'Northeast' ? 'NE' : 'TH'} {data.ageCohort} cohort</th>
              <th className="py-1.5 text-right font-medium">National {data.ageCohort}</th>
              <th className="py-1.5 text-right font-medium">Decline vs today</th>
              <th className="py-1.5 text-right font-medium">Share to maintain intake</th>
            </tr>
          </thead>
          <tbody>
            {data.projections.map((p) => (
              <tr key={p.year} className="border-t border-border-subtle">
                <td className="py-1.5 font-tabular">
                  {p.year === data.projections[0]!.year
                    ? `${p.year} · today`
                    : `${p.year} · +${p.year - data.projections[0]!.year}y`}
                </td>
                <td className="py-1.5 text-right font-tabular">
                  {p.cohortPopulation.toLocaleString('en-US')}
                </td>
                <td className="py-1.5 text-right font-tabular text-text-secondary">
                  {p.cohortPopulationNational !== null
                    ? p.cohortPopulationNational.toLocaleString('en-US')
                    : '—'}
                </td>
                <td className="py-1.5 text-right font-tabular text-text-secondary">
                  {p.cohortDeclinePct > 0 ? `−${p.cohortDeclinePct.toFixed(1)}%` : '0.0%'}
                </td>
                <td className="py-1.5 text-right font-tabular">
                  {p.requiredShareOfCohort !== null
                    ? `${(p.requiredShareOfCohort * 100).toFixed(3)}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
          Source: {data.source} (NESDC mid-variant population projection, republished by BOI). The
          "share to maintain intake" column shows what fraction of the regional {data.ageCohort} cohort
          this program would need to capture each year to keep today's Year-1 intake size.
          {fifteenYear && fifteenYear.cohortDeclinePct > 30 && (
            <span className="text-warning">
              {' '}A {fifteenYear.cohortDeclinePct.toFixed(0)}% contraction by {fifteenYear.year}
              indicates this program is structurally exposed to demographic shrinkage; portfolio-level
              consolidation should be on the Council's radar.
            </span>
          )}
        </p>
      </Card>
    </Section>
  );
}

function FinancialsSection({ data }: { data: DeepDiveFinancials | null }) {
  if (!data || data.waterfall.length === 0) {
    return (
      <EmptyCard title="Financials" note="Financial metrics not available — run pnpm programs:link-financials, or financial role required." />
    );
  }
  // Use the trend row matching latestFiscalYear (the complete-year pick),
  // not the very last trend entry (which may be a partial in-progress year).
  const headlineRow = data.latestFiscalYear
    ? data.trend.find((t) => t.year === data.latestFiscalYear)
    : data.trend.at(-1);
  const latestTuition = headlineRow?.tuitionRevenue ?? 0;
  const subsidy = data.governmentFacultySubsidy ?? 0;
  return (
    <Section id="financials" title="Financials">
      {data.partialCurrentYearAvailable && (
        <Card padding="sm" tone="quiet" className="mb-3">
          <p className="text-xs text-text-secondary">
            Headline KPIs use <span className="font-semibold text-text-primary">FY {data.latestFiscalYear}</span> (latest complete year). A more recent year exists in the registrar data but is in-progress (academic term still collecting tuition) — see the trend table for the partial number.
          </p>
        </Card>
      )}
      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Tuition revenue · FY {data.latestFiscalYear ?? '—'}
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {latestTuition.toLocaleString('en-US')}
          </div>
          <div className="text-xs text-text-tertiary">THB · direct income from enrolled students</div>
        </Card>
        <Card tone="quiet">
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Government salary subsidy</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {subsidy.toLocaleString('en-US')}
          </div>
          <div className="text-xs text-text-tertiary">
            THB/yr · faculty salaries funded by central government block grant — NOT netted from tuition
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Government investment / student</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.costPerStudent ? Math.round(data.costPerStudent).toLocaleString('en-US') : '—'}
          </div>
          <div className="text-xs text-text-tertiary">THB/yr · subsidized salary per enrolled head</div>
        </Card>
      </div>
      <Card>
        <h4 className="mb-2 text-sm font-semibold">Tuition flow</h4>
        <p className="mb-3 text-xs text-text-tertiary">
          Tuition revenue minus the program&apos;s direct costs gives net contribution. Faculty
          salaries (the government subsidy shown above) are intentionally not subtracted — that
          reflects Thai public-university financing, where teaching staff are funded by a central
          government block grant rather than out of tuition.
        </p>
        <Waterfall
          steps={data.waterfall}
          valueFormat={(n) => n.toLocaleString('en-US')}
        />
        {data.sensitivity && (
          <div className="mt-3 rounded-md bg-surface-2 p-3 text-sm">
            <strong>What if tuition rose 5%:</strong> net contribution becomes{' '}
            <span className="font-tabular">
              {data.sensitivity.tuitionPlus5Pct.netContribution.toLocaleString('en-US')} THB
            </span>
          </div>
        )}
        <p className="mt-2 text-xs text-text-tertiary">
          Methodology: {data.costMethodologyVersion}. Direct costs (lab consumables, materials)
          land once cost-allocation v1.0 is signed off. Faculty salary figures are sourced live
          from each teaching-staff record (monthly salary × 12).
        </p>
      </Card>
    </Section>
  );
}

function SkillsSection({
  data,
  programId,
}: {
  data: DeepDiveSkills | null;
  programId: string;
}) {
  if (!data) return <EmptyCard title="Skills coverage" note="Skills data unavailable." />;
  void programId;
  const match = data.matchScore;

  // Split taught skills into MAJOR (PLO-tagged or compulsory ≥ 0.5)
  // vs MINOR (elective-only / no PLO). Drives the two-column tabular view.
  const major = data.taught.filter(
    (s) => s.pickedFromPlo || (s.compulsoryWeight ?? s.weight) >= 0.5,
  );
  const minor = data.taught.filter(
    (s) => !s.pickedFromPlo && (s.compulsoryWeight ?? s.weight) < 0.5,
  );

  return (
    <Section id="skills" title="Skills coverage">
      {/* ── Summary row ─────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Skills taught</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{data.taught.length}</div>
          <div className="text-xs text-text-tertiary">{data.ploSkillCount} from PLOs</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Major contributors</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{major.length}</div>
          <div className="text-xs text-text-tertiary">PLO + compulsory courses</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Minor contributors</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{minor.length}</div>
          <div className="text-xs text-text-tertiary">elective courses only</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Demand match</div>
          <div
            className={
              'mt-1 font-tabular text-3xl font-semibold ' +
              (match < 40 ? 'text-danger' : match < 65 ? 'text-warning' : 'text-success')
            }
          >
            {Math.round(match)}
          </div>
          <div className="text-xs text-text-tertiary">vs LinkedIn (MHESI)</div>
        </Card>
      </div>

      {/* ── Taught skills table — MAJOR ─────────────────────────── */}
      <Card padding="md" className="mb-3">
        <h4 className="mb-3 text-sm font-semibold">
          Major contributors — taught in PLOs and/or compulsory courses
        </h4>
        {major.length === 0 ? (
          <p className="text-sm text-text-tertiary">No major-contribution skills extracted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-2 py-2">Skill</th>
                  <th className="px-2 py-2 text-center">PLO</th>
                  <th className="px-2 py-2 text-right">Compulsory</th>
                  <th className="px-2 py-2 text-right">Elective</th>
                  <th className="px-2 py-2">Evidence (PLO / course quote)</th>
                </tr>
              </thead>
              <tbody>
                {major.map((s) => (
                  <tr key={s.skillId} className="border-b border-subtle last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-medium">{s.nameEn || s.nameTh}</div>
                      {s.nameEn && s.nameTh && (
                        <div className="text-xs text-text-tertiary">{s.nameTh}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {s.pickedFromPlo ? <Badge tone="accent">PLO</Badge> : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-mono text-xs">
                      {s.compulsoryWeight === null ? '—' : s.compulsoryWeight.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-mono text-xs">
                      {s.electiveWeight === null ? '—' : s.electiveWeight.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-xs italic text-text-secondary">
                      {s.evidenceQuote ? `"${s.evidenceQuote.slice(0, 80)}${s.evidenceQuote.length > 80 ? '…' : ''}"` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Taught skills table — MINOR ─────────────────────────── */}
      {minor.length > 0 && (
        <Card padding="md" className="mb-3" tone="quiet">
          <h4 className="mb-3 text-sm font-semibold">
            Minor contributors — elective courses only ({minor.length} skills)
          </h4>
          <div className="flex flex-wrap gap-2">
            {minor.map((s) => (
              <Badge key={s.skillId} tone="neutral" size="sm">
                {s.nameEn || s.nameTh}
                {s.electiveWeight !== null && (
                  <span className="ml-1 text-text-tertiary">{s.electiveWeight.toFixed(1)}</span>
                )}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* ── Demanded × Gaps × Surplus ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card padding="md">
          <h4 className="mb-2 text-sm font-semibold">Top labour-market demand</h4>
          <p className="mb-2 text-xs text-text-tertiary">
            LinkedIn labour-market data (MHESI subscription) ·{' '}
            {data.careerFilterCount > 0 ? (
              <span className="text-accent-default">
                filtered to {data.careerFilterCount} career{data.careerFilterCount === 1 ? '' : 's'} this program targets
              </span>
            ) : (
              <span className="text-warning">unfiltered — career mapping not yet computed</span>
            )}
            {data.demandTier && data.demandTier !== 'thailand-job-postings' && data.demandTier !== 'none' && (
              <>
                {' · '}
                <span className="text-warning">scope: {data.demandTier.replace(/-/g, ' ')}</span>
                {data.demandTier.startsWith('global') && ' (Thai sample sparse for these careers)'}
              </>
            )}
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.demanded.slice(0, 12).map((s) => {
              const isMatched = s.curriculumMatched === true;
              const isUnmatched = s.curriculumMatched === false;
              return (
                <li key={s.skillId} className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{s.nameEn || s.nameTh}</span>
                      {isMatched && (
                        <Badge tone="success" size="sm">
                          ✓ taught
                        </Badge>
                      )}
                      {isUnmatched && (
                        <Badge tone="danger" size="sm">
                          ✗ gap
                        </Badge>
                      )}
                    </div>
                    {s.evidenceQuote && (
                      <div className="mt-0.5 text-[11px] italic text-text-tertiary truncate">
                        “{s.evidenceQuote.slice(0, 80)}{s.evidenceQuote.length > 80 ? '…' : ''}”
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-xs text-text-tertiary shrink-0">
                    {s.peakDemandPct.toFixed(0)}%
                  </span>
                </li>
              );
            })}
            {data.demanded.length === 0 && (
              <li className="text-xs text-text-tertiary">
                No demand signal yet — labour-market data not loaded for these careers.
              </li>
            )}
            {data.demanded.length > 0 && data.demanded.every((s) => s.curriculumMatched === null) && (
              <li className="mt-2 rounded-md border border-dashed border-border-default bg-surface-2/40 p-2 text-[11px] text-text-tertiary">
                Curriculum match not yet computed. Run{' '}
                <code className="font-mono">programs:match-demand</code> to cross-check
                each demanded skill against the program's PLOs and course descriptions.
              </li>
            )}
          </ul>
        </Card>
        <Card padding="md" tone={data.gaps.length > 0 ? 'glossy' : 'default'}>
          <h4 className="mb-2 text-sm font-semibold text-danger">Gaps — demanded, not taught</h4>
          <p className="mb-2 text-xs text-text-tertiary">
            Skills with ≥5% demand the curriculum doesn&apos;t build
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {data.gaps.slice(0, 10).map((g) => (
              <li key={g.skillId} className="flex justify-between">
                <span className="truncate">{g.nameEn || g.nameTh}</span>
                <span className="font-mono text-xs text-text-tertiary">
                  {g.peakDemandPct.toFixed(0)}%
                </span>
              </li>
            ))}
            {data.gaps.length === 0 && <li className="text-xs text-text-tertiary">None.</li>}
          </ul>
        </Card>
        <Card padding="md" tone="quiet">
          <h4 className="mb-2 text-sm font-semibold">Surplus — taught, not demanded</h4>
          <p className="mb-2 text-xs text-text-tertiary">
            Could be foundational or a sign of curriculum drift
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {data.surplus.slice(0, 10).map((s) => (
              <li key={s.skillId} className="flex justify-between">
                <span className="truncate">{s.nameEn || s.nameTh}</span>
                {s.pickedFromPlo && <Badge tone="accent" size="sm">PLO</Badge>}
              </li>
            ))}
            {data.surplus.length === 0 && <li className="text-xs text-text-tertiary">None.</li>}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

function OutcomesSection({ data }: { data: DeepDiveOutcomes | null }) {
  if (!data || !data.latest) {
    return <EmptyCard title="Outcomes" note="No graduate outcome surveys yet." />;
  }
  const l = data.latest;
  return (
    <Section id="outcomes" title="Outcomes">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Employment rate
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {(l.employmentRate * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-text-tertiary">
            ~1 year after graduation · {l.sampleSize.toLocaleString('en-US')} graduates surveyed
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Average starting salary
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {l.averageSalary.toLocaleString('en-US')} THB
          </div>
          <div className="text-xs text-text-tertiary">monthly, self-reported</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Job matches field of study
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {(l.jobRelevanceScore * 100).toFixed(0)}%
          </div>
          <div className="text-xs text-text-tertiary">graduates working in their discipline</div>
        </Card>
      </div>
      <Card className="mt-3">
        <h4 className="mb-2 text-sm font-semibold">Where graduates work — top employers</h4>
        <ul className="flex flex-col gap-1 text-sm">
          {data.topEmployers.slice(0, 10).map((e, i) => (
            <li key={i} className="flex justify-between">
              <span>{e.name}</span>
              <span className="font-tabular text-text-tertiary">
                {e.year} · employer satisfaction {(e.satisfactionScore * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-3">
        <h4 className="mb-2 text-sm font-semibold">Where graduates settle — by province</h4>
        <p className="text-sm text-text-tertiary">
          A Thailand province map is planned, but per-graduate home province is not yet collected.
          This view will populate once the KKU-Alumni connector adds province data.
        </p>
      </Card>
    </Section>
  );
}

function FacultySection({ data }: { data: DeepDiveFaculty | null }) {
  if (!data) return <EmptyCard title="Faculty capability" note="Faculty data unavailable." />;
  const scopeLabel =
    data.rosterScope === 'program'
      ? null
      : data.rosterScope === 'department'
        ? 'Showing all teaching staff in this program\'s home department — a program-specific roster has not been captured yet.'
        : 'Showing all teaching staff in this program\'s home faculty — neither a department nor program-specific roster has been captured yet.';
  const rosterScopeLabel: Record<typeof data.rosterScope, string> = {
    program: 'program-specific roster',
    department: 'department roster',
    faculty: 'faculty roster',
  };
  return (
    <Section id="faculty" title="Faculty capability">
      {scopeLabel && (
        <Card padding="sm" tone="quiet" className="mb-3">
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-text-primary">Source: {rosterScopeLabel[data.rosterScope]}.</span>{' '}
            {scopeLabel}
          </p>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Currently teaching</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{data.totalActive}</div>
          <div className="text-xs text-text-tertiary">active staff members</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Publications</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">{data.totalPublications.toLocaleString('en-US')}</div>
          <div className="text-xs text-text-tertiary">across the program's teaching staff</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Average age</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.averageAgeYears === null ? '—' : `${data.averageAgeYears.toFixed(0)} years`}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Retiring within 5 years
          </div>
          <div
            className={
              'mt-1 font-tabular text-2xl font-semibold ' +
              (data.successionRiskPct > 30 ? 'text-danger' : 'text-text-primary')
            }
          >
            {data.successionRiskPct.toFixed(0)}%
          </div>
          <div className="text-xs text-text-tertiary">
            {data.retiringWithin5Years} of {data.totalActive} staff
          </div>
        </Card>
      </div>
      <Card className="mt-3">
        <h4 className="mb-2 text-sm font-semibold">Academic rank distribution</h4>
        <RankDistribution ranks={data.ranks} totalActive={data.totalActive} />
        {data.visibility === 'aggregates-only' && (
          <p className="mt-3 text-xs text-text-tertiary">
            Individual faculty details are hidden — your role sees aggregates only. Council members
            see anonymised ranks plus retirement horizon; names and specialisations are visible to
            executives, analysts, deans, and department heads.
          </p>
        )}
      </Card>
    </Section>
  );
}

// Academic-rank distribution viz — horizontal bars in seniority order
// (Professor → Lecturer), colour-tone shifts from senior (positive) to
// junior (neutral). Replaces the previous flat-badge presentation.
const RANK_LABELS: Record<string, string> = {
  PROF: 'Professor',
  ASSOC_PROF: 'Associate Professor',
  ASST_PROF: 'Assistant Professor',
  LECTURER: 'Lecturer',
  RESEARCHER: 'Researcher',
  ADJUNCT: 'Adjunct',
  EMERITUS: 'Emeritus',
  null: 'Unspecified',
};
const RANK_ORDER = ['PROF', 'ASSOC_PROF', 'ASST_PROF', 'LECTURER', 'RESEARCHER', 'ADJUNCT', 'EMERITUS'];
const RANK_TONE: Record<string, string> = {
  PROF: 'bg-success/70',
  ASSOC_PROF: 'bg-success/55',
  ASST_PROF: 'bg-chart-2/65',
  LECTURER: 'bg-chart-2/45',
  RESEARCHER: 'bg-chart-3/50',
  ADJUNCT: 'bg-border-strong/60',
  EMERITUS: 'bg-text-tertiary/40',
};

function RankDistribution({
  ranks,
  totalActive,
}: {
  ranks: Record<string, number>;
  totalActive: number;
}) {
  const knownEntries = RANK_ORDER
    .filter((r) => (ranks[r] ?? 0) > 0)
    .map((r) => ({ rank: r, count: ranks[r] ?? 0 }));
  const otherEntries = Object.entries(ranks)
    .filter(([r, n]) => n > 0 && !RANK_ORDER.includes(r))
    .map(([rank, count]) => ({ rank, count }));
  const allEntries = [...knownEntries, ...otherEntries];
  if (allEntries.length === 0) {
    return <p className="text-xs text-text-tertiary">No rank data available.</p>;
  }
  const max = Math.max(...allEntries.map((e) => e.count), 1);
  // Senior share = PROF + ASSOC_PROF — surfaced separately so Council
  // can see the seniority centre of gravity at a glance.
  const seniorCount = (ranks.PROF ?? 0) + (ranks.ASSOC_PROF ?? 0);
  const seniorPct = totalActive > 0 ? (seniorCount / totalActive) * 100 : 0;
  // Layout uses a 3-column CSS grid so every bar starts at the same x
  // (the label column has a fixed width regardless of label length),
  // and the count + percentage sit in a wider tabular column with a
  // visible gap between them.
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-1.5">
        {allEntries.map(({ rank, count }) => {
          const pct = totalActive > 0 ? (count / totalActive) * 100 : 0;
          const widthPct = (count / max) * 100;
          const tone = RANK_TONE[rank] ?? 'bg-border-strong/60';
          return (
            <li
              key={rank}
              className="grid grid-cols-[12rem_minmax(0,1fr)_5.5rem] items-center gap-x-4 text-xs"
            >
              <span className="truncate text-text-primary" title={rank}>
                {RANK_LABELS[rank] ?? rank}
              </span>
              <div className="relative h-4 overflow-hidden rounded-sm bg-surface-2">
                <div className={`h-full ${tone}`} style={{ width: `${widthPct}%` }} />
              </div>
              <span className="flex items-baseline justify-end gap-2 font-tabular">
                <span className="font-semibold text-text-primary">{count}</span>
                <span className="w-10 text-right text-text-tertiary">{pct.toFixed(0)}%</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
        <span>
          <span className="font-medium text-text-primary">Senior share</span> (Prof + Assoc Prof):{' '}
          <span className="font-tabular font-semibold text-text-primary">
            {seniorCount}/{totalActive}
          </span>{' '}
          ({seniorPct.toFixed(0)}%)
        </span>
        <span className="opacity-70">·</span>
        <span>
          {seniorPct >= 40
            ? 'Healthy senior centre of gravity.'
            : seniorPct >= 25
              ? 'Mid-band — typical for a teaching-heavy department.'
              : 'Top-heavy junior cohort — succession plan worth reviewing.'}
        </span>
      </div>
    </div>
  );
}

function PeersSection({
  data,
  aiPeers,
}: {
  data: DeepDivePeers | null;
  aiPeers: DeepDiveAiPeers | null;
}) {
  const hasPicks =
    aiPeers !== null &&
    (aiPeers.tiers.WORLD.length > 0 ||
      aiPeers.tiers.ASIA.length > 0 ||
      aiPeers.tiers.SOUTHEAST_ASIA.length > 0 ||
      aiPeers.tiers.THAILAND_PEER.length > 0);
  if (!hasPicks) {
    return (
      <Section id="peers" title="Peer comparison">
        <Card>
          <EmptyState
            title="No AI peer review yet"
            description="Run `pnpm peers:select <program-code>` — the AI picks best-fit peer programs across QS/THE-ranked universities, then writes a frank comparative review of KKU's strengths + weaknesses + improvement recommendations."
          />
        </Card>
      </Section>
    );
  }
  const review = aiPeers.review;
  const tierLabels: Record<keyof DeepDiveAiPeers['tiers'], string> = {
    WORLD: 'World',
    ASIA: 'Asia',
    SOUTHEAST_ASIA: 'Southeast Asia',
    THAILAND_PEER: 'Thailand peers',
  };

  if (!review) {
    return (
      <Section id="peers" title="Peer comparison">
        <Card>
          <EmptyState
            title="Picks landed; review not generated yet"
            description="Run `pnpm peers:select <program-code> --review-only` to generate the AI's comparative review. Picks are visible below the empty state once a review exists."
          />
        </Card>
      </Section>
    );
  }

  // Group recommendations by priority for the recs panel.
  const recsByPriority: Record<'high' | 'medium' | 'low', typeof review.recommendations> = {
    high: review.recommendations.filter((r) => r.priority === 'high'),
    medium: review.recommendations.filter((r) => r.priority === 'medium'),
    low: review.recommendations.filter((r) => r.priority === 'low'),
  };
  const horizonLabel = (h: 'short' | 'medium' | 'long'): string =>
    h === 'short' ? '< 12 mo' : h === 'medium' ? '12-24 mo' : '24-36 mo';

  return (
    <Section id="peers" title="Peer comparison">
      {/* Header strip: subject lens + generation metadata */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-text-tertiary">
          Frank AI comparative review against {review.peerCountTotal} peer programs
          {aiPeers.subjectSignature && (
            <> · subject lens <span className="font-tabular">{aiPeers.subjectSignature}</span></>
          )}
          {aiPeers.rankingYear && <> · QS/THE rankings {aiPeers.rankingYear}</>}
        </p>
        <span className="text-xs text-text-tertiary">
          {review.methodVersion} · confidence {(review.confidence * 100).toFixed(0)}%
          {review.generatedAt && (
            <> · {formatDate(review.generatedAt)}</>
          )}
        </span>
      </div>

      {/* Subject benchmark summary — 1-3 sentence overall positioning */}
      <Card className="mb-3">
        <h4 className="mb-1 text-xs uppercase tracking-wide text-text-tertiary">
          Where this program sits
        </h4>
        <p className="text-sm text-text-secondary">{review.subjectBenchmarkSummary}</p>
      </Card>

      {/* Strengths + Weaknesses side-by-side */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="border-l-4 border-l-success">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-success">
              Where KKU leads
            </h4>
            <span className="text-xs text-text-tertiary">
              {review.strengths.length} {review.strengths.length === 1 ? 'strength' : 'strengths'}
            </span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {review.strengths.map((s, i) => (
              <li key={i} className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-text-primary">{s.claim}</p>
                {s.evidence && (
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    <span className="font-tabular">→</span> {s.evidence}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="border-l-4 border-l-warning">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-warning">
              Where KKU falls behind
            </h4>
            <span className="text-xs text-text-tertiary">
              {review.weaknesses.length} {review.weaknesses.length === 1 ? 'weakness' : 'weaknesses'}
            </span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {review.weaknesses.map((w, i) => (
              <li key={i} className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0">
                <p className="text-sm font-medium text-text-primary">{w.claim}</p>
                {w.evidence && (
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    <span className="font-tabular">→</span> {w.evidence}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Content modernity verdict */}
      {review.contentModernity && (
        <Card
          className={`mb-3 border-l-4 ${
            review.contentModernity.verdict === 'FRONTIER'
              ? 'border-l-success'
              : review.contentModernity.verdict === 'OLD_SCHOOL'
                ? 'border-l-warning'
                : 'border-l-chart-3'
          }`}
        >
          <div className="mb-1 flex items-baseline justify-between">
            <h4 className="text-xs uppercase tracking-wide text-text-tertiary">
              Curriculum content positioning
            </h4>
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                review.contentModernity.verdict === 'FRONTIER'
                  ? 'bg-success/15 text-success'
                  : review.contentModernity.verdict === 'OLD_SCHOOL'
                    ? 'bg-warning/15 text-warning'
                    : 'bg-chart-3/15 text-chart-3'
              }`}
            >
              {review.contentModernity.verdict === 'OLD_SCHOOL'
                ? 'Old school'
                : review.contentModernity.verdict === 'IN_BETWEEN'
                  ? 'In between'
                  : 'Frontier'}
            </span>
          </div>
          <p className="text-sm text-text-secondary">{review.contentModernity.narrative}</p>
          <div className="mt-3 flex items-center gap-1 text-xs text-text-tertiary">
            <span>Spectrum:</span>
            <span
              className={
                review.contentModernity.verdict === 'OLD_SCHOOL'
                  ? 'rounded-sm bg-warning/30 px-2 py-0.5 font-semibold text-warning'
                  : 'px-2 py-0.5'
              }
            >
              Old school
            </span>
            <span className="text-text-tertiary">·</span>
            <span
              className={
                review.contentModernity.verdict === 'IN_BETWEEN'
                  ? 'rounded-sm bg-chart-3/30 px-2 py-0.5 font-semibold text-chart-3'
                  : 'px-2 py-0.5'
              }
            >
              In between
            </span>
            <span className="text-text-tertiary">·</span>
            <span
              className={
                review.contentModernity.verdict === 'FRONTIER'
                  ? 'rounded-sm bg-success/30 px-2 py-0.5 font-semibold text-success'
                  : 'px-2 py-0.5'
              }
            >
              Frontier
            </span>
          </div>
        </Card>
      )}

      {/* Content gaps — KKU vs peer programs by topic */}
      {review.contentGaps && review.contentGaps.length > 0 && (
        <Card className="mb-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-xs uppercase tracking-wide text-text-tertiary">
              Content gaps vs peers
            </h4>
            <span className="text-xs text-text-tertiary">
              {review.contentGaps.length} {review.contentGaps.length === 1 ? 'topic' : 'topics'}
            </span>
          </div>
          <ul className="flex flex-col gap-3">
            {review.contentGaps
              .slice()
              .sort((a, b) => {
                const order = { major: 0, moderate: 1, minor: 2 };
                return order[a.severity] - order[b.severity];
              })
              .map((g, i) => {
                const sevClass =
                  g.severity === 'major'
                    ? 'bg-warning/20 text-warning'
                    : g.severity === 'moderate'
                      ? 'bg-chart-3/20 text-chart-3'
                      : 'bg-border-subtle/50 text-text-tertiary';
                return (
                  <li
                    key={i}
                    className="border-t border-border-subtle pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h5 className="text-sm font-semibold text-text-primary">{g.topic}</h5>
                      <span className={`rounded-sm px-1.5 py-0.5 text-xs uppercase ${sevClass}`}>
                        {g.severity}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                      <div>
                        <div className="uppercase tracking-wide text-text-tertiary">KKU today</div>
                        <p className="mt-0.5 text-text-secondary">{g.kkuStatus}</p>
                      </div>
                      <div>
                        <div className="uppercase tracking-wide text-text-tertiary">Peer practice</div>
                        <p className="mt-0.5 text-text-secondary">{g.peerExamples}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-text-tertiary">
                      <span className="font-tabular">→</span> {g.recommendation}
                    </p>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}

      {/* Per-tier verdicts */}
      <Card className="mb-3">
        <h4 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
          Tier-by-tier verdicts
        </h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(['WORLD', 'ASIA', 'SOUTHEAST_ASIA', 'THAILAND_PEER'] as const).map((tier) => {
            const verdict = review.tierVerdicts[tier];
            const peerNames = aiPeers.tiers[tier]
              .slice(0, 5)
              .map((p) => p.institutionName)
              .join(' · ');
            return (
              <div key={tier} className="border-t border-border-subtle pt-2">
                <div className="flex items-baseline justify-between">
                  <h5 className="text-sm font-semibold">{tierLabels[tier]}</h5>
                  <span className="text-xs text-text-tertiary">
                    {aiPeers.tiers[tier].length} peer
                    {aiPeers.tiers[tier].length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-text-secondary">{verdict}</p>
                {peerNames && (
                  <p className="mt-1 text-xs text-text-tertiary">vs {peerNames}</p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Recommendations */}
      <Card>
        <h4 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">
          Improvement recommendations
        </h4>
        <ol className="flex flex-col gap-3">
          {(['high', 'medium', 'low'] as const).flatMap((priority) =>
            recsByPriority[priority].map((rec, i) => {
              const stripeColor =
                priority === 'high'
                  ? 'border-l-warning'
                  : priority === 'medium'
                    ? 'border-l-chart-3'
                    : 'border-l-border-strong';
              return (
                <li
                  key={`${priority}-${i}`}
                  className={`border-l-4 ${stripeColor} pl-3`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h5 className="text-sm font-semibold">{rec.title}</h5>
                    <div className="flex items-center gap-2 text-xs text-text-tertiary">
                      <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 uppercase">
                        {priority}
                      </span>
                      <span>{horizonLabel(rec.effortHorizon)}</span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-text-secondary">{rec.detail}</p>
                </li>
              );
            }),
          )}
        </ol>
      </Card>

      {/* Picks (collapsed by default) */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-text-tertiary">
          Show the {review.peerCountTotal} peer programs the review compared against
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(['WORLD', 'ASIA', 'SOUTHEAST_ASIA', 'THAILAND_PEER'] as const).map((tier) => {
            const entries = aiPeers.tiers[tier];
            if (entries.length === 0) return null;
            return (
              <Card key={tier} tone="quiet">
                <h5 className="mb-2 text-sm font-semibold">{tierLabels[tier]}</h5>
                <ul className="flex flex-col gap-2">
                  {entries.map((p) => (
                    <li
                      key={`${tier}-${p.rankInTier}`}
                      className="border-t border-border-subtle pt-1.5 text-xs first:border-t-0 first:pt-0"
                    >
                      <div className="flex items-baseline justify-between">
                        <span>
                          <span className="mr-1 font-tabular text-text-tertiary">
                            #{p.rankInTier}
                          </span>
                          {p.websiteUrl ? (
                            <a
                              href={p.websiteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium underline-offset-2 hover:underline"
                            >
                              {p.institutionName}
                            </a>
                          ) : (
                            <span className="font-medium">{p.institutionName}</span>
                          )}
                          <span className="ml-1 text-text-tertiary">{p.country}</span>
                        </span>
                        <span className="font-tabular text-text-tertiary">
                          {p.qsWorldRank ? `QS#${p.qsWorldRank}` : ''}
                          {p.theWorldRank ? ` THE#${p.theWorldRank}` : ''}
                        </span>
                      </div>
                      <div className="text-text-secondary">{p.peerProgramName}</div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </details>

      {/* Legacy data, doubly hidden */}
      {data && data.peers.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-text-tertiary">
            Legacy peer-program scraper data ({data.peers.length} entries)
          </summary>
          <Card padding="none" className="mt-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left">Institution</th>
                    <th className="px-3 py-2 text-left">Country</th>
                    <th className="px-3 py-2 text-left">Program</th>
                    <th className="px-3 py-2 text-right">Ranking</th>
                  </tr>
                </thead>
                <tbody>
                  {data.peers.map((p) => (
                    <tr key={p.id} className="border-t border-border-subtle">
                      <td className="px-3 py-2 font-medium">{p.institution}</td>
                      <td className="px-3 py-2">{p.country}</td>
                      <td className="px-3 py-2">{p.programName}</td>
                      <td className="px-3 py-2 text-right font-tabular">{p.ranking ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </details>
      )}
    </Section>
  );
}

function TrendsSection({ data }: { data: DeepDiveTrends | null }) {
  if (!data || data.signals.length === 0) {
    return (
      <Section id="trends" title="Trend exposure">
        <Card>
          <EmptyState
            title="No trend signals"
            description="Trend Signals arrive from policy documents + research alerts once Trends Radar (prompt 07) is wired."
          />
        </Card>
      </Section>
    );
  }

  const signalKindLabel = (
    t: DeepDiveTrends['signals'][number]['signalType'],
  ): { label: string; blurb: string } => {
    switch (t) {
      case 'POLICY':
        return {
          label: 'Policy / regulation',
          blurb:
            'A government, ministry, or accreditation-body change that may shift the rules around curriculum, admissions, faculty qualifications, or quality assurance.',
        };
      case 'RESEARCH':
        return {
          label: 'Research finding',
          blurb:
            'A new academic or industry research result that updates the body of knowledge the discipline rests on.',
        };
      case 'MARKET':
        return {
          label: 'Labour-market signal',
          blurb:
            'An employment, demand, salary, or hiring shift in the sector that graduates of this program move into.',
        };
      case 'TECH':
        return {
          label: 'Technology shift',
          blurb:
            'An emerging tool, technique, or platform that the discipline is starting to absorb — and that students will be expected to know.',
        };
      case 'NEWS':
        return {
          label: 'News development',
          blurb:
            'A current event the program should be aware of, even if no direct curriculum impact is yet clear.',
        };
    }
  };

  // Recommend an action based on targeting × impact × signal type.
  // POLICY signals get an upgraded recommendation: regulatory drift is
  // rarely safe to ignore even at lower impact bands.
  const recommendedAction = (
    s: DeepDiveTrends['signals'][number],
  ): {
    label: string;
    tone: 'danger' | 'warning' | 'neutral';
    rationale: string;
  } => {
    const high = s.impactScore > 0.65;
    const moderate = s.impactScore > 0.35;
    const targeted = s.isTargetedAtProgram;
    const isPolicy = s.signalType === 'POLICY';

    if ((targeted && high) || (isPolicy && high)) {
      return {
        label: 'Take action',
        tone: 'danger',
        rationale: targeted
          ? 'This signal names the program directly and carries a high impact rating. Bring it to the next curriculum-committee meeting and decide whether it warrants a curriculum amendment, an admissions-policy update, or a Council-level briefing within this academic year.'
          : 'A regulatory or policy change at this impact level rarely stays sector-wide for long. Confirm whether the program is in scope — and if so, treat it as an action item, not a watch item.',
      };
    }
    if ((targeted && moderate) || (high && !targeted) || (isPolicy && moderate)) {
      return {
        label: 'Monitor',
        tone: 'warning',
        rationale: targeted
          ? 'Tagged as affecting this program but at moderate impact. Track downstream effects, and revisit explicitly at the next annual program review.'
          : isPolicy
            ? 'Policy direction worth tracking even though the program is not directly named — review again if a follow-up regulation lands.'
            : 'Sector-wide signal at high impact. There is likely an indirect effect on this program — cross-check whether the discipline is in scope, and assign an analyst to flag if the wave reaches it.',
      };
    }
    if (targeted) {
      return {
        label: 'Monitor',
        tone: 'warning',
        rationale:
          'Tagged as affecting this program but currently low impact. Keep on the watch list; no immediate response needed.',
      };
    }
    return {
      label: 'Ignore for now',
      tone: 'neutral',
      rationale:
        'General low-impact, sector-wide signal — ambient awareness only. Safe to deprioritise unless a stronger follow-up signal arrives.',
    };
  };

  return (
    <Section id="trends" title="Trend exposure">
      <p className="mb-3 text-xs text-text-tertiary">
        {data.signals.length} signal{data.signals.length === 1 ? '' : 's'} surfaced, sorted by
        detection date. A signal is &quot;targeted&quot; when its source explicitly names this
        program; otherwise it&apos;s sector-wide and may or may not reach the discipline. Source
        titles are shown verbatim — no auto-translation.
      </p>
      <div className="flex flex-col gap-2">
        {data.signals.map((s) => {
          const tone = s.impactScore > 0.6 ? 'danger' : s.impactScore > 0.3 ? 'warning' : 'neutral';
          const stripeClass =
            tone === 'danger'
              ? 'border-l-warning'
              : tone === 'warning'
                ? 'border-l-chart-3'
                : 'border-l-border-strong';
          const kind = signalKindLabel(s.signalType);
          const rec = recommendedAction(s);
          const recBg =
            rec.tone === 'danger'
              ? 'bg-warning/15 text-warning'
              : rec.tone === 'warning'
                ? 'bg-chart-3/15 text-chart-3'
                : 'bg-border-subtle/60 text-text-tertiary';
          const impactWord =
            s.impactScore > 0.7 ? 'High' : s.impactScore > 0.4 ? 'Moderate' : 'Low';
          return (
            <Card key={s.id} className={`border-l-4 ${stripeClass}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold" lang="th">
                      {s.title}
                    </span>
                    <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[0.7rem] uppercase tracking-wide text-text-tertiary">
                      {kind.label}
                    </span>
                    {s.isTargetedAtProgram ? (
                      <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 text-[0.7rem] uppercase tracking-wide text-warning">
                        Targets this program
                      </span>
                    ) : (
                      <span className="rounded-sm bg-border-subtle/60 px-1.5 py-0.5 text-[0.7rem] uppercase tracking-wide text-text-tertiary">
                        Sector-wide
                      </span>
                    )}
                    <span className="text-xs text-text-tertiary">
                      detected {formatDate(s.detectedDate)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs italic text-text-tertiary">{kind.blurb}</p>

                  {(s.summaryTh || s.summaryEn) && (
                    <div className="mt-2 space-y-1.5 border-l-2 border-border-subtle pl-3">
                      {s.summaryTh && (
                        <p className="text-sm" lang="th">
                          {s.summaryTh}
                        </p>
                      )}
                      {s.summaryEn && (
                        <p className="text-sm text-text-secondary">{s.summaryEn}</p>
                      )}
                    </div>
                  )}

                  <div className="mt-3 rounded-md border border-border-subtle bg-surface-2/40 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-text-secondary">
                        Why it matters
                      </span>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide ${recBg}`}
                      >
                        Recommendation: {rec.label}
                      </span>
                      <span className="text-[0.7rem] text-text-tertiary">
                        {impactWord} impact ·{' '}
                        {s.isTargetedAtProgram ? 'targeted' : 'sector-wide'}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                      {rec.rationale}
                    </p>
                  </div>

                  {s.sourceUrl && (
                    <a
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-block text-xs text-text-secondary underline-offset-2 hover:underline"
                    >
                      Open source ↗
                    </a>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={tone}>impact {(s.impactScore * 100).toFixed(0)}</Badge>
                  <span className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                    {impactWord.toLowerCase()}
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function EmptyCard({ title, note }: { title: string; note: string }) {
  return (
    <Section id={title.toLowerCase().replace(/\s/g, '-')} title={title}>
      <Card>
        <p className="text-sm text-text-tertiary">{note}</p>
      </Card>
    </Section>
  );
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'ACTIVE') return 'success';
  if (status === 'PAUSED') return 'warning';
  if (status === 'SUNSET') return 'danger';
  return 'neutral';
}


// ──────────────────────────────────────────────────────────────────────────
// Health Score Breakdown — clickable per-dimension expansion showing
// the per-driver scores + the underlying raw data so Council can audit
// every number on the radar.
// ──────────────────────────────────────────────────────────────────────────

const DRIVER_LABEL_LOOKUP: Record<string, string> = {
  // Attractiveness
  tcas_competition_vs_peers: 'TCAS competition vs peers',
  tcas_fill_rate: 'TCAS fill rate',
  enrollment_trend_slope: 'Enrolment trend (3-yr slope)',
  kku_intake_policy: 'KKU intake-floor policy',
  // Financial
  net_contribution_per_student: 'Net contribution / student',
  tuition_revenue_trend: 'Tuition revenue trend',
  cost_per_student_vs_peers: 'Cost / student vs peers',
  // Capability
  senior_rank_share: 'Senior-rank faculty share',
  publications_per_faculty: 'Publications per faculty (3 yr)',
  retirement_horizon_5y: '5-yr retirement headroom',
  student_faculty_ratio: 'Student / faculty ratio',
  // Outcomes
  tcas_min_score_percentile: 'TCAS min-score percentile',
  employment_rate: 'Graduate employment rate',
  job_relevance: 'Job relevance (ตรงสาขา)',
  average_salary: 'Average graduate salary',
  further_study_rate: 'Further-study rate',
  // Relevance
  labour_market_alignment: 'Labour-market alignment',
  labour_market_alignment_kmitl: 'Labour-market alignment (KMITL)',
  curriculum_modernity: 'Curriculum modernity (peer review)',
};

function humaniseDriverLabel(label: string): string {
  return DRIVER_LABEL_LOOKUP[label] ?? label.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreToneClass(score: number | null): string {
  if (score === null) return 'text-text-tertiary';
  if (score < 40) return 'text-danger';
  if (score < 65) return 'text-warning';
  return 'text-success';
}

interface HealthBreakdownRow {
  key: 'attractiveness' | 'financial' | 'capability' | 'outcomes' | 'relevance';
  label: string;
  cell: { score: number | null; dataCompletenessPct: number; drivers: Array<{ label: string; value: number | null; raw?: unknown }> };
}

function HealthScoreBreakdown({
  rows,
  methodologyVersion,
}: {
  rows: HealthBreakdownRow[];
  methodologyVersion: string;
}) {
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  // Mount-guard: defer the interactive panel to client-only render.
  // Avoids SSR/hydration drift on this complex tree (collapsible
  // accordion + dynamic raw-payload rendering across 5 dimensions).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-3">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
          Score breakdown · loading…
        </p>
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2 rounded border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-xs">
            <span className="flex-1 font-medium text-text-primary">{row.label}</span>
            <span className={`font-tabular text-sm font-semibold ${scoreToneClass(row.cell.score)}`}>
              {row.cell.score === null ? '—' : Math.round(row.cell.score)}
            </span>
            <span className="text-text-tertiary">{Math.round(row.cell.dataCompletenessPct ?? 0)}%</span>
          </div>
        ))}
        <p className="mt-1 text-[10px] text-text-tertiary">
          Methodology: <span className="font-tabular">{methodologyVersion}</span>
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t border-border-subtle pt-3">
      <p className="mb-1 text-[10px] uppercase tracking-wide text-text-tertiary">
        Score breakdown · click any dimension to inspect
      </p>
      {rows.map((row) => {
        const isOpen = openKey === row.key;
        return (
          <div key={row.key} className="rounded border border-border-subtle bg-surface-1">
            <button
              type="button"
              onClick={() => setOpenKey(isOpen ? null : row.key)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-2"
            >
              <span className="flex-1 font-medium text-text-primary">{row.label}</span>
              <span className={`font-tabular text-sm font-semibold ${scoreToneClass(row.cell.score)}`}>
                {row.cell.score === null ? '—' : Math.round(row.cell.score)}
              </span>
              <span className="text-text-tertiary">
                {Math.round(row.cell.dataCompletenessPct ?? 0)}%
              </span>
              <span className="text-text-tertiary">{isOpen ? '▴' : '▾'}</span>
            </button>
            {isOpen && (
              <div className="border-t border-border-subtle px-2.5 py-2 text-[11px]">
                <p className="mb-2 text-text-tertiary">
                  Average of populated drivers (null drivers excluded). Data completeness ={' '}
                  {Math.round(row.cell.dataCompletenessPct ?? 0)}%.
                </p>
                <ul className="flex flex-col gap-1.5">
                  {row.cell.drivers.map((d, i) => (
                    <li key={i} className="rounded bg-surface-2/50 p-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-text-primary">
                          {humaniseDriverLabel(d.label)}
                        </span>
                        <span className={`font-tabular ${scoreToneClass(d.value)}`}>
                          {d.value === null ? 'no data' : Math.round(d.value)}
                        </span>
                      </div>
                      {d.raw !== undefined && d.raw !== null && (
                        <RawPayload raw={d.raw} />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      <p className="mt-1 text-[10px] text-text-tertiary">
        Methodology: <span className="font-tabular">{methodologyVersion}</span>
      </p>
    </div>
  );
}

// Map raw-payload keys → friendly display labels. Anchored to the keys
// each scorer in @kku/db/health-score puts in `raw`. Anything not listed
// falls through to the camelCase splitter.
const RAW_KEY_LOOKUP: Record<string, string> = {
  // Outcomes
  kkuMin: 'KKU min score',
  percentile: 'Percentile vs peers',
  employmentRate: 'Employment rate',
  jobRelevanceScore: 'Job relevance (ตรงสาขา)',
  averageSalary: 'Average salary (THB/month)',
  furtherStudyRate: 'Further-study rate',
  surveyYear: 'Survey year',
  graduationYear: 'Graduation year',
  sampleSize: 'Sample size',
  method: 'Method',
  // Capability
  seniorCount: 'Senior-rank faculty',
  total: 'Total faculty',
  pubCount: 'Publications',
  windowYears: 'Window (years)',
  retiringSoon: 'Retiring within 5y',
  enrolled: 'Enrolled students',
  faculty: 'Active faculty',
  ratio: 'Ratio',
  band: 'Discipline band',
  bandThresholds: 'Band thresholds',
  // Attractiveness
  applicants: 'Applicants',
  quota: 'Quota',
  peerMedianRatio: 'Peer-median ratio',
  admitted: 'Admitted',
  series: 'Yearly series',
  level: 'Level',
  latestIntake: 'Latest intake',
  floor: 'Policy floor',
  compliance: 'Compliance',
  // Financial
  netContributionPerStudent: 'Net contribution / student',
  tuitionPerStudent: 'Tuition / student',
  costPerStudent: 'Cost / student',
  fiscalYear: 'Fiscal year',
  // Relevance
  kmitlAlignmentPct: 'KMITL alignment %',
  // Generic
  lower: 'Lower',
  upper: 'Upper',
  count: 'Count',
};

function humaniseRawKey(key: string): string {
  if (RAW_KEY_LOOKUP[key]) return RAW_KEY_LOOKUP[key];
  // camelCase → Sentence case (e.g. "labourMarketAlignment" → "Labour market alignment")
  const split = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
  return split.charAt(0).toUpperCase() + split.slice(1);
}

function RawPayload({ raw }: { raw: unknown }) {
  // For simple primitive payloads (numbers/strings), render inline.
  // For object payloads, render a small key/value table.
  if (typeof raw === 'number') {
    return <p className="mt-1 text-[10px] text-text-tertiary font-tabular">{formatRawValue(raw)}</p>;
  }
  if (typeof raw === 'string') {
    return <p className="mt-1 text-[10px] text-text-tertiary">{raw}</p>;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px]">
      {entries.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-text-tertiary">{humaniseRawKey(k)}</dt>
          <dd className="font-tabular text-text-secondary truncate">
            {formatRawValue(v, k)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function formatRawValue(v: unknown, key?: string): string {
  if (v === null) return '—';
  if (v === undefined) return '—';
  if (typeof v === 'number') {
    // Plain 4-digit years (CE 1900-2100, BE 2400-2700) shouldn't get
    // thousand-separators — render "2024" not "2,024".
    if (Number.isInteger(v) && ((v >= 1900 && v <= 2100) || (v >= 2400 && v <= 2700))) {
      return v.toString();
    }
    // Rate-like fields (0..1) → percent. Detect via key suffix.
    if (
      key &&
      /(rate|percentile|score|ratio|alignment)/i.test(key) &&
      v >= 0 && v <= 1
    ) {
      return `${(v * 100).toFixed(1)}%`;
    }
    if (Math.abs(v) >= 1_000_000) return `฿${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return v.toLocaleString('en-US');
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(3).replace(/\.?0+$/, '');
  }
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    // Render short numeric series inline (e.g. enrollment trend) up to ~6 items.
    if (v.length === 0) return '—';
    if (v.length <= 6 && v.every((x) => typeof x === 'number')) {
      return v.map((n) => formatRawValue(n)).join(' → ');
    }
    return `[${v.length} items]`;
  }
  if (typeof v === 'object' && v !== null) {
    // Range-shaped objects {lower, upper} → "lower – upper"
    const obj = v as Record<string, unknown>;
    if ('lower' in obj && 'upper' in obj && typeof obj.lower === 'number' && typeof obj.upper === 'number') {
      return `${obj.lower} – ${obj.upper}`;
    }
    return JSON.stringify(v).slice(0, 80);
  }
  return JSON.stringify(v).slice(0, 80);
}

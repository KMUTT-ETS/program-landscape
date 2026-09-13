'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  ProvenanceButton,
  RadarChartSmall,
  type RadarPoint,
  Section,
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  Waterfall,
} from '@kku/ui';
// TYPE-ONLY. The `@kku/shared` barrel re-exports subpaths that pull
// `node:crypto`, which breaks the client bundle — so the DQ module table
// (`DQ_MODULES`, plain data) is read by the SERVER page and handed down
// as the `dqModules` prop. Nothing here reaches into `@kku/shared` or
// `@kku/db` at runtime.
import type { DqModule, SessionUser } from '@kku/shared';
import {
  regenerateNarrativeAction,
  submitDisagreementAction,
} from '@/lib/actions/program-deep-dive';
import { SectionBand, SectionRail, SpineItem, type RailItem } from '@/components/evidence';
import { contractionMeterWidth, formatCohortChangePct } from '@/lib/format-cohort';
// Client-safe SUBPATH, not the `@kku/shared` root barrel — see the note above
// `scholarProvenance()`. The barrel reaches `node:crypto` and breaks the
// browser bundle; this module is pure strings and arithmetic.
import {
  scholarCaveat,
  SCHOLAR_SOURCE_LABEL,
  type ScholarFigureKind,
} from '@kku/shared/scholar/disclosure';
// Shared with /education/student-dq so both DQ radars mean the same
// thing by a floor of 60 — see the helper for why it is not 0.
import { dqRadarDomain } from '@/lib/dq-radar-domain';
import { DataSourceMark, DriverSourceMark } from '@/components/data-source-mark';
import ReactMarkdown from 'react-markdown';
import type {
  DeepDiveAiPeers,
  DeepDiveAiReadiness,
  DeepDiveStrategicNarrative,
  DeepDiveResearchExpertise,
  DeepDiveResearchExpertiseRecommendation,
  DeepDiveCurriculumRevision,
  DeepDiveCourses,
  DeepDiveDemandFunnel,
  DeepDiveDemographicOutlook,
  DeepDiveFaculty,
  DeepDiveFinancials,
  DeepDiveLifecycle,
  DeepDiveOutcomes,
  DeepDiveOverview,
  DeepDivePeers,
  DeepDiveSkills,
  DeepDiveJobThaiSkills,
  DeepDiveStudentCohorts,
  DeepDiveTcasStats,
  DeepDiveRecruitment,
  DeepDiveTrends,
  DeepDiveHealthBenchmarks,
} from './types';

// Anchored-nav deep-dive page. Left rail has section anchors; main
// column scrolls. IntersectionObserver highlights the current section
// in the left rail.

// ─────────────────────────────────────────────────────────────────────
// Digital Intelligence (DQ) competency — mirrors `ProgramDigitalCompetency`
// in `packages/db/src/program-deep-dive.ts`. Declared here rather than in
// `./types` and imported as a type by the server page, the same
// arrangement `/education/student-dq` uses for its own payloads.
// ─────────────────────────────────────────────────────────────────────

export interface DeepDiveDigitalCompetencyModule {
  moduleKey: string;
  moduleNo: number;
  /** Null when nobody here took the module — and null on EVERY module
   *  when the figure is withheld. Never render it as 0. */
  mean: number | null;
  coveragePct: number | null;
  /** The same module over the whole DQ population — every level, every
   *  faculty. Not a bachelor-only figure, and must not be labelled one. */
  universityMean: number | null;
}

export interface DeepDiveDigitalCompetency {
  /** `not-applicable` renders nothing at all — see DigitalCompetencySection. */
  status: 'ok' | 'below-floor' | 'no-data' | 'not-applicable';
  rawMean: number | null;
  driverScore: number | null;
  scoredStudents: number;
  passRatePct: number | null;
  modules: DeepDiveDigitalCompetencyModule[];
  weakest: Array<{ moduleKey: string; mean: number }>;
  methodologyVersion: string;
}

interface Props {
  user: SessionUser;
  programId: string;
  overview: DeepDiveOverview;
  demandFunnel: DeepDiveDemandFunnel | null;
  studentCohorts: DeepDiveStudentCohorts | null;
  tcasStats: DeepDiveTcasStats | null;
  recruitment: DeepDiveRecruitment | null;
  aiPeers: DeepDiveAiPeers | null;
  aiReadiness: DeepDiveAiReadiness | null;
  lifecycle: DeepDiveLifecycle | null;
  strategicNarrative: DeepDiveStrategicNarrative | null;
  researchExpertise: DeepDiveResearchExpertise | null;
  curriculumRevision: DeepDiveCurriculumRevision | null;
  demographicOutlook: DeepDiveDemographicOutlook | null;
  financials: DeepDiveFinancials | null;
  skills: DeepDiveSkills | null;
  outcomes: DeepDiveOutcomes | null;
  // v1.2.9 — per-program course list from program-courses-extract.v1
  // joined with class-GPA aggregates per course.
  courses: DeepDiveCourses | null;
  faculty: DeepDiveFaculty | null;
  peers: DeepDivePeers | null;
  trends: DeepDiveTrends | null;
  healthBenchmarks: DeepDiveHealthBenchmarks | null;
  digitalCompetency: DeepDiveDigitalCompetency | null;
  /** DQ theory modules 1–13, for the radar's axis labels and the names
   *  of the weakest modules. Server-supplied — see the import note. */
  dqModules: DqModule[];
  /** The suppression floor (`DQ_MIN_CELL_STUDENTS`), quoted in the copy
   *  so it moves with the query layer rather than being written twice. */
  dqMinCellStudents: number;
  /** KKU's own DQ pass mark, quoted where the radial floor is disclosed. */
  dqPassMark: number;
  /** `OVERALL_MEAN_MAX_MODULE_NO` — the highest module the headline mean
   *  averages over. Every sentence naming the module window derives from
   *  it rather than hardcoding "1–12" / "module 13". */
  dqHeadlineMaxModuleNo: number;
}

/**
 * Locale-stable date formatter to avoid Next.js hydration mismatches.
 * `toLocaleDateString()` without an explicit locale falls back to the
 * runtime's default — Node (server) and the browser (client)
 * frequently disagree, so the SSR'd HTML doesn't match what the
 * client re-renders on hydration. ISO `YYYY-MM-DD HH:MM UTC` is
 * deterministic everywhere AND carries time-of-day for DateTime
 * sources (strategic narrative `generatedAt`, peer review
 * `generatedAt` etc.). When the source is a Postgres DATE column
 * (arrives as 00:00:00 UTC) the time component is suppressed —
 * showing "00:00 UTC" on a date-only field looks like the renderer
 * wrongly stripped the real time.
 */
function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  // Use UTC slicing so the displayed date matches the stored UTC date
  // regardless of the viewer's local timezone (no off-by-one near
  // midnight UTC).
  const iso = d.toISOString();
  const datePart = iso.slice(0, 10);
  // Postgres DATE columns serialise to YYYY-MM-DDT00:00:00.000Z. Those
  // never carry meaningful time-of-day, so display date-only.
  if (iso.endsWith('T00:00:00.000Z')) return datePart;
  return `${datePart} ${iso.slice(11, 16)} UTC`;
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
// Seven macro-sections, designed for a program-manager audience that
// reads top-down. Each macro contains 1-3 sub-blocks; the side-nav
// anchors to the macro IDs only so navigation stays scannable.
//
// Sub-block IDs (header, narrative, ai-readiness, demand, tcas,
// recruitment, cohorts, demographic, outcomes, skills, faculty,
// financials, peers, trends) remain in the DOM as deep-link anchors,
// but the side-nav doesn't list them.
// The rail is two-level: each section lists the named blocks inside it, so a
// 15,000px page can be reached at the block a reader actually wants rather
// than only at its section. The sub-anchor ids already existed on the page —
// they were simply never surfaced.
const SECTIONS: Array<{
  id: string;
  label: string;
  subs?: Array<{ href: string; label: string }>;
}> = [
  {
    id: 'snapshot',
    label: 'Executive snapshot',
    subs: [
      { href: '#verdict', label: 'Lifecycle verdict' },
      { href: '#narrative', label: 'Strategic narrative' },
      { href: '#ai-readiness', label: 'AI readiness' },
    ],
  },
  {
    id: 'admissions',
    label: 'Admissions',
    subs: [
      { href: '#recruitment', label: 'Recruitment funnel' },
      { href: '#tcas', label: 'TCAS3 score detail' },
    ],
  },
  {
    id: 'students',
    label: 'Students',
    subs: [
      { href: '#cohorts', label: 'Cohort distribution' },
      { href: '#demand', label: 'Demand funnel' },
      { href: '#demographic', label: 'Demographic outlook' },
    ],
  },
  {
    id: 'outcomes',
    label: 'Outcomes',
    subs: [{ href: '#digital-competency', label: 'Digital competency' }],
  },
  {
    id: 'curriculum',
    label: 'Curriculum & Faculty',
    subs: [
      { href: '#skills', label: 'Skills coverage' },
      { href: '#faculty', label: 'Faculty capability' },
      { href: '#research-expertise', label: 'Research expertise' },
      { href: '#curriculum-revision', label: 'Curriculum revision' },
    ],
  },
  { id: 'financials', label: 'Financials' },
  {
    id: 'benchmarking',
    label: 'Benchmarking',
    subs: [{ href: '#peers', label: 'Peer comparison' }],
  },
  // Benchmarking (peer comparison) re-added to the deep-dive — a focused,
  // standalone view also lives at /benchmarking/programs/[id]. Trends still
  // live on /trends only; that data fetch remains in place so AI Analyst
  // tools can still query it.
];

export function DeepDiveClient(props: Props) {
  const router = useRouter();
  const [narrative, setNarrative] = React.useState<string | null>(null);
  const [narrativeBusy, setNarrativeBusy] = React.useState(false);
  const [narrativeAiId, setNarrativeAiId] = React.useState<string | null>(null);

  // The scroll-spy that used to live here now belongs to SectionRail —
  // keeping a second observer on the same elements would mean two sources
  // of truth for which section is current.

  // Headline figure per section. Each is already computed and displayed
  // somewhere inside its section — surfacing it in the rail and the section
  // band is a summary, not a new claim. Undefined where the figure is
  // unavailable, so both show the label alone rather than a fabricated dash.
  //
  // Shared between the rail and the bands from ONE computation: two
  // derivations of "the headline number" would eventually disagree, and a
  // band contradicting its own rail entry is worse than neither having one.
  const railMeta = React.useRef<Record<string, string | undefined>>({});
  const railItems: RailItem[] = React.useMemo(() => {
    const round = (n: number | null | undefined) =>
      n === null || n === undefined ? undefined : String(Math.round(n));
    // byYear is newest-first — the Admissions section itself takes the latest
    // complete year with `.find()`, so use the same, not `.at(-1)` (which
    // silently returned the OLDEST year and headlined 7.7× against the
    // section's own 16.5×).
    const latestYear = props.recruitment?.byYear.find((y) => y.isComplete);
    const comp = latestYear?.competitionRatio;
    // employmentRate is a FRACTION in this payload; the section renders it as
    // `(rate * 100).toFixed(1)`. Formatting it directly headlined 0.8%.
    const employment = props.outcomes?.latest?.employmentRate;
    const meta: Record<string, string | undefined> = {
      snapshot: round(props.overview.health?.overall.score),
      admissions: comp === null || comp === undefined ? undefined : `${comp.toFixed(1)}×`,
      students: round(props.studentCohorts?.totalActive),
      outcomes:
        employment === null || employment === undefined
          ? undefined
          : `${(employment * 100).toFixed(1)}%`,
      curriculum: round(props.courses?.extractedCount),
    };
    railMeta.current = meta;
    return SECTIONS.map((s) => ({
      href: `#${s.id}`,
      label: s.label,
      meta: meta[s.id],
      subs: s.subs,
    }));
  }, [
    props.overview.health,
    props.outcomes,
    props.courses,
    props.studentCohorts,
    props.recruitment,
  ]);

  const onRegenerateNarrative = async () => {
    setNarrativeBusy(true);
    const r = await regenerateNarrativeAction(props.programId, 'thai-narrative');
    setNarrativeBusy(false);
    if (r.ok) {
      // The narrative is regenerated through the same program-strategic-
      // narrative prompt the pipeline uses and persisted server-side, so
      // refresh to re-render the freshly-stored markdown (rather than the
      // plain-text live override). revalidatePath already ran in the action.
      setNarrative(null);
      setNarrativeAiId(r.aiInferenceId);
      toast.success('Strategic narrative regenerated');
      router.refresh();
    } else {
      toast.error(r.message);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      {/* Left rail — two-level, with each section's headline figure so the
          rail doubles as a summary. SectionRail owns its own scroll-spy. */}
      <aside>
        <SectionRail label="This programme" items={railItems} />
      </aside>

      <div className="flex flex-col gap-10">
        {/* Council-facing: states which document the analysis belongs to.
            Deliberately quiet — the analysis below is not wrong, it is
            simply about an earlier version of the curriculum. */}
        {props.overview.staleness?.stale && (
          <Card padding="sm" tone="quiet">
            <p className="text-xs text-text-secondary">
              {props.overview.staleness.reason === 'unanalysed-revision'
                ? props.overview.staleness.isFirstAnalysis
                  ? "This programme's analysis has not been generated yet."
                  : `A newer curriculum document${
                      props.overview.staleness.pendingCurriculumYearBE
                        ? ` (พ.ศ. ${props.overview.staleness.pendingCurriculumYearBE})`
                        : ''
                    } has been attached to this programme but not yet analysed. The analysis below reflects the previous curriculum.`
                : 'The analysis below was generated from a curriculum document that is no longer the current one.'}
            </p>
          </Card>
        )}
        <MacroGroup
          id="snapshot"
          title="Executive snapshot"
          subtitle="Health verdict, strategic narrative, and AI readiness — the one-page brief."
          stat={railMeta.current.snapshot}
          statLabel="overall"
        >
          <HeaderSection
            overview={props.overview}
            lifecycle={props.lifecycle}
            benchmarks={props.healthBenchmarks}
          />
          <NarrativeSection
            programId={props.programId}
            narrative={narrative}
            busy={narrativeBusy}
            onRegenerate={onRegenerateNarrative}
            aiInferenceId={narrativeAiId}
            preComputed={props.strategicNarrative}
          />
          <AiReadinessSection data={props.aiReadiness} />
        </MacroGroup>

        <MacroGroup
          id="admissions"
          title="Admissions"
          subtitle="TCAS rounds 1–4 funnel for the latest entry cohort + round-3 score detail and competitive landscape."
          stat={railMeta.current.admissions}
          statLabel="competition"
        >
          <RecruitmentSection data={props.recruitment} />
          <TcasStatsSection data={props.tcasStats} />
        </MacroGroup>

        <MacroGroup
          id="students"
          title="Students"
          subtitle="Past cohort distribution, full lifecycle, and the demographic outlook for future intake."
          stat={railMeta.current.students}
          statLabel="active"
        >
          <StudentCohortsSection data={props.studentCohorts} />
          <DemandFunnelSection data={props.demandFunnel} />
          <DemographicOutlookSection data={props.demographicOutlook} />
        </MacroGroup>

        <MacroGroup
          id="outcomes"
          title="Outcomes"
          subtitle="Where graduates land — employment, salary, sector and first-job destinations."
          stat={railMeta.current.outcomes}
          statLabel="employed"
        >
          <OutcomesSection data={props.outcomes} />
          {/* Digital competency sits in Outcomes because that is the
              health dimension its driver feeds (health-score.v4.0). It
              renders NOTHING for a non-bachelor programme — see the
              component. */}
          <DigitalCompetencySection
            data={props.digitalCompetency}
            modules={props.dqModules}
            minCellStudents={props.dqMinCellStudents}
            passMark={props.dqPassMark}
            headlineMaxModuleNo={props.dqHeadlineMaxModuleNo}
            programId={props.programId}
          />
        </MacroGroup>

        <MacroGroup
          id="curriculum"
          title="Curriculum & Faculty"
          subtitle="What we teach (skill coverage) and who teaches it (faculty capability + succession risk)."
          stat={railMeta.current.curriculum}
          statLabel="courses"
        >
          <SkillsSection data={props.skills} programId={props.programId} />
          <CoursesSection data={props.courses} programId={props.programId} />
          <FacultySection data={props.faculty} />
          <ResearchExpertiseSection
            data={props.researchExpertise}
            composition={props.faculty?.researchSourceComposition ?? null}
          />
          <CurriculumRevisionSection
            data={props.curriculumRevision}
            composition={props.faculty?.researchSourceComposition ?? null}
          />
        </MacroGroup>

        <MacroGroup
          id="financials"
          title="Financials"
          subtitle="Revenue, cost, and per-student economics — methodology v0; treat as preview."
        >
          <FinancialsSection data={props.financials} />
        </MacroGroup>

        <MacroGroup
          id="benchmarking"
          title="Benchmarking"
          subtitle="How this program compares to AI-selected peer programs across QS/THE-ranked universities — content modernity, strengths, gaps, and recommendations."
        >
          <div className="-mt-1 mb-1 text-xs">
            <a
              href={`/benchmarking/programs/${props.programId}`}
              className="text-accent-default underline-offset-2 hover:underline"
            >
              Open the focused benchmarking view →
            </a>
          </div>
          <PeersSection data={props.peers} aiPeers={props.aiPeers} />
        </MacroGroup>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sections
// ──────────────────────────────────────────────────────────────────────────

// Macro-group wrapper. Renders a small eyebrow heading + subtitle and
// stacks the sub-blocks under it. The macro `id` is what the side-nav
// + IntersectionObserver track. Sub-blocks keep their own `id="..."`
// for deep-link compatibility.
function MacroGroup({
  id,
  title,
  subtitle,
  stat,
  statLabel,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  /** Headline figure, right-aligned in the band. Sections here are a tour of
   *  a programme rather than a numbered framework, so the band carries the
   *  section's own number instead of an invented ordinal. */
  stat?: React.ReactNode;
  statLabel?: string;
  children: React.ReactNode;
}) {
  // Each direct child is a sub-block that renders its own heading and body,
  // so they hang off the spine via SpineItem rather than being rebuilt as
  // SubSections — nothing inside them is touched, which is what keeps this a
  // layout change rather than a rewrite. `toArray` drops the nulls that
  // conditional sub-blocks return, so the spine ends on a real item.
  const blocks = React.Children.toArray(children).filter(Boolean);
  return (
    <SectionBand
      id={id}
      title={title}
      coverage={subtitle}
      stat={stat}
      statLabel={statLabel}
      // The parent stacks sections with gap-10; SectionBand's own top margin
      // would add to it.
      className="scroll-mt-[5rem]"
    >
      <div className="ml-1 mt-3">
        {blocks.map((child, i) => (
          <SpineItem
            key={i}
            last={i === blocks.length - 1}
            // The first block in a section is the one it leads with.
            emphasis={i === 0}
          >
            {child}
          </SpineItem>
        ))}
      </div>
    </SectionBand>
  );
}

function HeaderSection({
  overview,
  lifecycle,
  benchmarks,
}: {
  overview: DeepDiveOverview;
  lifecycle: DeepDiveLifecycle | null;
  benchmarks: DeepDiveHealthBenchmarks | null;
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
  // University + faculty program-level averages, aligned to the same
  // 5-dim order as `dims`, overlaid on the radar as dashed comparison
  // polygons. Faculty omitted when the program has no faculty average.
  const meansToPoints = (m: DeepDiveHealthBenchmarks['university']) => [
    { label: 'Attractiveness', value: m.attractiveness },
    { label: 'Financial', value: m.financial },
    { label: 'Capability', value: m.capability },
    { label: 'Outcomes', value: m.outcomes },
    { label: 'Relevance', value: m.relevance },
  ];
  const radarComparisons =
    h && benchmarks
      ? [
          { label: 'University avg', points: meansToPoints(benchmarks.university) },
          ...(benchmarks.faculty
            ? [{ label: 'Faculty avg', points: meansToPoints(benchmarks.faculty) }]
            : []),
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
    <section id="header" className="scroll-mt-[5rem]">
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
                  {overview.program.curriculumYearBE != null
                    ? ` · curriculum rev. BE ${overview.program.curriculumYearBE} (CE ${overview.program.curriculumYearBE - 543})`
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
                {/* The badge represents WHEN THE PIPELINE LAST RAN for
                  * this program (full timestamp, time-of-day preserved).
                  * Sources from overview.lastAnalysedAt which is
                  * MAX(narrative.generatedAt, ai-readiness.generatedAt,
                  * peer-review.generatedAt, risk.assessedAt). Falls back
                  * to health.latestFreshness (data vintage, `@db.Date`,
                  * always midnight UTC) only when no pipeline output
                  * exists yet. */}
                {(overview.lastAnalysedAt ?? h.latestFreshness) && (
                  <FreshnessBadge
                    freshnessDate={overview.lastAnalysedAt ?? h.latestFreshness}
                    label={overview.lastAnalysedAt ? 'pipeline run' : 'source data'}
                  />
                )}
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
              <RadarChartSmall points={dims} comparisons={radarComparisons} seriesLabel="This program" />
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
    <section id="ai-readiness" className="scroll-mt-[5rem]">
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
    labour_market_alignment: 'Labour-market alignment',
    revenue_scale: 'Revenue scale',
    major_content_gaps: 'Major content gaps vs peers',
    demographic_resilience: 'Demographic resilience',
    delayed_graduation_share: 'Delayed-graduation share',
    capability_strength: 'Faculty capability',
    ai_readiness: 'AI readiness',
  };
  const labelOf = (lbl: string) => phrases[lbl] ?? lbl.replace(/_/g, ' ');

  // Gap #8 closure: surface the gate counterfactual when any modifier
  // gate fired. The gated verdict remains the institutional position;
  // this readout shows the reader what the trajectory math alone said.
  const gateLabels: Record<
    NonNullable<DeepDiveLifecycle['gatesApplied'][number]['name']>,
    string
  > = {
    oldSchoolContentCap: 'Old-school content cap',
    aiReadinessStableCap: 'AI readiness < 30 (STABLE cap)',
    aiReadinessFrontierCap: 'AI readiness < 50 (FRONTIER cap)',
    lowLabourMarketAlignmentStableCap: 'Labour-market alignment < 30 (STABLE cap)',
    lowLabourMarketAlignmentFrontierCap: 'Labour-market alignment < 50 (FRONTIER cap)',
    lowRevenuePotentialFrontierCap: 'Revenue < 3M THB/yr flagship floor (FRONTIER cap)',
  };
  const ungatedMeta =
    data.ungatedVerdict !== data.verdict ? verdictMeta[data.ungatedVerdict] : null;

  return (
    <section id="verdict" className="flex flex-1 flex-col scroll-mt-[5rem]">
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

        {/* Gate counterfactual (gap #8 closure, lifecycle.v1.2).
         *  Only renders when a modifier gate moved the verdict —
         *  shows reader what the trajectory math alone would have said
         *  and which institutional cap intervened. */}
        {ungatedMeta && data.gatesApplied.length > 0 && (
          <div
            className="mt-3 rounded-md border border-border-subtle bg-surface-2/60 px-3 py-2 text-xs text-text-secondary"
            role="note"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="uppercase tracking-wide text-text-tertiary">
                Without modifier gates:
              </span>
              <span className={`font-semibold ${ungatedMeta.text}`}>
                {ungatedMeta.label}
              </span>
              <span className="text-text-tertiary">
                (trajectory math alone)
              </span>
            </div>
            <ul className="mt-1 flex flex-col gap-0.5">
              {data.gatesApplied.map((g, i) => (
                <li key={`${g.name}-${i}`} className="leading-snug">
                  <span className="font-medium text-text-primary">
                    {gateLabels[g.name]}
                  </span>
                  <span className="text-text-tertiary">
                    {' '}— capped {g.from} → {g.to}. {g.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
      <Section id="tcas" title="TCAS3 round-3 score detail & peer comparison">
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
    <Section id="tcas" title="TCAS3 round-3 score detail & peer comparison">
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
    low: 'Low — healthy applicant pool through +15y',
    medium: 'Medium — applicant pool turns super-critical within +15y',
    high: 'High — under 1.5 applicants/seat within +10y',
    unknown: 'Unknown — no recruitment-funnel baseline',
  };
  const tenYear = data.projections.find((p) => p.year === data.projections[0]!.year + 10);
  const fifteenYear = data.projections.find((p) => p.year === data.projections[0]!.year + 15);
  // Bar visual — cohort population at each horizon, scaled to anchor.
  const anchorPop = data.projections[0]!.cohortPopulation;
  const peakWidth = anchorPop > 0 ? anchorPop : 1;
  const funnel = data.funnelBaseline;
  const planValue = funnel?.plan ?? 0;
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
            {formatCohortChangePct(data.fifteenYearContraction)}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-warning/70 transition-all"
              style={{ width: contractionMeterWidth(data.fifteenYearContraction) }}
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
          {data.superCriticalYear !== null ? (
            <div className="mt-1 text-xs text-warning">
              Super-critical from {data.superCriticalYear}
            </div>
          ) : data.funnelBaseline ? (
            <div className="mt-1 text-xs text-text-tertiary">
              Applicant pool healthy through +15y
            </div>
          ) : tenYear?.requiredShareOfCohort != null ? (
            <div className="mt-1 text-xs text-text-tertiary">
              +10y national share: {(tenYear.requiredShareOfCohort * 100).toFixed(4)}%
            </div>
          ) : null}
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
                    {/* Suppress only a genuinely flat 0.0% (the anchor row is
                        zero by definition). The old `> 0` guard also hid
                        cohort GROWTH, which is real and worth seeing. */}
                    {formatCohortChangePct(p.cohortDeclinePct) !== '0.0%' && (
                      <span className="ml-2 text-text-tertiary">
                        {formatCohortChangePct(p.cohortDeclinePct)}
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
              <th className="py-1.5 text-right font-medium">National {data.ageCohort} cohort</th>
              <th className="py-1.5 text-right font-medium">NE catchment</th>
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
                  {p.cohortPopulationRegional !== null
                    ? p.cohortPopulationRegional.toLocaleString('en-US')
                    : '—'}
                </td>
                <td className="py-1.5 text-right font-tabular text-text-secondary">
                  {formatCohortChangePct(p.cohortDeclinePct)}
                </td>
                <td className="py-1.5 text-right font-tabular">
                  {p.requiredShareOfCohort !== null
                    ? `${(p.requiredShareOfCohort * 100).toFixed(4)}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-3 border-t border-border-subtle pt-2 text-xs text-text-tertiary">
          Source: {data.source} (NESDC mid-variant population projection). The projection is
          national; the NE-catchment column is a comparator.
          {fifteenYear && fifteenYear.cohortDeclinePct > 30 && (
            <span className="text-warning">
              {' '}A {fifteenYear.cohortDeclinePct.toFixed(0)}% national contraction by{' '}
              {fifteenYear.year} leaves this program structurally exposed to demographic
              shrinkage; portfolio-level consolidation should be on the Council's radar.
            </span>
          )}
        </p>
      </Card>

      {/* ── Recruitment funnel vs admission plan ──────────────────── */}
      <Card>
        <h4 className="mb-1 text-sm font-semibold">Recruitment funnel vs admission plan</h4>
        {funnel ? (
          <>
            <p className="mb-3 text-xs text-text-tertiary">
              Baseline — TCAS BE {funnel.entryYearBE}: plan{' '}
              <span className="font-tabular text-text-secondary">
                {funnel.plan.toLocaleString('en-US')}
              </span>{' '}
              · applicants{' '}
              <span className="font-tabular text-text-secondary">
                {funnel.applicants.toLocaleString('en-US')}
              </span>{' '}
              ({funnel.competitionRatio.toFixed(1)} per seat) · reported in{' '}
              <span className="font-tabular text-text-secondary">
                {funnel.reportedIn.toLocaleString('en-US')}
              </span>{' '}
              ({(funnel.reportedRate * 100).toFixed(0)}% TCAS yield). Applicants are projected
              forward in proportion to the national {data.ageCohort} cohort; the risk is
              whether enough applicants remain per seat — below 1.5 applicants per seat the
              pool is too thin to fill the {planValue}-seat plan (super-critical).
            </p>
            <table className="w-full border-t border-border-subtle text-sm">
              <thead className="text-left text-xs text-text-tertiary">
                <tr>
                  <th className="py-1.5 font-medium">Horizon</th>
                  <th className="py-1.5 text-right font-medium">Proj. applicants</th>
                  <th className="py-1.5 text-right font-medium">Plan</th>
                  <th className="py-1.5 text-right font-medium">Applicants / seat</th>
                  <th className="py-1.5 text-right font-medium">Status</th>
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
                      {p.projectedApplicants !== null
                        ? p.projectedApplicants.toLocaleString('en-US')
                        : '—'}
                    </td>
                    <td className="py-1.5 text-right font-tabular text-text-secondary">
                      {planValue.toLocaleString('en-US')}
                    </td>
                    <td className="py-1.5 text-right font-tabular">
                      {p.competitionRatio !== null ? `${p.competitionRatio.toFixed(1)}×` : '—'}
                    </td>
                    <td className="py-1.5 text-right font-tabular">
                      {p.superCritical === null ? (
                        '—'
                      ) : p.superCritical ? (
                        <span className="text-warning">✗ super-critical</span>
                      ) : (
                        <span className="text-success">✓ healthy</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 border-t border-border-subtle pt-2 text-xs">
              {data.superCriticalYear !== null ? (
                <span className="text-warning">
                  The shrinking national cohort drags projected applicants below 1.5 per seat
                  from {data.superCriticalYear} onward — past that point the program no longer
                  has a substantial enough applicant pool to fill its {planValue}-seat plan.
                </span>
              ) : (
                <span className="text-text-tertiary">
                  Projected applicants stay at or above 1.5 per seat through the +15y horizon —
                  the pool remains substantial enough to fill the plan despite the demographic
                  contraction.
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-xs text-text-tertiary">
            No TCAS recruitment-funnel data (plan / applicants) is linked to this program, so
            the applicants-per-seat projection can't be computed.
          </p>
        )}
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
    <Section
      id="financials"
      title="Financials"
      actions={
        <Badge
          tone="warning"
          size="sm"
          title="Cost-allocation methodology v0 — placeholder allocations only. Net contribution + per-program cost figures pending Finance Committee sign-off."
        >
          PREVIEW
        </Badge>
      }
    >
      {data.partialCurrentYearAvailable && (
        <Card padding="sm" tone="quiet" className="mb-3">
          <p className="text-xs text-text-secondary">
            Figures below are for{' '}
            <span className="font-semibold text-text-primary">FY {data.latestFiscalYear}</span>, the
            most recent academic year that has finished billing.{' '}
            <span className="font-semibold text-text-primary">FY {data.partialFiscalYear}</span> is
            still in progress — the registrar has collected{' '}
            <span className="font-tabular font-semibold text-text-primary">
              {data.partialTuitionRevenueSoFar !== null
                ? data.partialTuitionRevenueSoFar.toLocaleString('en-US')
                : '—'}
            </span>{' '}
            THB so far this year. That figure is informational only — an academic year&apos;s
            tuition is billed across two terms, so it is not comparable to a full year and is
            excluded from the score above.
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
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Teaching-staff salary cost
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {(data.salaryByFunding?.totalAnnualThb ?? subsidy).toLocaleString(
              'en-US',
              { maximumFractionDigits: 0 },
            )}
          </div>
          <div className="text-xs text-text-tertiary">
            {data.salaryByFunding
              ? `THB/yr · weighted by enrolment share · ${data.salaryByFunding.contributingMembers} member${data.salaryByFunding.contributingMembers === 1 ? '' : 's'}`
              : 'THB/yr · faculty payroll — NOT netted from tuition'}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Public investment / student</div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.costPerStudent ? Math.round(data.costPerStudent).toLocaleString('en-US') : '—'}
          </div>
          <div className="text-xs text-text-tertiary">THB/yr · subsidised salary per enrolled head</div>
        </Card>
      </div>
      {data.salaryByFunding && data.salaryByFunding.entries.length > 0 && (
        <Card>
          <h4 className="mb-1 text-sm font-semibold">
            Where teaching-staff salaries come from
          </h4>
          <p className="mb-3 text-xs text-text-tertiary">
            Funding-source split for this program&apos;s teaching staff,
            sourced from the KKU-HR compensation cube (
            <Link href="/staff/compensation" className="text-accent-default hover:underline">
              /staff/compensation
            </Link>
            ). Staff who teach more than one program have their salary
            contribution to <em>this</em> program weighted by enrolment
            share (a lecturer teaching a 200- and a 20-student program
            contributes ~91% to the former).
          </p>
          <ul className="flex flex-col gap-1.5">
            {data.salaryByFunding.entries.map((e) => (
              <li key={e.salType} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-xs" lang="th">
                  {e.salType}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent-default/70"
                    style={{ width: `${Math.max(2, e.share * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right font-tabular text-xs">
                  {Math.round(e.annualThb).toLocaleString('en-US')}
                </span>
                <span className="w-12 shrink-0 text-right font-tabular text-xs text-text-tertiary">
                  {Math.round(e.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-text-tertiary">
            Methodology {data.salaryByFunding.methodologyVersion} · FY{' '}
            {data.salaryByFunding.sourceFiscalYear ?? '—'} ·{' '}
            {data.salaryByFunding.contributingMembers} contributing,{' '}
            {data.salaryByFunding.unresolvedMembers} unresolved (no cube
            row at their faculty × rank).
          </p>
        </Card>
      )}
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
  // Demand source lives in the URL (?skillsSource=jobthai|linkedin) so a view
  // is shareable. With no explicit choice, JobThai (domestic) is the default
  // whenever this programme has a JobThai demand list; LinkedIn otherwise.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const jobThaiAvailable = data?.jobThai?.status === 'ok' && (data.jobThai.demanded.length > 0 || data.jobThai.alsoAccepted.length > 0);
  const requested = searchParams?.get('skillsSource');
  const source: 'linkedin' | 'jobthai' =
    requested === 'jobthai' || requested === 'linkedin' ? requested : jobThaiAvailable ? 'jobthai' : 'linkedin';
  const setSource = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('skillsSource', next === 'jobthai' ? 'jobthai' : 'linkedin');
    router.replace(`${pathname}?${params.toString()}#skills`, { scroll: false });
  };
  if (!data) return <EmptyCard title="Skills coverage" note="Skills data unavailable." />;
  void programId;
  const match = data.matchScore;
  const jt = data.jobThai;

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
          {source === 'jobthai' ? (
            <>
              <div
                className={
                  'mt-1 font-tabular text-3xl font-semibold ' +
                  (jt?.matchScore == null
                    ? 'text-text-tertiary'
                    : jt.matchScore < 40 ? 'text-danger' : jt.matchScore < 65 ? 'text-warning' : 'text-success')
                }
              >
                {jt?.matchScore == null ? '—' : Math.round(jt.matchScore)}
              </div>
              <div className="flex items-center gap-1 text-xs text-text-tertiary">
                <DataSourceMark source="jobthai" size={12} />
                vs JobThai (domestic)
              </div>
              {jt?.aiComputed && (
                <div className="text-[11px] text-text-tertiary">
                  {jt.matchScore != null
                    ? `on ${jt.relevantCount} relevant skills`
                    : `only ${jt.relevantCount} relevant skill${jt.relevantCount === 1 ? '' : 's'} — needs ${jt.minRelevantSkills}`}
                </div>
              )}
            </>
          ) : (
            <>
              <div
                className={
                  'mt-1 font-tabular text-3xl font-semibold ' +
                  (match < 40 ? 'text-danger' : match < 65 ? 'text-warning' : 'text-success')
                }
              >
                {Math.round(match)}
              </div>
              <div className="text-xs text-text-tertiary">vs LinkedIn (MHESI, global)</div>
            </>
          )}
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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-text-tertiary">Labour-market demand source</span>
        <Segmented value={source} onValueChange={setSource}>
          <SegmentedList aria-label="Labour-market demand source">
            <SegmentedTrigger value="jobthai">
              <DataSourceMark source="jobthai" size={14} />
              JobThai · domestic
            </SegmentedTrigger>
            <SegmentedTrigger value="linkedin">LinkedIn · global</SegmentedTrigger>
          </SegmentedList>
        </Segmented>
      </div>
      {source === 'jobthai' ? (
        <JobThaiDemandCards data={jt} />
      ) : (
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
                      {isUnmatched && s.fit === 'other-profession' && (
                        <span title={s.fitReason ?? undefined}>
                          <Badge tone="neutral" size="sm">other profession</Badge>
                        </span>
                      )}
                      {isUnmatched && s.fit !== 'other-profession' && s.fit !== 'not-relevant' && s.fit !== 'uncertain' && (
                        <span title={s.fitReason ?? undefined}>
                          <Badge tone="danger" size="sm">
                            ✗ gap
                          </Badge>
                        </span>
                      )}
                      {isUnmatched && (s.fit === 'not-relevant' || s.fit === 'uncertain') && (
                        <span title={s.fitReason ?? undefined}>
                          <Badge tone="neutral" size="sm">{s.fit === 'uncertain' ? 'uncertain' : 'not for this field'}</Badge>
                        </span>
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
      )}
    </Section>
  );
}

// JobThai (domestic) view of the three demand cards. Its figures come from
// programJobThaiSkillCoverage, the loader behind the jobthai_demand_alignment
// health driver, so the list here and the score cannot disagree.
function JobThaiDemandCards({ data }: { data: DeepDiveJobThaiSkills | undefined }) {
  if (!data || data.status !== 'ok') {
    return (
      <Card padding="md" tone="quiet">
        <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <DataSourceMark source="jobthai" size={14} />
          No JobThai demand signal for this programme
        </h4>
        <p className="text-xs text-text-tertiary">
          {data?.status === 'below-floor'
            ? `Only ${data.postings} JobThai postings name this programme's field of study — below the 20-posting floor, so no demand list is shown.`
            : "No JobThai posting names this programme's field of study at a qualification level its graduates hold. Very few postings state a postgraduate minimum, so this is the normal state for master's and doctoral programmes. It is a data gap, not zero demand."}
        </p>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Card padding="md">
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <DataSourceMark source="jobthai" size={14} />
          Top labour-market demand
        </h4>
        <p className="mb-2 text-xs text-text-tertiary">
          JobThai postings (domestic) · {data.postings.toLocaleString()} postings across{' '}
          {data.occupationCount} occupation{data.occupationCount === 1 ? '' : 's'} that ask for this field
        </p>
        {data.occupations.length > 0 && (
          <details className="mb-2 text-[11px] text-text-tertiary">
            <summary className="cursor-pointer">Which occupations</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {data.occupations.map((o) => (
                <li key={`${o.category}|${o.subcategory}`} className="flex justify-between gap-2">
                  <span className="truncate">{o.subcategory === 'อื่นๆ' ? `${o.category} / ${o.subcategory}` : o.subcategory}</span>
                  <span className="shrink-0 font-mono">{o.postingCount.toLocaleString()} postings</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <ul className="flex flex-col gap-1.5 text-sm">
          {data.demanded.slice(0, 12).map((s) => (
            <li key={s.skillId} className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate">{s.nameEn || s.nameTh}</span>
                  {s.curriculumMatched === true && s.relevant !== false && <Badge tone="success" size="sm">✓ taught</Badge>}
                  {s.curriculumMatched === false && s.relevant === true && <Badge tone="danger" size="sm">✗ gap</Badge>}
                  {s.relevant === false && (
                    <Badge tone="neutral" size="sm">{s.fit === 'uncertain' ? 'uncertain' : 'not for this field'}</Badge>
                  )}
                  {s.fit === 'core' && <span className="text-[10px] uppercase tracking-wide text-text-tertiary">core</span>}
                </div>
                {s.fitReason && (
                  <div className="mt-0.5 text-[11px] text-text-tertiary">{s.fitReason}</div>
                )}
                {s.evidenceQuote && (
                  <div className="mt-0.5 truncate text-[11px] italic text-text-tertiary">
                    “{s.evidenceQuote.slice(0, 80)}{s.evidenceQuote.length > 80 ? '…' : ''}”
                  </div>
                )}
              </div>
              <span className="shrink-0 font-mono text-xs text-text-tertiary">{s.demandPct.toFixed(0)}% of postings</span>
            </li>
          ))}
          {data.demanded.length === 0 && (
            <li className="text-xs text-text-tertiary">No field-specific skill reaches 5% of these postings.</li>
          )}
          {!data.aiComputed && data.demanded.length > 0 && (
            <li className="mt-2 rounded-md border border-dashed border-border-default bg-surface-2/40 p-2 text-[11px] text-text-tertiary">
              Curriculum match not yet computed for JobThai demand. Run{' '}
              <code className="font-mono">programs:match-demand</code> to check each skill against the
              programme&apos;s PLOs and course descriptions.
            </li>
          )}
        </ul>
        {data.alsoAccepted.length > 0 && (
          <p className="mt-3 border-t border-border-subtle pt-2 text-[11px] text-text-tertiary">
            <span className="font-medium text-text-secondary">Employers also accept graduates in:</span>{' '}
            {data.alsoAccepted.map((a, i) => (
              <span key={a.skillId} title={a.fitReason ?? undefined}>
                {i > 0 && ' · '}
                {a.nameEn || a.nameTh}
              </span>
            ))}
            . Job adverts list several acceptable degrees; these are other professions, not gaps.
          </p>
        )}
        {data.generic.length > 0 && (
          <p className="mt-3 border-t border-border-subtle pt-2 text-[11px] text-text-tertiary">
            Also asked for across most occupations, so not counted as gaps or in the score:{' '}
            {data.generic.map((g, i) => (
              <span key={g.skillId}>
                {i > 0 && ' · '}
                {g.nameEn || g.nameTh} ({g.demandPct.toFixed(0)}%)
              </span>
            ))}
          </p>
        )}
      </Card>
      <Card padding="md" tone={data.gaps.length > 0 ? 'glossy' : 'default'}>
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <DataSourceMark source="jobthai" size={14} />
          Gaps — demanded, not taught
        </h4>
        <p className="mb-2 text-xs text-text-tertiary">
          {data.aiComputed
            ? 'Skills named in ≥5% of these postings, judged core or supporting to this profession, that the curriculum doesn\'t build'
            : 'Taxonomy match only — the AI curriculum check has not run, so a skill taught under another name still shows here'}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {data.gaps.slice(0, 10).map((g) => (
            <li key={g.skillId} className="flex flex-col">
              <div className="flex justify-between gap-2">
                <span className="truncate">
                  {g.nameEn || g.nameTh}
                  {g.fit === 'core' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-danger">core</span>}
                </span>
                <span className="shrink-0 font-mono text-xs text-text-tertiary">{g.demandPct.toFixed(0)}%</span>
              </div>
              {g.fitReason && <span className="text-[11px] text-text-tertiary">{g.fitReason}</span>}
            </li>
          ))}
          {data.gaps.length === 0 && <li className="text-xs text-text-tertiary">None.</li>}
        </ul>
      </Card>
      <Card padding="md" tone="quiet">
        <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <DataSourceMark source="jobthai" size={14} />
          Surplus — taught, not demanded
        </h4>
        <p className="mb-2 text-xs text-text-tertiary">
          Not named by these postings, and not cited by the AI as answering one. Could be
          foundational, a skill the postings phrase differently, or curriculum drift
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

/**
 * Digital Intelligence (DQ) competency.
 *
 * Four states, all distinct, because collapsing any two of them would
 * misrepresent the programme:
 *   - `not-applicable` → nothing renders. No card, no heading.
 *   - `no-data`        → an empty state pointing at the connector.
 *   - `below-floor`    → the count, and why the figure is withheld.
 *   - `ok`             → the full section.
 */
const DQ_SECTION_TITLE = 'Digital competency (DQ)';

function DigitalCompetencySection({
  data,
  modules,
  minCellStudents,
  passMark,
  headlineMaxModuleNo,
  programId,
}: {
  data: DeepDiveDigitalCompetency | null;
  modules: DqModule[];
  minCellStudents: number;
  passMark: number;
  headlineMaxModuleNo: number;
  programId: string;
}) {
  // A non-bachelor programme renders NOTHING — not an empty card, not a
  // heading. DQ is an undergraduate instrument; the DQ rows a master's
  // programme carries are undergraduates who later enrolled, caught by
  // the current-enrolment join. An empty box here would say the test
  // ought to have covered this programme and did not.
  if (data?.status === 'not-applicable') return null;
  // A null payload is a FAILED FETCH, not an absent one — the endpoint
  // answers for every programme the reader can open. Going quiet here
  // would be indistinguishable from not-applicable.
  //
  // The route that failed goes to the console, not onto the page: this
  // surface is read by Council, and `/programs/:id/dq` means nothing to
  // them while telling anyone else where to poke.
  if (!data) {
    return (
      <EmptyCard
        title={DQ_SECTION_TITLE}
        note="The Digital Intelligence section could not be loaded. Reload the page; if it keeps happening, tell an administrator."
      />
    );
  }

  // The DQ dashboard's radar takes a programme id straight from the URL.
  // No `radarFaculty`: this programme's students may be filed under a
  // faculty spelling we cannot derive here, and guessing would aim the
  // dashboard's chart at a narrower population than the figures above.
  const dashboardHref = `/education/student-dq?radarProgram=${encodeURIComponent(programId)}`;
  const moduleByKey = new Map(modules.map((m) => [m.key, m]));
  const students = (n: number) => `${n.toLocaleString('en-US')} scored student${n === 1 ? '' : 's'}`;
  // Both derived from `OVERALL_MEAN_MAX_MODULE_NO`, not written into the
  // copy: when the headline's module window moves, every sentence that
  // quotes it moves with it.
  const headlineRange = `theory modules 1–${headlineMaxModuleNo}`;
  const excludedModules = modules.filter((m) => m.no > headlineMaxModuleNo);
  const excludedLabel = excludedModules
    .map((m) => `module ${m.no} (${m.nameEn})`)
    .join(', ');

  if (data.status === 'no-data') {
    return (
      <Section id="digital-competency" title={DQ_SECTION_TITLE}>
        <Card>
          <p className="text-sm text-text-secondary">
            No Digital Intelligence results for this programme. Nobody currently enrolled here
            appears in the DQ export — this is an absence of results, not a figure held back at a
            small size.
          </p>
          <p className="mt-2 text-xs text-text-tertiary">
            If that looks wrong, re-run the <code className="font-mono">kku-dq</code> connector from{' '}
            <Link
              href="/admin/data-sources/kku-dq"
              className="text-accent-default underline-offset-2 hover:underline"
            >
              /admin/data-sources/kku-dq
            </Link>{' '}
            and check the programme match rate on{' '}
            <Link href="/education/student-dq" className="text-accent-default underline-offset-2 hover:underline">
              the DQ dashboard
            </Link>
            .
          </p>
        </Card>
      </Section>
    );
  }

  if (data.status === 'below-floor') {
    return (
      <Section id="digital-competency" title={DQ_SECTION_TITLE}>
        <Card>
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">Score withheld</span> — this programme
            has {students(data.scoredStudents)}, fewer than the {minCellStudents} needed to publish
            a per-programme figure. Its students <span className="font-medium">were</span> tested;
            the mean, the pass rate and the module profile are not published at this size. Nothing
            here is a zero.
          </p>
          <p className="mt-2 text-xs text-text-tertiary">
            Faculty and university figures cover the same students at a size that clears the floor —{' '}
            <Link href="/education/student-dq" className="text-accent-default underline-offset-2 hover:underline">
              open the DQ dashboard
            </Link>
            .
          </p>
        </Card>
      </Section>
    );
  }

  // ── status === 'ok' ───────────────────────────────────────────────
  // Both series arrive on the framework's 13 theory axes in the same
  // order, so they are mapped straight through and stay aligned by
  // index; reordering or filtering one would rotate it against the
  // other and the overlay would compare a module with its neighbour.
  const axisLabel = (key: string) => moduleByKey.get(key)?.shortEn ?? key;
  const programPoints: RadarPoint[] = data.modules.map((m) => ({
    label: axisLabel(m.moduleKey),
    // Null stays null — the primitive draws a gap and marks the axis
    // '· n/d'. A 0 would spike into the centre and read as "they scored
    // nothing" rather than "nobody took it".
    value: m.mean,
  }));
  const universityPoints: RadarPoint[] = data.modules.map((m) => ({
    label: axisLabel(m.moduleKey),
    value: m.universityMean,
  }));
  const domain = dqRadarDomain([
    data.modules.map((m) => ({ mean: m.mean })),
    data.modules.map((m) => ({ mean: m.universityMean })),
  ]);
  const hasUniversity = universityPoints.some((p) => p.value !== null);

  // ── Coverage ──────────────────────────────────────────────────────
  // Each axis is a mean among the students who TOOK that module, so the
  // axes do not all rest on the same population. That is the concrete
  // fact behind the "uneven rollout" the copy warns about, and the
  // payload carries it — stating it in the abstract while holding the
  // numbers would be the weaker half of the disclosure.
  const pctRange = (
    cells: DeepDiveDigitalCompetencyModule[],
  ): { lo: number; hi: number } | null => {
    const vs = cells.map((m) => m.coveragePct).filter((v): v is number => v !== null);
    if (vs.length === 0) return null;
    return { lo: Math.min(...vs), hi: Math.max(...vs) };
  };
  const headlineCoverage = pctRange(data.modules.filter((m) => m.moduleNo <= headlineMaxModuleNo));
  const excludedCoverage = data.modules
    .filter((m) => m.moduleNo > headlineMaxModuleNo && m.coveragePct !== null)
    .map(
      (m) =>
        `${moduleByKey.get(m.moduleKey)?.nameEn ?? m.moduleKey} rests on ${m.coveragePct!.toFixed(1)}%`,
    );

  return (
    <Section
      id="digital-competency"
      title={DQ_SECTION_TITLE}
      description={`How this programme's students score on KKU's Digital Intelligence test. ${data.methodologyVersion}.`}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Digital competency mean
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.rawMean === null ? '—' : data.rawMean.toFixed(1)}
          </div>
          <div className="text-xs text-text-tertiary">
            {headlineRange}, out of 100
            <span className="px-1">·</span>
            from {students(data.scoredStudents)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Health driver (Outcomes)
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.driverScore === null ? '—' : data.driverScore.toFixed(0)}
          </div>
          <div className="text-xs text-text-tertiary">
            the mean banded on the {passMark} pass mark ({passMark} &rarr; 50)
            <span className="px-1">·</span>
            from the same {students(data.scoredStudents)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-text-tertiary">
            Passed (DQ verdict)
          </div>
          <div className="mt-1 font-tabular text-2xl font-semibold">
            {data.passRatePct === null ? '—' : `${data.passRatePct.toFixed(1)}%`}
          </div>
          <div className="text-xs text-text-tertiary">
            share of {students(data.scoredStudents)} the source itself flags as passed
          </div>
          {/* Load-bearing, and more so here than on the dashboard: the
              card immediately to the left says the mean is banded on the
              {passMark} pass mark, so "{'{'}pass rate{'}'}% passed" invites
              the reader to conclude the rest scored under {passMark}.
              They did not. The source applies no single rule to the
              flag. Wording kept in step with /education/student-dq so
              the two surfaces say one thing. */}
          <div className="mt-1.5 text-xs text-warning">
            This is DQ&rsquo;s own verdict, passed through unchanged &mdash; never recomputed here,
            and not a test against the {passMark} pass mark. The source applies no single rule to
            it: some students are flagged as passed while scoring below the pass mark on{' '}
            {excludedLabel || `module ${headlineMaxModuleNo + 1}`}, and others with that same
            profile are flagged as failed.
          </div>
        </Card>
      </div>

      <Card>
        <h4 className="text-sm font-semibold">Module profile</h4>
        <p className="mt-1 text-xs text-text-tertiary">
          Solid ring is this programme ({students(data.scoredStudents)}); the dashed ring is the{' '}
          <span className="font-medium">university-wide DQ profile</span> &mdash; every scored
          student in the export, at every level, not a bachelor-only average and not this
          programme&rsquo;s faculty. The mean and driver above are bachelor-only; the overlay is
          not, so read it as the institutional backdrop rather than as a like-for-like peer figure.
          An axis marked <span className="font-medium">&middot; n/d</span> is a module nobody here
          has taken; the polygon skips it rather than dropping to zero.
        </p>
        {headlineCoverage && (
          <p className="mt-1.5 text-xs text-text-tertiary">
            Each axis is the mean among the students who took that module, not across the whole
            cohort. Over {headlineRange} that is{' '}
            {headlineCoverage.lo.toFixed(1)}
            {headlineCoverage.hi - headlineCoverage.lo >= 0.05 && (
              <>&ndash;{headlineCoverage.hi.toFixed(1)}</>
            )}
            % of this programme&rsquo;s {students(data.scoredStudents)}.
            {excludedCoverage.length > 0 && (
              <>
                {' '}
                By contrast, {excludedCoverage.join(', ')} &mdash; the uneven uptake that keeps it
                out of the headline mean.
              </>
            )}{' '}
            A thinly-taken module is not a strong one.
          </p>
        )}
        {/* The primitive takes a fixed pixel width, so on a narrow column
            it scrolls inside its own box — the page body never scrolls
            sideways. `min-w-fit` keeps the centred row reachable once the
            content exceeds the box. */}
        <div className="mt-3 overflow-x-auto">
          <div className="flex min-w-fit justify-center">
            <RadarChartSmall
              points={programPoints}
              comparisons={
                hasUniversity ? [{ label: 'University-wide DQ profile', points: universityPoints }] : []
              }
              seriesLabel="This programme"
              // 13 axes at fontSize 11: the primitive's label gutter is
              // fixed at 56px, so the outer radius has to come from the
              // HEIGHT for the widest labels ('Collaboration',
              // 'Presentation') to clear the polygon.
              width={720}
              height={420}
              // Not the default 0-100 — see dqRadarDomain.
              domain={domain}
            />
          </div>
        </div>
        {domain[0] > 0 && (
          <p className="mt-2 text-xs text-text-tertiary">
            The axis runs {domain[0]}&ndash;100, not 0&ndash;100. DQ scores cluster near the top of
            the scale, so a full-scale plot draws every module at almost the same radius; starting
            at {domain[0]} makes the differences legible, but it also magnifies them &mdash; read
            the shape as relative and the ring labels for the actual values.
            {domain[0] < passMark && ` The pass mark, ${passMark}, sits inside the chart.`}
          </p>
        )}
      </Card>

      <Card>
        <h4 className="text-sm font-semibold">Weakest modules</h4>
        {data.weakest.length === 0 ? (
          <p className="mt-1 text-sm text-text-tertiary">
            No module means to rank &mdash; nobody here has taken a module in the {headlineRange}{' '}
            window.
          </p>
        ) : (
          <>
            <p className="mt-1 text-xs text-text-tertiary">
              This programme&rsquo;s lowest-scoring modules among {headlineRange}.
              {excludedLabel && (
                <>
                  {' '}
                  Excluded: {excludedLabel} &mdash; for the same reason it is out of the headline
                  mean, its rollout has reached faculties unevenly.
                </>
              )}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {data.weakest.map((w) => (
                <li key={w.moduleKey} className="flex items-baseline justify-between gap-3">
                  <span>{moduleByKey.get(w.moduleKey)?.nameEn ?? w.moduleKey}</span>
                  {/* Explicit separator, not a gap: a bare padding put
                      "80.8out of 100" on screen as one token. */}
                  <span className="shrink-0">
                    <span className="font-tabular tabular-nums text-text-secondary">
                      {w.mean.toFixed(1)}
                    </span>
                    <span className="text-xs text-text-tertiary">
                      {' · '}
                      {w.mean < passMark ? `below the ${passMark} pass mark` : 'out of 100'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs">
          <Link href={dashboardHref} className="text-accent-default underline-offset-2 hover:underline">
            Open this programme on the DQ dashboard &rarr;
          </Link>
        </p>
      </Card>
    </Section>
  );
}

// GPA → OKLCH heatmap colour. Mirrors the /education/performance pivot
// so the visual language is consistent across the two surfaces.
function courseGpaHeat(gpa: number | null): string {
  if (gpa === null) return 'transparent';
  const c = Math.max(0, Math.min(4, gpa));
  const hue = c < 2 ? 25 + ((60 - 25) * c) / 2 : 60 + ((145 - 60) * (c - 2)) / 2;
  return `oklch(0.86 0.08 ${hue.toFixed(0)})`;
}

const COURSE_SEM_OPTIONS = [
  { value: 1, label: 'Sem 1' },
  { value: 2, label: 'Sem 2' },
  { value: 3, label: 'Summer (3)' },
  { value: 4, label: 'Intersession (4)' },
] as const;

function CoursesSection({
  data: initialData,
  programId,
}: {
  data: DeepDiveCourses | null;
  programId: string;
}) {
  const [data, setData] = React.useState<DeepDiveCourses | null>(initialData);
  const [selectedSemesters, setSelectedSemesters] = React.useState<number[]>(
    initialData?.semestersApplied ?? [1, 2],
  );
  const [loading, setLoading] = React.useState(false);

  // Refetch on semester change. Skip the first render so we don't fire
  // a fetch identical to the SSR payload — only re-fetch when the user
  // toggles a semester button.
  const isFirstRender = React.useRef(true);
  React.useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const ctrl = new AbortController();
    const qs = new URLSearchParams();
    selectedSemesters.forEach((s) => qs.append('semester', String(s)));
    setLoading(true);
    fetch(`/api/proxy/programs/${programId}/courses?${qs}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((env) => {
        const payload: DeepDiveCourses = env.data ?? env;
        setData(payload);
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') return;
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
    // Deliberate deps: selectedSemesters is identity-unstable per render, so
    // we depend on its joined string. (No eslint directive — react-hooks is
    // not registered in this repo's flat config, and naming an unregistered
    // rule is itself a lint error that turned CI red on 2026-08-16.)
  }, [selectedSemesters.join(','), programId]);

  if (!data || data.total === 0) {
    return (
      <EmptyCard
        title="Course list"
        note={
          !data || data.extractedCount === 0
            ? 'No course list materialised yet. Run pnpm programs:extract-courses <code> to populate program_courses.'
            : `${data.extractedCount} curriculum courses on file but none have graded class data in the selected semesters. Try toggling additional semesters above.`
        }
      />
    );
  }
  const fmtGpa = (n: number | null): string => (n === null ? '—' : n.toFixed(2));
  const remainder = data.extractedCount - data.total;

  return (
    <Section
      title="Course list"
      description={`${data.total} of ${data.extractedCount} curriculum courses with graded class data${
        remainder > 0
          ? ` (${remainder} course${remainder === 1 ? '' : 's'} on the curriculum have no graded sections in the selected semesters)`
          : ''
      }. Extracted via ${data.methodVersion}. Class GPA is credit-weighted across every section taught of each course; coloured cell = high (green) → low (red).`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-text-tertiary">Semesters:</span>
        {COURSE_SEM_OPTIONS.map((s) => {
          const active = selectedSemesters.includes(s.value);
          return (
            <button
              key={s.value}
              onClick={() => {
                setSelectedSemesters((prev) =>
                  prev.includes(s.value)
                    ? prev.filter((x) => x !== s.value)
                    : [...prev, s.value].sort(),
                );
              }}
              className={
                'rounded border px-2 py-0.5 text-[11px] ' +
                (active
                  ? 'border-accent-default bg-accent-subtle text-accent-default'
                  : 'border-border-subtle text-text-secondary hover:bg-surface-2')
              }
            >
              {s.label}
            </button>
          );
        })}
        {loading && <span className="ml-1 text-[11px] italic text-text-tertiary">refreshing…</span>}
      </div>

      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-text-tertiary">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Course code</th>
              <th className="px-3 py-2 text-left font-medium">Title</th>
              <th className="px-3 py-2 text-right font-medium">Cr</th>
              <th className="px-3 py-2 text-right font-medium">Sections</th>
              <th className="px-3 py-2 text-right font-medium">Students</th>
              <th className="px-3 py-2 text-right font-medium">All-year GPA</th>
              {data.yearsObserved.map((y) => (
                <th key={y} className="px-3 py-2 text-right font-medium font-mono">
                  BE {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((c) => (
              <tr key={c.courseCode} className="border-t border-border-subtle">
                <td className="px-3 py-1.5 font-mono text-text-secondary">{c.courseCode}</td>
                <td className="px-3 py-1.5">
                  <span className="text-text-primary">{c.courseNameTh || c.courseNameEn || '—'}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                  {c.credits ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                  {c.classCount.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right font-tabular tabular-nums">
                  {c.gradedCount.toLocaleString()}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <span
                    className="inline-block rounded px-2 py-0.5 font-tabular font-semibold tabular-nums text-text-primary"
                    style={{
                      background: courseGpaHeat(c.classGpa),
                      minWidth: '3.2rem',
                      textAlign: 'right',
                    }}
                    title={`Class GPA ${c.classGpa.toFixed(3)}`}
                  >
                    {fmtGpa(c.classGpa)}
                  </span>
                </td>
                {data.yearsObserved.map((y) => {
                  const cell = c.byYear[String(y)];
                  return (
                    <td key={y} className="px-3 py-1.5 text-right">
                      <span
                        className="inline-block rounded px-2 py-0.5 font-tabular font-semibold tabular-nums text-text-primary"
                        style={{
                          background: courseGpaHeat(cell?.averageClassGpa ?? null),
                          minWidth: '3rem',
                          textAlign: 'right',
                        }}
                        title={
                          cell?.averageClassGpa !== null && cell !== undefined
                            ? `BE ${y}: GPA ${cell.averageClassGpa!.toFixed(3)} · ${cell.classCount} section${cell.classCount === 1 ? '' : 's'} · ${cell.gradedCount.toLocaleString()} graded`
                            : `BE ${y}: no graded data`
                        }
                      >
                        {fmtGpa(cell?.averageClassGpa ?? null)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── Google Scholar source composition ────────────────────────────────────
//
// `ResearchOutput` has two writers. The library pipeline (`kku-research`,
// mirroring Scopus + PubMed) imports on a schedule for everyone; the Google
// Scholar runner imports ON DEMAND, for one person, when they press a button.
// So a research figure over a roster can move without the underlying research
// changing — Council-readiness rule 1 says the drawer must state the mix.
//
// The WORDING lives in `@kku/shared/scholar/disclosure`, not here. It is the
// same sentence the print view, the Gotenberg `program-detail` PDF and the
// AUN-QA evidence pack print, and those are the copies that reach Council;
// four hand-written variants would be four caveats that drift. That module is
// a published client-safe subpath (pure strings, no `node:*`) — importing the
// `@kku/shared` root barrel from this file would pull `node:crypto` into the
// browser bundle and break the build.
//
// `kind` is passed per call site because only the call site knows whether its
// figure is citation-weighted. `countedInFigure: false` does NOT mean Scholar
// has no effect: an import also raises citations on existing LIBRARY rows,
// which keep their ingestion-run provenance and so still reach the
// research-expertise analysis that filters Scholar rows out.
function scholarProvenance(
  composition: DeepDiveFaculty['researchSourceComposition'] | null,
  kind: ScholarFigureKind,
): {
  sourceComposition?: {
    label: string;
    staffCovered: number;
    staffTotal: number;
    papersCovered: number;
    papersTotal: number;
    denominator: string;
    countedInFigure: boolean;
  };
  caveats?: string[];
} {
  if (!composition) return {};
  return {
    sourceComposition: {
      label: SCHOLAR_SOURCE_LABEL,
      staffCovered: composition.staffOnScholar,
      staffTotal: composition.staffWithResearch,
      papersCovered: composition.papersFromScholar,
      papersTotal: composition.papersTotal,
      denominator: composition.denominator,
      countedInFigure: kind === 'counts-scholar-rows',
    },
    caveats: [scholarCaveat(composition, kind)],
  };
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
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs uppercase tracking-wide text-text-tertiary">Publications</div>
            <ProvenanceButton
              size="xs"
              title="Publications across the teaching staff"
              meta={{
                freshnessDate: null,
                sources: [
                  { id: 'kku-research', name: 'KKU Publications mirror (Scopus + PubMed)' },
                  { id: 'google-scholar', name: 'Google Scholar, imported on demand by staff' },
                ],
                ...scholarProvenance(data.researchSourceComposition, 'counts-scholar-rows'),
              }}
            />
          </div>
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

// Demonstrated research expertise (program-research-expertise.v1) — the
// roster's last-10-years publications, clustered into evidenced themes
// with three lanes of grounded recommendations. Pre-computed during the
// per-program pipeline / `pnpm expertise:generate`, same posture as the
// strategic narrative above: the deep-dive reads a persisted row, it
// never triggers generation on page load.
const RESEARCH_TREND_TONE: Record<'rising' | 'steady' | 'fading', 'success' | 'neutral' | 'warning'> = {
  rising: 'success',
  steady: 'neutral',
  fading: 'warning',
};

function ResearchExpertiseSection({
  data,
  composition,
}: {
  data: DeepDiveResearchExpertise | null;
  composition: DeepDiveFaculty['researchSourceComposition'] | null;
}) {
  if (!data) {
    return <EmptyCard title="Research expertise" note="Research expertise data unavailable." />;
  }

  const { result, readiness } = data;

  // Three distinct empty reasons — a Council reader needs to know WHICH
  // one applies (no roster to analyse vs. roster too thin vs. simply
  // hasn't run yet), not just "no data".
  if (!result) {
    let description: string;
    if (!readiness || readiness.readiness === 'no-roster') {
      description =
        'No curated faculty roster yet — run pnpm programs:extract-faculty <code> to link teaching staff before a research-expertise brief can be generated.';
    } else if (readiness.readiness === 'thin') {
      description = `Only ${readiness.distinctPaperCount} paper${readiness.distinctPaperCount === 1 ? '' : 's'} found for this roster in the last 10 years — below the analysis threshold (10).`;
    } else {
      description = 'Not yet analysed — run pnpm expertise:generate --only <code> to generate the brief.';
    }
    return (
      <Section id="research-expertise" title="Research expertise">
        <Card>
          <EmptyState title="Research expertise" description={description} />
        </Card>
      </Section>
    );
  }

  const { payload } = result;

  return (
    <Section id="research-expertise" title="Research expertise">
      <Card padding="sm" tone="quiet" className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          <span>{result.methodVersion}</span>
          <ConfidenceBadge value={payload.confidence} />
          <FreshnessBadge freshnessDate={result.generatedAt} label="brief generated" />
          <ProvenanceButton
            size="xs"
            title="Research expertise"
            meta={{
              freshnessDate: result.generatedAt,
              sources: [
                { id: 'kku-research', name: 'KKU Publications mirror (Scopus + PubMed)' },
                { id: 'program-faculty', name: 'Curated program faculty roster' },
              ],
              confidence: payload.confidence,
              methodologyVersion: result.methodVersion,
              ...scholarProvenance(composition, 'excludes-rows-citation-weighted'),
            }}
          />
        </div>
        {readiness && (
          <span className="text-xs text-text-tertiary">
            Roster: <span className="font-tabular">{readiness.rosterSize}</span> · Distinct papers
            (10y): <span className="font-tabular">{readiness.distinctPaperCount}</span>
          </span>
        )}
        {/* v2 basis statement: theme paperCounts are counts WITHIN the
            analysed set, never full-roster estimates — say so where the
            numbers are read. */}
        <span className="text-xs text-text-tertiary">
          Theme counts refer to the{' '}
          <span className="font-tabular">{result.analysedPaperCount}</span> most significant papers
          analysed
          {result.totalDistinctPapers > result.analysedPaperCount && (
            <> (of <span className="font-tabular">{result.totalDistinctPapers}</span> total)</>
          )}
          .
        </span>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {payload.themes.map((t) => (
          <Card key={t.name} padding="md">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-text-primary">{t.name}</h4>
              <Badge tone={RESEARCH_TREND_TONE[t.trend]} size="sm">
                {t.trend}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-text-tertiary">
              <span className="font-tabular">{t.paperCount}</span> paper{t.paperCount === 1 ? '' : 's'} ·{' '}
              {t.yearSpan}
            </div>
            <p className="mt-2 text-sm text-text-secondary">{t.evidenceNote}</p>
            <ul className="mt-2 flex flex-col gap-1 border-t border-border-subtle pt-2">
              {t.exampleTitles.map((title) => (
                <li key={title} className="text-xs italic text-text-tertiary">
                  &ldquo;{title}&rdquo;
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ResearchRecommendationLane title="Curriculum" items={payload.recommendations.curriculum} />
        <ResearchRecommendationLane title="Positioning" items={payload.recommendations.positioning} />
        <ResearchRecommendationLane title="Research strategy" items={payload.recommendations.research} />
      </div>

      {payload.caveats.length > 0 && (
        <Card padding="sm" tone="quiet">
          <ul className="flex flex-col gap-1">
            {payload.caveats.map((c) => (
              <li key={c} className="text-xs text-text-tertiary">
                {c}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

function ResearchRecommendationLane({
  title,
  items,
}: {
  title: string;
  items: DeepDiveResearchExpertiseRecommendation[];
}) {
  return (
    <Card padding="md">
      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
      {items.length === 0 ? (
        <p className="text-xs text-text-tertiary">No recommendations.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.action} className="text-sm">
              <div className="font-medium text-text-primary">{r.action}</div>
              <div className="mt-0.5 text-xs text-text-secondary">{r.rationale}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-text-tertiary">
                <span className="font-tabular">{r.horizonMonths}mo horizon</span>
                {r.themeRefs.map((ref) => (
                  <Badge key={ref} tone="neutral" size="sm">
                    {ref}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Course-level curriculum advice derived from the programme's own research
// (program-curriculum-revision.v1). Sits BELOW the research section, whose
// three-lane strip stays as the programme-level summary it already is.
//
// A draft for a curriculum committee to edit — never a decision. Every
// course named here is guaranteed to exist: the runner drops any
// recommendation citing a course outside the programme's real course list.
function CurriculumRevisionSection({
  data,
  composition,
}: {
  data: DeepDiveCurriculumRevision | null;
  composition: DeepDiveFaculty['researchSourceComposition'] | null;
}) {
  if (!data) {
    return (
      <EmptyCard
        title="Curriculum revision"
        note="Curriculum revision advice unavailable."
      />
    );
  }

  const { result, readiness } = data;

  // FOUR distinct empty reasons, four distinct messages. Conflating any
  // two of them misleads: "we have nothing to derive this from" and "it
  // simply has not been generated yet" call for different actions, and
  // neither is a finding about the curriculum. Same discipline as the
  // research-expertise section above.
  if (!result) {
    let description: string;
    if (readiness.readiness === 'no-research') {
      description =
        'No research-expertise analysis exists for this programme, so there is nothing to derive course-level advice from. Run pnpm expertise:generate --only <code> first.';
    } else if (readiness.readiness === 'no-courses') {
      description =
        'No course list has been extracted for this programme, so there are no courses to advise on. Run pnpm programs:extract-courses <code>.';
    } else {
      description = `Analysable, but not generated yet — run pnpm curriculum:revision-generate --program <code>. On file for this programme: ${readiness.courseCount} course${readiness.courseCount === 1 ? '' : 's'}, and ${readiness.distinctPaperCount} distinct paper${readiness.distinctPaperCount === 1 ? '' : 's'} behind the research analysis.`;
    }
    return (
      <Section id="curriculum-revision" title="Curriculum revision">
        <Card>
          <EmptyState title="Curriculum revision" description={description} />
        </Card>
      </Section>
    );
  }

  const { payload, generatedAt, methodVersion, coursesWithCategory } = result;

  return (
    <Section
      id="curriculum-revision"
      title="Curriculum revision"
      description="Where this programme's own research strength is not yet reflected in its courses. A draft for a curriculum committee to edit, not a decision."
      actions={
        <div className="flex items-center gap-2">
          <ConfidenceBadge value={payload.confidence} />
          <FreshnessBadge freshnessDate={generatedAt} label="advice generated" />
          <ProvenanceButton
            title="Curriculum revision"
            meta={{
              freshnessDate: generatedAt,
              sources: [
                { id: 'kku-research', name: 'KKU Publications mirror (kku-research)' },
                { id: 'program-courses', name: 'Curriculum PDF course extraction' },
                { id: 'program-faculty', name: 'Curated program faculty roster' },
              ],
              confidence: payload.confidence,
              methodologyVersion: methodVersion,
              ...scholarProvenance(composition, 'excludes-rows-citation-weighted'),
            }}
          />
        </div>
      }
    >
      <Card padding="md">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-text-primary">
            <span className="font-tabular">{payload.coverageSummary.themesReflectedInCurriculum}</span>
            {' of '}
            <span className="font-tabular">{payload.coverageSummary.themesTotal}</span>
            {' research themes'}
          </span>
          <span className="text-xs text-text-tertiary">
            are reflected in the current curriculum
          </span>
        </div>
        <p className="mt-2 text-sm text-text-secondary">{payload.coverageSummary.narrative}</p>
        {payload.coverageSummary.themesAbsent.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-text-tertiary">
              Not represented in any course:
            </span>
            {payload.coverageSummary.themesAbsent.map((t) => (
              <Badge key={t} tone="warning" size="sm">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {payload.enhanceCourses.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">
            Enhance existing courses
          </h4>
          <div className="flex flex-col gap-3">
            {payload.enhanceCourses.map((e) => (
              <Card key={`${e.courseCode}-${e.addition}`} padding="md">
                {/* WHICH course — code and Thai name lead the card. */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-text-tertiary">{e.courseCode}</span>
                  <span className="text-sm font-medium text-text-primary" lang="th">
                    {e.courseNameTh}
                  </span>
                  <Badge tone="neutral" size="sm">
                    {e.effort.toLowerCase()} effort
                  </Badge>
                </div>
                {/* WHAT IT TEACHES NOW — verbatim from the course's own
                    Thai description; blank when the validator could not
                    confirm the quote, in which case say nothing at all
                    rather than paraphrase it back. */}
                {e.currentlyCoversQuote && (
                  <div className="mt-2">
                    <span className="text-xs text-text-tertiary">Currently covers</span>
                    <p
                      className="mt-0.5 border-l-2 border-border-subtle pl-3 text-xs italic text-text-tertiary"
                      lang="th"
                    >
                      &ldquo;{e.currentlyCoversQuote}&rdquo;
                    </p>
                  </div>
                )}
                {/* WHAT TO ADD. */}
                <div className="mt-3">
                  <span className="text-xs text-text-tertiary">Proposed addition</span>
                  <p className="mt-0.5 text-sm font-medium text-text-primary">{e.addition}</p>
                  {e.additionDetail && (
                    <p className="mt-1 text-sm text-text-secondary">{e.additionDetail}</p>
                  )}
                </div>
                {/* WHY — the research theme this closes, then the papers. */}
                {e.themeRefs.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-text-tertiary">
                      Research theme not yet reflected:
                    </span>
                    {e.themeRefs.map((t) => (
                      <Badge key={t} tone="neutral" size="sm">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                {e.evidencePaperTitles.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-text-tertiary">
                      Evidence — <span className="font-tabular">{e.evidencePaperTitles.length}</span>{' '}
                      paper{e.evidencePaperTitles.length === 1 ? '' : 's'} by this programme&rsquo;s
                      own staff
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-border-subtle pl-3">
                      {e.evidencePaperTitles.map((t) => (
                        <li key={t} className="text-xs italic text-text-tertiary">
                          &ldquo;{t}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {payload.newCourseProposals.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">New course proposals</h4>
          <div className="flex flex-col gap-3">
            {payload.newCourseProposals.map((n) => (
              <Card key={n.titleTh} padding="md">
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-medium text-text-primary" lang="th">
                    {n.titleTh}
                  </span>
                  {n.titleEn && <span className="text-xs text-text-tertiary">{n.titleEn}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
                  <span>
                    <span className="font-tabular">{n.credits}</span> credits
                  </span>
                  <span>
                    Year <span className="font-tabular">{n.placementYear}</span>, semester{' '}
                    <span className="font-tabular">{n.placementSemester}</span>
                  </span>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{n.rationale}</p>
                {n.couldBeTaughtBy.length > 0 && (
                  <p className="mt-2 text-xs text-text-tertiary">
                    Could be taught by:{' '}
                    {n.couldBeTaughtBy
                      .map((f) => `${f.name}${f.rank ? ` (${f.rank})` : ''}`)
                      .join(', ')}
                  </p>
                )}
                {n.themeRefs.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-text-tertiary">Research theme:</span>
                    {n.themeRefs.map((t) => (
                      <Badge key={t} tone="neutral" size="sm">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
                {n.evidencePaperTitles.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-text-tertiary">
                      Evidence — <span className="font-tabular">{n.evidencePaperTitles.length}</span>{' '}
                      paper{n.evidencePaperTitles.length === 1 ? '' : 's'} by this programme&rsquo;s
                      own staff
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5 border-l-2 border-border-subtle pl-3">
                      {n.evidencePaperTitles.map((t) => (
                        <li key={t} className="text-xs italic text-text-tertiary">
                          &ldquo;{t}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Promotion needs course-category data. Until the category-aware
          extractor has run, EVERY course is category-unknown and the
          validator drops every promotion candidate — so an absent section
          would read as "the model found nothing to promote" when the truth
          is "we cannot answer this question yet". Say which. */}
      {payload.promotionCandidates.length === 0 && coursesWithCategory === 0 && (
        <Card padding="sm" tone="quiet">
          <p className="text-xs text-text-tertiary">
            Elective-to-core promotion needs each course&rsquo;s curriculum category
            (บังคับ / เลือก), which has not been extracted for this programme yet. This is a
            missing input, not a finding that no course qualifies.
          </p>
        </Card>
      )}

      {payload.promotionCandidates.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Promotion candidates</h4>
          <div className="flex flex-col gap-3">
            {payload.promotionCandidates.map((p) => (
              <Card key={p.courseCode} padding="md">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-xs text-text-tertiary">{p.courseCode}</span>
                  <span className="text-sm font-medium text-text-primary" lang="th">
                    {p.courseNameTh}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  {p.currentCategory} &rarr; {p.proposedCategory}
                </p>
                <p className="mt-2 text-sm text-text-secondary">{p.rationale}</p>
                {p.themeRefs.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-xs text-text-tertiary">Research theme:</span>
                    {p.themeRefs.map((t) => (
                      <Badge key={t} tone="neutral" size="sm">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {payload.caveats.length > 0 && (
        <Card padding="sm" tone="quiet">
          <ul className="flex flex-col gap-1">
            {payload.caveats.map((c) => (
              <li key={c} className="text-xs text-text-tertiary">
                {c}
              </li>
            ))}
          </ul>
        </Card>
      )}
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
  labour_market_alignment: 'Labour-market alignment (LinkedIn · global, 25%)',
  labour_market_alignment_kmitl: 'Labour-market alignment (LinkedIn · MHESI)',
  jobthai_demand_alignment: 'Job-posting demand match (JobThai · domestic, 75%)',
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
                  {row.key === 'relevance' &&
                    ' JobThai (domestic) and LinkedIn (global) demand are weighted 75:25 within their share; when one has no data the other takes it all.'}
                </p>
                <ul className="flex flex-col gap-1.5">
                  {row.cell.drivers.map((d, i) => (
                    <li key={i} className="rounded bg-surface-2/50 p-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-medium text-text-primary">
                          <DriverSourceMark label={d.label} size={14} />
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
  kmitlAlignmentPct: 'LinkedIn labour-market alignment %',
  // strategic_sector_alignment driver — `targetedCareers` is the
  // count of LinkedIn-via-MHESI career groups this program is
  // mapped to (see health-score.ts).
  targetedCareers: 'Targeted careers (LinkedIn)',
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

// ──────────────────────────────────────────────────────────────────────────
// Recruitment funnel — full TCAS round 1–4 from POWERBI.ADMISSION_STAT_CURRID.
// Distinct from the older TcasStatsSection (TCAS3 + peer comparison only).
// ──────────────────────────────────────────────────────────────────────────

function RecruitmentSection({ data }: { data: DeepDiveRecruitment | null }) {
  if (!data || data.byYear.length === 0) {
    return (
      <Section id="recruitment" title="Recruitment funnel (TCAS rounds 1–4)">
        <Card padding="md">
          <p className="text-sm text-text-tertiary">
            No recruitment data — this program isn&apos;t listed in
            POWERBI.ADMISSION_STAT_CURRID, or its CURR_ID couldn&apos;t be
            mapped to a Program record.
          </p>
        </Card>
      </Section>
    );
  }

  const latestComplete = data.byYear.find((y) => y.isComplete) ?? null;
  const inProgress = data.byYear.find((y) => !y.isComplete) ?? null;

  return (
    <Section id="recruitment" title="Recruitment funnel (TCAS rounds 1–4)">
      <div className="flex flex-col gap-4">
        {inProgress && (
          <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
            <div className="font-semibold text-info">
              BE {inProgress.entryYearBE} (CE {inProgress.entryYearCE}) — recruitment in progress
            </div>
            <div className="mt-1 text-text-secondary">
              <span className="font-tabular">{inProgress.totalApplicants.toLocaleString()}</span>{' '}
              applicants for <span className="font-tabular">{inProgress.planPerYear ?? '—'}</span>{' '}
              planned seats so far.{' '}
              {inProgress.regReported > 0 && (
                <>
                  <span className="font-tabular">{inProgress.regReported.toLocaleString()}</span>{' '}
                  reported in to date (
                  {inProgress.fillRateVsPlan !== null
                    ? `${(inProgress.fillRateVsPlan * 100).toFixed(0)} % of plan`
                    : 'plan unknown'}
                  ).
                </>
              )}{' '}
              Numbers update as later rounds run; not used for health-score scoring.
            </div>
          </div>
        )}

        {/* KPI strip — latest complete year */}
        {latestComplete && (
          <Card padding="md">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">
                Latest complete cohort — BE {latestComplete.entryYearBE}{' '}
                <span className="text-text-tertiary">(CE {latestComplete.entryYearCE})</span>
              </h3>
              <span className="text-xs text-text-tertiary">
                {latestComplete.rounds} round{latestComplete.rounds === 1 ? '' : 's'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <RecruitmentTile
                label="Plan / yr"
                value={latestComplete.planPerYear?.toLocaleString() ?? '—'}
                sub="annual target"
              />
              <RecruitmentTile
                label="Allocated"
                value={latestComplete.enrollSeats.toLocaleString()}
                sub={
                  latestComplete.overAllocationFactor
                    ? `${latestComplete.overAllocationFactor.toFixed(2)}× over-alloc`
                    : 'sum across rounds'
                }
              />
              <RecruitmentTile
                label="Applicants"
                value={latestComplete.totalApplicants.toLocaleString()}
                sub={
                  latestComplete.competitionRatio
                    ? `${latestComplete.competitionRatio.toFixed(1)}× competition`
                    : undefined
                }
              />
              <RecruitmentTile
                label="Passed"
                value={latestComplete.totalPassed.toLocaleString()}
                sub="cleared the round cut"
              />
              <RecruitmentTile
                label="Confirm CH"
                value={latestComplete.confirmClearinghouse.toLocaleString()}
                sub="accepted the offer"
              />
              <RecruitmentTile
                label="Reported in"
                value={latestComplete.regReported.toLocaleString()}
                sub={
                  latestComplete.fillRateVsPlan !== null
                    ? `${(latestComplete.fillRateVsPlan * 100).toFixed(0)} % of plan`
                    : undefined
                }
                tone={
                  latestComplete.fillRateVsPlan === null
                    ? undefined
                    : latestComplete.fillRateVsPlan >= 1
                      ? 'positive'
                      : latestComplete.fillRateVsPlan >= 0.85
                        ? 'warning'
                        : 'danger'
                }
              />
            </div>
          </Card>
        )}

        {/* Per-year history table */}
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-4 py-2 text-left">BE year</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Plan</th>
                  <th className="px-4 py-2 text-right">Allocated</th>
                  <th className="px-4 py-2 text-right">Over-alloc</th>
                  <th className="px-4 py-2 text-right">Applicants</th>
                  <th className="px-4 py-2 text-right">Comp. ratio</th>
                  <th className="px-4 py-2 text-right">Passed</th>
                  <th className="px-4 py-2 text-right">Confirm CH</th>
                  <th className="px-4 py-2 text-right">Reported in</th>
                  <th className="px-4 py-2 text-right">vs Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.byYear.map((y) => {
                  const planClass =
                    y.fillRateVsPlan === null
                      ? ''
                      : y.fillRateVsPlan >= 1
                        ? 'text-positive'
                        : y.fillRateVsPlan >= 0.85
                          ? 'text-warning'
                          : 'text-danger';
                  return (
                    <tr key={y.entryYearBE} className={y.isComplete ? '' : 'opacity-70'}>
                      <td className="px-4 py-2 font-tabular font-semibold">
                        {y.entryYearBE}{' '}
                        <span className="text-xs text-text-tertiary">(CE {y.entryYearCE})</span>
                      </td>
                      <td className="px-4 py-2">
                        {y.isComplete ? (
                          <Badge tone="success">complete</Badge>
                        ) : (
                          <Badge tone="info">in progress</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.planPerYear?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.enrollSeats.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular text-text-tertiary">
                        {y.overAllocationFactor
                          ? `${y.overAllocationFactor.toFixed(2)}×`
                          : '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.totalApplicants.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.competitionRatio === null
                          ? '—'
                          : `${y.competitionRatio.toFixed(1)}×`}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.totalPassed.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.confirmClearinghouse.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {y.regReported.toLocaleString()}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-tabular font-semibold ${planClass}`}
                      >
                        {y.fillRateVsPlan === null
                          ? '—'
                          : `${(y.fillRateVsPlan * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Per-round breakdown for the latest complete year */}
        {data.latestRounds && (
          <Card padding="none">
            <header className="border-b border-border-subtle px-4 py-2 text-xs uppercase tracking-wide text-text-tertiary">
              Round-by-round breakdown — BE {data.latestRounds.entryYearBE}
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-4 py-2 text-left">Round</th>
                    <th className="px-4 py-2 text-right">Allocated</th>
                    <th className="px-4 py-2 text-right">Applicants</th>
                    <th className="px-4 py-2 text-right">Passed</th>
                    <th className="px-4 py-2 text-right">Send CH</th>
                    <th className="px-4 py-2 text-right">Confirm CH</th>
                    <th className="px-4 py-2 text-right">Send Reg</th>
                    <th className="px-4 py-2 text-right">Reported in</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.latestRounds.rounds.map((r) => (
                    <tr key={r.round}>
                      <td className="px-4 py-2 font-tabular font-semibold">{r.round}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.enrollSeats ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.totalApplicants ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.totalPassed ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.sendClearinghouse ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.confirmClearinghouse ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.sendRegReported ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-tabular">{r.regReported ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Section>
  );
}

function RecruitmentTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'positive' | 'warning' | 'danger';
}) {
  const valueClass =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-text-primary';
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-1 p-3">
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`font-tabular text-xl font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-tertiary">{sub}</p>}
    </div>
  );
}

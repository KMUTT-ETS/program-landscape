import { notFound, redirect } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import type {
  DeepDiveAiPeers,
  DeepDiveAiReadiness,
  DeepDiveDecisions,
  DeepDiveDemandFunnel,
  DeepDiveDemographicOutlook,
  DeepDiveFaculty,
  DeepDiveFinancials,
  DeepDiveLifecycle,
  DeepDiveOutcomes,
  DeepDiveOverview,
  DeepDivePeers,
  DeepDiveRecruitment,
  DeepDiveSkills,
  DeepDiveStrategicNarrative,
  DeepDiveStudentCohorts,
  DeepDiveTcasStats,
  DeepDiveTrends,
} from '../types';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program detail report — print' };

// ---------------------------------------------------------------------------
// Comprehensive A4 detail document for a single program. Designed to print
// cleanly (`Ctrl/Cmd+P`) and to be saved as a coloured PDF for internal
// circulation. NOT the formal Council Pack — this is the analyst-facing
// working document that bundles every deep-dive section into one cohesive
// professional layout.
//
// Visual language: warm-neutral page stock, KKU cardinal accent on the
// header band, status-tone (success / warning / danger) for risk cells,
// chart palette for categorical fills. All colours come from design
// tokens. `print-color-adjust: exact` ensures the printer keeps them.
// ---------------------------------------------------------------------------

export default async function ProgramPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const { id } = await params;
  const [
    overview,
    lifecycle,
    strategicNarrative,
    aiReadiness,
    demandFunnel,
    studentCohorts,
    tcasStats,
    recruitment,
    demographicOutlook,
    outcomes,
    skills,
    faculty,
    financials,
    peers,
    aiPeers,
    trends,
    decisions,
  ] = await Promise.all([
    apiFetch<DeepDiveOverview>(`/programs/${id}/overview`).catch(() => null),
    apiFetch<DeepDiveLifecycle>(`/programs/${id}/lifecycle`).catch(() => null),
    apiFetch<DeepDiveStrategicNarrative>(`/programs/${id}/strategic-narrative`).catch(() => null),
    apiFetch<DeepDiveAiReadiness>(`/programs/${id}/ai-readiness`).catch(() => null),
    apiFetch<DeepDiveDemandFunnel>(`/programs/${id}/demand-funnel`).catch(() => null),
    apiFetch<DeepDiveStudentCohorts>(`/programs/${id}/student-cohorts`).catch(() => null),
    apiFetch<DeepDiveTcasStats>(`/programs/${id}/tcas-stats`).catch(() => null),
    apiFetch<DeepDiveRecruitment>(`/programs/${id}/recruitment`).catch(() => null),
    apiFetch<DeepDiveDemographicOutlook>(`/programs/${id}/demographic-outlook`).catch(() => null),
    apiFetch<DeepDiveOutcomes>(`/programs/${id}/outcomes`).catch(() => null),
    apiFetch<DeepDiveSkills>(`/programs/${id}/skills`).catch(() => null),
    apiFetch<DeepDiveFaculty>(`/programs/${id}/faculty`).catch(() => null),
    apiFetch<DeepDiveFinancials>(`/programs/${id}/financials`).catch(() => null),
    apiFetch<DeepDivePeers>(`/programs/${id}/peers`).catch(() => null),
    apiFetch<DeepDiveAiPeers>(`/programs/${id}/ai-peers`).catch(() => null),
    apiFetch<DeepDiveTrends>(`/programs/${id}/trends`).catch(() => null),
    apiFetch<DeepDiveDecisions>(`/programs/${id}/decisions`).catch(() => null),
  ]);
  if (!overview) notFound();

  const generatedAt = new Date();
  const generatedAtLabel = generatedAt.toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  return (
    <main className="mx-auto max-w-[210mm] bg-surface-1 text-text-primary print:mx-0 print:max-w-none">
      <PrintStyles />
      <CoverBand
        overview={overview}
        generatedAtLabel={generatedAtLabel}
      />
      <HeroKpiStrip
        overview={overview}
        lifecycle={lifecycle}
        aiReadiness={aiReadiness}
        financials={financials}
        outcomes={outcomes}
      />
      <ToolbarStrip />

      <div className="mx-auto flex max-w-[186mm] flex-col gap-5 px-4 pb-8 print:max-w-none print:gap-4 print:px-0">
        {/* MACRO 1 · Executive snapshot ----------------------------------- */}
        <MacroBand title="Executive snapshot" />
        <HealthDimensionsBlock overview={overview} />
        {lifecycle && <LifecycleVerdictBlock data={lifecycle} />}
        {strategicNarrative && <StrategicNarrativeBlock data={strategicNarrative} />}
        {aiReadiness && <AiReadinessBlock data={aiReadiness} />}

        {/* MACRO 2 · Admissions ------------------------------------------- */}
        <MacroBand title="Admissions" pageBreakBefore />
        {recruitment && recruitment.byYear.length > 0 && (
          <RecruitmentBlock data={recruitment} />
        )}
        {tcasStats && tcasStats.history.length > 0 && <TcasBlock data={tcasStats} />}

        {/* MACRO 3 · Students --------------------------------------------- */}
        <MacroBand title="Students" pageBreakBefore />
        {studentCohorts && studentCohorts.cohorts.length > 0 && (
          <CohortsBlock data={studentCohorts} />
        )}
        {demandFunnel && <DemandFunnelBlock data={demandFunnel} />}
        {demographicOutlook && <DemographicBlock data={demographicOutlook} />}

        {/* MACRO 4 · Outcomes --------------------------------------------- */}
        <MacroBand title="Outcomes" pageBreakBefore />
        {outcomes && outcomes.latest && <OutcomesBlock data={outcomes} />}

        {/* MACRO 5 · Curriculum & Faculty --------------------------------- */}
        <MacroBand title="Curriculum & Faculty" pageBreakBefore />
        {skills && <SkillsBlock data={skills} />}
        {faculty && <FacultyBlock data={faculty} />}

        {/* MACRO 6 · Financials ------------------------------------------- */}
        <MacroBand title="Financials" pageBreakBefore />
        {financials && financials.waterfall.length > 0 && (
          <FinancialsBlock data={financials} />
        )}

        {/* External context (Peers + Trends) removed from the print
            view in v1.2.7 — those live on /benchmarking and /trends.
            Decisions still print as a standalone macro band below. */}
        {decisions && decisions.decisions.length > 0 && (
          <>
            <MacroBand title="Decisions" pageBreakBefore />
            <DecisionsBlock data={decisions} />
          </>
        )}

        <FooterBand
          overview={overview}
          generatedAtLabel={generatedAtLabel}
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Print-only styles.
// ---------------------------------------------------------------------------

function PrintStyles() {
  return (
    <style>{`
      /* Force A4 portrait. Without an explicit "portrait" hint Chromium
         will sometimes default to the user's last-used paper size. */
      @page {
        size: A4 portrait;
        margin: 12mm 12mm 16mm 12mm;
      }
      @media print {
        html, body {
          background: white;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .print-hide { display: none !important; }
        .print-page-break {
          break-before: page;
          page-break-before: always;
        }
        /* Both modern (break-inside) and legacy (page-break-inside) so
           every browser engine keeps the card whole. */
        .print-keep {
          break-inside: avoid;
          page-break-inside: avoid;
          -webkit-column-break-inside: avoid;
        }
        /* Tables and lists inside cards inherit the rule too. */
        .print-keep table,
        .print-keep ul,
        .print-keep ol {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        /* Avoid orphan headings stranded at the bottom of a page. */
        h1, h2, h3, h4, h5 {
          break-after: avoid;
          page-break-after: avoid;
        }
      }
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// Cover banner (KKU brand + program identity).
// ---------------------------------------------------------------------------

const LEVEL_LABEL: Record<DeepDiveOverview['program']['level'], string> = {
  BACHELOR: 'Bachelor',
  MASTER: 'Master',
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Graduate Diploma',
};
const STATUS_TONE: Record<
  DeepDiveOverview['program']['status'],
  { bg: string; text: string; label: string }
> = {
  ACTIVE: { bg: 'bg-success/15', text: 'text-success', label: 'Active' },
  PAUSED: { bg: 'bg-warning/15', text: 'text-warning', label: 'Paused' },
  SUNSET: { bg: 'bg-danger/15', text: 'text-danger', label: 'Sunset' },
};

function CoverBand({
  overview,
  generatedAtLabel,
}: {
  overview: DeepDiveOverview;
  generatedAtLabel: string;
}) {
  const status = STATUS_TONE[overview.program.status];
  return (
    <header className="print-keep mb-3 bg-gradient-to-br from-surface-1 to-surface-2 text-text-primary">
      {/* KKU cardinal stripe */}
      <div className="h-2 w-full bg-danger/85" aria-hidden />
      <div className="mx-auto flex max-w-[186mm] flex-col gap-3 px-4 py-4 print:max-w-none">
        <div className="flex items-center justify-between gap-4 text-[0.65rem] uppercase tracking-[0.18em] text-text-tertiary">
          <span>KKU Curriculum Compass · ทักษทัศน์</span>
          <span>Internal program detail report</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-sm px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide ${status.bg} ${status.text}`}
              >
                {status.label}
              </span>
              <span className="text-xs text-text-tertiary">
                {LEVEL_LABEL[overview.program.level]}
                {overview.program.yearEstablished
                  ? ` · est. ${overview.program.yearEstablished}`
                  : ''}
              </span>
              <span className="font-tabular text-xs text-text-tertiary">
                {overview.program.code}
              </span>
            </div>
            <h1 className="mt-1 text-xl font-bold leading-tight">
              {overview.program.nameTh}
            </h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {overview.program.nameEn}
            </p>
            <p className="mt-1 text-xs text-text-tertiary">
              {overview.program.faculty.nameEn} ({overview.program.faculty.nameTh})
              {overview.program.department ? (
                <>
                  {' '}· {overview.program.department.nameEn} (
                  {overview.program.department.nameTh})
                </>
              ) : null}
            </p>
          </div>
          <div className="text-right text-[0.7rem] text-text-tertiary">
            <div className="uppercase tracking-wide">Report generated</div>
            <div className="font-tabular text-xs text-text-secondary">
              {generatedAtLabel}
            </div>
            <div className="mt-0.5 font-tabular">
              {overview.methodologyVersion}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Hero KPI strip — four headline numbers above the fold.
// ---------------------------------------------------------------------------

function HeroKpiStrip({
  overview,
  lifecycle,
  aiReadiness,
  financials,
  outcomes,
}: {
  overview: DeepDiveOverview;
  lifecycle: DeepDiveLifecycle | null;
  aiReadiness: DeepDiveAiReadiness | null;
  financials: DeepDiveFinancials | null;
  outcomes: DeepDiveOutcomes | null;
}) {
  const overall = overview.health?.overall.score ?? null;
  const overallTone =
    overall === null
      ? 'text-text-tertiary'
      : overall < 40
        ? 'text-danger'
        : overall < 65
          ? 'text-warning'
          : 'text-success';
  const verdictTone: Record<string, string> = {
    SUNSET: 'text-warning',
    STABLE: 'text-text-secondary',
    RISING: 'text-chart-2',
    FRONTIER: 'text-success',
  };
  const aiTone =
    aiReadiness === null
      ? 'text-text-tertiary'
      : aiReadiness.overallScore < 20
        ? 'text-warning'
        : aiReadiness.overallScore < 45
          ? 'text-chart-3'
          : aiReadiness.overallScore < 70
            ? 'text-chart-2'
            : 'text-success';
  const tuition =
    financials?.trend.find((t) => t.year === financials.latestFiscalYear)
      ?.tuitionRevenue ??
    financials?.trend.at(-1)?.tuitionRevenue ??
    null;
  return (
    <div className="print-keep mx-auto max-w-[186mm] px-4 print:max-w-none">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile
          label="Overall health"
          value={overall === null ? '—' : Math.round(overall).toString()}
          valueTone={overallTone}
          subtitle={
            overview.health
              ? `data ${Math.round(overview.health.overall.dataCompletenessPct)}% complete`
              : 'no data'
          }
        />
        <KpiTile
          label="Lifecycle verdict"
          value={lifecycle ? lifecycle.verdict : '—'}
          valueTone={lifecycle ? verdictTone[lifecycle.verdict] ?? '' : 'text-text-tertiary'}
          valueClass="text-xl"
          subtitle={
            lifecycle
              ? `trajectory ${lifecycle.trajectoryScore.toFixed(0)}/100`
              : 'not generated'
          }
        />
        <KpiTile
          label="AI readiness"
          value={
            aiReadiness === null
              ? '—'
              : Math.round(aiReadiness.overallScore).toString()
          }
          valueTone={aiTone}
          subtitle={
            aiReadiness === null
              ? 'no data'
              : aiReadiness.overallScore >= 70
                ? 'strong'
                : aiReadiness.overallScore >= 45
                  ? 'partial'
                  : aiReadiness.overallScore >= 20
                    ? 'low'
                    : 'critical gap'
          }
        />
        <KpiTile
          label="Latest employment rate"
          value={
            outcomes?.latest
              ? `${(outcomes.latest.employmentRate * 100).toFixed(0)}%`
              : '—'
          }
          subtitle={
            outcomes?.latest
              ? `n=${outcomes.latest.sampleSize.toLocaleString('en-US')} · ${outcomes.latest.graduationYear} cohort`
              : 'no survey'
          }
        />
      </div>
      {tuition !== null && financials?.latestFiscalYear !== null && (
        <p className="mt-2 text-[0.7rem] text-text-tertiary">
          FY {financials?.latestFiscalYear ?? '—'} tuition revenue:{' '}
          <span className="font-tabular text-text-secondary">
            {tuition.toLocaleString('en-US')} THB
          </span>
          {financials?.governmentFacultySubsidy !== null && (
            <>
              {' '}· government salary subsidy{' '}
              <span className="font-tabular text-text-secondary">
                {financials?.governmentFacultySubsidy?.toLocaleString('en-US')} THB/yr
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function KpiTile({
  label,
  value,
  subtitle,
  valueTone,
  valueClass,
}: {
  label: string;
  value: string;
  subtitle: string;
  valueTone?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border-subtle bg-surface-0 p-3">
      <span className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <span
        className={`font-tabular font-semibold ${valueClass ?? 'text-3xl'} ${valueTone ?? ''}`}
      >
        {value}
      </span>
      <span className="text-[0.7rem] text-text-tertiary">{subtitle}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar (only shown on screen, hidden when printing).
// ---------------------------------------------------------------------------

function ToolbarStrip() {
  return (
    <div className="print-hide mx-auto mt-2 flex max-w-[186mm] items-center justify-end px-4 py-2">
      <PrintButton />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section shell.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MacroBand — section divider that separates the seven macro-groups in the
// printed report. Forces a page-break-before for groups 2–7 so each
// macro-group starts on a fresh page when printed; appears as a thin
// uppercase eyebrow between blocks on screen.
// ---------------------------------------------------------------------------

function MacroBand({
  title,
  pageBreakBefore = false,
}: {
  title: string;
  pageBreakBefore?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-3 ${
        pageBreakBefore ? 'print-page-break' : ''
      }`}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-accent">
        {title}
      </span>
      <span className="h-px flex-1 bg-border-strong" />
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  accent = 'border-l-accent',
  children,
  pageBreakBefore = false,
}: {
  title: string;
  subtitle?: string;
  accent?: string;
  children: React.ReactNode;
  pageBreakBefore?: boolean;
}) {
  return (
    <section
      className={`print-keep rounded-md border border-border-subtle border-l-4 ${accent} bg-surface-0 ${
        pageBreakBefore ? 'print-page-break' : ''
      }`}
    >
      <header className="border-b border-border-subtle px-4 py-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-primary">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-text-tertiary">{subtitle}</p>
        )}
      </header>
      <div className="px-4 py-3 text-sm">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Block: Health dimensions.
// ---------------------------------------------------------------------------

function HealthDimensionsBlock({ overview }: { overview: DeepDiveOverview }) {
  const h = overview.health;
  if (!h) {
    return (
      <SectionCard title="Health score" subtitle="No health data yet" accent="border-l-border-strong">
        <p className="text-text-tertiary">Health score has not been computed for this program.</p>
      </SectionCard>
    );
  }
  const dims = [
    { key: 'attractiveness' as const, label: 'Attractiveness', cell: h.dimensions.attractiveness },
    { key: 'financial' as const, label: 'Financial', cell: h.dimensions.financial },
    { key: 'capability' as const, label: 'Capability', cell: h.dimensions.capability },
    { key: 'outcomes' as const, label: 'Outcomes', cell: h.dimensions.outcomes },
    { key: 'relevance' as const, label: 'Relevance', cell: h.dimensions.relevance },
  ];
  return (
    <SectionCard
      title="Health score · 5 dimensions"
      subtitle={`Methodology ${h.methodologyVersion}. Equal-weight composite. Missing data is excluded from the average — never substituted with zero.`}
      accent="border-l-accent"
    >
      <div className="grid grid-cols-1 gap-2">
        {dims.map((d) => (
          <HealthDimRow key={d.key} label={d.label} cell={d.cell} />
        ))}
      </div>
    </SectionCard>
  );
}

function HealthDimRow({
  label,
  cell,
}: {
  label: string;
  cell: DeepDiveOverview['health'] extends infer T
    ? T extends { dimensions: { attractiveness: infer C } }
      ? C
      : never
    : never;
}) {
  const score = cell.score;
  const tone =
    score === null
      ? 'bg-border-subtle/40'
      : score < 40
        ? 'bg-danger/65'
        : score < 65
          ? 'bg-warning/65'
          : 'bg-success/65';
  const populated = cell.drivers.filter((d) => d.value !== null);
  return (
    <div className="rounded border border-border-subtle bg-surface-1 p-2.5">
      <div className="grid grid-cols-[10rem_minmax(0,1fr)_5rem_4rem] items-center gap-3">
        <span className="font-medium text-text-primary">{label}</span>
        <div className="relative h-3 overflow-hidden rounded-sm bg-surface-2">
          {score !== null && (
            <div className={`h-full ${tone}`} style={{ width: `${score}%` }} />
          )}
        </div>
        <span
          className={`text-right font-tabular text-xl font-semibold ${
            score === null ? 'text-text-tertiary' : ''
          }`}
        >
          {score === null ? '—' : Math.round(score)}
        </span>
        <span className="text-right text-[0.7rem] text-text-tertiary">
          data {Math.round(cell.dataCompletenessPct)}%
        </span>
      </div>
      {populated.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem] text-text-tertiary">
          {populated.slice(0, 8).map((d, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">{driverLabel(d.label)}</span>
              <span className="font-tabular text-text-secondary">
                {d.value === null ? '—' : Math.round(d.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const DRIVER_LABELS: Record<string, string> = {
  tcas_competition_vs_peers: 'TCAS competition vs peers',
  tcas_fill_rate: 'TCAS fill rate',
  enrollment_trend_slope: 'Enrolment trend (3-yr slope)',
  kku_intake_policy: 'KKU intake-floor policy',
  net_contribution_per_student: 'Net contribution / student',
  tuition_revenue_trend: 'Tuition revenue trend',
  cost_per_student_vs_peers: 'Cost / student vs peers',
  senior_rank_share: 'Senior-rank faculty share',
  publications_per_faculty: 'Publications per faculty (3 yr)',
  retirement_horizon_5y: '5-yr retirement headroom',
  student_faculty_ratio: 'Student / faculty ratio',
  employment_rate: 'Employment rate',
  job_relevance: 'Job relevance',
  average_salary: 'Average starting salary',
  further_study_rate: 'Further-study share',
  curriculum_modernity: 'Curriculum modernity',
  skill_resilience_vs_ai: 'Skill resilience vs AI',
  ai_research_intensity: 'AI research intensity',
  labour_market_alignment_kmitl: 'Labour-market alignment (LinkedIn · MHESI)',
};
function driverLabel(label: string): string {
  return DRIVER_LABELS[label] ?? label.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Block: Lifecycle verdict.
// ---------------------------------------------------------------------------

function LifecycleVerdictBlock({ data }: { data: DeepDiveLifecycle }) {
  const verdictMeta: Record<
    DeepDiveLifecycle['verdict'],
    { label: string; tagline: string; bg: string; text: string; stripe: string }
  > = {
    SUNSET: {
      label: 'Sunset',
      tagline:
        'Multiple signals declining — closure, merger, or restructure on the table.',
      bg: 'bg-warning/15',
      text: 'text-warning',
      stripe: 'border-l-warning',
    },
    STABLE: {
      label: 'Stable',
      tagline: 'Meeting expectations — hold and monitor.',
      bg: 'bg-border-subtle/50',
      text: 'text-text-secondary',
      stripe: 'border-l-border-strong',
    },
    RISING: {
      label: 'Rising',
      tagline:
        'Improving across multiple signals — fund continued development.',
      bg: 'bg-chart-2/15',
      text: 'text-chart-2',
      stripe: 'border-l-chart-2',
    },
    FRONTIER: {
      label: 'Frontier',
      tagline: 'Leading-edge program, future-defining — showcase and scale.',
      bg: 'bg-success/15',
      text: 'text-success',
      stripe: 'border-l-success',
    },
  };
  const meta = verdictMeta[data.verdict];
  const lifters = data.drivers.filter((d) => d.contribution > 0).slice(0, 5);
  const drags = data.drivers.filter((d) => d.contribution < 0).slice(0, 5);
  const markerPct = Math.max(0, Math.min(100, data.trajectoryScore));
  return (
    <SectionCard
      title="Lifecycle verdict"
      subtitle={`Methodology ${data.methodologyVersion}. Trajectory score is a weighted blend of overall health, growth signals, and demographic resilience.`}
      accent={meta.stripe}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <span
            className={`rounded-md px-3 py-1 text-base font-semibold uppercase tracking-wide ${meta.bg} ${meta.text}`}
          >
            {meta.label}
          </span>
          <span className="ml-3 font-tabular text-sm text-text-tertiary">
            Trajectory {data.trajectoryScore.toFixed(0)}/100
          </span>
          <p className="mt-1 text-xs text-text-tertiary">{meta.tagline}</p>
        </div>
      </div>

      {/* Spectrum bar */}
      <div className="mt-3">
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md text-[0.65rem] uppercase tracking-wide">
          <div className="flex h-6 items-center bg-warning/25 px-2 text-warning">Sunset</div>
          <div className="flex h-6 items-center bg-border-subtle/60 px-2 text-text-secondary">
            Stable
          </div>
          <div className="flex h-6 items-center bg-chart-2/25 px-2 text-chart-2">Rising</div>
          <div className="flex h-6 items-center bg-success/25 px-2 text-success">Frontier</div>
        </div>
        <div className="relative mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-0 ${meta.bg.replace('/15', '/85')}`}
            style={{ left: `${markerPct}%` }}
            aria-hidden
          />
        </div>
        <div className="mt-1 flex justify-between font-tabular text-[0.6rem] text-text-tertiary">
          <span>0</span>
          <span>45</span>
          <span>65</span>
          <span>80</span>
          <span>100</span>
        </div>
      </div>

      <p className="mt-3 text-sm text-text-secondary">{data.narrative}</p>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <DriverColumn title="Lifting forces" rows={lifters} positive />
        <DriverColumn title="Drag forces" rows={drags} positive={false} />
      </div>
    </SectionCard>
  );
}

const DRIVER_PHRASES: Record<string, string> = {
  health_overall: 'Overall health',
  enrollment_trend: 'Enrolment growth',
  tuition_trend: 'Tuition growth',
  content_modernity: 'Curriculum modernity',
  major_content_gaps: 'Major content gaps vs peers',
  demographic_resilience: 'Demographic resilience',
  delayed_graduation_share: 'Delayed-graduation share',
  capability_strength: 'Faculty capability',
  ai_readiness: 'AI readiness',
};

function DriverColumn({
  title,
  rows,
  positive,
}: {
  title: string;
  rows: DeepDiveLifecycle['drivers'];
  positive: boolean;
}) {
  return (
    <div>
      <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        {title}
      </h4>
      {rows.length === 0 ? (
        <p className="text-xs text-text-tertiary">
          {positive ? '(no positive contributors)' : '(no negative contributors)'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((d) => (
            <li
              key={d.label}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-text-secondary">
                {DRIVER_PHRASES[d.label] ?? d.label.replace(/_/g, ' ')}
              </span>
              <span
                className={`font-tabular ${positive ? 'text-success' : 'text-warning'}`}
              >
                {d.contribution > 0 ? '+' : ''}
                {d.contribution.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block: Strategic narrative.
// ---------------------------------------------------------------------------

function StrategicNarrativeBlock({ data }: { data: DeepDiveStrategicNarrative }) {
  return (
    <SectionCard
      title="Strategic narrative"
      subtitle={`AI-authored · ${data.methodVersion} · confidence ${(data.confidence * 100).toFixed(0)}% · generated ${formatDate(data.generatedAt)}`}
      accent="border-l-chart-3"
    >
      <article className="kku-narrative-md text-text-primary">
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
              <p className="my-1.5 text-sm leading-relaxed text-text-secondary">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="my-1.5 ml-5 list-disc space-y-1 text-sm leading-relaxed text-text-secondary">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="my-1.5 ml-5 list-decimal space-y-1 text-sm leading-relaxed text-text-secondary">
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
            blockquote: ({ children }) => (
              <blockquote className="my-2 border-l-2 border-border-strong pl-3 italic text-text-tertiary">
                {children}
              </blockquote>
            ),
            code: ({ children }) => (
              <code className="rounded bg-surface-2 px-1 font-tabular text-xs">{children}</code>
            ),
          }}
        >
          {data.contentMarkdown}
        </ReactMarkdown>
      </article>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: AI readiness.
// ---------------------------------------------------------------------------

function AiReadinessBlock({ data }: { data: DeepDiveAiReadiness }) {
  const total =
    data.skillBreakdown.aiNative +
    data.skillBreakdown.aiAugmented +
    data.skillBreakdown.aiDisplaceable +
    data.skillBreakdown.neutral;
  const verdict =
    data.overallScore >= 70
      ? { label: 'Strong AI readiness', stripe: 'border-l-success' }
      : data.overallScore >= 45
        ? { label: 'Partial AI readiness', stripe: 'border-l-chart-2' }
        : data.overallScore >= 20
          ? { label: 'Low AI readiness', stripe: 'border-l-chart-3' }
          : { label: 'Critical AI gap', stripe: 'border-l-warning' };
  return (
    <SectionCard
      title="AI readiness"
      subtitle={`Methodology ${data.methodologyVersion} · ${verdict.label}. Score is composite of curriculum integration, skill resilience, AI research presence, and pedagogical readiness.`}
      accent={verdict.stripe}
      pageBreakBefore
    >
      <p className="mb-3 text-text-secondary">{data.summary}</p>

      {/* Sub-scores */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <SubScoreTile
          label="Curriculum integration"
          score={data.subScores.curriculumIntegration}
          hint="AI/ML coverage in program skills"
        />
        <SubScoreTile
          label="Skill resilience"
          score={data.subScores.skillResilience}
          hint="AI-augmented vs displaceable balance"
        />
        <SubScoreTile
          label="AI research presence"
          score={data.subScores.researchPresence}
          hint={`${data.aiPublicationsLast3Years}/${data.totalPublicationsLast3Years} publications (3y)`}
        />
        <SubScoreTile
          label="Pedagogical readiness"
          score={data.subScores.pedagogicalReadiness}
          hint={
            data.subScores.pedagogicalReadiness === null
              ? 'data not yet collected'
              : 'how staff and students adopt AI tools'
          }
        />
      </div>

      {/* Skill composition */}
      {total > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            <span>How program skills relate to AI ({total} skills)</span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {data.skillBreakdown.aiNative > 0 && (
              <div
                className="h-full bg-success/70"
                style={{ flexBasis: `${(data.skillBreakdown.aiNative / total) * 100}%` }}
              />
            )}
            {data.skillBreakdown.aiAugmented > 0 && (
              <div
                className="h-full bg-chart-2/70"
                style={{ flexBasis: `${(data.skillBreakdown.aiAugmented / total) * 100}%` }}
              />
            )}
            {data.skillBreakdown.neutral > 0 && (
              <div
                className="h-full bg-border-subtle"
                style={{ flexBasis: `${(data.skillBreakdown.neutral / total) * 100}%` }}
              />
            )}
            {data.skillBreakdown.aiDisplaceable > 0 && (
              <div
                className="h-full bg-warning/70"
                style={{ flexBasis: `${(data.skillBreakdown.aiDisplaceable / total) * 100}%` }}
              />
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[0.7rem] text-text-tertiary">
            <Legend swatch="bg-success/70" label="AI-native" value={data.skillBreakdown.aiNative} />
            <Legend
              swatch="bg-chart-2/70"
              label="AI-augmented"
              value={data.skillBreakdown.aiAugmented}
            />
            <Legend
              swatch="bg-border-subtle"
              label="Neutral"
              value={data.skillBreakdown.neutral}
            />
            <Legend
              swatch="bg-warning/70"
              label="AI-displaceable"
              value={data.skillBreakdown.aiDisplaceable}
            />
          </div>
        </div>
      )}

      {/* Gaps */}
      {data.gaps.length > 0 && (
        <div className="mt-3 rounded border border-border-subtle bg-surface-1 p-2.5">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            AI-readiness gaps ({data.gaps.length})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {data.gaps.slice(0, 6).map((g, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{g.topic}</span>
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[0.65rem] uppercase ${
                      g.severity === 'major'
                        ? 'bg-warning/20 text-warning'
                        : g.severity === 'moderate'
                          ? 'bg-chart-3/20 text-chart-3'
                          : 'bg-border-subtle/50 text-text-tertiary'
                    }`}
                  >
                    {g.severity}
                  </span>
                </div>
                <p className="text-text-secondary">{g.observation}</p>
                {g.peerReference && (
                  <p className="text-text-tertiary">→ peers: {g.peerReference}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Recommendations to raise AI readiness
          </h4>
          <ol className="flex flex-col gap-2">
            {data.recommendations.slice(0, 6).map((rec, i) => (
              <li
                key={i}
                className={`border-l-2 pl-3 ${
                  rec.priority === 'high'
                    ? 'border-warning'
                    : rec.priority === 'medium'
                      ? 'border-chart-3'
                      : 'border-border-strong'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold">{rec.title}</span>
                  <span className="text-[0.65rem] uppercase text-text-tertiary">
                    {rec.priority} · {effortHorizonLabel(rec.effortHorizon)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">{rec.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </SectionCard>
  );
}

function SubScoreTile({
  label,
  score,
  hint,
}: {
  label: string;
  score: number | null;
  hint: string;
}) {
  const tone =
    score === null
      ? ''
      : score >= 70
        ? 'bg-success/70'
        : score >= 45
          ? 'bg-chart-2/70'
          : score >= 20
            ? 'bg-chart-3/70'
            : 'bg-warning/70';
  return (
    <div className="rounded border border-border-subtle bg-surface-1 p-2">
      <div className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div
        className={`font-tabular text-xl font-semibold ${
          score === null ? 'text-text-tertiary' : ''
        }`}
      >
        {score === null ? 'no data' : score.toFixed(0)}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        {score !== null && <div className={`h-full ${tone}`} style={{ width: `${score}%` }} />}
      </div>
      <div className="mt-0.5 text-[0.7rem] text-text-tertiary">{hint}</div>
    </div>
  );
}

function Legend({
  swatch,
  label,
  value,
}: {
  swatch: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-sm ${swatch}`} />
      <span>
        {label} · <span className="font-tabular">{value}</span>
      </span>
    </span>
  );
}

function effortHorizonLabel(h: 'short' | 'medium' | 'long'): string {
  return h === 'short' ? '< 12 mo' : h === 'medium' ? '12–24 mo' : '24–36 mo';
}

// ---------------------------------------------------------------------------
// Block: Demand funnel.
// ---------------------------------------------------------------------------

function DemandFunnelBlock({ data }: { data: DeepDiveDemandFunnel }) {
  const stages = data.stages.filter((s) => s.value > 0);
  const max = Math.max(...stages.map((s) => s.value), 1);
  const hasAlumni = data.alumniBreakdown.length > 0;
  return (
    <SectionCard
      title="Demand funnel"
      subtitle={
        data.anchorEntryYearBE
          ? `Anchored on cohort BE ${data.anchorEntryYearBE} (CE ${data.anchorEntryYearCE}) · ${
              data.cohortCompleted ? 'lifecycle complete' : 'in-progress cohort'
            }${data.programDurationYears ? ` · ${data.programDurationYears}-year program` : ''}`
          : 'No cohort data'
      }
      accent="border-l-chart-2"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Funnel stages
          </h4>
          <ul className="flex flex-col gap-1">
            {stages.map((s) => {
              const widthPct = (s.value / max) * 100;
              return (
                <li
                  key={s.key}
                  className="grid grid-cols-[8rem_minmax(0,1fr)_4rem] items-center gap-2 text-xs"
                >
                  <span className="text-text-secondary">{s.label}</span>
                  <div className="relative h-3 overflow-hidden rounded-sm bg-surface-2">
                    <div
                      className="h-full bg-chart-2/70"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="text-right font-tabular">
                    {s.value.toLocaleString('en-US')}
                  </span>
                </li>
              );
            })}
          </ul>
          {data.conversions.length > 0 && (
            <div className="mt-2 border-t border-border-subtle pt-2">
              <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                Stage conversions
              </h4>
              <ul className="text-xs">
                {data.conversions.map((c) => (
                  <li
                    key={`${c.fromKey}-${c.toKey}`}
                    className="flex justify-between"
                  >
                    <span className="text-text-secondary">
                      {c.fromKey} → {c.toKey}
                    </span>
                    <span className="font-tabular">
                      {c.rate === null ? '—' : `${(c.rate * 100).toFixed(1)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          {hasAlumni && (
            <>
              <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                Alumni outcome buckets
              </h4>
              <ul className="text-xs">
                {data.alumniBreakdown.map((b) => (
                  <li
                    key={b.bucket}
                    className="grid grid-cols-[8rem_minmax(0,1fr)_5rem] items-center gap-2"
                  >
                    <span className="text-text-secondary">{b.bucket}</span>
                    <div className="h-2 overflow-hidden rounded-sm bg-surface-2">
                      <div
                        className="h-full bg-chart-3/60"
                        style={{ width: `${Math.min(100, b.pct * 100)}%` }}
                      />
                    </div>
                    <span className="text-right font-tabular">
                      {b.count.toLocaleString('en-US')} · {(b.pct * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.cohortTrend.length > 0 && (
            <>
              <h4 className="mb-1 mt-2 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                Cohort trend
              </h4>
              <table className="w-full border-collapse text-xs">
                <thead className="text-left text-text-tertiary">
                  <tr>
                    <th className="py-1 font-medium">Cohort BE</th>
                    <th className="py-1 text-right font-medium">Admitted</th>
                    <th className="py-1 text-right font-medium">Enrolled</th>
                    <th className="py-1 text-right font-medium">Graduated</th>
                    <th className="py-1 text-right font-medium">Dropped</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohortTrend.slice(-6).map((c) => (
                    <tr key={c.entryYearBE} className="border-t border-border-subtle">
                      <td className="py-1 font-tabular">
                        {c.entryYearBE}
                        {!c.cohortCompleted && (
                          <span className="ml-1 text-warning">·</span>
                        )}
                      </td>
                      <td className="py-1 text-right font-tabular">
                        {c.admittedTotal.toLocaleString('en-US')}
                      </td>
                      <td className="py-1 text-right font-tabular">
                        {c.enrolled.toLocaleString('en-US')}
                      </td>
                      <td className="py-1 text-right font-tabular">
                        {c.graduated.toLocaleString('en-US')}
                      </td>
                      <td className="py-1 text-right font-tabular text-text-tertiary">
                        {c.droppedTotal.toLocaleString('en-US')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[0.65rem] text-text-tertiary">
                · = cohort still in progress (lifecycle not yet complete).
              </p>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: TCAS3 admissions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Block: Recruitment funnel — TCAS rounds 1–4. Primary admissions view;
// the TCAS3-only block beneath this carries the round-3 score detail and
// peer comparison.
// ---------------------------------------------------------------------------

function RecruitmentBlock({ data }: { data: DeepDiveRecruitment }) {
  const sortedYears = [...data.byYear].sort((a, b) => b.entryYearBE - a.entryYearBE);
  const latestComplete = sortedYears.find((y) => y.isComplete);
  const inProgress =
    data.inProgressRounds && sortedYears.find((y) => y.entryYearBE === data.inProgressRounds!.entryYearBE);

  // Headline KPIs from the latest complete year.
  const head = latestComplete ?? sortedYears[0];
  const yieldVsPlan =
    head && head.planPerYear !== null && head.planPerYear > 0
      ? head.regReported / head.planPerYear
      : null;

  return (
    <SectionCard
      title="Recruitment funnel — TCAS rounds 1–4"
      subtitle={
        head
          ? `Latest complete cohort BE ${head.entryYearBE} · ${head.totalApplicants.toLocaleString('en-US')} applicants · ${head.regReported.toLocaleString('en-US')} reported in${
              yieldVsPlan !== null ? ` (${(yieldVsPlan * 100).toFixed(0)}% of plan)` : ''
            }${inProgress ? ` · BE ${inProgress.entryYearBE} in progress` : ''}`
          : 'No recruitment data'
      }
      accent="border-l-chart-2"
    >
      {/* Year-over-year history */}
      {sortedYears.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead className="text-left text-text-tertiary">
            <tr>
              <th className="py-1 font-medium">Year</th>
              <th className="py-1 text-right font-medium">Plan/yr</th>
              <th className="py-1 text-right font-medium">Allocated</th>
              <th className="py-1 text-right font-medium">Applicants</th>
              <th className="py-1 text-right font-medium">Comp.</th>
              <th className="py-1 text-right font-medium">Passed</th>
              <th className="py-1 text-right font-medium">Confirm CH</th>
              <th className="py-1 text-right font-medium">Reported</th>
              <th className="py-1 text-right font-medium">vs Plan</th>
              <th className="py-1 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedYears.map((y) => {
              const fillVsPlan =
                y.planPerYear !== null && y.planPerYear > 0
                  ? y.regReported / y.planPerYear
                  : null;
              const fillCls =
                fillVsPlan === null
                  ? ''
                  : fillVsPlan >= 1
                    ? 'text-success'
                    : fillVsPlan >= 0.85
                      ? 'text-chart-3'
                      : 'text-warning';
              return (
                <tr
                  key={y.entryYearBE}
                  className="border-t border-border-subtle"
                >
                  <td className="py-1 font-tabular">BE {y.entryYearBE}</td>
                  <td className="py-1 text-right font-tabular">
                    {y.planPerYear !== null ? y.planPerYear.toLocaleString('en-US') : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {y.enrollSeats.toLocaleString('en-US')}
                    {y.overAllocationFactor !== null && y.overAllocationFactor > 1.05 && (
                      <span className="ml-1 text-[0.65rem] text-text-tertiary">
                        ({y.overAllocationFactor.toFixed(2)}×)
                      </span>
                    )}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {y.totalApplicants.toLocaleString('en-US')}
                  </td>
                  <td className="py-1 text-right font-tabular text-text-secondary">
                    {y.competitionRatio !== null
                      ? `${y.competitionRatio.toFixed(2)}×`
                      : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {y.totalPassed.toLocaleString('en-US')}
                  </td>
                  <td className="py-1 text-right font-tabular text-text-secondary">
                    {y.confirmClearinghouse.toLocaleString('en-US')}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {y.regReported.toLocaleString('en-US')}
                  </td>
                  <td className={`py-1 text-right font-tabular font-semibold ${fillCls}`}>
                    {fillVsPlan !== null ? `${(fillVsPlan * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="py-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                    {y.isComplete ? 'complete' : 'in progress'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Per-round breakdown for latest complete year */}
      {data.latestRounds && data.latestRounds.rounds.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Per-round breakdown · BE {data.latestRounds.entryYearBE}
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-text-tertiary">
              <tr>
                <th className="py-1 font-medium">Round</th>
                <th className="py-1 text-right font-medium">Allocated</th>
                <th className="py-1 text-right font-medium">Applicants</th>
                <th className="py-1 text-right font-medium">Passed</th>
                <th className="py-1 text-right font-medium">Confirm CH</th>
                <th className="py-1 text-right font-medium">Reported</th>
              </tr>
            </thead>
            <tbody>
              {data.latestRounds.rounds.map((r) => (
                <tr key={r.round} className="border-t border-border-subtle">
                  <td className="py-1 font-tabular">{r.round}</td>
                  <td className="py-1 text-right font-tabular">
                    {r.enrollSeats !== null ? r.enrollSeats.toLocaleString('en-US') : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {r.totalApplicants !== null ? r.totalApplicants.toLocaleString('en-US') : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {r.totalPassed !== null ? r.totalPassed.toLocaleString('en-US') : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular text-text-secondary">
                    {r.confirmClearinghouse !== null
                      ? r.confirmClearinghouse.toLocaleString('en-US')
                      : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {r.regReported !== null ? r.regReported.toLocaleString('en-US') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-[0.65rem] text-text-tertiary">
        Source: <span className="font-tabular">POWERBI.ADMISSION_STAT_CURRID</span> via the
        kku-tcas-funnel connector. Plan/yr is the annual seat target;
        Allocated is total seats opened across rounds; vs Plan = reg-reported ÷
        Plan. {data.methodologyVersion}.
      </p>
    </SectionCard>
  );
}

function TcasBlock({ data }: { data: DeepDiveTcasStats }) {
  const sortedHistory = [...data.history].sort(
    (a, b) => b.entryYearBE - a.entryYearBE || b.round.localeCompare(a.round),
  );
  const latest = sortedHistory[0];
  const peerCompetitionAvg =
    data.peers.length > 0
      ? data.peers.reduce((s, p) => s + p.competitionRatio, 0) / data.peers.length
      : null;
  return (
    <SectionCard
      title="TCAS3 round-3 score detail & peer competition"
      subtitle={
        latest
          ? `Latest BE ${latest.entryYearBE} R${latest.round} · ${latest.applicants.toLocaleString('en-US')} applicants for ${latest.quota.toLocaleString('en-US')} seats (${latest.competitionRatio.toFixed(2)}× competition${peerCompetitionAvg !== null ? ` · peer avg ${peerCompetitionAvg.toFixed(2)}×` : ''})`
          : 'No TCAS3 data'
      }
      accent="border-l-chart-3"
    >
      {sortedHistory.length > 0 && (
        <table className="w-full border-collapse text-xs">
          <thead className="text-left text-text-tertiary">
            <tr>
              <th className="py-1 font-medium">Year · Round</th>
              <th className="py-1 text-right font-medium">Quota</th>
              <th className="py-1 text-right font-medium">Applicants</th>
              <th className="py-1 text-right font-medium">Competition</th>
              <th className="py-1 text-right font-medium">Fill rate</th>
              <th className="py-1 text-right font-medium">Min score</th>
              <th className="py-1 text-right font-medium">Max score</th>
            </tr>
          </thead>
          <tbody>
            {sortedHistory.map((h) => (
              <tr
                key={`${h.entryYearBE}-${h.round}`}
                className="border-t border-border-subtle"
              >
                <td className="py-1 font-tabular">
                  BE {h.entryYearBE} R{h.round}
                </td>
                <td className="py-1 text-right font-tabular">
                  {h.quota.toLocaleString('en-US')}
                </td>
                <td className="py-1 text-right font-tabular">
                  {h.applicants.toLocaleString('en-US')}
                </td>
                <td className="py-1 text-right font-tabular text-text-secondary">
                  {h.competitionRatio.toFixed(2)}×
                </td>
                <td className="py-1 text-right font-tabular text-text-secondary">
                  {(h.fillRate * 100).toFixed(1)}%
                </td>
                <td className="py-1 text-right font-tabular">
                  {h.minScorePass1 !== null ? h.minScorePass1.toFixed(2) : '—'}
                </td>
                <td className="py-1 text-right font-tabular">
                  {h.maxScorePass1 !== null ? h.maxScorePass1.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.peers.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Peer programs · same subject ({data.peers.length} matched
            {data.peerMatchKey ? ` on "${data.peerMatchKey}"` : ''})
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-text-tertiary">
              <tr>
                <th className="py-1 font-medium">Match</th>
                <th className="py-1 font-medium">Institution</th>
                <th className="py-1 font-medium">Programme</th>
                <th className="py-1 text-right font-medium">Quota</th>
                <th className="py-1 text-right font-medium">Applicants</th>
                <th className="py-1 text-right font-medium">Competition</th>
              </tr>
            </thead>
            <tbody>
              {[...data.peers]
                .sort((a, b) => b.competitionRatio - a.competitionRatio)
                .slice(0, 12)
                .map((p, i) => (
                  <tr key={i} className="border-t border-border-subtle">
                    <td className="py-1">
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[0.65rem] ${
                          p.matchTier === 'exact'
                            ? 'bg-success/15 text-success'
                            : 'bg-chart-3/15 text-chart-3'
                        }`}
                      >
                        {p.matchTier}
                      </span>
                    </td>
                    <td className="py-1 text-text-secondary">{p.institutionName}</td>
                    <td className="py-1 text-[0.7rem] text-text-tertiary">
                      {p.programmeName}
                    </td>
                    <td className="py-1 text-right font-tabular">
                      {p.quota.toLocaleString('en-US')}
                    </td>
                    <td className="py-1 text-right font-tabular">
                      {p.applicants.toLocaleString('en-US')}
                    </td>
                    <td className="py-1 text-right font-tabular text-text-secondary">
                      {p.competitionRatio.toFixed(2)}×
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: Cohort distribution.
// ---------------------------------------------------------------------------

function CohortsBlock({ data }: { data: DeepDiveStudentCohorts }) {
  const max = Math.max(...data.cohorts.map((c) => c.studentCount), 1);
  const statusBg = (s: 'incoming' | 'on-track' | 'delayed') =>
    s === 'incoming'
      ? 'bg-chart-3/65'
      : s === 'delayed'
        ? 'bg-warning/75'
        : 'bg-chart-2/75';
  const statusLabel = (s: 'incoming' | 'on-track' | 'delayed') =>
    s === 'incoming' ? 'Incoming' : s === 'delayed' ? 'Delayed' : 'On track';
  return (
    <SectionCard
      title="Cohort distribution"
      subtitle={`${data.totalActive.toLocaleString('en-US')} active students · anchored to BE ${data.currentAcademicYearBE}${
        data.programDurationYears !== null ? ` · ${data.programDurationYears}-year program` : ''
      }`}
      accent="border-l-chart-2"
      pageBreakBefore
    >
      <div className="grid grid-cols-3 gap-2">
        <KpiTile
          label="Incoming"
          value={data.incomingCount.toLocaleString('en-US')}
          subtitle={`Year 0 · ${(data.totalActive > 0 ? (data.incomingCount / data.totalActive) * 100 : 0).toFixed(0)}%`}
        />
        <KpiTile
          label="On-track"
          value={data.onTrackCount.toLocaleString('en-US')}
          subtitle={
            data.programDurationYears
              ? `Years 1–${data.programDurationYears} · ${(data.totalActive > 0 ? (data.onTrackCount / data.totalActive) * 100 : 0).toFixed(0)}%`
              : `Within nominal duration · ${(data.totalActive > 0 ? (data.onTrackCount / data.totalActive) * 100 : 0).toFixed(0)}%`
          }
        />
        <KpiTile
          label="Delayed"
          value={data.delayedCount.toLocaleString('en-US')}
          valueTone={data.delayedCount > 0 ? 'text-warning' : ''}
          subtitle={
            data.programDurationYears
              ? `Year ${data.programDurationYears + 1}+ · ${(data.totalActive > 0 ? (data.delayedCount / data.totalActive) * 100 : 0).toFixed(0)}%`
              : `Beyond nominal duration · ${(data.totalActive > 0 ? (data.delayedCount / data.totalActive) * 100 : 0).toFixed(0)}%`
          }
        />
      </div>

      <h4 className="mb-1 mt-3 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        Currently enrolled by entry cohort
      </h4>
      <div className="flex h-32 items-end gap-1.5">
        {data.cohorts.map((c) => {
          const heightPct = (c.studentCount / max) * 100;
          return (
            <div
              key={c.entryYearBE}
              className="flex flex-1 flex-col items-center gap-0.5"
              title={`BE ${c.entryYearBE} · ${statusLabel(c.status)} · ${c.studentCount} students`}
            >
              <span className="font-tabular text-[0.65rem] text-text-secondary">
                {c.studentCount}
              </span>
              <div
                className={`w-full rounded-t-sm ${statusBg(c.status)}`}
                style={{
                  height: `${heightPct}%`,
                  minHeight: c.studentCount > 0 ? '2px' : 0,
                }}
              />
              <span className="font-tabular text-[0.6rem] text-text-tertiary">
                BE {c.entryYearBE}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[0.7rem] text-text-tertiary">
        <Legend swatch="bg-chart-3/65" label="Incoming" value={data.incomingCount} />
        <Legend swatch="bg-chart-2/75" label="On-track" value={data.onTrackCount} />
        <Legend swatch="bg-warning/75" label="Delayed" value={data.delayedCount} />
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: Demographic outlook.
// ---------------------------------------------------------------------------

function DemographicBlock({ data }: { data: DeepDiveDemographicOutlook }) {
  const peakWidth = Math.max(...data.projections.map((p) => p.cohortPopulation), 1);
  const riskTone: Record<typeof data.riskLevel, string> = {
    low: 'text-success',
    medium: 'text-chart-3',
    high: 'text-warning',
    unknown: 'text-text-tertiary',
  };
  return (
    <SectionCard
      title="Demographic outlook"
      subtitle={`Catchment ${
        data.catchmentRegion === 'Northeast' ? 'Northeast Thailand' : 'Thailand'
      } · age ${data.ageCohort} cohort · ${data.source}`}
      accent="border-l-chart-3"
    >
      <div className="grid grid-cols-3 gap-2">
        <KpiTile
          label="Today's Year-1 intake"
          value={
            data.baselineYearOneIntake !== null
              ? data.baselineYearOneIntake.toLocaleString('en-US')
              : '—'
          }
          subtitle="latest complete academic year"
        />
        <KpiTile
          label="+15y cohort contraction"
          value={`−${data.fifteenYearContraction.toFixed(1)}%`}
          valueTone={data.fifteenYearContraction > 30 ? 'text-warning' : ''}
          subtitle={`${data.catchmentRegion === 'Northeast' ? 'Northeast' : 'Thailand'} ${data.ageCohort} cohort`}
        />
        <KpiTile
          label="Demographic ceiling"
          value={data.riskLevel.toUpperCase()}
          valueTone={riskTone[data.riskLevel]}
          valueClass="text-xl"
          subtitle="risk verdict"
        />
      </div>
      <h4 className="mb-1 mt-3 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        Cohort projection — share to maintain today&apos;s intake
      </h4>
      <table className="w-full border-collapse text-xs">
        <thead className="text-left text-text-tertiary">
          <tr>
            <th className="py-1 font-medium">Year</th>
            <th className="py-1 font-medium">Visual</th>
            <th className="py-1 text-right font-medium">Cohort population</th>
            <th className="py-1 text-right font-medium">Decline vs today</th>
            <th className="py-1 text-right font-medium">Share needed</th>
          </tr>
        </thead>
        <tbody>
          {data.projections.map((p, i) => {
            const pct = (p.cohortPopulation / peakWidth) * 100;
            return (
              <tr key={p.year} className="border-t border-border-subtle">
                <td className="py-1 font-tabular">
                  {p.year}
                  {i === 0 && (
                    <span className="ml-1 text-text-tertiary">today</span>
                  )}
                </td>
                <td className="py-1">
                  <div className="h-2 w-32 overflow-hidden rounded-sm bg-surface-2">
                    <div
                      className="h-full bg-chart-2/65"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
                <td className="py-1 text-right font-tabular">
                  {(p.cohortPopulation / 1_000_000).toFixed(2)}M
                </td>
                <td className="py-1 text-right font-tabular text-text-secondary">
                  {p.cohortDeclinePct > 0 ? `−${p.cohortDeclinePct.toFixed(1)}%` : '0.0%'}
                </td>
                <td className="py-1 text-right font-tabular">
                  {p.requiredShareOfCohort !== null
                    ? `${(p.requiredShareOfCohort * 100).toFixed(3)}%`
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: Outcomes.
// ---------------------------------------------------------------------------

function OutcomesBlock({ data }: { data: DeepDiveOutcomes }) {
  const l = data.latest;
  if (!l) return null;
  return (
    <SectionCard
      title="Outcomes"
      subtitle={`Latest survey: ${l.graduationYear} cohort · ${l.sampleSize.toLocaleString('en-US')} graduates surveyed · ${l.methodologyVersion} · ${formatDate(l.freshnessDate)}`}
      accent="border-l-success"
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile
          label="Employment rate"
          value={`${(l.employmentRate * 100).toFixed(1)}%`}
          subtitle="~1 year after graduation"
        />
        <KpiTile
          label="Average starting salary"
          value={`${l.averageSalary.toLocaleString('en-US')}`}
          subtitle="THB / month, self-reported"
        />
        <KpiTile
          label="Job matches field"
          value={`${(l.jobRelevanceScore * 100).toFixed(0)}%`}
          subtitle="working in their discipline"
        />
        <KpiTile
          label="Further study"
          value={`${(l.furtherStudyRate * 100).toFixed(0)}%`}
          subtitle="enrolled in postgraduate study"
        />
      </div>

      {data.salaryTrajectory.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Average starting salary by graduation year
          </h4>
          <SalarySparkline points={data.salaryTrajectory} />
        </div>
      )}

      {data.topEmployers.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
              Top employers (most recent surveys)
            </h4>
            <ul className="text-xs">
              {data.topEmployers.slice(0, 12).map((e, i) => (
                <li
                  key={i}
                  className="flex justify-between border-t border-border-subtle py-1 first:border-t-0"
                >
                  <span>{e.name}</span>
                  <span className="font-tabular text-text-tertiary">
                    {e.year} · sat {(e.satisfactionScore * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function SalarySparkline({
  points,
}: {
  points: Array<{ graduationYear: number; averageSalary: number }>;
}) {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.graduationYear - b.graduationYear);
  const min = Math.min(...sorted.map((p) => p.averageSalary));
  const max = Math.max(...sorted.map((p) => p.averageSalary));
  const range = max - min || 1;
  return (
    <div className="flex items-end gap-1.5">
      {sorted.map((p) => {
        const heightPct = ((p.averageSalary - min) / range) * 100;
        return (
          <div
            key={p.graduationYear}
            className="flex flex-1 flex-col items-center gap-0.5"
          >
            <span className="font-tabular text-[0.6rem] text-text-secondary">
              {(p.averageSalary / 1000).toFixed(0)}k
            </span>
            <div
              className="w-full rounded-t-sm bg-success/65"
              style={{ height: `${20 + heightPct}px` }}
            />
            <span className="font-tabular text-[0.6rem] text-text-tertiary">
              {p.graduationYear}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block: Skills coverage.
// ---------------------------------------------------------------------------

function SkillsBlock({ data }: { data: DeepDiveSkills }) {
  const major = data.taught.filter(
    (s) => s.pickedFromPlo || (s.compulsoryWeight ?? s.weight) >= 0.5,
  );
  const minor = data.taught.filter(
    (s) => !s.pickedFromPlo && (s.compulsoryWeight ?? s.weight) < 0.5,
  );
  // Friendly label for the demand-side data source. The backend returns
  // raw slugs (e.g., `linkedin-via-mhesi`) for API stability; the UI
  // never shows the slug — only this lookup result, falling back to
  // "Demand-side signal" so unknown slugs degrade gracefully.
  const DEMAND_SOURCE_LABEL: Record<string, string> = {
    'linkedin-via-mhesi': 'LinkedIn (via MHESI)',
  };
  const demandSourceLabel =
    DEMAND_SOURCE_LABEL[data.demandSource] ?? 'Demand-side signal';
  return (
    <SectionCard
      title="Skills coverage"
      subtitle={`${data.taught.length} skills taught (${data.ploSkillCount} from PLOs) · demand match ${Math.round(data.matchScore)} · source ${demandSourceLabel}`}
      accent="border-l-chart-2"
      pageBreakBefore
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SkillsColumn
          title={`Major contributors (${major.length})`}
          subtitle="from PLOs and/or compulsory courses"
          items={major.slice(0, 14).map((s) => ({
            label: s.nameEn || s.nameTh,
            sub: s.pickedFromPlo ? 'PLO' : '',
            weight: s.compulsoryWeight ?? s.weight,
          }))}
        />
        <SkillsColumn
          title={`Minor contributors (${minor.length})`}
          subtitle="elective courses only"
          items={minor.slice(0, 14).map((s) => ({
            label: s.nameEn || s.nameTh,
            sub: '',
            weight: s.electiveWeight ?? s.weight,
          }))}
        />
      </div>

      {data.demanded.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Top demanded skills (labour market) · {data.careerFilterCount} careers in scope
          </h4>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {data.demanded.slice(0, 14).map((s) => (
              <div
                key={s.skillId}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate" title={s.nameTh ?? undefined}>
                  {s.nameEn || s.nameTh}
                </span>
                <span className="font-tabular text-text-tertiary">
                  {s.peakDemandPct.toFixed(0)}%
                  {s.curriculumMatched === false && (
                    <span className="ml-1 text-warning">●</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[0.65rem] text-text-tertiary">
            <span className="text-warning">●</span> = demanded skill not currently
            taught (gap candidate).
          </p>
        </div>
      )}

      {data.gaps.length > 0 && (
        <div className="mt-3 rounded border border-border-subtle bg-surface-1 p-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Top gap candidates ({data.gaps.length} unmatched)
          </h4>
          <ul className="text-xs">
            {data.gaps.slice(0, 8).map((g) => (
              <li key={g.skillId} className="flex justify-between">
                <span>{g.nameEn || g.nameTh}</span>
                <span className="font-tabular text-text-tertiary">
                  {g.peakDemandPct.toFixed(0)}% peak · {g.careerCount} careers
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function SkillsColumn({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Array<{ label: string; sub: string; weight: number | null }>;
}) {
  return (
    <div>
      <h4 className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        {title}
      </h4>
      <p className="mb-1 text-[0.65rem] text-text-tertiary">{subtitle}</p>
      <ul className="text-xs">
        {items.map((s, i) => (
          <li
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_3rem_3rem] items-baseline gap-2 border-t border-border-subtle py-1 first:border-t-0"
          >
            <span className="truncate" title={s.label}>
              {s.label}
            </span>
            <span className="text-right text-[0.65rem] uppercase text-accent">
              {s.sub}
            </span>
            <span className="text-right font-tabular text-text-tertiary">
              {s.weight === null ? '—' : s.weight.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block: Faculty capability.
// ---------------------------------------------------------------------------

const RANK_LABELS_FOR_PRINT: Record<string, string> = {
  PROF: 'Professor',
  ASSOC_PROF: 'Associate Professor',
  ASST_PROF: 'Assistant Professor',
  LECTURER: 'Lecturer',
  RESEARCHER: 'Researcher',
  ADJUNCT: 'Adjunct',
  EMERITUS: 'Emeritus',
};
const RANK_TONE_FOR_PRINT: Record<string, string> = {
  PROF: 'bg-success/70',
  ASSOC_PROF: 'bg-success/55',
  ASST_PROF: 'bg-chart-2/65',
  LECTURER: 'bg-chart-2/45',
  RESEARCHER: 'bg-chart-3/50',
  ADJUNCT: 'bg-border-strong/60',
  EMERITUS: 'bg-text-tertiary/40',
};
const RANK_ORDER_FOR_PRINT = [
  'PROF',
  'ASSOC_PROF',
  'ASST_PROF',
  'LECTURER',
  'RESEARCHER',
  'ADJUNCT',
  'EMERITUS',
];

function FacultyBlock({ data }: { data: DeepDiveFaculty }) {
  const rankEntries = [
    ...RANK_ORDER_FOR_PRINT.filter((r) => (data.ranks[r] ?? 0) > 0).map((rank) => ({
      rank,
      count: data.ranks[rank] ?? 0,
    })),
    ...Object.entries(data.ranks)
      .filter(([r, n]) => n > 0 && !RANK_ORDER_FOR_PRINT.includes(r))
      .map(([rank, count]) => ({ rank, count })),
  ];
  const max = Math.max(...rankEntries.map((e) => e.count), 1);
  const seniorCount = (data.ranks.PROF ?? 0) + (data.ranks.ASSOC_PROF ?? 0);
  const seniorPct =
    data.totalActive > 0 ? (seniorCount / data.totalActive) * 100 : 0;
  const rosterScopeLabel: Record<typeof data.rosterScope, string> = {
    program: 'program-specific roster',
    department: 'department roster',
    faculty: 'faculty roster',
  };
  return (
    <SectionCard
      title="Faculty capability"
      subtitle={`Source: ${rosterScopeLabel[data.rosterScope]} · ${data.visibility === 'aggregates-only' ? 'aggregates only (role-gated)' : 'full detail'}`}
      accent="border-l-chart-2"
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile
          label="Currently teaching"
          value={data.totalActive.toString()}
          subtitle="active staff members"
        />
        <KpiTile
          label="Publications (3 yr)"
          value={data.totalPublications.toLocaleString('en-US')}
          subtitle="across teaching staff"
        />
        <KpiTile
          label="Average age"
          value={
            data.averageAgeYears === null
              ? '—'
              : `${data.averageAgeYears.toFixed(0)} years`
          }
          subtitle="all teaching ranks"
        />
        <KpiTile
          label="Retiring within 5 yrs"
          value={`${data.successionRiskPct.toFixed(0)}%`}
          valueTone={data.successionRiskPct > 30 ? 'text-danger' : ''}
          subtitle={`${data.retiringWithin5Years} of ${data.totalActive} staff`}
        />
      </div>

      {rankEntries.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Academic rank distribution
          </h4>
          <ul className="flex flex-col gap-1">
            {rankEntries.map(({ rank, count }) => {
              const pct =
                data.totalActive > 0 ? (count / data.totalActive) * 100 : 0;
              const widthPct = (count / max) * 100;
              const tone = RANK_TONE_FOR_PRINT[rank] ?? 'bg-border-strong/60';
              return (
                <li
                  key={rank}
                  className="grid grid-cols-[10rem_minmax(0,1fr)_5rem] items-center gap-3 text-xs"
                >
                  <span className="text-text-primary">
                    {RANK_LABELS_FOR_PRINT[rank] ?? rank}
                  </span>
                  <div className="relative h-3 overflow-hidden rounded-sm bg-surface-2">
                    <div
                      className={`h-full ${tone}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="flex items-baseline justify-end gap-2 font-tabular">
                    <span className="font-semibold text-text-primary">{count}</span>
                    <span className="w-9 text-right text-text-tertiary">
                      {pct.toFixed(0)}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[0.65rem] text-text-tertiary">
            Senior share (Prof + Assoc Prof):{' '}
            <span className="font-tabular text-text-secondary">
              {seniorCount}/{data.totalActive}
            </span>{' '}
            ({seniorPct.toFixed(0)}%) ·{' '}
            {seniorPct >= 40
              ? 'healthy senior centre of gravity.'
              : seniorPct >= 25
                ? 'mid-band — typical for a teaching-heavy department.'
                : 'top-heavy junior cohort — succession plan worth reviewing.'}
          </p>
        </div>
      )}

      {data.visibility === 'full' && data.members.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Roster (top {Math.min(20, data.members.length)} by rank)
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-text-tertiary">
              <tr>
                <th className="py-1 font-medium">Rank</th>
                <th className="py-1 font-medium">Name</th>
                <th className="py-1 font-medium">Specialisation</th>
                <th className="py-1 text-right font-medium">Retires</th>
              </tr>
            </thead>
            <tbody>
              {data.members.slice(0, 20).map((m) => (
                <tr key={m.id} className="border-t border-border-subtle">
                  <td className="py-1 font-tabular">
                    {RANK_LABELS_FOR_PRINT[m.rank] ?? m.rank}
                  </td>
                  <td className="py-1 text-text-secondary">
                    {m.nameEn || m.nameTh || '—'}
                  </td>
                  <td className="py-1 text-[0.7rem] text-text-tertiary">
                    {m.specialization || '—'}
                  </td>
                  <td className="py-1 text-right font-tabular text-text-tertiary">
                    {m.retirementDate ? formatDate(m.retirementDate) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: Financials.
// ---------------------------------------------------------------------------

function FinancialsBlock({ data }: { data: DeepDiveFinancials }) {
  const max = Math.max(...data.waterfall.map((s) => Math.abs(s.value)), 1);
  return (
    <SectionCard
      title="Financials"
      subtitle={`Cost methodology ${data.costMethodologyVersion} · headline FY ${data.latestFiscalYear ?? '—'}${
        data.partialCurrentYearAvailable ? ' (a more recent partial year is in progress)' : ''
      }`}
      accent="border-l-success"
    >
      <div className="grid grid-cols-3 gap-2">
        <KpiTile
          label={`Tuition revenue · FY ${data.latestFiscalYear ?? '—'}`}
          value={(
            data.trend.find((t) => t.year === data.latestFiscalYear)?.tuitionRevenue ??
            data.trend.at(-1)?.tuitionRevenue ??
            0
          ).toLocaleString('en-US')}
          subtitle="THB"
        />
        <KpiTile
          label="Government salary subsidy"
          value={(data.governmentFacultySubsidy ?? 0).toLocaleString('en-US')}
          subtitle="THB / yr · block-grant funded"
        />
        <KpiTile
          label="Government investment / student"
          value={
            data.costPerStudent
              ? Math.round(data.costPerStudent).toLocaleString('en-US')
              : '—'
          }
          subtitle="THB / yr · subsidised salary per head"
        />
      </div>

      <h4 className="mb-1 mt-3 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        Tuition flow waterfall
      </h4>
      <ul className="flex flex-col gap-1">
        {data.waterfall.map((s) => {
          const widthPct = (Math.abs(s.value) / max) * 100;
          const tone =
            s.kind === 'negative'
              ? 'bg-warning/70'
              : s.kind === 'total'
                ? 'bg-chart-2/70'
                : 'bg-success/65';
          return (
            <li
              key={s.label}
              className="grid grid-cols-[12rem_minmax(0,1fr)_8rem] items-center gap-2 text-xs"
            >
              <span className="text-text-secondary">{s.label}</span>
              <div className="relative h-3 overflow-hidden rounded-sm bg-surface-2">
                <div className={`h-full ${tone}`} style={{ width: `${widthPct}%` }} />
              </div>
              <span
                className={`text-right font-tabular ${s.kind === 'negative' ? 'text-warning' : ''}`}
              >
                {s.kind === 'negative' ? '−' : ''}
                {Math.abs(s.value).toLocaleString('en-US')} THB
              </span>
            </li>
          );
        })}
      </ul>
      {data.sensitivity && (
        <p className="mt-2 rounded border border-border-subtle bg-surface-1 p-2 text-xs">
          <strong>What if tuition rose 5%:</strong> net contribution becomes{' '}
          <span className="font-tabular">
            {data.sensitivity.tuitionPlus5Pct.netContribution.toLocaleString('en-US')} THB
          </span>{' '}
          (revenue {data.sensitivity.tuitionPlus5Pct.tuitionRevenue.toLocaleString('en-US')} THB).
        </p>
      )}

      {data.trend.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Year-over-year trend
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-text-tertiary">
              <tr>
                <th className="py-1 font-medium">FY</th>
                <th className="py-1 text-right font-medium">Tuition revenue</th>
                <th className="py-1 text-right font-medium">Faculty subsidy</th>
                <th className="py-1 text-right font-medium">Net contribution</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((t) => (
                <tr key={t.year} className="border-t border-border-subtle">
                  <td className="py-1 font-tabular">{t.year}</td>
                  <td className="py-1 text-right font-tabular">
                    {t.tuitionRevenue !== null
                      ? t.tuitionRevenue.toLocaleString('en-US')
                      : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular text-text-tertiary">
                    {t.facultyCostSubsidy !== null
                      ? t.facultyCostSubsidy.toLocaleString('en-US')
                      : '—'}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {t.netContribution !== null
                      ? t.netContribution.toLocaleString('en-US')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Block: Peer comparison (combines structured peers + AI peers).
// ---------------------------------------------------------------------------

function PeersBlock({
  peers,
  aiPeers,
}: {
  peers: DeepDivePeers | null;
  aiPeers: DeepDiveAiPeers | null;
}) {
  return (
    <SectionCard
      title="Peer comparison"
      subtitle={
        aiPeers?.subjectSignature
          ? `Subject signature: ${aiPeers.subjectSignature}${aiPeers.rankingYear ? ` · ${aiPeers.rankingYear} rankings` : ''}`
          : 'No subject signature available'
      }
      accent="border-l-chart-3"
      pageBreakBefore
    >
      {aiPeers && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <PeerTier label="World tier" tone="bg-success/15 text-success" entries={aiPeers.tiers.WORLD} />
          <PeerTier
            label="Asia tier"
            tone="bg-chart-2/15 text-chart-2"
            entries={aiPeers.tiers.ASIA}
          />
          <PeerTier
            label="Southeast Asia"
            tone="bg-chart-3/15 text-chart-3"
            entries={aiPeers.tiers.SOUTHEAST_ASIA}
          />
          <PeerTier
            label="Thailand"
            tone="bg-border-strong/40 text-text-secondary"
            entries={aiPeers.tiers.THAILAND_PEER}
          />
        </div>
      )}

      {aiPeers?.review && (
        <div className="mt-3 rounded border border-border-subtle bg-surface-1 p-2.5 text-xs">
          <h4 className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            AI peer review · confidence {(aiPeers.review.confidence * 100).toFixed(0)}%
          </h4>
          <div className="mt-1 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <div className="text-[0.65rem] uppercase tracking-wide text-success">
                Strengths
              </div>
              <ul className="mt-0.5 list-disc pl-4">
                {aiPeers.review.strengths.slice(0, 4).map((b, i) => (
                  <li key={i}>{b.claim}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[0.65rem] uppercase tracking-wide text-warning">
                Weaknesses
              </div>
              <ul className="mt-0.5 list-disc pl-4">
                {aiPeers.review.weaknesses.slice(0, 4).map((b, i) => (
                  <li key={i}>{b.claim}</li>
                ))}
              </ul>
            </div>
          </div>
          {aiPeers.review.contentModernity && (
            <p className="mt-2 text-text-secondary">
              <strong>Curriculum modernity:</strong>{' '}
              <span
                className={
                  aiPeers.review.contentModernity.verdict === 'FRONTIER'
                    ? 'text-success'
                    : aiPeers.review.contentModernity.verdict === 'IN_BETWEEN'
                      ? 'text-chart-2'
                      : 'text-warning'
                }
              >
                {aiPeers.review.contentModernity.verdict.replace(/_/g, ' ')}
              </span>{' '}
              — {aiPeers.review.contentModernity.narrative}
            </p>
          )}
          <p className="mt-2 text-text-secondary">
            {aiPeers.review.subjectBenchmarkSummary}
          </p>
        </div>
      )}

      {peers && peers.peers.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <h4 className="mb-1 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            Curated peer set ({peers.peers.length})
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead className="text-left text-text-tertiary">
              <tr>
                <th className="py-1 font-medium">Institution</th>
                <th className="py-1 font-medium">Country</th>
                <th className="py-1 font-medium">Programme</th>
                <th className="py-1 text-right font-medium">Ranking</th>
              </tr>
            </thead>
            <tbody>
              {peers.peers.slice(0, 10).map((p) => (
                <tr key={p.id} className="border-t border-border-subtle">
                  <td className="py-1 text-text-secondary">{p.institution}</td>
                  <td className="py-1 text-text-tertiary">{p.country}</td>
                  <td className="py-1 text-[0.7rem] text-text-tertiary">
                    {p.programName}
                  </td>
                  <td className="py-1 text-right font-tabular">
                    {p.ranking ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function PeerTier({
  label,
  tone,
  entries,
}: {
  label: string;
  tone: string;
  entries: DeepDiveAiPeers['tiers']['WORLD'];
}) {
  return (
    <div className="rounded border border-border-subtle bg-surface-1 p-2">
      <div className="flex items-baseline justify-between">
        <span
          className={`rounded-sm px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${tone}`}
        >
          {label}
        </span>
        <span className="text-[0.65rem] text-text-tertiary">
          {entries.length} peers
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="mt-1 text-xs text-text-tertiary">No peers selected.</p>
      ) : (
        <ol className="mt-1 flex flex-col gap-1 text-xs">
          {entries.slice(0, 5).map((p, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="truncate" title={p.peerProgramName}>
                {p.rankInTier}. {p.institutionName}
              </span>
              <span className="text-[0.65rem] text-text-tertiary">
                {p.country}
                {p.qsWorldRank ? ` · QS ${p.qsWorldRank}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block: Trend exposure.
// ---------------------------------------------------------------------------

function TrendsBlock({ data }: { data: DeepDiveTrends }) {
  return (
    <SectionCard
      title="Trend exposure"
      subtitle={`${data.signals.length} signal${data.signals.length === 1 ? '' : 's'} surfaced — sorted by detection date.`}
      accent="border-l-chart-3"
    >
      <ul className="flex flex-col gap-2">
        {data.signals.map((s) => {
          const tone =
            s.impactScore > 0.6
              ? 'border-l-warning'
              : s.impactScore > 0.3
                ? 'border-l-chart-3'
                : 'border-l-border-strong';
          const rec = trendRecommendation(s);
          const recBg =
            rec.tone === 'danger'
              ? 'bg-warning/15 text-warning'
              : rec.tone === 'warning'
                ? 'bg-chart-3/15 text-chart-3'
                : 'bg-border-subtle/50 text-text-tertiary';
          const impactWord =
            s.impactScore > 0.7 ? 'High' : s.impactScore > 0.4 ? 'Moderate' : 'Low';
          return (
            <li
              key={s.id}
              className={`rounded border border-border-subtle border-l-4 ${tone} bg-surface-1 p-2.5`}
            >
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-semibold" lang="th">
                  {s.title}
                </span>
                <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                  {SIGNAL_KIND_LABEL[s.signalType]}
                </span>
                {s.isTargetedAtProgram ? (
                  <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-warning">
                    Targets this program
                  </span>
                ) : (
                  <span className="rounded-sm bg-border-subtle/60 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                    Sector-wide
                  </span>
                )}
                <span className="text-[0.65rem] text-text-tertiary">
                  detected {formatDate(s.detectedDate)}
                </span>
                <span className="ml-auto rounded-sm bg-surface-2 px-1.5 py-0.5 text-[0.65rem] font-tabular">
                  impact {(s.impactScore * 100).toFixed(0)} ({impactWord.toLowerCase()})
                </span>
              </div>
              {(s.summaryTh || s.summaryEn) && (
                <div className="mt-1.5 space-y-1 border-l-2 border-border-subtle pl-2 text-xs">
                  {s.summaryTh && (
                    <p className="text-text-primary" lang="th">
                      {s.summaryTh}
                    </p>
                  )}
                  {s.summaryEn && (
                    <p className="text-text-secondary">{s.summaryEn}</p>
                  )}
                </div>
              )}
              <div className="mt-2 rounded border border-border-subtle bg-surface-0 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-text-secondary">
                    Why it matters
                  </span>
                  <span
                    className={`rounded-sm px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${recBg}`}
                  >
                    Recommendation: {rec.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-text-secondary">{rec.rationale}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

const SIGNAL_KIND_LABEL: Record<DeepDiveTrends['signals'][number]['signalType'], string> = {
  POLICY: 'Policy / regulation',
  RESEARCH: 'Research finding',
  MARKET: 'Labour-market signal',
  TECH: 'Technology shift',
  NEWS: 'News development',
};

function trendRecommendation(
  s: DeepDiveTrends['signals'][number],
): { label: string; tone: 'danger' | 'warning' | 'neutral'; rationale: string } {
  const high = s.impactScore > 0.65;
  const moderate = s.impactScore > 0.35;
  const targeted = s.isTargetedAtProgram;
  const isPolicy = s.signalType === 'POLICY';
  if ((targeted && high) || (isPolicy && high)) {
    return {
      label: 'Take action',
      tone: 'danger',
      rationale: targeted
        ? 'Names the program directly and high impact. Bring to the next curriculum-committee meeting and decide on a curriculum amendment, admissions update, or Council-level briefing within this academic year.'
        : 'Regulatory or policy change at this impact level rarely stays sector-wide. Confirm scope; treat as an action item if the program is in scope.',
    };
  }
  if ((targeted && moderate) || (high && !targeted) || (isPolicy && moderate)) {
    return {
      label: 'Monitor',
      tone: 'warning',
      rationale: targeted
        ? 'Tagged as affecting this program at moderate impact. Track downstream effects; revisit explicitly at the next annual program review.'
        : isPolicy
          ? 'Policy direction worth tracking even though the program is not directly named — review again if a follow-up regulation lands.'
          : 'Sector-wide signal at high impact. Likely indirect effect — assign an analyst to flag if the wave reaches the discipline.',
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
}

// ---------------------------------------------------------------------------
// Block: Decision history.
// ---------------------------------------------------------------------------

function DecisionsBlock({ data }: { data: DeepDiveDecisions }) {
  return (
    <SectionCard
      title="Council decision history"
      subtitle={`${data.decisions.length} decision${data.decisions.length === 1 ? '' : 's'} on file`}
      accent="border-l-accent"
    >
      <ul className="flex flex-col gap-2 text-xs">
        {data.decisions.slice(0, 10).map((d) => (
          <li
            key={d.id}
            className="rounded border border-border-subtle bg-surface-1 p-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold uppercase tracking-wide">
                {d.decisionType.replace(/_/g, ' ')}
              </span>
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                {d.status}
              </span>
              <span className="ml-auto text-[0.65rem] font-tabular text-text-tertiary">
                {formatDate(d.createdAt)} · {d.decidedBy}
              </span>
            </div>
            {d.rationaleTh && (
              <p className="mt-1 text-text-primary" lang="th">
                {d.rationaleTh}
              </p>
            )}
            {d.rationaleEn && (
              <p className="mt-1 text-text-secondary">{d.rationaleEn}</p>
            )}
            {d.effectiveDate && (
              <p className="mt-1 text-[0.65rem] text-text-tertiary">
                Effective {formatDate(d.effectiveDate)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Footer band.
// ---------------------------------------------------------------------------

function FooterBand({
  overview,
  generatedAtLabel,
}: {
  overview: DeepDiveOverview;
  generatedAtLabel: string;
}) {
  return (
    <footer className="print-keep mt-2 rounded-md border border-border-subtle bg-surface-2/50 p-3 text-[0.65rem] text-text-tertiary">
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          KKU Curriculum Compass · ทักษทัศน์ — Internal program detail report
        </span>
        <span className="font-tabular">{overview.program.code}</span>
      </div>
      <div className="mt-1 flex flex-wrap justify-between gap-2">
        <span>
          Methodology {overview.methodologyVersion} · health{' '}
          {overview.health?.methodologyVersion ?? '—'}
        </span>
        <span>Generated {generatedAtLabel}</span>
      </div>
      <p className="mt-2 leading-relaxed">
        This document is for internal KKU use. Figures may include preview-quality
        connectors still completing their 30-day green-history gate. Refer to the
        live deep-dive page for the most recent values, and to the methodology docs
        in <span className="font-tabular">docs/methodologies/</span> for the
        calculation specification.
      </p>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-CA');
}

// Per-programme setup checklist. For ONE programme it answers "which parts of
// the Deep-Dive have real data, which are empty, and what do I do to fill
// them?" — one item per Deep-Dive section plus one per health-score driver.
//
// Read-only. "Green" means what the readers would show: realDataWhere() is
// applied wherever the reader applies it, so a row stamped by a mock run never
// turns an item ok.
//
// DEGRADED. The pipeline's per-phase degraded results (regex-fallback courses,
// NO_TEXT, refused writes) are written to the job log only; nothing persists
// them per programme. So `degraded` here is derived from what the readers
// expose: low-confidence AI rows, a peer selection without its review, and
// courses whose method version marks a regex fallback. A degraded AI output
// still counts as green data elsewhere (D8) — it is flagged, not hidden.
import { prisma } from './index';
import { realDataWhere } from './data-quality';
import { IS_CANONICAL_PROGRAM } from './canonical-programs';
import { computeHealthScores, DIMENSION_DRIVERS, DRIVER_NOT_COMPUTED, type HealthDimension } from './health-score';
import {
  programDemandFunnel,
  programDemographicOutlook,
  programDigitalCompetency,
  programFaculty,
  programAiPeers,
  programStudentCohorts,
  programTcasStats,
  researchExpertiseReadiness,
} from './program-deep-dive';
import { driverNullNote, PUBLIC_BASIS_NOTE, usesPublicTcasBasis, type DriverNoteContext } from './checklist-driver-notes';
import { programRecruitment } from './program-recruitment';
import { curriculumRevisionReadiness } from './program-curriculum-revision';
import { programOverlapSection } from './program-overlap/read';

export type ChecklistGroup =
  | 'Programme'
  | 'Students'
  | 'Outcomes'
  | 'Finance'
  | 'Staff & research'
  | 'Curriculum'
  | 'Market & benchmarking'
  | 'Health score';

export type ChecklistStatus = 'ok' | 'empty' | 'not-applicable' | 'degraded';

export interface ChecklistWaitingOn {
  kind: 'dataset' | 'connector' | 'pipeline' | 'setting' | 'sibling';
  slug: string;
  label: string;
  href: string;
}

export interface ChecklistItem {
  key: string;
  group: ChecklistGroup;
  title: string;
  status: ChecklistStatus;
  note: string | null;
  waitingOn: ChecklistWaitingOn[];
}

export interface SetupChecklist {
  programId: string;
  programCode: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  generatedAt: string;
  /** `ready` = ok + degraded + notApplicable: a degraded AI output still counts
   *  as passing for the "N of M ready" figure (D8), and not-applicable is not a gap. */
  summary: { ok: number; empty: number; notApplicable: number; degraded: number; ready: number };
  items: ChecklistItem[];
}

// ─── What each item is waiting on ───────────────────────────────────────

const DATA_SETUP = '/admin/data-setup';
const ds = (slug: string, label: string): ChecklistWaitingOn => ({ kind: 'dataset', slug, label, href: DATA_SETUP });
const conn = (slug: string, label: string): ChecklistWaitingOn => ({
  kind: 'connector',
  slug,
  label,
  href: `/admin/data-sources/${slug}`,
});
/** `{programId}` is replaced when the checklist is built. */
const phase = (slug: string, label: string): ChecklistWaitingOn => ({
  kind: 'pipeline',
  slug,
  label,
  href: '/admin/programs/{programId}?tab=pipeline',
});
const organisation: ChecklistWaitingOn = {
  kind: 'setting',
  slug: 'organization',
  label: 'Organisation profile (region)',
  href: '/admin/organization',
};
const courseLists: ChecklistWaitingOn = {
  kind: 'sibling',
  slug: 'programme-courses',
  label: 'Programme course lists',
  href: DATA_SETUP,
};

/** The one step that builds a skill taxonomy on a fresh install. Named in the
 *  label because the page links to the pipeline tab, not to the docs. */
const skillTaxonomy: ChecklistWaitingOn = {
  kind: 'pipeline',
  slug: 'skills-normalise',
  label:
    'Run the pipeline again (it builds the skill taxonomy). ' +
    'Manual alternative: `pnpm skills:normalise --source=program_digest --auto-promote` ' +
    '(docs/adopters/README.md, "Building your skill taxonomy")',
  href: '/admin/programs/{programId}?tab=pipeline',
};
/** Items that read nothing until the taxonomy has skills in it. */
const NEEDS_TAXONOMY: ReadonlySet<string> = new Set([
  'section.skills',
  'section.ai-readiness',
  'driver.labour_market_alignment',
  'driver.demand_match_filled',
]);

const ENROLMENT = ds('enrollment-metrics', 'Enrolment');
const FINANCE = ds('financial-metrics', 'Finance');
const STAFF = ds('faculty-members', 'Staff');

/** Keyed by item key. Section items are listed by name; driver items are
 *  `driver.<label>` and cover every label in DIMENSION_DRIVERS. */
export const CHECKLIST_SOURCES: Readonly<Record<string, readonly ChecklistWaitingOn[]>> = {
  'section.curriculum-pdf': [
    { kind: 'pipeline', slug: 'files', label: 'Attach the curriculum PDF', href: '/admin/programs/{programId}?tab=files' },
  ],
  'section.strategic-narrative': [phase('phase7', 'Strategic narrative')],
  'section.ai-readiness': [phase('phase6', 'AI readiness')],
  'section.recruitment': [ds('admission-campaigns', 'Admission campaigns')],
  'section.tcas': [conn('tcas', 'TCAS admissions')],
  'section.cohorts': [ds('student-cohorts', 'Student cohorts')],
  'section.demand-funnel': [
    ds('student-cohorts', 'Student cohorts'),
    ds('alumni-cohorts', 'Alumni cohorts'),
    ds('admission-campaigns', 'Admission campaigns'),
  ],
  'section.demographic-outlook': [
    ds('population-projections', 'Population projections'),
    conn('un-wpp', 'UN population prospects'),
    ENROLMENT,
    organisation,
  ],
  'section.financials': [FINANCE],
  'section.skills': [phase('phase1', 'PDF extraction (skills)')],
  'section.outcomes': [ds('graduate-outcomes', 'Graduate outcomes')],
  'section.employer-feedback': [ds('employer-feedback', 'Employer feedback')],
  'section.digital-competency': [
    ds('digital-competency-cohorts', 'Digital competency cohorts'),
    ds('digital-competency-modules', 'Digital competency modules'),
  ],
  'section.faculty': [STAFF, ds('program-faculty', 'Programme staff links')],
  'section.research-expertise': [
    ds('research-outputs', 'Publications'),
    conn('openalex-works', 'OpenAlex works'),
    phase('phaseRE', 'Research expertise'),
  ],
  'section.curriculum-revision': [
    phase('phaseCR', 'Curriculum revision'),
    ds('research-outputs', 'Publications'),
    courseLists,
  ],
  'section.course-list': [courseLists, phase('phase2b', 'Courses extract')],
  'section.peers': [ds('ranked-universities', 'Ranked universities'), phase('phase5', 'AI benchmarking')],
  'section.overlap': [phase('phaseOV', 'Programme overlap'), courseLists],

  // Attractiveness
  'driver.tcas_competition_ratio': [conn('tcas', 'TCAS admissions'), ds('admission-campaigns', 'Admission campaigns')],
  'driver.tcas_fill_rate': [conn('tcas', 'TCAS admissions'), ds('admission-campaigns', 'Admission campaigns')],
  'driver.tcas_registration_yield': [conn('tcas', 'TCAS admissions'), ds('admission-campaigns', 'Admission campaigns')],
  'driver.tcas_competition_vs_peers': [conn('tcas', 'TCAS admissions'), ds('admission-campaigns', 'Admission campaigns')],
  'driver.enrollment_trend_slope': [ENROLMENT],
  'driver.kku_intake_policy': [ds('admission-campaigns', 'Admission campaigns')],
  // Financial
  'driver.net_contribution_per_student': [FINANCE, ENROLMENT],
  'driver.revenue_coverage_program_direct': [FINANCE],
  'driver.revenue_coverage_ratio': [FINANCE, ds('faculty-budgets', 'Faculty budgets')],
  'driver.net_contribution_per_program': [FINANCE],
  'driver.tuition_trend_slope': [FINANCE],
  'driver.revenue_scale': [FINANCE],
  // Capability
  'driver.senior_rank_share': [STAFF, ds('program-faculty', 'Programme staff links')],
  'driver.publications_per_faculty': [ds('research-outputs', 'Publications'), STAFF],
  'driver.retirement_horizon_5y': [STAFF],
  'driver.student_faculty_ratio': [STAFF, ENROLMENT],
  // Outcomes
  'driver.tcas_min_score_percentile': [conn('tcas', 'TCAS admissions')],
  'driver.employment_rate': [ds('graduate-outcomes', 'Graduate outcomes')],
  'driver.job_relevance': [ds('graduate-outcomes', 'Graduate outcomes')],
  'driver.average_salary': [ds('graduate-outcomes', 'Graduate outcomes')],
  'driver.further_study_rate': [ds('graduate-outcomes', 'Graduate outcomes')],
  'driver.student_satisfaction': [ds('course-evaluations', 'Course evaluations')],
  'driver.dq_digital_competency': [ds('digital-competency-cohorts', 'Digital competency cohorts')],
  // Relevance
  'driver.labour_market_alignment': [conn('kmitl-skill-mapping', 'Skill demand'), ds('career-skill-demand', 'Career skill demand')],
  'driver.demand_match_filled': [phase('phase3', 'Careers and demand match')],
  'driver.demographic_resilience': [ds('population-projections', 'Population projections'), conn('un-wpp', 'UN population prospects')],
  'driver.strategic_sector_alignment': [phase('phase3', 'Careers and demand match')],
  'driver.pedagogical_fit': [phase('phase1', 'PDF extraction (pedagogy)')],
  'driver.jobthai_demand_alignment': [conn('jobthai', 'JobThai postings'), phase('phase3', 'Careers and demand match')],
};

// ─── Small helpers ──────────────────────────────────────────────────────

function waitingFor(key: string, programId: string, taxonomyEmpty = false): ChecklistWaitingOn[] {
  const sources = taxonomyEmpty && NEEDS_TAXONOMY.has(key)
    ? [skillTaxonomy, ...(CHECKLIST_SOURCES[key] ?? [])]
    : (CHECKLIST_SOURCES[key] ?? []);
  return sources.map((w) => ({ ...w, href: w.href.replace('{programId}', programId) }));
}

const LOW_CONFIDENCE = 0.5;

const NEEDS_KMITL_CONTEXT: ReadonlySet<string> = new Set(['labour_market_alignment', 'demand_match_filled']);

interface Verdict {
  status: ChecklistStatus;
  note: string | null;
  /** True when the item could not be checked: the page must not send anyone to upload data. */
  noWaiting?: boolean;
  /** Replaces the item's usual waiting-on list when the real blocker is narrower. */
  waiting?: readonly ChecklistWaitingOn[];
}
const CHECK_FAILED = 'Could not be checked — see server log.';
const failed = (): Verdict => ({ status: 'empty', note: CHECK_FAILED, noWaiting: true });
const ok = (note: string | null = null): Verdict => ({ status: 'ok', note });
const empty = (note: string | null = null): Verdict => ({ status: 'empty', note });
const na = (note: string): Verdict => ({ status: 'not-applicable', note });
const degraded = (note: string): Verdict => ({ status: 'degraded', note });
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

function humanise(label: string): string {
  const words = label.replace(/_/g, ' ').replace(/\b5y\b/, '(5 years)');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The scorer's own free-form null reason, when it recorded one. */
function rawReason(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const reason = (raw as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

interface SectionSpec {
  key: string;
  group: ChecklistGroup;
  title: string;
  check: () => Promise<Verdict>;
}

// ─── The checklist ──────────────────────────────────────────────────────

export async function programSetupChecklist(programId: string): Promise<SetupChecklist | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true, code: true, level: true, nameEn: true },
  });
  if (!program) return null;
  const bachelor = program.level === 'BACHELOR';
  const real = realDataWhere();

  const sections: SectionSpec[] = [
    {
      key: 'section.curriculum-pdf',
      group: 'Programme',
      title: 'Curriculum PDF linked',
      check: async () => {
        const n = await prisma.programDocument.count({ where: { programId, role: 'CURRENT_CURRICULUM' } });
        return n > 0 ? ok() : empty('No current curriculum document is attached.');
      },
    },
    {
      key: 'section.strategic-narrative',
      group: 'Programme',
      title: 'Strategic narrative',
      check: async () => {
        const row = await prisma.programStrategicNarrative.findUnique({
          where: { programId },
          select: { confidence: true },
        });
        if (!row) return empty();
        return row.confidence < LOW_CONFIDENCE ? degraded(`degraded — confidence ${row.confidence.toFixed(2)}`) : ok();
      },
    },
    {
      key: 'section.ai-readiness',
      group: 'Programme',
      title: 'AI readiness',
      check: async () => {
        const row = await prisma.programAiReadinessAssessment.findUnique({
          where: { programId },
          select: { confidence: true },
        });
        if (!row) {
          // The pipeline does not persist phase results, but a failed AI call
          // leaves a confidence-0 inference row whose prompt names the programme.
          const last = await prisma.aiInference.findFirst({
            where: { kind: 'program-ai-readiness', prompt: { contains: program.nameEn } },
            orderBy: { createdAt: 'desc' },
            select: { confidence: true },
          });
          return last && (last.confidence ?? 0) === 0
            ? empty('The AI readiness phase failed on the last pipeline run — run the pipeline again.')
            : empty();
        }
        return row.confidence < LOW_CONFIDENCE ? degraded(`degraded — confidence ${row.confidence.toFixed(2)}`) : ok();
      },
    },
    {
      key: 'section.recruitment',
      group: 'Students',
      title: 'Recruitment funnel',
      check: async () => {
        const r = await programRecruitment(programId);
        return r.byYear.length > 0 ? ok(count(r.byYear.length, 'admission year')) : empty();
      },
    },
    {
      key: 'section.tcas',
      group: 'Students',
      title: 'TCAS admissions',
      check: async () => {
        if (!bachelor) return na('TCAS covers bachelor programmes only.');
        const r = await programTcasStats(programId);
        return r.history.length > 0 ? ok(count(r.history.length, 'row')) : empty();
      },
    },
    {
      key: 'section.cohorts',
      group: 'Students',
      title: 'Student cohorts',
      check: async () => {
        const r = await programStudentCohorts(programId);
        return r.cohorts.length > 0 ? ok(count(r.cohorts.length, 'cohort')) : empty();
      },
    },
    {
      key: 'section.demand-funnel',
      group: 'Students',
      title: 'Demand funnel',
      check: async () => {
        const r = await programDemandFunnel(programId);
        return r.stages.length > 0 ? ok() : empty();
      },
    },
    {
      key: 'section.demographic-outlook',
      group: 'Students',
      title: 'Demographic outlook',
      check: async () => {
        const r = await programDemographicOutlook(programId);
        return r && r.projections.length > 0 ? ok() : empty();
      },
    },
    {
      key: 'section.financials',
      group: 'Finance',
      title: 'Financials',
      check: async () => {
        const n = await prisma.financialMetric.count({ where: { programId, ...real } });
        return n > 0 ? ok(count(n, 'year')) : empty();
      },
    },
    {
      key: 'section.skills',
      group: 'Curriculum',
      title: 'Skills taught',
      check: async () => {
        const n = await prisma.programSkill.count({ where: { programId } });
        return n > 0 ? ok(count(n, 'skill')) : empty();
      },
    },
    {
      key: 'section.outcomes',
      group: 'Outcomes',
      title: 'Graduate outcomes',
      check: async () => {
        const n = await prisma.graduateOutcome.count({ where: { programId, ...real } });
        return n > 0 ? ok(count(n, 'survey row')) : empty();
      },
    },
    {
      key: 'section.employer-feedback',
      group: 'Outcomes',
      title: 'Employer feedback',
      check: async () => {
        const n = await prisma.employerFeedback.count({ where: { programId, ...real } });
        return n > 0 ? ok(count(n, 'row')) : empty();
      },
    },
    {
      key: 'section.digital-competency',
      group: 'Outcomes',
      title: 'Digital competency',
      check: async () => {
        if (!bachelor) return na('Digital competency covers bachelor programmes only.');
        const r = await programDigitalCompetency(programId);
        if (r.status === 'ok') return ok();
        if (r.status === 'not-applicable') return na('Digital competency covers bachelor programmes only.');
        if (r.status === 'below-floor') return empty('Too few students to show a figure (privacy floor).');
        return empty();
      },
    },
    {
      key: 'section.faculty',
      group: 'Staff & research',
      title: 'Staff roster',
      check: async () => {
        const r = await programFaculty(programId, 'aggregates-only');
        return r.totalActive > 0 ? ok(`${count(r.totalActive, 'active member')} (${r.rosterScope} roster)`) : empty();
      },
    },
    {
      key: 'section.research-expertise',
      group: 'Staff & research',
      title: 'Research expertise',
      check: async () => {
        const [row, r] = await Promise.all([
          prisma.programResearchExpertise.findFirst({ where: { programId }, select: { id: true } }),
          researchExpertiseReadiness(programId),
        ]);
        if (row) return ok();
        if (!r) return empty();
        if (r.readiness === 'no-roster') return empty('No staff roster yet.');
        if (r.readiness === 'thin') return empty(`Only ${r.distinctPaperCount} papers found; the analysis needs more.`);
        return empty('Ready to generate — run the research expertise phase.');
      },
    },
    {
      key: 'section.curriculum-revision',
      group: 'Curriculum',
      title: 'Curriculum revision advice',
      check: async () => {
        const [row, r] = await Promise.all([
          prisma.programCurriculumRevision.findFirst({ where: { programId }, select: { id: true } }),
          curriculumRevisionReadiness(programId),
        ]);
        if (row) return ok();
        if (!r) return empty();
        if (r.readiness === 'no-courses') return empty('No course list yet.');
        if (r.readiness === 'no-research') return empty('No research analysis yet.');
        if (r.readiness === 'thin') return empty(`Only ${r.distinctPaperCount} papers found; the analysis needs more.`);
        return empty('Ready to generate — run the curriculum revision phase.');
      },
    },
    {
      key: 'section.course-list',
      group: 'Curriculum',
      title: 'Course list',
      check: async () => {
        const [n, fallback] = await Promise.all([
          prisma.programCourse.count({ where: { programId } }),
          prisma.programCourse.count({ where: { programId, methodVersion: { endsWith: '-fallback' } } }),
        ]);
        if (n === 0) return empty();
        return fallback > 0
          ? degraded(`degraded — ${count(fallback, 'course')} came from the regex fallback`)
          : ok(count(n, 'course'));
      },
    },
    {
      key: 'section.peers',
      group: 'Market & benchmarking',
      title: 'Peer benchmarking',
      check: async () => {
        const r = await programAiPeers(programId);
        const n = r.tiers.WORLD.length + r.tiers.ASIA.length + r.tiers.SOUTHEAST_ASIA.length + r.tiers.THAILAND_PEER.length;
        if (n === 0) return empty();
        return r.review ? ok(count(n, 'peer')) : degraded('degraded — peers selected but no comparative review');
      },
    },
    {
      key: 'section.overlap',
      group: 'Market & benchmarking',
      title: 'Programme overlap',
      check: async () => {
        const section = await programOverlapSection(programId);
        if (section) return ok(count(section.siblings.length, 'overlapping programme'));
        // D7: nothing to compare is not a gap the adopter can fix here.
        const sibling = await prisma.program.count({
          where: {
            ...IS_CANONICAL_PROGRAM,
            status: 'ACTIVE',
            level: program.level,
            id: { not: programId },
            programCourses: { some: {} },
          },
        });
        if (sibling === 0) return na('No other programme at this level has a course list to compare with.');
        // Siblings have course lists, so the only thing missing is the run.
        return {
          status: 'empty',
          note: 'Run the pipeline overlap phase (phaseOV).',
          waiting: [phase('phaseOV', 'Programme overlap')],
        };
      },
    },
  ];

  const [sectionVerdicts, scores, skillCount] = await Promise.all([
    Promise.all(sections.map((s) => s.check().catch((err: unknown): Verdict => {
        console.warn(`[setup-checklist] ${s.key} failed: ${err instanceof Error ? err.name : 'error'}`);
        return failed();
      }))),
    computeHealthScores('program', programId).catch((err: unknown) => {
      console.warn(`[setup-checklist] health score failed: ${err instanceof Error ? err.name : 'error'}`);
      return [];
    }),
    prisma.skill.count().catch(() => 1),
  ]);
  const taxonomyEmpty = skillCount === 0;

  const items: ChecklistItem[] = sections.map((s, i) => ({
    key: s.key,
    group: s.group,
    title: s.title,
    status: sectionVerdicts[i]!.status,
    note: sectionVerdicts[i]!.note,
    waitingOn: sectionVerdicts[i]!.noWaiting
      ? []
      : (sectionVerdicts[i]!.waiting ?? waitingFor(s.key, programId, taxonomyEmpty)).map((w) => ({
          ...w,
          href: w.href.replace('{programId}', programId),
        })),
  }));

  let kmitlMemo: Promise<DriverNoteContext> | null = null;
  const kmitlContext = (): Promise<DriverNoteContext> => {
    kmitlMemo ??= Promise.all([
      prisma.kmitlCareerSkillDemand.count(),
      prisma.kmitlCareerSkillDemand.count({ where: { skillId: { not: null } } }),
    ])
      .then(([kmitlRows, kmitlLinked]) => ({ kmitlRows, kmitlLinked }))
      .catch(() => ({ kmitlRows: null, kmitlLinked: null }));
    return kmitlMemo;
  };
  const jobThaiLoaded = (): Promise<boolean> =>
    prisma.ingestionRun
      .findFirst({
        // A mocked source never counts as loaded.
        where: { status: 'SUCCEEDED', dataSource: { slug: 'jobthai', mocked: false } },
        select: { id: true },
      })
      .then((r) => r !== null)
      .catch(() => true);

  const dimensions = scores[0]?.dimensions;
  for (const dimension of Object.keys(DIMENSION_DRIVERS) as HealthDimension[]) {
    const drivers = dimensions?.[dimension].drivers ?? [];
    for (const label of DIMENSION_DRIVERS[dimension]) {
      const driver = drivers.find((d) => d.label === label);
      let verdict: Verdict;
      if (!dimensions) verdict = failed();
      else if (!bachelor && label.startsWith('tcas_')) verdict = na('TCAS covers bachelor programmes only.');
      else if (!driver) verdict = na('This driver does not apply to this programme.');
      else if (driver.value !== null) verdict = ok(usesPublicTcasBasis(driver.raw) ? PUBLIC_BASIS_NOTE : null);
      else if (driver.raw === DRIVER_NOT_COMPUTED || (driver.raw as { notComputedAtThisScope?: boolean } | null)?.notComputedAtThisScope) {
        verdict = empty('Not computed for this programme.');
      } else if (label === 'jobthai_demand_alignment' && !(await jobThaiLoaded())) {
        // A commercial feed most installations never connect: not a gap.
        verdict = na('JobThai postings are not loaded on this installation (commercial feed).');
      } else {
        const ctx = NEEDS_KMITL_CONTEXT.has(label) ? await kmitlContext() : { kmitlRows: null, kmitlLinked: null };
        // A short plain sentence beats the scorer's bare token ('no-links').
        verdict = empty(driverNullNote(label, driver.raw, ctx) ?? rawReason(driver.raw));
      }
      const key = `driver.${label}`;
      items.push({
        key,
        group: 'Health score',
        title: humanise(label),
        status: verdict.status,
        note: verdict.note,
        waitingOn: verdict.noWaiting || verdict.status === 'not-applicable' ? [] : waitingFor(key, programId, taxonomyEmpty),
      });
    }
  }

  const tally = (s: ChecklistStatus): number => items.filter((i) => i.status === s).length;
  return {
    programId: program.id,
    programCode: program.code,
    level: program.level,
    generatedAt: new Date().toISOString(),
    summary: {
      ok: tally('ok'),
      empty: tally('empty'),
      notApplicable: tally('not-applicable'),
      degraded: tally('degraded'),
      ready: items.length - tally('empty'),
    },
    items,
  };
}

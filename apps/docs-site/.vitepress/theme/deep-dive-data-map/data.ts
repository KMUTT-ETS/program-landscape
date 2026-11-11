/**
 * Content for the Deep-Dive data map (docs/adopters/deep-dive-data-map.md).
 *
 * The plain-language text is written by hand. The structure is not free: a test in
 * packages/db/test/deep-dive-data-map-doc.test.ts checks it against the code it describes.
 *   - Every driver in DIMENSION_DRIVERS (packages/db/src/health-score/drivers.ts) appears here under
 *     the same dimension, and nothing else does (the grant award is marked `award`).
 *   - A driver's or section's `in` list is exactly what CHECKLIST_SOURCES
 *     (packages/db/src/program-setup-checklist.ts) names for it, mapped through each input's
 *     `sources`. Inputs the code reads that the checklist does not name go in `alsoReads`.
 * So when a driver or a checklist source changes, the test fails until this file follows.
 */

export type DimensionId = 'attractiveness' | 'financial' | 'capability' | 'outcomes' | 'relevance';
export type InputKind = 'setting' | 'sheet' | 'connector' | 'pipeline';

export interface MapDimension {
  id: DimensionId;
  name: string;
  question: string;
  /** A VitePress colour variable, so the map follows the site's light/dark theme. */
  color: string;
}

export interface MapInput {
  id: string;
  kind: InputKind;
  name: string;
  /** Where an operator finds it: dataset slug, connector slug or admin page. */
  where: string;
  /** Load this first; most of the page depends on it. */
  core?: boolean;
  /** Checklist sources this input stands for, as `<kind>:<slug>` of ChecklistWaitingOn. */
  sources: readonly string[];
}

export interface MapDriver {
  dimension: DimensionId;
  /** The driver label in DIMENSION_DRIVERS. */
  key: string;
  name: string;
  how: string;
  note?: string;
  in: readonly string[];
  alsoReads?: readonly string[];
  /** Computed only for faculty, department and university scores, not for a programme. */
  rollupOnly?: boolean;
  /** The Financial grant award: added after the average, not a driver. */
  award?: boolean;
}

export interface MapSection {
  /** The section key in CHECKLIST_SOURCES, without the `section.` prefix. */
  key: string;
  name: string;
  in: readonly string[];
}

export const MAP_DIMENSIONS: readonly MapDimension[] = [
  { id: 'attractiveness', name: 'Attractiveness', question: 'Do students want to study here?', color: 'var(--vp-c-red-1)' },
  { id: 'financial', name: 'Financial', question: 'Does the programme pay its way? Uses the last complete academic year.', color: 'var(--vp-c-green-1)' },
  { id: 'capability', name: 'Capability', question: 'Can the teaching team deliver it?', color: 'var(--vp-c-indigo-1)' },
  { id: 'outcomes', name: 'Outcomes', question: 'How strong are the students coming in, and what happens to graduates?', color: 'var(--vp-c-yellow-1)' },
  { id: 'relevance', name: 'Relevance', question: 'Does it teach what employers and the future need?', color: 'var(--vp-c-purple-1)' },
];

export const INPUT_KIND_LABEL: Readonly<Record<InputKind, string>> = {
  setting: 'Admin settings',
  sheet: 'Spreadsheet uploads',
  connector: 'Public data connectors',
  pipeline: 'Curriculum PDF + AI pipeline',
};

export const MAP_INPUTS: readonly MapInput[] = [
  { id: 'org', kind: 'setting', name: 'Organisation profile', where: '/admin/organization: region, intake floors, Thai name', core: true, sources: ['setting:organization'] },
  { id: 'backbone', kind: 'sheet', name: 'Faculties, departments, programmes', where: 'faculties · departments · programmes', core: true, sources: [] },
  { id: 'enrol', kind: 'sheet', name: 'Enrolment', where: 'enrollment-metrics', core: true, sources: ['dataset:enrollment-metrics'] },
  { id: 'finance', kind: 'sheet', name: 'Finance (revenue)', where: 'financial-metrics', core: true, sources: ['dataset:financial-metrics'] },
  { id: 'adm', kind: 'sheet', name: 'Admission campaigns', where: 'admission-campaigns', core: true, sources: ['dataset:admission-campaigns'] },
  { id: 'staff', kind: 'sheet', name: 'Staff', where: 'faculty-members', core: true, sources: ['dataset:faculty-members'] },
  { id: 'pstaff', kind: 'sheet', name: 'Programme teaching staff', where: 'program-faculty', core: true, sources: ['dataset:program-faculty'] },
  { id: 'gout', kind: 'sheet', name: 'Graduate outcomes', where: 'graduate-outcomes', core: true, sources: ['dataset:graduate-outcomes'] },
  { id: 'pubs', kind: 'sheet', name: 'Publications', where: 'research-outputs, or the openalex-works connector', sources: ['dataset:research-outputs', 'connector:openalex-works'] },
  { id: 'evals', kind: 'sheet', name: 'Course evaluations', where: 'course-evaluations', sources: ['dataset:course-evaluations'] },
  { id: 'dq', kind: 'sheet', name: 'Digital competency', where: 'digital-competency-cohorts · -modules', sources: ['dataset:digital-competency-cohorts', 'dataset:digital-competency-modules'] },
  { id: 'grants', kind: 'sheet', name: 'External grants and grant team', where: 'external-grants · external-grant-team', sources: [] },
  { id: 'budgets', kind: 'sheet', name: 'Faculty budgets', where: 'faculty-budgets', sources: ['dataset:faculty-budgets'] },
  { id: 'cohorts', kind: 'sheet', name: 'Student and alumni cohorts', where: 'student-cohorts · alumni-cohorts', sources: ['dataset:student-cohorts', 'dataset:alumni-cohorts'] },
  { id: 'courses', kind: 'sheet', name: 'Programme course lists', where: 'programme-courses, or read from the PDF', sources: ['sibling:programme-courses'] },
  { id: 'employer', kind: 'sheet', name: 'Employer feedback', where: 'employer-feedback', sources: ['dataset:employer-feedback'] },
  { id: 'rank', kind: 'sheet', name: 'Ranked universities', where: 'ranked-universities', sources: ['dataset:ranked-universities'] },
  { id: 'tcas', kind: 'connector', name: 'TCAS national admissions', where: 'tcas (public files)', core: true, sources: ['connector:tcas'] },
  { id: 'pop', kind: 'connector', name: 'Population projections', where: 'un-wpp, or the population-projections sheet', sources: ['connector:un-wpp', 'dataset:population-projections'] },
  { id: 'skilld', kind: 'connector', name: 'Labour-market skill demand', where: 'kmitl-skill-mapping, or the career-skill-demand sheet', sources: ['connector:kmitl-skill-mapping', 'dataset:career-skill-demand'] },
  { id: 'jobthai', kind: 'connector', name: 'JobThai job ads', where: 'jobthai (commercial, optional)', sources: ['connector:jobthai'] },
  {
    id: 'pdf',
    kind: 'pipeline',
    name: 'Curriculum PDF + AI pipeline',
    where: 'files tab, then "Run full pipeline"',
    core: true,
    sources: [
      'pipeline:files', 'pipeline:phase1', 'pipeline:phase2b', 'pipeline:phase3', 'pipeline:phase5',
      'pipeline:phase6', 'pipeline:phase7', 'pipeline:phaseRE', 'pipeline:phaseCR', 'pipeline:phaseOV',
    ],
  },
];

export const MAP_DRIVERS: readonly MapDriver[] = [
  // Attractiveness
  { dimension: 'attractiveness', key: 'tcas_competition_ratio', name: 'Applicants per seat', how: 'Applicants ÷ planned seats for the latest complete year.', in: ['tcas', 'adm'], note: 'When the admissions sheet states no seats, the public TCAS round-3 figures are used instead.' },
  { dimension: 'attractiveness', key: 'tcas_fill_rate', name: 'Seat fill rate', how: 'Students admitted ÷ seats offered.', in: ['tcas', 'adm'] },
  { dimension: 'attractiveness', key: 'tcas_registration_yield', name: 'Registration yield', how: 'Students who registered ÷ students who confirmed a place.', in: ['tcas', 'adm'], note: 'Needs the Confirmed and Reported columns of the admissions sheet. There is no public substitute.' },
  { dimension: 'attractiveness', key: 'tcas_competition_vs_peers', name: 'Competition vs similar programmes', how: 'Applicants per seat ÷ the national median for the same subject. 50 means the same as peers, 100 means twice as competitive.', in: ['tcas', 'adm'] },
  { dimension: 'attractiveness', key: 'enrollment_trend_slope', name: 'Enrolment trend', how: 'Slope of enrolled students over the last five years. Growth scores above 50.', in: ['enrol'] },
  { dimension: 'attractiveness', key: 'kku_intake_policy', name: 'Intake vs minimum', how: 'Latest intake against the minimum the university sets (defaults: 30 bachelor, 8 postgraduate).', in: ['adm'], alsoReads: ['org'], note: 'Null when no minimum is configured.' },
  // Financial
  { dimension: 'financial', key: 'net_contribution_per_student', name: 'Net contribution per student', how: '(Revenue − costs) ÷ enrolled students. ฿100k gives 100, ฿0 gives 50, losses fall toward 0.', in: ['finance', 'enrol'] },
  { dimension: 'financial', key: 'revenue_coverage_program_direct', name: 'Revenue covers costs', how: 'Tuition ÷ direct, facility and overhead costs. 1.0 gives 80, 1.2 or more gives 100.', in: ['finance'], note: 'The Finance sheet carries revenue only. With no cost figures, any revenue scores 80.' },
  { dimension: 'financial', key: 'tuition_trend_slope', name: 'Tuition trend', how: 'Slope of tuition revenue over the years loaded. Growth scores higher.', in: ['finance'] },
  { dimension: 'financial', key: 'revenue_scale', name: 'Revenue scale', how: 'Annual revenue against a target for the degree level.', in: ['finance'], alsoReads: ['backbone'] },
  { dimension: 'financial', key: 'revenue_coverage_ratio', name: 'Revenue coverage (roll-up)', how: 'Total revenue ÷ total cost across the scope\'s programmes.', in: ['finance', 'budgets'], rollupOnly: true },
  { dimension: 'financial', key: 'net_contribution_per_program', name: 'Net contribution per programme (roll-up)', how: 'Net contribution averaged over the scope\'s programmes.', in: ['finance'], rollupOnly: true },
  { dimension: 'financial', key: 'grant_award', name: 'Grant award (+0 to +10)', how: 'Added after the average: external grant money per teaching staff member per year over the last three fiscal years. ฿0.1M gives +0, ฿3M or more gives +10.', in: [], alsoReads: ['grants', 'staff', 'pstaff'], note: 'A bonus only. It never lowers a score and does not count toward completeness.', award: true },
  // Capability
  { dimension: 'capability', key: 'senior_rank_share', name: 'Senior staff share', how: '(Professors + Associate Professors) ÷ active teaching staff. 50% gives 100.', in: ['staff', 'pstaff'] },
  { dimension: 'capability', key: 'publications_per_faculty', name: 'Publications per staff member', how: 'Papers in the last three years ÷ active teaching staff. Five a year gives 100.', in: ['pubs', 'staff'], alsoReads: ['pstaff'] },
  { dimension: 'capability', key: 'retirement_horizon_5y', name: 'Retirement horizon', how: 'Share of the team not retiring in the next five years. Needs a retirement date per person.', in: ['staff'], alsoReads: ['pstaff'] },
  { dimension: 'capability', key: 'student_faculty_ratio', name: 'Students per staff member', how: 'Enrolled ÷ teaching staff, judged against a band for the faculty\'s Teaching Mode (clinical, lab-based, studio, professional, humanities).', in: ['staff', 'enrol'], alsoReads: ['pstaff', 'backbone'] },
  // Outcomes
  { dimension: 'outcomes', key: 'tcas_min_score_percentile', name: 'Entry score vs peers', how: 'Where the programme\'s minimum admission score sits among programmes of the same subject nationally.', in: ['tcas'], note: 'Bachelor programmes only.' },
  { dimension: 'outcomes', key: 'employment_rate', name: 'Employment rate', how: 'Share of surveyed graduates in work.', in: ['gout'] },
  { dimension: 'outcomes', key: 'job_relevance', name: 'Job in field', how: 'Share of employed graduates whose job matches what they studied.', in: ['gout'] },
  { dimension: 'outcomes', key: 'average_salary', name: 'Starting salary', how: '฿15k gives 0, ฿20k gives 40, ฿25k gives 70, ฿35k or more gives 100.', in: ['gout'] },
  { dimension: 'outcomes', key: 'further_study_rate', name: 'Further study rate', how: 'Best between 5% and 15%. Very low or very high (30% or more) both score lower.', in: ['gout'] },
  { dimension: 'outcomes', key: 'student_satisfaction', name: 'Student satisfaction', how: 'Mean course-evaluation rating on a 5-point scale: 3.5 gives 0, 5.0 gives 100.', in: ['evals'] },
  { dimension: 'outcomes', key: 'dq_digital_competency', name: 'Digital competency', how: 'Mean digital-skills test score: 50 gives 0, 70 gives 50, 90 gives 100.', in: ['dq'], note: 'Bachelor programmes only, and only when at least five students took the test.' },
  // Relevance
  { dimension: 'relevance', key: 'labour_market_alignment', name: 'Skills employers ask for (global)', how: 'Share of the skills the curriculum teaches that appear in labour-market demand data (LinkedIn, via the KMITL skill-mapping service).', in: ['skilld'], alsoReads: ['pdf'], note: 'Paired with the JobThai driver: 25% here, 75% JobThai. Without JobThai this counts in full.' },
  { dimension: 'relevance', key: 'demand_match_filled', name: 'Demand coverage', how: 'Of the in-demand skills relevant to the field, the share the curriculum already teaches (an AI check).', in: ['pdf'], alsoReads: ['skilld'] },
  { dimension: 'relevance', key: 'demographic_resilience', name: 'Population outlook', how: 'Projected size of the 18–22 age group in the university\'s region ten years from now. A shrinking pool scores lower.', in: ['pop'], alsoReads: ['org'], note: 'Null until the organisation region is set.' },
  { dimension: 'relevance', key: 'strategic_sector_alignment', name: 'National priority sectors', how: '100 when the programme\'s careers map to a national target sector, otherwise 50.', in: ['pdf'], alsoReads: ['skilld'] },
  { dimension: 'relevance', key: 'pedagogical_fit', name: 'Teaching-method fit', how: 'AI reading of the curriculum: do its teaching methods suit the discipline (labs, clinical practice, studio work and so on)?', in: ['pdf'] },
  { dimension: 'relevance', key: 'jobthai_demand_alignment', name: 'Skills employers ask for (Thailand)', how: 'Share of taught skills demanded in Thai job ads linked to the field.', in: ['jobthai', 'pdf'], note: 'Commercial feed. Reads "not applicable" without it, which is not a failure.' },
];

export const MAP_SECTIONS: readonly MapSection[] = [
  { key: 'curriculum-pdf', name: 'Curriculum PDF linked', in: ['pdf'] },
  { key: 'strategic-narrative', name: 'Strategic narrative', in: ['pdf'] },
  { key: 'ai-readiness', name: 'AI readiness', in: ['pdf'] },
  { key: 'recruitment', name: 'Recruitment funnel', in: ['adm'] },
  { key: 'tcas', name: 'TCAS admissions', in: ['tcas'] },
  { key: 'cohorts', name: 'Student cohorts', in: ['cohorts'] },
  { key: 'demand-funnel', name: 'Demand funnel', in: ['cohorts', 'adm'] },
  { key: 'demographic-outlook', name: 'Demographic outlook', in: ['pop', 'enrol', 'org'] },
  { key: 'financials', name: 'Financials', in: ['finance'] },
  { key: 'skills', name: 'Skills taught', in: ['pdf'] },
  { key: 'outcomes', name: 'Graduate outcomes', in: ['gout'] },
  { key: 'employer-feedback', name: 'Employer feedback', in: ['employer'] },
  { key: 'digital-competency', name: 'Digital competency', in: ['dq'] },
  { key: 'faculty', name: 'Staff roster', in: ['staff', 'pstaff'] },
  { key: 'research-expertise', name: 'Research expertise', in: ['pubs', 'pdf'] },
  { key: 'curriculum-revision', name: 'Curriculum revision advice', in: ['pdf', 'pubs', 'courses'] },
  { key: 'course-list', name: 'Course list', in: ['courses', 'pdf'] },
  { key: 'peers', name: 'Peer benchmarking', in: ['rank', 'pdf'] },
  { key: 'overlap', name: 'Programme overlap', in: ['pdf', 'courses'] },
];

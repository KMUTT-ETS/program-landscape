import { describe, expect, it, vi, beforeEach } from 'vitest';

// The rule under test throughout: a resolver reports `available: false`
// rather than a zero, an empty array dressed as a value, or a thrown
// error. "No evidence for 4.2" is the output this feature exists to
// produce; a zero would read as "assessed and scored nothing".

const mocks = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  programSkillAggregate: vi.fn(),
  programCourseAggregate: vi.fn(),
  programFindUnique: vi.fn(),
  enrollmentFindFirst: vi.fn(),
  pedagogyFindUnique: vi.fn(),
  programSkills: vi.fn(),
  programCourses: vi.fn(),
  programOutcomes: vi.fn(),
  programFaculty: vi.fn(),
  programStudentCohorts: vi.fn(),
  programDigitalCompetency: vi.fn(),
  programAiPeers: vi.fn(),
  dqCompetencyByScope: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    $queryRawUnsafe: mocks.queryRawUnsafe,
    programSkill: { aggregate: mocks.programSkillAggregate },
    programCourse: { aggregate: mocks.programCourseAggregate },
    program: { findUnique: mocks.programFindUnique },
    enrollmentMetric: { findFirst: mocks.enrollmentFindFirst },
    programPedagogyAssessment: { findUnique: mocks.pedagogyFindUnique },
  },
}));

vi.mock('../src/program-deep-dive', () => ({
  programSkills: mocks.programSkills,
  programCourses: mocks.programCourses,
  programOutcomes: mocks.programOutcomes,
  programFaculty: mocks.programFaculty,
  programStudentCohorts: mocks.programStudentCohorts,
  programDigitalCompetency: mocks.programDigitalCompetency,
  programAiPeers: mocks.programAiPeers,
}));

vi.mock('../src/student-dq', () => ({
  dqCompetencyByScope: mocks.dqCompetencyByScope,
}));

import { allEvidenceBindings, type EvidenceBinding } from '@kku/shared';
import {
  resolveEvidenceForProgram,
  type CohortProgressionValue,
  type EvaluationThemeValue,
  type StaffResearchValue,
} from '../src/aunqa-evidence';

/** Every binding the registry uses, plus the two the registry happens not
 *  to reference today, so the invariant tests cover every resolver. */
function everyBinding(): EvidenceBinding[] {
  const extras: EvidenceBinding[] = [
    { kind: 'graduate-outcome', field: 'furtherStudy' },
    { kind: 'cohort-progression' },
  ];
  return [...allEvidenceBindings(), ...extras];
}

/** Every source empty — the state of a programme nobody has ingested,
 *  extracted or surveyed. */
function emptyEverything(): void {
  mocks.queryRawUnsafe.mockResolvedValue([]);
  mocks.programSkillAggregate.mockResolvedValue({ _max: { computedAt: null } });
  mocks.programCourseAggregate.mockResolvedValue({
    _max: { refreshedAt: null },
    _sum: { credits: null },
    _count: { _all: 0 },
  });
  mocks.programFindUnique.mockResolvedValue({ totalCredits: null, durationYears: null });
  mocks.enrollmentFindFirst.mockResolvedValue(null);
  mocks.pedagogyFindUnique.mockResolvedValue(null);
  mocks.programSkills.mockResolvedValue({
    taught: [],
    ploSkillCount: 0,
    majorContributorCount: 0,
    minorContributorCount: 0,
  });
  mocks.programCourses.mockResolvedValue({
    extractedCount: 0,
    total: 0,
    rows: [],
    yearsObserved: [],
  });
  mocks.programOutcomes.mockResolvedValue({ latest: null });
  mocks.programFaculty.mockResolvedValue({
    totalActive: 0,
    ranks: {},
    retiringWithin5Years: 0,
    totalPublications: 0,
    rosterScope: 'faculty',
  });
  mocks.programStudentCohorts.mockResolvedValue({
    cohorts: [],
    totalActive: 0,
    incomingCount: 0,
    onTrackCount: 0,
    delayedCount: 0,
    programDurationYears: null,
    refreshedAt: null,
  });
  mocks.programDigitalCompetency.mockResolvedValue({
    status: 'no-data',
    rawMean: null,
    scoredStudents: 0,
    modules: [],
    weakest: [],
  });
  mocks.programAiPeers.mockResolvedValue({ review: null });
  mocks.dqCompetencyByScope.mockResolvedValue({ rawMean: null, scoredStudents: 0, programCount: 0 });
}

/** Every source populated — a well-evidenced programme. */
function fullEverything(): void {
  mocks.queryRawUnsafe.mockImplementation((sql: string) => {
    if (sql.includes('evaluation_response_summaries')) {
      return Promise.resolve([
        {
          rating_avg: 4.31,
          respondents: 1200n,
          cells: 340n,
          questions: 8n,
          first_year: 2563,
          last_year: 2567,
          freshness: new Date('2026-06-01'),
        },
      ]);
    }
    return Promise.resolve([
      { acad_year_be: 2567, teachers: 40n, sections: 120n, contact_hrs: 480 },
    ]);
  });
  mocks.programSkillAggregate.mockResolvedValue({ _max: { computedAt: new Date('2026-05-01') } });
  mocks.programCourseAggregate.mockResolvedValue({
    _max: { refreshedAt: new Date('2026-05-02') },
    _sum: { credits: 120 },
    _count: { _all: 40 },
  });
  mocks.programFindUnique.mockResolvedValue({ totalCredits: 138, durationYears: 4 });
  mocks.enrollmentFindFirst.mockResolvedValue({
    academicYear: 2567,
    enrolled: 400,
    freshnessDate: new Date('2026-04-01'),
  });
  mocks.pedagogyFindUnique.mockResolvedValue({
    disciplineFitScore: 72,
    qaScore: 65,
    overallScore: 69,
    confidence: 0.9,
    methodVersion: 'program-pedagogy.v1.1',
    generatedAt: new Date('2026-08-01'),
    payloadJson: {
      qaSystem: {
        framework: 'TQF',
        continuousImprovementEvidence: ['PDCA cycle described'],
        stakeholderFeedbackLoops: ['alumni survey'],
      },
      gaps: [
        { area: 'Industry internship', severity: 'moderate', observation: 'o', recommendation: 'r' },
      ],
    },
  });
  mocks.programSkills.mockResolvedValue({
    taught: [
      { skillId: 's1', nameEn: 'Programming', nameTh: 'x', weight: 0.9, compulsoryWeight: 0.9, electiveWeight: 0, pickedFromPlo: true, evidenceQuote: null },
    ],
    ploSkillCount: 1,
    majorContributorCount: 1,
    minorContributorCount: 0,
  });
  mocks.programCourses.mockResolvedValue({
    extractedCount: 40,
    total: 2,
    rows: [
      { courseCode: 'EN001', classGpa: 3.2, classCount: 4, gradedCount: 200 },
      { courseCode: 'EN002', classGpa: 2.4, classCount: 2, gradedCount: 100 },
    ],
    yearsObserved: [2565, 2566, 2567],
  });
  mocks.programOutcomes.mockResolvedValue({
    latest: {
      graduationYear: 2566,
      employmentRate: 88.5,
      averageSalary: 21000,
      jobRelevanceScore: 4.1,
      furtherStudyRate: 6.2,
      sampleSize: 120,
      freshnessDate: new Date('2026-03-01'),
    },
  });
  mocks.programFaculty.mockResolvedValue({
    totalActive: 30,
    ranks: { PROF: 3, ASSOC_PROF: 9, ASST_PROF: 10, LECTURER: 8 },
    retiringWithin5Years: 4,
    totalPublications: 210,
    rosterScope: 'department',
  });
  mocks.programStudentCohorts.mockResolvedValue({
    cohorts: [
      { entryYearBE: 2564, entryYearCE: 2021, studentCount: 30, yearInProgramme: 5, status: 'delayed' },
      { entryYearBE: 2566, entryYearCE: 2023, studentCount: 70, yearInProgramme: 3, status: 'on-track' },
    ],
    totalActive: 100,
    incomingCount: 0,
    onTrackCount: 70,
    delayedCount: 30,
    programDurationYears: 4,
    refreshedAt: '2026-07-01T00:00:00.000Z',
  });
  mocks.programDigitalCompetency.mockResolvedValue({
    status: 'ok',
    rawMean: 78.2,
    scoredStudents: 250,
    modules: [{ moduleKey: 'm1', moduleNo: 1, mean: 80, coveragePct: 90, universityMean: 76 }],
    weakest: [{ moduleKey: 'm7', mean: 60 }],
  });
  mocks.programAiPeers.mockResolvedValue({
    review: {
      contentModernity: { verdict: 'IN_BETWEEN', narrative: 'n' },
      contentGaps: [{ topic: 'MLOps', kkuStatus: 'absent', peerExamples: 'MIT', severity: 'major', recommendation: 'add' }],
      confidence: 0.8,
      peerCountTotal: 12,
      generatedAt: '2026-07-15T00:00:00.000Z',
      methodVersion: 'peer-review.v2',
    },
  });
  mocks.dqCompetencyByScope.mockResolvedValue({ rawMean: 78.2, scoredStudents: 250, programCount: 1 });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('resolveEvidenceForProgram — a binding with data', () => {
  beforeEach(fullEverything);

  it('resolves an evaluation theme to a weighted mean with its respondent base', async () => {
    const [row] = await resolveEvidenceForProgram('p-1', [
      { kind: 'evaluation-theme', theme: 'assessment' },
    ]);
    expect(row?.available).toBe(true);
    const value = row?.value as EvaluationThemeValue;
    expect(value.ratingAvg).toBeCloseTo(4.31);
    expect(value.respondentCount).toBe(1200);
    expect(value.questionCount).toBe(8);
    expect(row?.freshness).toEqual(new Date('2026-06-01'));
  });

  it('labels cohort progression as completion lag, never as a time to graduate', async () => {
    const [row] = await resolveEvidenceForProgram('p-1', [{ kind: 'cohort-progression' }]);
    expect(row?.available).toBe(true);
    const value = row?.value as CohortProgressionValue;
    expect(value.delayedCount).toBe(30);
    expect(value.delayedPct).toBeCloseTo(30);
    // The label is the guard against overclaiming, so it is pinned here.
    expect(row?.caveat).toBe(
      'Cohort progression by year in programme — indicative of completion lag, not a measured time to graduate.',
    );
    expect(row?.caveat).not.toMatch(/on.time/i);
  });

  it('names the roster scope when the staff figures are not programme-specific', async () => {
    const [row] = await resolveEvidenceForProgram('p-1', [
      { kind: 'staff-metric', field: 'rankMix' },
    ]);
    expect(row?.available).toBe(true);
    expect(row?.caveat).toMatch(/whole department/);
  });

  it('resolves every registry binding', async () => {
    const rows = await resolveEvidenceForProgram('p-1', everyBinding());
    expect(rows.every((r) => r.available)).toBe(true);
  });

  it('returns one row per input binding, in order', async () => {
    const bindings: EvidenceBinding[] = [
      { kind: 'curriculum', field: 'skills' },
      { kind: 'cohort-progression' },
      { kind: 'curriculum', field: 'credits' },
    ];
    const rows = await resolveEvidenceForProgram('p-1', bindings);
    expect(rows.map((r) => r.binding)).toEqual(bindings);
  });

  it('fetches a binding repeated across sub-criteria only once', async () => {
    await resolveEvidenceForProgram('p-1', [
      { kind: 'curriculum', field: 'skills' },
      { kind: 'curriculum', field: 'skills' },
      { kind: 'curriculum', field: 'skills' },
    ]);
    expect(mocks.programSkills).toHaveBeenCalledTimes(1);
  });

  it('treats a measured zero as evidence — a known roster with no publications', async () => {
    mocks.programFaculty.mockResolvedValue({
      totalActive: 12,
      ranks: { LECTURER: 12 },
      retiringWithin5Years: 0,
      totalPublications: 0,
      rosterScope: 'program',
    });
    const [row] = await resolveEvidenceForProgram('p-1', [
      { kind: 'staff-metric', field: 'research' },
    ]);
    // The roster exists and was counted: zero publications is a finding,
    // not a data gap. The distinction the availability flag protects runs
    // in both directions.
    expect(row?.available).toBe(true);
    expect((row?.value as StaffResearchValue).totalPublications).toBe(0);
  });
});

describe('resolveEvidenceForProgram — a binding with no data', () => {
  beforeEach(emptyEverything);

  it('reports unavailable with a null value, never a zero', async () => {
    const rows = await resolveEvidenceForProgram('p-empty', everyBinding());
    expect(rows.every((r) => r.available === false)).toBe(true);
    expect(rows.every((r) => r.value === null)).toBe(true);
  });

  it('does not resolve a graduate outcome the survey never covered', async () => {
    const [row] = await resolveEvidenceForProgram('p-empty', [
      { kind: 'graduate-outcome', field: 'employmentRate' },
    ]);
    expect(row?.available).toBe(false);
    expect(row?.value).toBeNull();
  });

  it('withholds the DQ score rather than reporting it as zero', async () => {
    const [row] = await resolveEvidenceForProgram('p-empty', [{ kind: 'dq-program-score' }]);
    expect(row?.available).toBe(false);
    expect(row?.value).toBeNull();
  });

  it('says why a non-bachelor programme has no DQ profile', async () => {
    mocks.programDigitalCompetency.mockResolvedValue({
      status: 'not-applicable',
      rawMean: null,
      scoredStudents: 0,
      modules: [],
      weakest: [],
    });
    const [row] = await resolveEvidenceForProgram('p-master', [{ kind: 'dq-module-profile' }]);
    expect(row?.available).toBe(false);
    expect(row?.caveat).toMatch(/undergraduate-only/);
  });

  it('withholds a peer-review field the stored review version predates', async () => {
    mocks.programAiPeers.mockResolvedValue({
      review: {
        contentModernity: null,
        contentGaps: null,
        confidence: 0.7,
        peerCountTotal: 9,
        generatedAt: '2026-01-01T00:00:00.000Z',
        methodVersion: 'peer-review.v1',
      },
    });
    const rows = await resolveEvidenceForProgram('p-1', [
      { kind: 'peer-review', field: 'contentModernity' },
      { kind: 'peer-review', field: 'contentGaps' },
    ]);
    expect(rows.map((r) => r.available)).toEqual([false, false]);
    expect(rows[0]?.caveat).toMatch(/peer-review\.v1/);
  });
});

describe('resolveEvidenceForProgram — a programme whose courses are unmapped', () => {
  beforeEach(() => {
    fullEverything();
    // No program_courses rows: the evaluation join, the class-GPA join and
    // the workload join all pass through them, so all three come back
    // empty. That is a real finding about the programme, not a bug.
    mocks.programCourses.mockResolvedValue({
      extractedCount: 0,
      total: 0,
      rows: [],
      yearsObserved: [],
    });
    mocks.queryRawUnsafe.mockImplementation((sql: string) => {
      if (sql.includes('evaluation_response_summaries')) {
        return Promise.resolve([
          {
            rating_avg: null,
            respondents: 0n,
            cells: 0n,
            questions: 0n,
            first_year: null,
            last_year: null,
            freshness: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });
  });

  it('reports every evaluation theme as unavailable', async () => {
    const themes: EvidenceBinding[] = [
      { kind: 'evaluation-theme', theme: 'assessment' },
      { kind: 'evaluation-theme', theme: 'feedback' },
      { kind: 'evaluation-theme', theme: 'active-learning' },
    ];
    const rows = await resolveEvidenceForProgram('p-unmapped', themes);
    expect(rows.every((r) => r.available === false && r.value === null)).toBe(true);
  });

  it('reports the class-GPA distribution and the workload as unavailable too', async () => {
    const rows = await resolveEvidenceForProgram('p-unmapped', [
      { kind: 'class-gpa-distribution' },
      { kind: 'staff-metric', field: 'workload' },
      { kind: 'curriculum', field: 'courses' },
    ]);
    expect(rows.map((r) => r.available)).toEqual([false, false, false]);
  });

  it('still resolves the evidence that does not pass through the course list', async () => {
    const rows = await resolveEvidenceForProgram('p-unmapped', [
      { kind: 'cohort-progression' },
      { kind: 'graduate-outcome', field: 'employmentRate' },
      { kind: 'staff-metric', field: 'rankMix' },
    ]);
    expect(rows.every((r) => r.available)).toBe(true);
  });
});

describe('resolveEvidenceForProgram — the standing invariant', () => {
  it('never returns available: true with a null or undefined value', async () => {
    for (const setup of [emptyEverything, fullEverything]) {
      for (const fn of Object.values(mocks)) fn.mockReset();
      setup();
      const rows = await resolveEvidenceForProgram('p-1', everyBinding());
      for (const row of rows) {
        if (row.available) {
          expect(row.value).not.toBeNull();
          expect(row.value).not.toBeUndefined();
        } else {
          expect(row.value).toBeNull();
        }
      }
    }
  });

  it('degrades a failing source to unavailable instead of throwing', async () => {
    emptyEverything();
    mocks.programStudentCohorts.mockRejectedValue(new Error('connection reset'));
    const rows = await resolveEvidenceForProgram('p-1', [
      { kind: 'cohort-progression' },
      { kind: 'curriculum', field: 'skills' },
    ]);
    expect(rows[0]?.available).toBe(false);
    expect(rows[0]?.value).toBeNull();
    expect(rows[0]?.caveat).toMatch(/connection reset/);
    // One source failing must not take the rest of the page down.
    expect(rows[1]?.available).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it('always carries a source label a provenance drawer can render', async () => {
    emptyEverything();
    const rows = await resolveEvidenceForProgram('p-1', everyBinding());
    expect(rows.every((r) => r.sourceLabel.length > 0)).toBe(true);
  });
});

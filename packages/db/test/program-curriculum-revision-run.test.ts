import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ROSTER_PROVENANCE_CAVEAT, type AiService } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks prisma (via '../src/index', same pattern as
// program-research-expertise.test.ts) so the skip-path tests below run
// without a DB and without ever reaching the AiService. The AI path itself
// is NOT tested here — per the plan that is covered by the live gate, not by
// mocked theater. What IS tested exhaustively is the closure-policy gate,
// which is simultaneously the most safety-critical logic in the runner and,
// being a word matcher over free prose, the most defect-prone.
// ─────────────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  programCourseFindMany: vi.fn(),
  programResearchExpertiseFindFirst: vi.fn(),
  aiExtractionFindFirst: vi.fn(),
  programFacultyFindMany: vi.fn(),
  programSkillFindMany: vi.fn(),
  programCurriculumRevisionCreate: vi.fn(),
}));

// NO `vi.importActual('../src/index')` spread here, deliberately. `index.ts`
// re-exports the module under test, so importActual loads the REAL graph —
// and the real `prisma` binding with it. The skip-path tests then reach the
// dev database, where `findUnique('p1')` legitimately returns null and every
// case collapses to 'program not found', silently passing for the wrong
// reason on the not-found test and failing the other two. Both modules in
// the chain import only `prisma` from index, so a bare mock is sufficient.
vi.mock('../src/index', () => {
  return {
    prisma: {
      program: { findUnique: mocks.programFindUnique },
      programCourse: { findMany: mocks.programCourseFindMany },
      programResearchExpertise: { findFirst: mocks.programResearchExpertiseFindFirst },
      aiExtraction: { findFirst: mocks.aiExtractionFindFirst },
      programFaculty: { findMany: mocks.programFacultyFindMany },
      programSkill: { findMany: mocks.programSkillFindMany },
      programCurriculumRevision: { create: mocks.programCurriculumRevisionCreate },
    },
  };
});

import {
  buildCurriculumRevisionLintableText,
  collectCurriculumRevisionViolations,
  findClosureViolations,
  generateProgramCurriculumRevision,
} from '../src/program-curriculum-revision-run';

/** An AiService whose extractStructured THROWS. Any code path that reaches
 *  the model fails loudly, which turns "no AI call before the readiness
 *  short-circuit" from a comment into an assertion. */
function unreachableAi(): AiService {
  const boom = () => {
    throw new Error('AI service must not be called on a skip path');
  };
  return {
    providerId: 'mock',
    complete: vi.fn(boom),
    embed: vi.fn(boom),
    extractStructured: vi.fn(boom),
    translate: vi.fn(boom),
    vision: vi.fn(boom),
  };
}

describe('findClosureViolations — unambiguous terms', () => {
  // Every concept HARD CONSTRAINT 5 bans must be caught in the phrasing a
  // model would actually use. The hyphenated and noun forms are here because
  // the original hand-written gate missed exactly those.
  const cases: Array<[string, string]> = [
    ['We recommend the department retire EN241100.', 'retire'],
    ['EN241100 was retired in 2019.', 'retired'],
    ['Retiring this course would free four credits.', 'retiring'],
    ['The retirement of EN241100 is overdue.', 'retirement'],
    ['Discontinue the assembly-language content.', 'discontinue'],
    ['The elective was discontinued last year.', 'discontinued'],
    ['Its discontinuation is recommended.', 'discontinuation'],
    ['Sunset EN241100 after the 2027 intake.', 'sunset'],
    ['Sunsetting it frees teaching load.', 'sunsetting'],
    ['Terminate the specialisation.', 'terminate'],
    ['Termination of the track is advisable.', 'termination'],
    ['Downgrade EN241100 to an elective.', 'downgrade'],
    ['Downgrading it reflects falling demand.', 'downgrading'],
    ['Phase out the legacy content over two years.', 'phase out'],
    ['A phase-out beginning in 2027.', 'phase out'],
    ['It is being phased out already.', 'phased out'],
    ['Phasing out the module is premature.', 'phasing out'],
    ['A teach-out plan for the final cohort.', 'teach out'],
  ];

  for (const [text, expected] of cases) {
    it(`flags "${expected}" in: ${text}`, () => {
      expect(findClosureViolations(text)).toContain(expected);
    });
  }
});

describe('findClosureViolations — ambiguous terms bound to a real object', () => {
  const cases: Array<[string, string]> = [
    ['Merge the two courses into one.', 'merge'],
    ['The course should be merged with EN241200.', 'merged'],
    ['Consolidate the elective into the core.', 'consolidate'],
    ['These modules could be consolidated.', 'consolidated'],
    ['Close the programme to new intakes.', 'close'],
    ['Closure of the degree is unavoidable.', 'closure'],
    ['Suspend the course for one academic year.', 'suspend'],
    ['The programme was suspended in 2024.', 'suspended'],
    ['Remove the outdated unit from the curriculum.', 'remove'],
    ['Removing this elective saves three credits.', 'removing'],
    ['Reduce the credits of EN241100 from 3 to 2.', 'reduce'],
    ['Eliminate the duplicated module.', 'eliminate'],
  ];

  for (const [text, expected] of cases) {
    it(`flags "${expected}" in: ${text}`, () => {
      expect(findClosureViolations(text)).toContain(expected);
    });
  }
});

describe('findClosureViolations — false-positive corpus (must stay clean)', () => {
  // ORDINARY CURRICULUM PROSE. Every row below was measured as a wrong match
  // against the original flat word list. They are pinned here so a future
  // widening of the term list cannot quietly reintroduce them.
  //
  // A false positive is NOT free: it burns an AI call on a pointless rewrite
  // and sets lintRetried, which an operator reads as "the model tried to
  // recommend closure" — a misleading flag on a safety signal.
  const corpus = [
    "Closing the gap between the department's research and the taught curriculum.",
    'A close alignment between theme 2 and EN241100.',
    'Students consolidate prior learning in the final capstone module.',
    'Consolidation of statistics content across the two courses.',
    'Add a module on suspended solids and sedimentation to the water-treatment unit.',
    'Merging the two topics into a single 3-credit module.',
  ];

  for (const text of corpus) {
    it(`stays clean: ${text}`, () => {
      expect(findClosureViolations(text)).toEqual([]);
    });
  }

  it('the whole corpus together produces no violation', () => {
    expect(findClosureViolations(corpus.join('\n'))).toEqual([]);
  });

  it('an ambiguous term with no object nearby is not a violation', () => {
    expect(findClosureViolations('This reduces the risk of duplicated teaching effort.')).toEqual(
      [],
    );
  });

  it('an object noun far past the term is not bound to it', () => {
    // 'course' sits well outside the forward window, so this reads as
    // reducing assessment load, not credits.
    expect(
      findClosureViolations(
        'Reduce the amount of rote memorisation asked of students on this course.',
      ),
    ).toEqual([]);
  });
});

describe('collectCurriculumRevisionViolations', () => {
  it('reports a banned tell and a closure term together', () => {
    // Proves BOTH halves are wired: the shared banned-AI-tell list and this
    // feature's own policy gate. A regression that dropped either half would
    // otherwise still pass a single-violation test.
    const phrases = collectCurriculumRevisionViolations(
      'We should delve into this. The department should retire EN241100.',
    ).map((v) => v.phrase);

    expect(phrases).toContain('delve');
    expect(phrases).toContain('retire');
  });

  it('returns nothing for clean analytical prose', () => {
    expect(
      collectCurriculumRevisionViolations(
        'Add a unit on vector databases to EN241100, closing the gap against theme 2.',
      ),
    ).toEqual([]);
  });
});

describe('buildCurriculumRevisionLintableText', () => {
  const payload = {
    coverageSummary: { narrative: 'NARRATIVE' },
    enhanceCourses: [{ addition: 'ADDITION', additionDetail: 'DETAIL' }],
    newCourseProposals: [{ titleTh: 'TITLE_TH', titleEn: 'TITLE_EN', rationale: 'RATIONALE' }],
    promotionCandidates: [{ rationale: 'PROMOTION_RATIONALE' }],
    caveats: ['CAVEAT'],
  };

  it('covers every model-authored field group', () => {
    const text = buildCurriculumRevisionLintableText(payload);
    for (const field of [
      'NARRATIVE',
      'ADDITION',
      'DETAIL',
      'TITLE_TH',
      'TITLE_EN',
      'RATIONALE',
      'PROMOTION_RATIONALE',
      'CAVEAT',
    ]) {
      expect(text).toContain(field);
    }
  });

  it('separates fields so two of them cannot fuse into a phantom phrase', () => {
    const text = buildCurriculumRevisionLintableText({
      ...payload,
      enhanceCourses: [{ addition: 'phase', additionDetail: 'out' }],
    });
    expect(findClosureViolations(text)).toEqual([]);
  });

  it('handles empty lanes', () => {
    expect(
      buildCurriculumRevisionLintableText({
        coverageSummary: { narrative: 'ONLY' },
        enhanceCourses: [],
        newCourseProposals: [],
        promotionCandidates: [],
        caveats: [],
      }),
    ).toBe('ONLY');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Readiness short-circuits. The AiService throws on every method, so these
// pass only if the runner truly makes ZERO AI calls before skipping.
// ─────────────────────────────────────────────────────────────────────────────

const expertisePayload = {
  themes: [
    {
      name: 'Recycled aggregate concrete',
      paperCount: 12,
      exampleTitles: ['Recycled aggregate concrete', 'Fly ash blended cement'],
      yearSpan: '2018–2025',
      trend: 'rising',
      evidenceNote: 'Twelve papers across eight years.',
    },
  ],
  recommendations: {
    curriculum: [
      {
        action: 'Add a materials-durability unit',
        rationale: 'The theme has no course home yet',
        horizonMonths: 12,
        themeRefs: ['Recycled aggregate concrete'],
      },
    ],
    positioning: [
      {
        action: 'Feature the concrete work in recruitment',
        rationale: 'It is the strongest evidenced theme',
        horizonMonths: 6,
        themeRefs: ['Recycled aggregate concrete'],
      },
    ],
    research: [
      {
        action: 'Seek industry co-funding',
        rationale: 'Output is rising and fundable',
        horizonMonths: 18,
        themeRefs: ['Recycled aggregate concrete'],
      },
    ],
  },
  caveats: [ROSTER_PROVENANCE_CAVEAT],
  confidence: 0.7,
};

describe('generateProgramCurriculumRevision — skip paths make no AI call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.programCourseFindMany.mockResolvedValue([]);
    mocks.programResearchExpertiseFindFirst.mockResolvedValue(null);
    mocks.aiExtractionFindFirst.mockResolvedValue(null);
    mocks.programFacultyFindMany.mockResolvedValue([]);
    mocks.programSkillFindMany.mockResolvedValue([]);
  });

  const program = {
    code: 'KKU-SEQ-0001',
    nameTh: 'วิศวกรรมโยธา',
    nameEn: 'Civil Engineering',
    level: 'BACHELOR',
    totalCredits: 140,
    durationYears: 4,
    faculty: { nameTh: 'คณะวิศวกรรมศาสตร์' },
  };

  it('skips a program that does not exist', async () => {
    mocks.programFindUnique.mockResolvedValue(null);
    const ai = unreachableAi();

    const result = await generateProgramCurriculumRevision({ programId: 'nope', ai });

    expect(result.status).toBe('SKIPPED');
    expect(result).toMatchObject({ readiness: null });
    expect(ai.extractStructured).not.toHaveBeenCalled();
    expect(mocks.programCurriculumRevisionCreate).not.toHaveBeenCalled();
  });

  it('skips no-research before any AI call', async () => {
    mocks.programFindUnique.mockResolvedValue(program);
    mocks.programCourseFindMany.mockResolvedValue([
      { courseCode: 'EN241100', courseNameTh: 'กลศาสตร์', courseNameEn: null, credits: 3, category: 'MAJOR_REQUIRED' },
    ]);
    const ai = unreachableAi();

    const result = await generateProgramCurriculumRevision({ programId: 'p1', ai });

    expect(result).toMatchObject({ status: 'SKIPPED', reason: 'no-research', readiness: 'no-research' });
    expect(ai.extractStructured).not.toHaveBeenCalled();
    expect(mocks.programCurriculumRevisionCreate).not.toHaveBeenCalled();
  });

  it('skips no-courses before any AI call', async () => {
    mocks.programFindUnique.mockResolvedValue(program);
    mocks.programResearchExpertiseFindFirst.mockResolvedValue({
      payloadJson: expertisePayload,
      inputStatsJson: { totalDistinct: 42 },
    });
    mocks.programCourseFindMany.mockResolvedValue([]);
    const ai = unreachableAi();

    const result = await generateProgramCurriculumRevision({ programId: 'p1', ai });

    expect(result).toMatchObject({ status: 'SKIPPED', reason: 'no-courses', readiness: 'no-courses' });
    expect(ai.extractStructured).not.toHaveBeenCalled();
    expect(mocks.programCurriculumRevisionCreate).not.toHaveBeenCalled();
  });
});

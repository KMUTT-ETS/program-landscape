import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderCurriculumRevisionSection } from '../../src/templates/program-detail/sections/curriculum-revision';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';

const MINIMAL_BASE = {
  programCode: 'KKU-SEQ-9999',
  nameTh: 'หลักสูตรทดสอบวิศวกรรมทดสอบ',
  nameEn: 'Test Program in Testing Engineering',
  level: 'Bachelor',
  status: 'ACTIVE',
  facultyTh: 'คณะทดสอบ',
  facultyEn: 'Faculty of Testing',
  dateLabel: '2026-01-01',
  generatedAtLabel: 'January 1, 2026 at 9:00 AM',
  methodologyVersion: 'health-score.v3.8',
};

function parse(overrides: Record<string, unknown> = {}): ProgramDetailData {
  return ProgramDetailDataSchema.parse({ ...MINIMAL_BASE, ...overrides });
}

const OK_PAYLOAD = {
  readiness: 'ok',
  distinctPaperCount: 84,
  confidence: 0.82,
  methodVersion: 'program-curriculum-revision.v1',
  generatedAt: '2026-09-01',
  courseCount: 41,
  coursesWithCategory: 41,
  coverage: {
    themesTotal: 6,
    themesReflected: 4,
    themesAbsent: ['Battery chemistry', 'Grid-scale storage'],
    narrative: 'The roster publishes heavily in materials science.',
  },
  enhanceCourses: [
    {
      courseCode: 'EN512101',
      courseNameTh: 'วัสดุวิศวกรรม',
      currentlyCoversQuote: 'สมบัติของวัสดุโลหะ',
      themeRefs: ['Battery chemistry'],
      addition: 'Add a unit on lithium-ion cell chemistry',
      additionDetail: 'Two lectures plus one lab.',
      effort: 'low',
      evidencePaperTitles: ['Paper A', 'Paper B', 'Paper C', 'Paper D'],
    },
  ],
  newCourseProposals: [
    {
      titleTh: 'การกักเก็บพลังงาน',
      titleEn: 'Energy Storage Systems',
      credits: 3,
      placementYear: 3,
      placementSemester: 1,
      themeRefs: ['Grid-scale storage'],
      rationale: 'Six roster members publish in this area.',
      couldBeTaughtBy: ['Somchai P. (Associate Professor)'],
      evidencePaperTitles: ['Paper E'],
    },
  ],
  promotionCandidates: [
    {
      courseCode: 'EN512205',
      courseNameTh: 'เคมีไฟฟ้า',
      currentCategory: 'Elective',
      proposedCategory: 'Core',
      rationale: 'Now underpins two required courses.',
    },
  ],
  caveats: ['Derived from publication titles, not full texts.'],
};

describe('renderCurriculumRevisionSection', () => {
  it('renders nothing when the programme has no payload', () => {
    expect(renderCurriculumRevisionSection(parse())).toBeNull();
  });

  it('names every recommendation lane with its evidence', () => {
    const html = renderToStaticMarkup(
      renderCurriculumRevisionSection(parse({ curriculumRevision: OK_PAYLOAD }))!,
    );
    expect(html).toContain('Extend an existing course');
    expect(html).toContain('Proposed new courses');
    expect(html).toContain('outgrown their category');
    expect(html).toContain('EN512101');
    expect(html).toContain('Energy Storage Systems');
    expect(html).toContain('EN512205');
    // Coverage headline and the themes with no course home.
    expect(html).toContain('Battery chemistry');
    expect(html).toContain('Derived from publication titles');
  });

  // The papers are the grounding — a recommendation with none behind it
  // is an opinion, so titles are shown, not reduced to a count.
  it('shows evidence papers by title and states how many it elided', () => {
    const html = renderToStaticMarkup(
      renderCurriculumRevisionSection(parse({ curriculumRevision: OK_PAYLOAD }))!,
    );
    expect(html).toContain('Paper A');
    expect(html).toContain('Paper C');
    // Four titles, three shown, remainder named rather than dropped.
    expect(html).toContain('+1 more paper');
    expect(html).not.toContain('Paper D');
  });

  // Each non-ok readiness points somewhere different; none of them means
  // "we examined the curriculum and it needs no change".
  it.each([
    ['thin', /distinct paper/i],
    ['no-research', /no publications are recorded/i],
    ['no-courses', /no extracted course list/i],
  ])('explains why no advice was produced when readiness is %s', (readiness, expected) => {
    const html = renderToStaticMarkup(
      renderCurriculumRevisionSection(
        parse({
          curriculumRevision: {
            ...OK_PAYLOAD,
            readiness,
            distinctPaperCount: 4,
            enhanceCourses: [],
            newCourseProposals: [],
            promotionCandidates: [],
          },
        }),
      )!,
    );
    expect(html).toMatch(expected);
    // Must not present an empty analysis as a completed one.
    expect(html).not.toContain('Extend an existing course');
  });

  it('distinguishes an empty promotion lane from missing category data', () => {
    const html = renderToStaticMarkup(
      renderCurriculumRevisionSection(
        parse({
          curriculumRevision: { ...OK_PAYLOAD, promotionCandidates: [], coursesWithCategory: 0 },
        }),
      )!,
    );
    expect(html).toContain('data gap');
  });

  it('says the analysis ran but proposed nothing, when that is what happened', () => {
    const html = renderToStaticMarkup(
      renderCurriculumRevisionSection(
        parse({
          curriculumRevision: {
            ...OK_PAYLOAD,
            enhanceCourses: [],
            newCourseProposals: [],
            promotionCandidates: [],
            coursesWithCategory: 41,
          },
        }),
      )!,
    );
    expect(html).toContain('proposed no changes');
  });
});

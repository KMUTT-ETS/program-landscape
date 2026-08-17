import { describe, expect, it } from 'vitest';
import { buildProgramDigestMessages } from '../src/ai/prompts/program-digest';
import { buildProgramCoursesExtractMessages } from '../src/ai/prompts/program-courses-extract';
import { buildProgramFacultyMessages } from '../src/ai/prompts/program-faculty-extraction';
import { buildProgramSkillsDetailedMessages } from '../src/ai/prompts/program-skills-detailed';
import { buildCareerKmitlMappingMessages } from '../src/ai/prompts/career-kmitl-mapping';

// docs/superpowers/notes/2026-08-16-prompt-audit.md #16-#19, #24: TOUCH
// prompts whose `caveats`/`reasoning` meta-field was Thai in practice (the
// system prompt instructed Thai) even though the field is analysis prose,
// not a data label — not on docs/prompt-standard.md's exemption list. Each
// was flipped to an explicit English-output instruction. These are narrow
// language-contract regression tests, not full builder-behaviour suites —
// the conformance ratchet (prompt-standard-conformance.test.ts) already
// covers marker presence for every file in this batch.

function systemOf(messages: ReturnType<typeof buildProgramDigestMessages>): string {
  return messages.find((m) => m.role === 'system')?.content ?? '';
}

describe('TOUCH prompts — flipped caveats/reasoning fields are instructed in English', () => {
  it('program-digest: caveats must be English (audit #16)', () => {
    const system = systemOf(
      buildProgramDigestMessages({
        programMetaFromSheet: {
          facultyNameTh: 'คณะวิศวกรรมศาสตร์',
          levelTh: 'ป.ตรี',
          degreeNameFromSheet: 'วิศวกรรมศาสตรบัณฑิต',
          majorNameFromSheet: 'วิศวกรรมเครื่องกล',
          curriculumYearBe: 2565,
          mhesiCode: null,
        },
        pdfText: 'sample curriculum text',
      }),
    );
    expect(system).toMatch(/caveats.*MUST be written in English/i);
  });

  it('program-courses-extract: caveats must be English (audit #17)', () => {
    const system = systemOf(
      buildProgramCoursesExtractMessages({
        programCode: 'KKU-SEQ-0001',
        programNameTh: 'หลักสูตรทดสอบ',
        programNameEn: 'Test Program',
        facultyNameTh: 'คณะวิศวกรรมศาสตร์',
        levelTh: 'ป.ตรี',
        pdfText: 'sample รายวิชา section text',
        candidateCodes: ['EN101001'],
      }),
    );
    expect(system).toMatch(/caveats.*MUST be written in English/i);
  });

  it('program-faculty-extraction: reasoning must be English (audit #18)', () => {
    const system = systemOf(
      buildProgramFacultyMessages({
        programMetaFromSheet: {
          facultyNameTh: 'คณะวิศวกรรมศาสตร์',
          levelTh: 'ป.ตรี',
          degreeNameFromSheet: 'วิศวกรรมศาสตรบัณฑิต',
        },
        pdfText: 'sample staff section text',
      }),
    );
    expect(system).toMatch(/reasoning.*MUST be written in English/i);
  });

  it('program-skills-detailed: reasoning must be English (audit #19)', () => {
    const system = systemOf(
      buildProgramSkillsDetailedMessages({
        programMetaFromSheet: {
          facultyNameTh: 'คณะวิศวกรรมศาสตร์',
          levelTh: 'ป.ตรี',
          degreeNameFromSheet: 'วิศวกรรมศาสตรบัณฑิต',
          majorNameFromSheet: 'วิศวกรรมเครื่องกล',
        },
        pdfText: 'sample PLO + course description text',
      }),
    );
    expect(system).toMatch(/reasoning.*MUST be written in English/i);
  });

  it('career-kmitl-mapping: reasoning must be English (audit #24)', () => {
    const system = systemOf(
      buildCareerKmitlMappingMessages({
        programDegree: 'วิศวกรรมศาสตรบัณฑิต',
        programFaculty: 'คณะวิศวกรรมศาสตร์',
        programCareers: ['วิศวกรเครื่องกล'],
        kmitlCareers: [{ id: 1, name: 'Mechanical Engineer', group: 'Engineer', subGroup: 'Mechanic' }],
      }),
    );
    expect(system).toMatch(/reasoning.*MUST be written in English/i);
  });
});

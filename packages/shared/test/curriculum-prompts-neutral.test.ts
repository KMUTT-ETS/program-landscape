import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KKU_REFERENCE_ORGANIZATION,
  setOrganizationForTest,
  type Institution,
} from '../src';
import {
  PROGRAM_DIGEST_VERSION,
  buildProgramDigestMessages,
} from '../src/ai/prompts/program-digest';
import {
  PROGRAM_COURSES_EXTRACT_VERSION,
  buildProgramCoursesExtractMessages,
} from '../src/ai/prompts/program-courses-extract';
import {
  PROGRAM_FACULTY_VERSION,
  buildProgramFacultyMessages,
} from '../src/ai/prompts/program-faculty-extraction';
import {
  PROGRAM_SKILLS_DETAILED_VERSION,
  buildProgramSkillsDetailedMessages,
} from '../src/ai/prompts/program-skills-detailed';
import { AI_METHOD_CATALOG } from '../src/ai/method-catalog';

// A fictional organisation: the rendered curriculum prompts must carry its
// name and none of the KKU / KMITL literals the prompts used to hardcode.
const FICTIONAL: Institution = {
  ...KKU_REFERENCE_ORGANIZATION,
  nameTh: 'มหาวิทยาลัยตัวอย่างเหนือ',
  nameEn: 'Northern Example University',
  shortNameEn: 'NEU',
  shortNameTh: 'มตน.',
};

beforeEach(() => setOrganizationForTest(FICTIONAL));
afterEach(() => setOrganizationForTest(KKU_REFERENCE_ORGANIZATION));

const FORBIDDEN = ['ม.ขก.', 'สจล.', 'ขอนแก่น', 'KKU', 'KMITL', 'มข.', 'EN013'];

function render(messages: Array<{ content: string }>): string {
  return messages.map((m) => m.content).join('\n');
}

const sheet = {
  facultyNameTh: 'คณะตัวอย่าง',
  levelTh: 'ป.ตรี',
  degreeNameFromSheet: 'วิศวกรรมศาสตรบัณฑิต',
  majorNameFromSheet: 'วิศวกรรมเครื่องกล',
  curriculumYearBe: 2565,
  mhesiCode: null,
};

describe('curriculum prompts carry no institution-specific literals', () => {
  it('program-courses-extract', () => {
    const text = render(
      buildProgramCoursesExtractMessages({
        programCode: 'ABC-0001',
        programNameTh: 'หลักสูตรทดสอบ',
        programNameEn: 'Test Program',
        facultyNameTh: 'คณะตัวอย่าง',
        levelTh: 'ป.ตรี',
        pdfText: 'ABC 101 ตัวอย่าง Example 3(3-0-6)',
        candidateCodes: ['ABC101'],
      }),
    );
    for (const f of FORBIDDEN) expect(text, f).not.toContain(f);
    expect(text).toContain('มตน.');
    expect(text).toMatch(/ABC ?101/);
  });

  it('program-digest', () => {
    const text = render(
      buildProgramDigestMessages({ programMetaFromSheet: sheet, pdfText: 'x' }),
    );
    for (const f of FORBIDDEN) expect(text, f).not.toContain(f);
    expect(text).toContain('มตน.');
    expect(text).toContain('NEU');
  });

  it('program-skills-detailed', () => {
    const text = render(
      buildProgramSkillsDetailedMessages({ programMetaFromSheet: sheet, pdfText: 'x' }),
    );
    for (const f of FORBIDDEN) expect(text, f).not.toContain(f);
    expect(text).toContain('ผลลัพธ์การเรียนรู้ระดับหลักสูตร');
    expect(text).toContain('ผลลัพธ์การเรียนรู้ที่คาดหวังของหลักสูตร');
    expect(text).toContain('Programme Learning Outcomes (PLOs)');
  });

  it('program-faculty-extraction', () => {
    const text = render(
      buildProgramFacultyMessages({
        programMetaFromSheet: {
          facultyNameTh: 'คณะตัวอย่าง',
          levelTh: 'ป.ตรี',
          degreeNameFromSheet: 'วิศวกรรมศาสตรบัณฑิต',
        },
        pdfText: 'x',
      }),
    );
    for (const f of FORBIDDEN) expect(text, f).not.toContain(f);
    for (const t of ['ศ.ดร.', 'รศ.', 'ผศ.', 'Prof.', 'Assoc. Prof.', 'Asst. Prof.', 'Dr.']) {
      expect(text, t).toContain(t);
    }
  });
});

describe('curriculum prompt versions and defaults', () => {
  it('bumps the four versions and keeps the catalog in step', () => {
    expect(PROGRAM_COURSES_EXTRACT_VERSION).toBe('program-courses-extract.v5');
    expect(PROGRAM_DIGEST_VERSION).toBe('program-digest.v4');
    expect(PROGRAM_SKILLS_DETAILED_VERSION).toBe('program-skills-detailed.v4');
    expect(PROGRAM_FACULTY_VERSION).toBe('program-faculty.v3');
    for (const [prefix, v] of [
      ['program-courses-extract', PROGRAM_COURSES_EXTRACT_VERSION],
      ['program-digest', PROGRAM_DIGEST_VERSION],
      ['program-skills-detailed', PROGRAM_SKILLS_DETAILED_VERSION],
      ['program-faculty', PROGRAM_FACULTY_VERSION],
    ] as const) {
      expect(AI_METHOD_CATALOG.find((e) => e.methodPrefix === prefix)?.currentVersion).toBe(v);
    }
  });

  it('digest asks for up to 160 courses by default', () => {
    const text = render(
      buildProgramDigestMessages({ programMetaFromSheet: sheet, pdfText: 'x' }),
    );
    expect(text).toContain('มากกว่า 160 วิชา');
    expect(text).toContain('descriptionTh ไม่เกิน 200 ตัวอักษร');
    expect(text).toContain('ไม่เกิน 3 ข้อ แต่ละข้อไม่เกิน 120 ตัวอักษร');
  });

  it('renders the KKU short name for the KKU reference organisation', () => {
    setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
    const text = render(
      buildProgramCoursesExtractMessages({
        programCode: 'ABC-0001', programNameTh: 'ก', programNameEn: 'A',
        facultyNameTh: 'ข', levelTh: 'ป.ตรี', pdfText: 'x', candidateCodes: [],
      }),
    );
    expect(text).toContain(KKU_REFERENCE_ORGANIZATION.shortNameTh);
  });
});

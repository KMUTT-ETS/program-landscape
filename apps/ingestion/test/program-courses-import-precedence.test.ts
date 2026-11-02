import { beforeEach, describe, expect, it, vi } from 'vitest';

const owned = vi.fn();
const findProgram = vi.fn();
const createExtraction = vi.fn();
const countCourses = vi.fn();
const deleteMany = vi.fn();
const createMany = vi.fn();
const txClient = { programCourse: { deleteMany, createMany } };

vi.mock('@kku/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kku/db')>();
  return {
    ...actual,
    importOwnedProgramIds: (...a: unknown[]) => owned(...a),
    activeRevisionIdFor: async () => null,
    prisma: {
      program: { findUnique: (...a: unknown[]) => findProgram(...a) },
      aiExtraction: { create: (...a: unknown[]) => createExtraction(...a) },
      programCourse: { count: (...a: unknown[]) => countCourses(...a) },
      $transaction: async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
    },
  };
});

import { IMPORT_OWNED_SKIP_REASON } from '@kku/db';
import { runProgramCoursesExtract } from '../src/program-courses-extract/run';
import { shouldMaterialise } from '../src/program-courses-extract/materialise-decision';

const program = {
  id: 'p1',
  code: 'KKU-SEQ-T1',
  nameTh: 'ทดสอบ',
  nameEn: 'Test',
  level: 'BACHELOR',
  faculty: { nameTh: 'คณะ' },
  documents: [
    { pdfDocument: { id: 'd1', storageUrl: 's3://b/k.pdf', originalFilename: 'k.pdf' } },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  findProgram.mockResolvedValue(program);
  countCourses.mockResolvedValue(0);
  createExtraction.mockResolvedValue({ id: 'x1' });
});

describe('phase 2b and import ownership', () => {
  it('skips an import-owned programme before fetching the PDF', async () => {
    owned.mockResolvedValue(new Set(['p1']));
    const getSignedDownloadUrl = vi.fn();
    const extractStructured = vi.fn();
    const out = await runProgramCoursesExtract({
      programId: 'p1',
      ai: { extractStructured } as never,
      storage: { getSignedDownloadUrl } as never,
    });
    expect(out).toEqual({ status: 'SKIPPED', reason: IMPORT_OWNED_SKIP_REASON });
    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
    expect(extractStructured).not.toHaveBeenCalled();
  });

  it('writes nothing when the programme became import-owned during extraction', async () => {
    owned.mockResolvedValueOnce(new Set()).mockResolvedValue(new Set(['p1']));
    const fullText =
      '2.1 รายวิชา\nหมวดวิชาศึกษาทั่วไป\n' +
      'GE 101 001 ทดสอบ 3(3-0-6)\n'.repeat(30);
    const extractStructured = vi.fn().mockResolvedValue({
      parsed: {
        courses: [
          { code: 'GE101001', nameTh: 'ทดสอบ', nameEn: 'Test', credits: 3, category: 'GENERAL_EDUCATION' },
        ],
        caveats: [],
        confidence: 0.9,
      },
      confidence: 0.9,
      aiInferenceId: null,
      reasoning: null,
      tokens: { input: 1, output: 1 },
      cost: { usd: 0 },
    });
    const out = await runProgramCoursesExtract({
      programId: 'p1',
      ai: { extractStructured } as never,
      storage: {} as never,
      pdfPrep: { fullText } as never,
    });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(out.status).toBe('SUCCEEDED');
    if (out.status === 'SUCCEEDED') {
      expect(out.materialisationRefusedReason).toBe(IMPORT_OWNED_SKIP_REASON);
      expect(out.materialisedCount).toBe(0);
    }
  });
});

describe('materialise script decision', () => {
  it('skips import-owned programmes even with --force', () => {
    expect(shouldMaterialise({ extractorOwned: false, importOwned: true, force: true })).toBe('skip-import');
    expect(shouldMaterialise({ extractorOwned: true, importOwned: true, force: false })).toBe('skip-import');
  });
  it('skips extractor-owned unless forced, otherwise writes', () => {
    expect(shouldMaterialise({ extractorOwned: true, importOwned: false, force: false })).toBe('skip-extractor');
    expect(shouldMaterialise({ extractorOwned: true, importOwned: false, force: true })).toBe('write');
    expect(shouldMaterialise({ extractorOwned: false, importOwned: false, force: false })).toBe('write');
  });
});

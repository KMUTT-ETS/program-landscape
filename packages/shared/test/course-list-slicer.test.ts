import { describe, it, expect } from 'vitest';
import { extractCourseListSection } from '../src/ai/prompts/program-courses-extract';

/**
 * The slicer confines course extraction to the รายวิชา section. Reading the
 * whole document is what v2.3 removed: it pulled OLD-curriculum codes out of
 * the curriculum-revision appendix and tagged them active, mislinking roughly
 * 30 programmes. So every relaxation here has to keep that guard intact.
 *
 * Its start anchor originally demanded TWO-level numbering ("3.1 รายวิชา").
 * A survey of 27 programme PDFs on 2026-09-07 found 8 the slicer refused; 3 of
 * them (KKU-SEQ-0009, 0026, 0027) head the section with SINGLE-level numbering
 * scoped under a หมวด — "หมวด 3 โครงสร้างหลักสูตร … 1. จำนวนหน่วยกิต …
 * 2. รายวิชา" — which the anchor could not see. The remaining 5 fail for a
 * different reason and are NOT addressed here.
 *
 * The discriminator against a table-of-contents hit is the trailing check
 * (หมวดวิชา AND a course code within 400 chars), not the numbering depth —
 * verified against the real documents before this was relaxed.
 */
const CODES = 'PH 111 101 3(3-0-6) PH 111 102 2(2-0-4) PH 111 103 3(2-2-5)';
const pad = (n: number) => 'ก'.repeat(n);

describe('extractCourseListSection', () => {
  it('finds a two-level heading (the original supported form)', () => {
    const text = `${pad(200)} 3.1 รายวิชา หมวดวิชาศึกษาทั่วไป 24 หน่วยกิต ${CODES} ${pad(600)} ภาคผนวก`;
    const r = extractCourseListSection(text);
    expect(r.found).toBe(true);
    expect(r.text).toContain('หมวดวิชาศึกษาทั่วไป');
  });

  it('finds a SINGLE-level heading under a หมวด — the KKU-SEQ-0026 layout', () => {
    // No digit may precede "2." — otherwise the OLD two-level anchor matches
    // across it (a credit figure like "150 2." satisfies \\d[\\s.]+\\d) and the
    // test passes without exercising single-level numbering at all.
    const text = `${pad(200)} หมวด สาม โครงสร้างหลักสูตร ${pad(30)} 2. รายวิชา 1) หมวดวิชาศึกษาทั่วไป ${CODES} ${pad(600)} ภาคผนวก`;
    const r = extractCourseListSection(text);
    expect(r.found).toBe(true);
    expect(r.text).toContain('หมวดวิชาศึกษาทั่วไป');
  });

  it('finds "3 . รายวิชา" with spaces around the separator', () => {
    const text = `${pad(200)} 3 . รายวิชา 1) หมวดวิชาเฉพาะ ${CODES} ${pad(600)} ภาคผนวก`;
    expect(extractCourseListSection(text).found).toBe(true);
  });

  it('SKIPS the table-of-contents entry and takes the real section', () => {
    // The ToC lists "2. รายวิชา 17" with no หมวดวิชา and no course code near
    // it. This is the exact shape at KKU-SEQ-0026 offset 771, and it must not
    // win over the real section further down.
    const toc = `หมวด 3 โครงสร้างหลักสูตร 1. จำนวนหน่วยกิต 15 2. รายวิชา 17 3. คำอธิบายระบบรหัสวิชา 41 หมวด 4 การจัดกระบวนการเรียนรู้`;
    const real = `2. รายวิชา 1) หมวดวิชาศึกษาทั่วไป 24 หน่วยกิต ${CODES}`;
    const text = `${toc} ${pad(2000)} ${real} ${pad(600)} ภาคผนวก`;
    const r = extractCourseListSection(text);
    expect(r.found).toBe(true);
    expect(r.text.startsWith('2. รายวิชา 1)')).toBe(true);
    expect(r.text).not.toContain('คำอธิบายระบบรหัสวิชา');
  });

  it('refuses when หมวดวิชา is absent — will not read the whole document', () => {
    const text = `${pad(200)} 2. รายวิชา ${CODES} ${pad(2000)} ภาคผนวก`;
    expect(extractCourseListSection(text).found).toBe(false);
  });

  it('refuses when no course code follows the heading', () => {
    const text = `${pad(200)} 2. รายวิชา หมวดวิชาศึกษาทั่วไป 24 หน่วยกิต ${pad(2000)} ภาคผนวก`;
    expect(extractCourseListSection(text).found).toBe(false);
  });

  it('stops at ภาคผนวก, so appendix codes stay out of the slice', () => {
    const text = `${pad(200)} 2. รายวิชา หมวดวิชาเฉพาะ ${CODES} ${pad(600)} ภาคผนวก 4 XX 999 999 เปรียบเทียบหลักสูตรปรับปรุง`;
    const r = extractCourseListSection(text);
    expect(r.found).toBe(true);
    expect(r.text).not.toContain('XX 999 999');
  });

  it('refuses a slice shorter than 500 chars rather than returning a stub', () => {
    const text = `2. รายวิชา หมวดวิชาเฉพาะ ${CODES} ภาคผนวก`;
    expect(extractCourseListSection(text).found).toBe(false);
  });
});

describe('extractCourseListSection — 3-digit (KMUTT-shape) codes', () => {
  const ROWS =
    'GEN 111 วิชาสมมติหนึ่ง 3 (3-0-6) Fictional One MEE 221 วิชาสมมติสอง 3 (3-0-6) Fictional Two';
  it('skips the TOC line and starts at the body', () => {
    const text = `${pad(200)} 3.1.3 รายวิชา 22 ${pad(600)} 3.1.3 รายวิชา หมวดวิชาศึกษาทั่วไป 30 หน่วยกิต ${ROWS} ${pad(600)} ภาคผนวก`;
    const r = extractCourseListSection(text);
    expect(r.found).toBe(true);
    expect(r.startIndex).toBeGreaterThan(text.indexOf(' 22 ') + 600);
    expect(r.text).toMatch(/^\S* รายวิชา หมวดวิชาศึกษาทั่วไป/);
    expect(r.text).toContain('MEE 221');
  });

  it('negative control: same document without body rows is not found', () => {
    const text = `${pad(200)} 3.1.3 รายวิชา 22 ${pad(600)} 3.1.3 รายวิชา ${pad(600)} ภาคผนวก`;
    expect(extractCourseListSection(text).found).toBe(false);
  });

  it('rejects a TOC line near a code that has no หมวดวิชา in its window', () => {
    // Code within 400 chars but no หมวดวิชา: first half of the check fails.
    const near = `${pad(100)} 3.1.3 รายวิชา 22 ${pad(50)} ${ROWS} ${pad(600)} ภาคผนวก`;
    expect(extractCourseListSection(near).found).toBe(false);
    // หมวดวิชา within 400 chars but no code: second half fails.
    const noCode = `${pad(100)} 3.1.3 รายวิชา 22 หมวดวิชาศึกษาทั่วไป ${pad(600)} ภาคผนวก`;
    expect(extractCourseListSection(noCode).found).toBe(false);
  });
});

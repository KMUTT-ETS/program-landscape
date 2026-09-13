// Row normalisation for JobThai drops. Pure, no IO, so the correctness
// story is exhaustively testable. Cases are taken from real rows in
// Job_Data_01.xlsx.
import { describe, expect, it } from 'vitest';

import { normaliseJobThaiRow, JOBTHAI_ANY_FIELD } from '../../src/jobthai/parse-row';

const base: Record<string, string> = {
  'Job Title': 'เจ้าหน้าที่การเงิน',
  'Job Category (ประเภทงานหลัก)': 'งานการเงิน/ธนาคาร',
  'Job Subcategory (ประเภทงานย่อย)': 'งานการเงิน',
  'Business (ประเภทธุรกิจ)': 'ธุรกิจ วัสดุก่อสร้าง/ก่อสร้าง',
  Province: 'สมุทรปราการ',
  'Job Description (Raw)': 'จัดทำเอกสารใบแจ้งหนี้ลูกค้า',
  'Qualification (Raw)': '',
};

describe('normaliseJobThaiRow — education and field of study', () => {
  it('extracts the named fields of study', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'วุฒิการศึกษา ปริญญาตรี สาขาบัญชี , การเงินการธนาคาร เท่านั้น',
    });
    expect(r.requiredFieldsRaw).toEqual(['บัญชี', 'การเงินการธนาคาร']);
    expect(r.minEducationLevel).toBe('BACHELOR');
  });

  it('treats any-field as a sentinel, not a field literally named "every"', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'วุฒิการศึกษา ปวช., ปวส.- ปริญญาตรี ทุกสาขา',
    });
    expect(r.requiredFieldsRaw).toEqual([JOBTHAI_ANY_FIELD]);
  });

  it('takes the LOWEST stated level as the floor the employer accepts', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'วุฒิการศึกษา ปวช., ปวส.- ปริญญาตรี ทุกสาขา',
    });
    expect(r.minEducationLevel).toBe('VOCATIONAL_CERT');
  });

  it('reads a postgraduate requirement', () => {
    const r = normaliseJobThaiRow({ ...base, 'Qualification (Raw)': 'วุฒิปริญญาโท สาขาวิศวกรรมไฟฟ้า' });
    expect(r.minEducationLevel).toBe('MASTER');
    expect(r.requiredFieldsRaw).toEqual(['วิศวกรรมไฟฟ้า']);
  });

  it('is UNSPECIFIED with no fields when no qualification is stated', () => {
    const r = normaliseJobThaiRow(base);
    expect(r.minEducationLevel).toBe('UNSPECIFIED');
    expect(r.requiredFieldsRaw).toEqual([]);
  });
});

describe('normaliseJobThaiRow — exclusions', () => {
  it('strips gender and age requirements from stored text', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'เพศหญิง อายุไม่เกิน 30 ปี วุฒิการศึกษา ปริญญาตรี สาขาบัญชี',
    });
    expect(r.qualificationRaw).not.toMatch(/เพศ/);
    expect(r.qualificationRaw).not.toMatch(/อายุ/);
    // The legitimate signal survives the strip.
    expect(r.requiredFieldsRaw).toEqual(['บัญชี']);
    expect(r.minEducationLevel).toBe('BACHELOR');
  });

  it('scrubs email addresses and phone-like digits', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'ส่งประวัติมาที่ somchai@example.com หรือโทร 0812345678',
    });
    expect(r.qualificationRaw).not.toMatch(/@example\.com/);
    expect(r.qualificationRaw).not.toMatch(/0812345678/);
    expect(r.qualificationRaw).toMatch(/redacted/);
  });

  it('scrubs the description as well as the qualification', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Job Description (Raw)': 'ติดต่อ hr@example.com',
    });
    expect(r.descriptionRaw).not.toMatch(/@example\.com/);
  });
});

describe('normaliseJobThaiRow — identity and dates', () => {
  it('gives identical rows the same rowKey and different rows different keys', () => {
    const a = normaliseJobThaiRow(base);
    const b = normaliseJobThaiRow({ ...base });
    const c = normaliseJobThaiRow({ ...base, Province: 'ขอนแก่น' });
    expect(a.rowKey).toBe(b.rowKey);
    expect(a.rowKey).not.toBe(c.rowKey);
  });

  it('leaves postedDate null when the source carries no date column', () => {
    expect(normaliseJobThaiRow(base).postedDate).toBeNull();
  });

  it('reads a posted date when the column is present', () => {
    const r = normaliseJobThaiRow({ ...base, 'Posted Date': '2026-08-15' });
    expect(r.postedDate?.toISOString().slice(0, 10)).toBe('2026-08-15');
  });
});

describe('normaliseJobThaiRow — recruitment handles', () => {
  it('redacts a LINE recruitment id', () => {
    const r = normaliseJobThaiRow({ ...base, 'Qualification (Raw)': 'สอบถาม Line: @hr.regen' });
    expect(r.qualificationRaw).not.toMatch(/@hr\.regen/);
  });

  it('redacts a TikTok handle in a description', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Job Description (Raw)': 'ติดตามที่ https://www.tiktok.com/@lst.logistics',
    });
    expect(r.descriptionRaw).not.toMatch(/@lst\.logistics/);
  });
});

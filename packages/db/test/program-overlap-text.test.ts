import { describe, expect, it } from 'vitest';
import {
  buildMarketProfileText,
  courseEmbeddingText,
  languageVariantKey,
  normalisePloText,
  sha256,
} from '../src/program-overlap/text';

describe('normalisePloText', () => {
  it('strips leading PLO labels and numbering', () => {
    expect(normalisePloText('PLO 1.1 อธิบายหลักการทางวิศวกรรม')).toBe('อธิบายหลักการทางวิศวกรรม');
    expect(normalisePloText('PLO1: Apply statistics')).toBe('Apply statistics');
    expect(normalisePloText('ELO 2 ประยุกต์ใช้')).toBe('ประยุกต์ใช้');
    expect(normalisePloText('3. วิเคราะห์ข้อมูล')).toBe('วิเคราะห์ข้อมูล');
    expect(normalisePloText('  ใช้เครื่องมือ  ')).toBe('ใช้เครื่องมือ');
  });
  it('keeps text that has no label', () => {
    expect(normalisePloText('สื่อสารได้อย่างมีประสิทธิภาพ')).toBe('สื่อสารได้อย่างมีประสิทธิภาพ');
  });
});

describe('languageVariantKey', () => {
  it('drops international markers and whitespace', () => {
    expect(languageVariantKey('วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ (หลักสูตรนานาชาติ)')).toBe(
      languageVariantKey('วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์'),
    );
    expect(languageVariantKey('ABC (นานาชาติ)')).toBe('abc');
  });
});

describe('buildMarketProfileText', () => {
  it('joins degree names, recruitment summary and careers, skipping blanks', () => {
    expect(
      buildMarketProfileText({
        nameTh: 'ก',
        nameEn: 'A',
        degreeNameTh: 'วท.บ.',
        degreeNameEn: null,
        recruitmentSummaryTh: 'สรุป',
        careers: ['นักวิเคราะห์', 'วิศวกร'],
      }),
    ).toBe('ก / A\nวท.บ.\nสรุป\nCareers: นักวิเคราะห์; วิศวกร');
  });
});

describe('courseEmbeddingText', () => {
  it('uses names, description and CLOs', () => {
    expect(
      courseEmbeddingText({ nameTh: 'สถิติ', nameEn: 'Statistics', descriptionTh: 'ความน่าจะเป็น', learningOutcomesTh: ['คำนวณ'] }),
    ).toBe('สถิติ / Statistics\nความน่าจะเป็น\nCLO: คำนวณ');
  });
});

describe('sha256', () => {
  it('is stable hex', () => {
    expect(sha256('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});

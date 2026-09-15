import { describe, expect, it } from 'vitest';
import {
  JOB_FIELD_TAXONOMY_VERSION,
  JobFieldTaxonomyOutputSchema,
  buildJobFieldTaxonomyMessages,
} from '../src/ai/prompts/job-field-taxonomy';
import {
  PROGRAM_JOB_FIELD_VERSION,
  ProgramJobFieldOutputSchema,
  buildProgramJobFieldMessages,
} from '../src/ai/prompts/program-job-field';

describe('job-field-taxonomy.v1', () => {
  it('is versioned and puts every raw string and every anchor in the user turn', () => {
    expect(JOB_FIELD_TAXONOMY_VERSION).toBe('job-field-taxonomy.v1');
    const msgs = buildJobFieldTaxonomyMessages({
      rawStrings: [{ raw: 'บัญชี', mentions: 812 }, { raw: 'Accounting', mentions: 40 }],
      anchors: [{ slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า'] }],
    });
    const user = msgs.find((m) => m.role === 'user')!.content;
    expect(user).toContain('บัญชี');
    expect(user).toContain('812');
    expect(user).toContain('electrical-engineering');
    expect(user).toContain('ไฟฟ้า');
  });
  it('refuses an empty or oversized batch', () => {
    expect(() => buildJobFieldTaxonomyMessages({ rawStrings: [], anchors: [] })).toThrow();
    const big = Array.from({ length: 201 }, (_, i) => ({ raw: `f${i}`, mentions: 5 }));
    expect(() => buildJobFieldTaxonomyMessages({ rawStrings: big, anchors: [] })).toThrow(/200/);
  });
  it('validates the output shape', () => {
    const ok = JobFieldTaxonomyOutputSchema.safeParse({
      newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
      assignments: [{ raw: 'บัญชี', fieldSlug: 'accounting' }, { raw: 'Accounting', fieldSlug: 'accounting' }],
      confidence: 0.8,
      reasoning: 'Both strings name the accounting discipline.',
    });
    expect(ok.success).toBe(true);
    expect(JobFieldTaxonomyOutputSchema.safeParse({ newFields: [], assignments: [], confidence: 2, reasoning: '' }).success).toBe(false);
  });
});

describe('program-job-field.v1', () => {
  it('is versioned and lists the closed field vocabulary', () => {
    expect(PROGRAM_JOB_FIELD_VERSION).toBe('program-job-field.v1');
    const msgs = buildProgramJobFieldMessages({
      programs: [{ id: 'p1', code: 'KKU-SEQ-0001', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical Engineering', level: 'BACHELOR', skills: ['Circuit design'] }],
      fields: [{ slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering' }],
    });
    const user = msgs.find((m) => m.role === 'user')!.content;
    expect(user).toContain('KKU-SEQ-0001');
    expect(user).toContain('electrical-engineering');
    expect(user).toContain('Circuit design');
  });
  it('caps a programme at three fields and refuses more than 50 programmes', () => {
    const four = { programs: [{ programId: 'p1', fields: [1, 2, 3, 4].map((n) => ({ slug: `f${n}`, confidence: 0.5 })) }], confidence: 0.5, reasoning: 'x' };
    expect(ProgramJobFieldOutputSchema.safeParse(four).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, code: `c${i}`, nameTh: 'x', nameEn: 'x', level: 'BACHELOR', skills: [] }));
    expect(() => buildProgramJobFieldMessages({ programs: many, fields: [] })).toThrow(/50/);
  });
});

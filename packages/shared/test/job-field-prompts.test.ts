import { describe, expect, it } from 'vitest';
import {
  JOB_FIELD_TAXONOMY_BATCH_MAX,
  JOB_FIELD_TAXONOMY_MAX_OUTPUT_TOKENS,
  JOB_FIELD_TAXONOMY_VERSION,
  JobFieldTaxonomyOutputSchema,
  buildJobFieldTaxonomyMessages,
} from '../src/ai/prompts/job-field-taxonomy';
import {
  PROGRAM_JOB_FIELD_BATCH_MAX,
  PROGRAM_JOB_FIELD_MAX_OUTPUT_TOKENS,
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
    expect(user).toContain('1. บัญชี  (812 adverts)');
  });
  it('refuses an empty or oversized batch', () => {
    expect(() => buildJobFieldTaxonomyMessages({ rawStrings: [], anchors: [] })).toThrow();
    const big = Array.from({ length: 201 }, (_, i) => ({ raw: `f${i}`, mentions: 5 }));
    expect(() => buildJobFieldTaxonomyMessages({ rawStrings: big, anchors: [] })).toThrow(/200/);
  });
  it('shows the first-batch placeholder when there are no anchors yet', () => {
    const msgs = buildJobFieldTaxonomyMessages({
      rawStrings: [{ raw: 'บัญชี', mentions: 812 }],
      anchors: [],
    });
    const user = msgs.find((m) => m.role === 'user')!.content;
    expect(user).toContain('(none yet — this is the first batch)');
  });
  it('mentions the abstain path in the system prompt', () => {
    const msgs = buildJobFieldTaxonomyMessages({
      rawStrings: [{ raw: 'บัญชี', mentions: 812 }],
      anchors: [],
    });
    const system = msgs.find((m) => m.role === 'system')!.content;
    expect(system).toContain('unassigned');
  });
  it('exports an output-token budget comfortably above the batch size', () => {
    expect(typeof JOB_FIELD_TAXONOMY_MAX_OUTPUT_TOKENS).toBe('number');
    expect(JOB_FIELD_TAXONOMY_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(JOB_FIELD_TAXONOMY_BATCH_MAX * 30);
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
  it('normalises drifting slugs on both newFields and assignments', () => {
    const parsed = JobFieldTaxonomyOutputSchema.parse({
      newFields: [{ slug: 'Computer_Science', nameTh: 'วิทยาการคอมพิวเตอร์', nameEn: 'Computer Science' }],
      assignments: [{ raw: 'Computer Science', fieldSlug: 'Computer_Science' }],
      confidence: 0.8,
      reasoning: 'Normalised.',
    });
    expect(parsed.newFields[0]!.slug).toBe('computer-science');
    expect(parsed.assignments[0]!.fieldSlug).toBe('computer-science');
  });
  it('clamps an overlong reasoning to 600 chars instead of rejecting the batch', () => {
    const parsed = JobFieldTaxonomyOutputSchema.parse({
      newFields: [],
      assignments: [{ raw: 'บัญชี', fieldSlug: 'accounting' }],
      confidence: 0.8,
      reasoning: 'x'.repeat(700),
    });
    expect(parsed.reasoning.length).toBe(600);
  });
  it('defaults unassigned to an empty array', () => {
    const parsed = JobFieldTaxonomyOutputSchema.parse({
      newFields: [],
      assignments: [{ raw: 'บัญชี', fieldSlug: 'accounting' }],
      confidence: 0.8,
      reasoning: 'ok',
    });
    expect(parsed.unassigned).toEqual([]);
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
  it('exports an output-token budget comfortably above the batch size', () => {
    expect(typeof PROGRAM_JOB_FIELD_MAX_OUTPUT_TOKENS).toBe('number');
    expect(PROGRAM_JOB_FIELD_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(PROGRAM_JOB_FIELD_BATCH_MAX * 30);
  });
  it('clamps an overlong reasoning to 600 chars', () => {
    const parsed = ProgramJobFieldOutputSchema.parse({
      programs: [{ programId: 'p1', fields: [] }],
      confidence: 0.8,
      reasoning: 'y'.repeat(700),
    });
    expect(parsed.reasoning.length).toBe(600);
  });
});

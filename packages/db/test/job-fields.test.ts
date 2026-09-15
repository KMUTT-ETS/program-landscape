import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/index';
import {
  JOB_FIELD_MENTION_FLOOR,
  applyTaxonomyOutput,
  planRuleAssignments,
  planTaxonomyBatches,
  writeTaxonomy,
  type ExistingField,
} from '../src/job-fields';

const existing: ExistingField[] = [
  { id: 'f1', slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า', 'วิศวกรรมไฟฟ้า'], reviewStatus: 'APPROVED' },
  { id: 'f2', slug: 'old-rejected', nameTh: 'x', nameEn: 'x', synonyms: ['ขยะ'], reviewStatus: 'REJECTED' },
];

describe('planTaxonomyBatches', () => {
  it('sends only strings above the floor that no synonym list absorbs, in batches', () => {
    const raw = [
      { raw: 'ไฟฟ้า', mentions: 900 },       // absorbed by f1
      { raw: 'ขยะ', mentions: 30 },          // absorbed by the REJECTED row — still absorbed, never re-proposed
      { raw: 'บัญชี', mentions: 812 },
      { raw: 'Accounting', mentions: 40 },
      { raw: 'rare', mentions: JOB_FIELD_MENTION_FLOOR - 1 },
    ];
    const plan = planTaxonomyBatches(raw, existing, 200);
    expect(plan.batches.flat().map((r) => r.raw)).toEqual(['บัญชี', 'Accounting']);
    expect(plan.other).toEqual({ kinds: 1, mentions: JOB_FIELD_MENTION_FLOOR - 1 });
    expect(plan.absorbed).toBe(2);
  });
  it('splits at the batch size, biggest mentions first', () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ raw: `s${i}`, mentions: 10 + i }));
    const plan = planTaxonomyBatches(raw, [], 2);
    expect(plan.batches.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(plan.batches[0]![0]!.raw).toBe('s4');
  });
});

describe('applyTaxonomyOutput', () => {
  const output = {
    newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
    assignments: [
      { raw: 'บัญชี', fieldSlug: 'accounting' },
      { raw: 'Accounting', fieldSlug: 'accounting' },
      { raw: 'ไฟฟ้ากำลัง', fieldSlug: 'electrical-engineering' },
      { raw: 'ghost', fieldSlug: 'no-such-field' },
    ],
    confidence: 0.8,
    reasoning: 'ok',
  };
  it('creates new fields, attaches synonyms to anchors, drops unknown slugs', () => {
    const r = applyTaxonomyOutput(output, existing, ['บัญชี', 'Accounting', 'ไฟฟ้ากำลัง', 'ghost']);
    expect(r.creates).toEqual([{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting', synonyms: ['บัญชี', 'Accounting'] }]);
    expect(r.synonymAdds).toEqual([{ slug: 'electrical-engineering', synonyms: ['ไฟฟ้ากำลัง'] }]);
    expect(r.dropped).toEqual([{ raw: 'ghost', reason: 'unknown-slug' }]);
  });
  it('never attaches a string that another row already absorbs, and never names an existing slug as new', () => {
    const dup = {
      ...output,
      newFields: [{ slug: 'electrical-engineering', nameTh: 'y', nameEn: 'y' }],
      assignments: [{ raw: 'ไฟฟ้า', fieldSlug: 'accounting' }],
    };
    const r = applyTaxonomyOutput(dup, existing, ['ไฟฟ้า']);
    expect(r.creates).toEqual([]);
    expect(r.synonymAdds).toEqual([]);
    expect(r.dropped).toEqual([
      { raw: 'ไฟฟ้า', reason: 'already-absorbed' },
    ]);
  });
  it('ignores assignments for strings that were not in the batch', () => {
    const r = applyTaxonomyOutput(output, existing, ['บัญชี']);
    expect(r.creates[0]!.synonyms).toEqual(['บัญชี']);
    expect(r.dropped.map((d) => d.raw)).toEqual(['Accounting', 'ไฟฟ้ากำลัง', 'ghost']);
  });
  it('is idempotent: applying the same output to the resulting state produces nothing', () => {
    const first = applyTaxonomyOutput(output, existing, ['บัญชี', 'Accounting', 'ไฟฟ้ากำลัง']);
    const after: ExistingField[] = [
      { ...existing[0]!, synonyms: [...existing[0]!.synonyms, 'ไฟฟ้ากำลัง'] },
      existing[1]!,
      { id: 'f3', reviewStatus: 'PROPOSED', ...first.creates[0]! },
    ];
    const second = applyTaxonomyOutput(output, after, ['บัญชี', 'Accounting', 'ไฟฟ้ากำลัง']);
    expect(second.creates).toEqual([]);
    expect(second.synonymAdds).toEqual([]);
  });
});

describe('planRuleAssignments', () => {
  const fields = [
    { id: 'f1', slug: 'electrical-engineering', synonyms: ['ไฟฟ้า', 'วิศวกรรมไฟฟ้า'] },
    { id: 'f9', slug: 'science', synonyms: ['วิทยาศาสตร์'] },
  ];
  const programmes = [
    { id: 'p1', nameTh: 'วิศวกรรมศาสตรบัณฑิต สาขาวิศวกรรมไฟฟ้า', nameEn: 'Electrical Engineering' },
    { id: 'p2', nameTh: 'พยาบาลศาสตรบัณฑิต', nameEn: 'Nursing' },
    ...Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, nameTh: `วิทยาศาสตร์ ${i}`, nameEn: `Science ${i}` })),
  ];
  it('assigns by name match and skips synonyms that match too many programmes', () => {
    const r = planRuleAssignments(programmes, fields);
    expect(r.assignments).toEqual([{ programId: 'p1', fieldId: 'f1', synonym: 'ไฟฟ้า' }]);
    expect(r.promiscuousSynonyms).toEqual(['วิทยาศาสตร์']);
    expect(r.unassignedProgramIds).toContain('p2');
  });
});

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!postgresUp)('writeTaxonomy against postgres', () => {
  it('upserts by slug, appends synonyms, never renames a non-PROPOSED row, and stamps the run', async () => {
    const run = await prisma.ingestionRun.findFirst({ where: { status: 'SUCCEEDED' }, select: { id: true } });
    if (!run) return; // fresh database: nothing to attribute to; the guard in the script refuses too
    await prisma
      .$transaction(async (tx) => {
        await tx.jobFieldTaxonomy.create({
          data: { slug: 'zz-test-approved', nameTh: 'เดิม', nameEn: 'Original', synonyms: ['a'], reviewStatus: 'APPROVED', methodVersion: 't' },
        });
        await writeTaxonomy(
          {
            creates: [{ slug: 'zz-test-new', nameTh: 'ใหม่', nameEn: 'New', synonyms: ['b'] }],
            synonymAdds: [{ slug: 'zz-test-approved', synonyms: ['c'] }],
            dropped: [],
          },
          run.id,
          tx,
        );
        const rows = await tx.jobFieldTaxonomy.findMany({ where: { slug: { startsWith: 'zz-test-' } }, orderBy: { slug: 'asc' } });
        expect(rows.map((r) => [r.slug, r.nameEn, r.synonyms, r.reviewStatus, r.ingestionRunId])).toEqual([
          ['zz-test-approved', 'Original', ['a', 'c'], 'APPROVED', null],
          ['zz-test-new', 'New', ['b'], 'PROPOSED', run.id],
        ]);
        throw new Prisma.PrismaClientKnownRequestError('rollback', { code: 'P0000', clientVersion: 'test' });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.message === 'rollback')) throw e;
      });
  });
});

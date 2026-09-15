import { describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/index';
import {
  JOB_FIELD_MENTION_FLOOR,
  applyTaxonomyOutput,
  mergeJobFields,
  planRuleAssignments,
  planTaxonomyBatches,
  refreshMentionCounts,
  writeAssignments,
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
    expect(r.missing).toEqual([]);
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
  it('records abstentions as dropped, and strings the model never mentioned as missing', () => {
    const r = applyTaxonomyOutput(
      {
        newFields: [],
        assignments: [{ raw: 'ไฟฟ้ากำลัง', fieldSlug: 'electrical-engineering' }],
        unassigned: [
          { raw: 'Sales Manager', reason: 'job title' },
          { raw: 'ไฟฟ้ากำลัง', reason: 'also listed — the assignment wins' },
          { raw: 'stranger', reason: 'not in the batch' },
        ],
      },
      existing,
      ['ไฟฟ้ากำลัง', 'Sales Manager', 'forgotten', 'forgotten-too'],
    );
    expect(r.synonymAdds).toEqual([{ slug: 'electrical-engineering', synonyms: ['ไฟฟ้ากำลัง'] }]);
    expect(r.dropped).toEqual([{ raw: 'Sales Manager', reason: 'abstained' }]);
    expect(r.missing).toEqual(['forgotten', 'forgotten-too']);
  });
  it('drops an assignment that names a REJECTED slug directly, never adding the synonym', () => {
    const r = applyTaxonomyOutput(
      { newFields: [], assignments: [{ raw: 'ขยะใหม่', fieldSlug: 'old-rejected' }] },
      existing,
      ['ขยะใหม่'],
    );
    expect(r.synonymAdds).toEqual([]);
    expect(r.creates).toEqual([]);
    expect(r.dropped).toEqual([{ raw: 'ขยะใหม่', reason: 'rejected-field' }]);
    expect(r.missing).toEqual([]);
  });
  it('drops assignments to a newFields entry whose slug collides with a REJECTED row', () => {
    const r = applyTaxonomyOutput(
      {
        newFields: [{ slug: 'old-rejected', nameTh: 'ฟื้น', nameEn: 'Revived' }],
        assignments: [{ raw: 'ขยะใหม่', fieldSlug: 'old-rejected' }],
      },
      existing,
      ['ขยะใหม่'],
    );
    expect(r.creates).toEqual([]);
    expect(r.synonymAdds).toEqual([]);
    expect(r.dropped).toEqual([{ raw: 'ขยะใหม่', reason: 'rejected-field' }]);
  });
  it('keeps the first assignment of a string and drops the repeat as duplicate', () => {
    const r = applyTaxonomyOutput(
      {
        newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
        assignments: [
          { raw: 'บัญชี', fieldSlug: 'accounting' },
          { raw: 'บัญชี', fieldSlug: 'electrical-engineering' },
        ],
      },
      existing,
      ['บัญชี'],
    );
    expect(r.creates).toEqual([{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting', synonyms: ['บัญชี'] }]);
    expect(r.synonymAdds).toEqual([]);
    expect(r.dropped).toEqual([{ raw: 'บัญชี', reason: 'duplicate' }]);
    expect(r.missing).toEqual([]);
  });
  it('does not create a newFields entry whose synonyms were all dropped', () => {
    const r = applyTaxonomyOutput(
      {
        newFields: [{ slug: 'phantom', nameTh: 'ผี', nameEn: 'Phantom' }],
        assignments: [
          { raw: 'ไฟฟ้า', fieldSlug: 'phantom' },      // already absorbed by f1
          { raw: 'elsewhere', fieldSlug: 'phantom' },  // not in the batch
        ],
      },
      existing,
      ['ไฟฟ้า'],
    );
    expect(r.creates).toEqual([]);
    expect(r.dropped).toEqual([
      { raw: 'ไฟฟ้า', reason: 'already-absorbed' },
      { raw: 'elsewhere', reason: 'not-in-batch' },
    ]);
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

// ── Postgres tests: every write happens inside a transaction that is rolled
// back by throwing Rollback at the end, so nothing persists. Rows are created
// inside the transaction with zz-test- slugs; programme ids and the run id
// are read-only lookups of what the database already holds.

class Rollback extends Error {}

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

/** Runs `fn` in a transaction that is always rolled back. */
async function rolledBack(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  await prisma
    .$transaction(
      async (tx) => {
        await fn(tx);
        throw new Rollback('rollback');
      },
      { timeout: 60_000 },
    )
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
}

async function succeededRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({ where: { status: 'SUCCEEDED' }, select: { id: true } });
  return run?.id ?? null;
}

async function twoProgramIds(): Promise<[string, string] | null> {
  const rows = await prisma.program.findMany({ take: 2, select: { id: true }, orderBy: { code: 'asc' } });
  return rows.length === 2 ? [rows[0]!.id, rows[1]!.id] : null;
}

describe.skipIf(!postgresUp)('writeTaxonomy against postgres', () => {
  it('creates PROPOSED rows and appends synonyms, never renames a non-PROPOSED row, and stamps the run', async () => {
    const runId = await succeededRunId();
    if (!runId) return; // fresh database: nothing to attribute to; the guard in the script refuses too
    await rolledBack(async (tx) => {
      await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-approved', nameTh: 'เดิม', nameEn: 'Original', synonyms: ['a'], reviewStatus: 'APPROVED', methodVersion: 't' },
      });
      await writeTaxonomy(
        {
          creates: [{ slug: 'zz-test-new', nameTh: 'ใหม่', nameEn: 'New', synonyms: ['b'] }],
          synonymAdds: [{ slug: 'zz-test-approved', synonyms: ['c'] }],
          dropped: [],
          missing: [],
        },
        runId,
        tx,
      );
      const rows = await tx.jobFieldTaxonomy.findMany({ where: { slug: { startsWith: 'zz-test-' } }, orderBy: { slug: 'asc' } });
      expect(rows.map((r) => [r.slug, r.nameEn, r.synonyms, r.reviewStatus, r.ingestionRunId])).toEqual([
        ['zz-test-approved', 'Original', ['a', 'c'], 'APPROVED', null],
        ['zz-test-new', 'New', ['b'], 'PROPOSED', runId],
      ]);
      expect(rows.find((r) => r.slug === 'zz-test-new')!.methodVersion).toBe('job-field-taxonomy.v1');
    });
  });
});

describe.skipIf(!postgresUp)('writeAssignments against postgres', () => {
  it('keeps an APPROVED row as it is when the refresh proposes it again, and refreshes a PROPOSED one', async () => {
    const runId = await succeededRunId();
    const programs = await twoProgramIds();
    if (!runId || !programs) return;
    const [p1, p2] = programs;
    await rolledBack(async (tx) => {
      const field = await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-field', nameTh: 'ทดสอบ', nameEn: 'Test', synonyms: ['zz'], methodVersion: 't' },
        select: { id: true },
      });
      await tx.programJobField.create({
        data: { programId: p1, fieldId: field.id, source: 'manual', confidence: null, reviewStatus: 'APPROVED', methodVersion: 'manual' },
      });
      await tx.programJobField.create({
        data: { programId: p2, fieldId: field.id, source: 'rule', confidence: null, reviewStatus: 'PROPOSED', methodVersion: 'old' },
      });
      const result = await writeAssignments(
        [
          { programId: p1, fieldId: field.id, source: 'ai', confidence: 0.4, methodVersion: 'new' },
          { programId: p2, fieldId: field.id, source: 'ai', confidence: 0.9, methodVersion: 'new' },
        ],
        runId,
        tx,
      );
      expect(result).toEqual({ created: 0, refreshed: 1, kept: 1 });
      const rows = await tx.programJobField.findMany({ where: { fieldId: field.id }, orderBy: { reviewStatus: 'asc' } });
      const byProgram = new Map(rows.map((r) => [r.programId, r]));
      const keptRow = byProgram.get(p1)!;
      expect([keptRow.reviewStatus, keptRow.source, keptRow.confidence, keptRow.methodVersion, keptRow.ingestionRunId]).toEqual([
        'APPROVED', 'manual', null, 'manual', null,
      ]);
      const refreshedRow = byProgram.get(p2)!;
      expect([refreshedRow.reviewStatus, refreshedRow.source, refreshedRow.confidence, refreshedRow.methodVersion, refreshedRow.ingestionRunId]).toEqual([
        'PROPOSED', 'ai', 0.9, 'new', runId,
      ]);
    });
  });
});

describe.skipIf(!postgresUp)('mergeJobFields against postgres', () => {
  it('moves synonyms and assignments, promotes the target when the from-row was APPROVED, and deletes the from-field', async () => {
    const programs = await twoProgramIds();
    if (!programs) return;
    const [p1, p2] = programs;
    await rolledBack(async (tx) => {
      const into = await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-into', nameTh: 'ปลายทาง', nameEn: 'Into', synonyms: ['shared', 'into-only'], methodVersion: 't' },
        select: { id: true },
      });
      const from = await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-from', nameTh: 'ต้นทาง', nameEn: 'From', synonyms: ['shared', 'from-only'], methodVersion: 't' },
        select: { id: true },
      });
      // p1: on both — from-row APPROVED beats the target's PROPOSED.
      await tx.programJobField.create({
        data: { programId: p1, fieldId: into.id, source: 'rule', confidence: null, reviewStatus: 'PROPOSED', methodVersion: 'rule' },
      });
      await tx.programJobField.create({
        data: { programId: p1, fieldId: from.id, source: 'manual', confidence: null, reviewStatus: 'APPROVED', methodVersion: 'manual' },
      });
      // p2: only on from — moved.
      await tx.programJobField.create({
        data: { programId: p2, fieldId: from.id, source: 'ai', confidence: 0.7, reviewStatus: 'PROPOSED', methodVersion: 'ai' },
      });

      const result = await mergeJobFields(from.id, into.id, tx);
      expect(result).toEqual({ synonymsMoved: 1, assignmentsMoved: 1, assignmentsPromoted: 1 });

      const survivor = await tx.jobFieldTaxonomy.findUnique({ where: { id: into.id }, select: { synonyms: true } });
      expect(survivor!.synonyms).toEqual(['shared', 'into-only', 'from-only']);
      expect(await tx.jobFieldTaxonomy.findUnique({ where: { id: from.id } })).toBeNull();
      expect(await tx.programJobField.count({ where: { fieldId: from.id } })).toBe(0);

      const rows = await tx.programJobField.findMany({ where: { fieldId: into.id } });
      const byProgram = new Map(rows.map((r) => [r.programId, r]));
      expect(rows).toHaveLength(2);
      const promotedRow = byProgram.get(p1)!;
      expect([promotedRow.reviewStatus, promotedRow.source, promotedRow.methodVersion]).toEqual(['APPROVED', 'manual', 'manual']);
      const movedRow = byProgram.get(p2)!;
      expect([movedRow.reviewStatus, movedRow.source, movedRow.confidence]).toEqual(['PROPOSED', 'ai', 0.7]);
    });
  });
  it('does not demote an APPROVED target when the from-row is weaker', async () => {
    const programs = await twoProgramIds();
    if (!programs) return;
    const [p1] = programs;
    await rolledBack(async (tx) => {
      const into = await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-into', nameTh: 'ปลายทาง', nameEn: 'Into', synonyms: [], methodVersion: 't' },
        select: { id: true },
      });
      const from = await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-from', nameTh: 'ต้นทาง', nameEn: 'From', synonyms: [], methodVersion: 't' },
        select: { id: true },
      });
      await tx.programJobField.create({
        data: { programId: p1, fieldId: into.id, source: 'manual', confidence: null, reviewStatus: 'APPROVED', methodVersion: 'manual' },
      });
      await tx.programJobField.create({
        data: { programId: p1, fieldId: from.id, source: 'ai', confidence: 0.2, reviewStatus: 'REJECTED', methodVersion: 'ai' },
      });
      const result = await mergeJobFields(from.id, into.id, tx);
      expect(result).toEqual({ synonymsMoved: 0, assignmentsMoved: 0, assignmentsPromoted: 0 });
      const row = await tx.programJobField.findUnique({ where: { programId_fieldId: { programId: p1, fieldId: into.id } } });
      expect([row!.reviewStatus, row!.source]).toEqual(['APPROVED', 'manual']);
    });
  });
});

describe.skipIf(!postgresUp)('refreshMentionCounts against postgres', () => {
  it('sets a count of at least zero without error', async () => {
    await rolledBack(async (tx) => {
      const field = await tx.jobFieldTaxonomy.create({
        data: { slug: 'zz-test-count', nameTh: 'นับ', nameEn: 'Count', synonyms: ['zz-test-no-posting-says-this'], mentionCount: 99, methodVersion: 't' },
        select: { id: true },
      });
      await refreshMentionCounts(tx);
      const row = await tx.jobFieldTaxonomy.findUnique({ where: { id: field.id }, select: { mentionCount: true } });
      expect(row!.mentionCount).toBe(0);
    });
  });
});

import { Prisma, type JobFieldReviewStatus } from '@prisma/client';
import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';
import { prisma } from './index';
import { realDataSql } from './data-quality';
import { MAX_PROGRAMMES_PER_FIELD, matchFieldToProgramme } from './jobthai-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Job-field taxonomy — the rows of the demand-first Gap Analyzer.
//
// Raw `job_postings.required_fields_raw` strings ("บัญชี", "Accounting",
// "บัญชี/การเงิน") are clustered into canonical fields by the
// job-field-taxonomy prompt; each field absorbs its raw strings as synonyms.
// Programmes are assigned to fields first by the name-match rule the JobThai
// bridge already uses (source 'rule'), then by the program-job-field prompt
// (source 'ai'), then by hand on /admin/job-fields (source 'manual').
//
// Invariants enforced HERE, because Postgres cannot express them:
//   - a raw string belongs to at most one field's synonyms;
//   - APPROVED / REJECTED rows are never renamed, never downgraded, and their
//     synonyms are never removed by the build step;
//   - every write stamps ingestionRunId (realDataWhere()).
// ─────────────────────────────────────────────────────────────────────────────

/** Strings mentioned by fewer postings form the "other" bucket: counted in
 *  denominators, never assigned. 518 of 3,854 strings cleared it on 2026-09-15. */
export const JOB_FIELD_MENTION_FLOOR = 5;

export type JobFieldSource = 'ai' | 'rule' | 'manual';

export interface RawFieldString {
  raw: string;
  mentions: number;
}

export interface ExistingField {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  reviewStatus: JobFieldReviewStatus;
}

/** Every distinct field string on JobThai postings with its mention count,
 *  excluding the any-field sentinel. Gated by realDataSql so a mocked or
 *  untagged batch cannot seed the taxonomy. */
export async function collectRawFieldStrings(): Promise<RawFieldString[]> {
  const rows = await prisma.$queryRaw<Array<{ raw: string; mentions: number }>>(Prisma.sql`
    SELECT s AS raw, COUNT(*)::int AS mentions
    FROM job_postings jp, unnest(jp.required_fields_raw) AS s
    WHERE jp.source = 'jobthai'
      AND s <> ${JOBTHAI_ANY_FIELD}
      AND ${realDataSql('jp')}
    GROUP BY s
    ORDER BY mentions DESC, s ASC
  `);
  return rows;
}

export async function listExistingFields(): Promise<ExistingField[]> {
  return prisma.jobFieldTaxonomy.findMany({
    select: { id: true, slug: true, nameTh: true, nameEn: true, synonyms: true, reviewStatus: true },
    orderBy: { slug: 'asc' },
  });
}

export interface TaxonomyPlan {
  /** Strings to send to the model, batched, most-mentioned first. */
  batches: RawFieldString[][];
  /** Strings below the floor: counted, never assigned. */
  other: { kinds: number; mentions: number };
  /** Strings above the floor already in some synonym list (any status). */
  absorbed: number;
}

export function planTaxonomyBatches(
  raw: RawFieldString[],
  existing: ExistingField[],
  batchSize: number,
): TaxonomyPlan {
  const absorbedSet = new Set(existing.flatMap((f) => f.synonyms));
  let otherKinds = 0;
  let otherMentions = 0;
  let absorbed = 0;
  const pending: RawFieldString[] = [];
  for (const r of raw) {
    if (r.raw === JOBTHAI_ANY_FIELD) continue;
    if (r.mentions < JOB_FIELD_MENTION_FLOOR) {
      otherKinds += 1;
      otherMentions += r.mentions;
      continue;
    }
    if (absorbedSet.has(r.raw)) {
      absorbed += 1;
      continue;
    }
    pending.push(r);
  }
  pending.sort((a, b) => b.mentions - a.mentions || a.raw.localeCompare(b.raw));
  const batches: RawFieldString[][] = [];
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize));
  return { batches, other: { kinds: otherKinds, mentions: otherMentions }, absorbed };
}

export interface TaxonomyOutputLike {
  newFields: Array<{ slug: string; nameTh: string; nameEn: string }>;
  assignments: Array<{ raw: string; fieldSlug: string }>;
}

export interface TaxonomyWrite {
  creates: Array<{ slug: string; nameTh: string; nameEn: string; synonyms: string[] }>;
  synonymAdds: Array<{ slug: string; synonyms: string[] }>;
  dropped: Array<{ raw: string; reason: 'unknown-slug' | 'already-absorbed' | 'not-in-batch' | 'duplicate' }>;
}

/** Turns one model response into writes, enforcing the invariants. Pure. */
export function applyTaxonomyOutput(
  output: TaxonomyOutputLike,
  existing: ExistingField[],
  batchRaw: string[],
): TaxonomyWrite {
  const existingBySlug = new Map(existing.map((f) => [f.slug, f]));
  const absorbed = new Set(existing.flatMap((f) => f.synonyms));
  const inBatch = new Set(batchRaw);
  const newBySlug = new Map<string, { slug: string; nameTh: string; nameEn: string; synonyms: string[] }>();
  for (const nf of output.newFields) {
    if (existingBySlug.has(nf.slug) || newBySlug.has(nf.slug)) continue; // never re-create an existing slug
    newBySlug.set(nf.slug, { ...nf, synonyms: [] });
  }
  const addsBySlug = new Map<string, string[]>();
  const dropped: TaxonomyWrite['dropped'] = [];
  const seen = new Set<string>();
  for (const a of output.assignments) {
    if (!inBatch.has(a.raw)) { dropped.push({ raw: a.raw, reason: 'not-in-batch' }); continue; }
    if (seen.has(a.raw)) { dropped.push({ raw: a.raw, reason: 'duplicate' }); continue; }
    seen.add(a.raw);
    if (absorbed.has(a.raw)) { dropped.push({ raw: a.raw, reason: 'already-absorbed' }); continue; }
    const created = newBySlug.get(a.fieldSlug);
    if (created) { created.synonyms.push(a.raw); continue; }
    if (existingBySlug.has(a.fieldSlug)) {
      const list = addsBySlug.get(a.fieldSlug) ?? [];
      list.push(a.raw);
      addsBySlug.set(a.fieldSlug, list);
      continue;
    }
    dropped.push({ raw: a.raw, reason: 'unknown-slug' });
  }
  return {
    creates: [...newBySlug.values()].filter((c) => c.synonyms.length > 0),
    synonymAdds: [...addsBySlug.entries()].map(([slug, synonyms]) => ({ slug, synonyms })),
    dropped,
  };
}

type Tx = Prisma.TransactionClient | typeof prisma;

/** Applies a TaxonomyWrite. New rows are PROPOSED and stamped with the run;
 *  synonym additions touch only the array (names and status untouched). */
export async function writeTaxonomy(write: TaxonomyWrite, runId: string, tx: Tx = prisma): Promise<{ created: number; extended: number }> {
  for (const c of write.creates) {
    await tx.jobFieldTaxonomy.create({
      data: {
        slug: c.slug,
        nameTh: c.nameTh,
        nameEn: c.nameEn,
        synonyms: c.synonyms,
        reviewStatus: 'PROPOSED',
        methodVersion: 'job-field-taxonomy.v1',
        ingestionRunId: runId,
      },
    });
  }
  for (const s of write.synonymAdds) {
    await tx.jobFieldTaxonomy.update({
      where: { slug: s.slug },
      data: { synonyms: { push: s.synonyms } },
    });
  }
  return { created: write.creates.length, extended: write.synonymAdds.length };
}

/** mention_count = postings naming any synonym (bachelor and postgraduate
 *  alike — this is the review page's size hint, not the map's demand). */
export async function refreshMentionCounts(tx: Tx = prisma): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE job_field_taxonomy f SET mention_count = sub.n
    FROM (
      SELECT f2.id, COUNT(DISTINCT jp.id)::int AS n
      FROM job_field_taxonomy f2
      LEFT JOIN job_postings jp ON jp.source = 'jobthai' AND jp.required_fields_raw && f2.synonyms
      GROUP BY f2.id
    ) sub
    WHERE sub.id = f.id
  `);
}

// ── Programme assignment ────────────────────────────────────────────────────

export interface RuleAssignment {
  programId: string;
  fieldId: string;
  synonym: string;
}

/** Name-match rule (matchFieldToProgramme) over every synonym. A synonym that
 *  matches more than MAX_PROGRAMMES_PER_FIELD programmes is generic vocabulary
 *  ("วิทยาศาสตร์") and is skipped, as the JobThai bridge skips it. Pure. */
export function planRuleAssignments(
  programmes: Array<{ id: string; nameTh: string; nameEn: string }>,
  fields: Array<{ id: string; slug: string; synonyms: string[] }>,
): { assignments: RuleAssignment[]; promiscuousSynonyms: string[]; unassignedProgramIds: string[] } {
  const assignments: RuleAssignment[] = [];
  const promiscuous: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    for (const syn of f.synonyms) {
      const hits = programmes.filter(
        (p) => matchFieldToProgramme(syn, p.nameTh) || matchFieldToProgramme(syn, p.nameEn),
      );
      if (hits.length > MAX_PROGRAMMES_PER_FIELD) { promiscuous.push(syn); continue; }
      for (const p of hits) {
        const key = `${p.id}:${f.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assignments.push({ programId: p.id, fieldId: f.id, synonym: syn });
      }
    }
  }
  const assigned = new Set(assignments.map((a) => a.programId));
  return {
    assignments,
    promiscuousSynonyms: promiscuous,
    unassignedProgramIds: programmes.filter((p) => !assigned.has(p.id)).map((p) => p.id),
  };
}

export interface AssignmentWrite {
  programId: string;
  fieldId: string;
  source: JobFieldSource;
  confidence: number | null;
  methodVersion: string;
}

/** Upserts on (programId, fieldId). An existing APPROVED or REJECTED row is
 *  left exactly as it is; a PROPOSED row is refreshed. */
export async function writeAssignments(rows: AssignmentWrite[], runId: string, tx: Tx = prisma): Promise<{ created: number; refreshed: number; kept: number }> {
  let created = 0;
  let refreshed = 0;
  let kept = 0;
  for (const r of rows) {
    const existing = await tx.programJobField.findUnique({
      where: { programId_fieldId: { programId: r.programId, fieldId: r.fieldId } },
      select: { id: true, reviewStatus: true },
    });
    if (!existing) {
      await tx.programJobField.create({
        data: { ...r, reviewStatus: 'PROPOSED', ingestionRunId: runId },
      });
      created += 1;
    } else if (existing.reviewStatus === 'PROPOSED') {
      await tx.programJobField.update({
        where: { id: existing.id },
        data: { source: r.source, confidence: r.confidence, methodVersion: r.methodVersion, ingestionRunId: runId },
      });
      refreshed += 1;
    } else {
      kept += 1;
    }
  }
  return { created, refreshed, kept };
}

// ── Review page readers + mutations (used by /admin/job-fields) ─────────────

export interface JobFieldRow {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  mentionCount: number;
  reviewStatus: JobFieldReviewStatus;
  methodVersion: string;
  programmeCount: number;
  updatedAt: string;
}

export async function listJobFields(): Promise<JobFieldRow[]> {
  const rows = await prisma.jobFieldTaxonomy.findMany({
    orderBy: [{ reviewStatus: 'asc' }, { mentionCount: 'desc' }],
    include: { _count: { select: { programs: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    synonyms: r.synonyms,
    mentionCount: r.mentionCount,
    reviewStatus: r.reviewStatus,
    methodVersion: r.methodVersion,
    programmeCount: r._count.programs,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface ProgramJobFieldRow {
  id: string;
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: string;
  fieldId: string;
  fieldSlug: string;
  source: string;
  confidence: number | null;
  reviewStatus: JobFieldReviewStatus;
}

export async function listProgramJobFields(fieldId?: string): Promise<ProgramJobFieldRow[]> {
  const rows = await prisma.programJobField.findMany({
    where: fieldId ? { fieldId } : undefined,
    include: {
      program: { select: { code: true, nameTh: true, nameEn: true, level: true } },
      field: { select: { slug: true } },
    },
    orderBy: [{ reviewStatus: 'asc' }, { confidence: 'desc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    programId: r.programId,
    programCode: r.program.code,
    programNameTh: r.program.nameTh,
    programNameEn: r.program.nameEn,
    programLevel: r.program.level,
    fieldId: r.fieldId,
    fieldSlug: r.field.slug,
    source: r.source,
    confidence: r.confidence,
    reviewStatus: r.reviewStatus,
  }));
}

export async function setJobFieldStatus(id: string, reviewStatus: JobFieldReviewStatus): Promise<void> {
  await prisma.jobFieldTaxonomy.update({ where: { id }, data: { reviewStatus } });
}

export async function renameJobField(id: string, names: { nameTh: string; nameEn: string }): Promise<void> {
  await prisma.jobFieldTaxonomy.update({ where: { id }, data: names });
}

/** Moves synonyms and assignments from `fromId` into `intoId`, then deletes
 *  `fromId`. Assignments that already exist on the target are dropped by
 *  the unique key, never duplicated. One transaction. */
export async function mergeJobFields(fromId: string, intoId: string): Promise<{ synonymsMoved: number; assignmentsMoved: number }> {
  if (fromId === intoId) throw new Error('cannot merge a field into itself');
  return prisma.$transaction(async (tx) => {
    const from = await tx.jobFieldTaxonomy.findUniqueOrThrow({ where: { id: fromId }, select: { synonyms: true } });
    const into = await tx.jobFieldTaxonomy.findUniqueOrThrow({ where: { id: intoId }, select: { synonyms: true } });
    const merged = [...new Set([...into.synonyms, ...from.synonyms])];
    await tx.jobFieldTaxonomy.update({ where: { id: intoId }, data: { synonyms: merged } });
    const assignments = await tx.programJobField.findMany({ where: { fieldId: fromId } });
    let moved = 0;
    for (const a of assignments) {
      const clash = await tx.programJobField.findUnique({
        where: { programId_fieldId: { programId: a.programId, fieldId: intoId } },
        select: { id: true },
      });
      if (clash) continue;
      await tx.programJobField.update({ where: { id: a.id }, data: { fieldId: intoId } });
      moved += 1;
    }
    await tx.jobFieldTaxonomy.delete({ where: { id: fromId } }); // cascades the un-moved clashes
    return { synonymsMoved: merged.length - into.synonyms.length, assignmentsMoved: moved };
  });
}

export async function setProgramJobFieldStatus(id: string, reviewStatus: JobFieldReviewStatus): Promise<void> {
  await prisma.programJobField.update({ where: { id }, data: { reviewStatus } });
}

/** Manual add from the review page: APPROVED at once (an admin said so). */
export async function addProgramJobField(programId: string, fieldId: string, runId: string | null): Promise<string> {
  const row = await prisma.programJobField.upsert({
    where: { programId_fieldId: { programId, fieldId } },
    create: { programId, fieldId, source: 'manual', confidence: null, reviewStatus: 'APPROVED', methodVersion: 'manual', ingestionRunId: runId },
    update: { source: 'manual', reviewStatus: 'APPROVED' },
    select: { id: true },
  });
  return row.id;
}

/** The run every taxonomy write is attributed to: the latest SUCCEEDED
 *  JobThai run. Null on a database that has never ingested JobThai. */
export async function latestJobThaiRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: 'jobthai' } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

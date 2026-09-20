import { Prisma, type JobFieldReviewStatus } from '@prisma/client';
import { JOB_FIELD_TAXONOMY_VERSION, demandSourcesFor } from '@kku/shared';
import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';
import { prisma } from './index';
import { realDataSql } from './data-quality';
import {
  MAX_PROGRAMMES_PER_FIELD,
  buildReviewedFieldVocabulary,
  matchFieldToProgramme,
  type ReviewedFieldVocabulary,
} from './jobthai-bridge';

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
// Both demand sources (private JobThai postings, public job-108 government
// announcements) seed the vocabulary — see TAXONOMY_SOURCES below. A field of
// study is a field of study regardless of who advertised it, and separate
// vocabularies would leave no shared row for the map to carry a private and a
// public share on.
//
// Invariants enforced HERE, because Postgres cannot express them:
//   - a raw string belongs to at most one field's synonyms;
//   - APPROVED / REJECTED rows are never renamed, never downgraded, and their
//     synonyms are never removed by the build step;
//   - every write stamps ingestionRunId (realDataWhere()).
// ─────────────────────────────────────────────────────────────────────────────

/** Source slugs whose postings seed and count toward the taxonomy. Both
 *  bases, not just 'private' — see the module banner above. */
const TAXONOMY_SOURCES = demandSourcesFor('all');

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

/** Every distinct field string on postings from either demand source (private
 *  JobThai or public job-108) with its mention count, excluding the any-field
 *  sentinel. Gated by realDataSql so a mocked or untagged batch cannot seed
 *  the taxonomy. */
export async function collectRawFieldStrings(): Promise<RawFieldString[]> {
  const rows = await prisma.$queryRaw<Array<{ raw: string; mentions: number }>>(Prisma.sql`
    SELECT s AS raw, COUNT(*)::int AS mentions
    FROM job_postings jp, unnest(jp.required_fields_raw) AS s
    WHERE jp.source = ANY(${TAXONOMY_SOURCES}::text[])
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

/** The shape of one job-field-taxonomy prompt response that this module
 *  reads (slugs already normalised by the prompt's Zod schema). */
export interface TaxonomyOutputLike {
  newFields: Array<{ slug: string; nameTh: string; nameEn: string }>;
  assignments: Array<{ raw: string; fieldSlug: string }>;
  /** Strings the model declined to attach: not a field of study at all. */
  unassigned?: Array<{ raw: string; reason: string }>;
}

export type TaxonomyDropReason =
  | 'unknown-slug'
  | 'already-absorbed'
  | 'not-in-batch'
  | 'duplicate'
  | 'abstained'
  | 'rejected-field';

export interface TaxonomyWrite {
  creates: Array<{ slug: string; nameTh: string; nameEn: string; synonyms: string[] }>;
  synonymAdds: Array<{ slug: string; synonyms: string[] }>;
  dropped: Array<{ raw: string; reason: TaxonomyDropReason }>;
  /** Batch strings the model mentioned in neither `assignments` nor
   *  `unassigned`. Not absorbed, so planTaxonomyBatches re-sends them next run. */
  missing: string[];
}

/** Turns one model response into writes, enforcing the invariants. Pure.
 *
 *  A target that resolves to a REJECTED row — named directly as `fieldSlug`,
 *  or via a `newFields` entry colliding with a REJECTED slug — is dropped as
 *  'rejected-field', never added as a synonym: planTaxonomyBatches treats
 *  every synonym as absorbed, so the string would vanish for good. Anchors
 *  exclude REJECTED rows, so this only happens by collision or hallucination. */
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
    const anchor = existingBySlug.get(a.fieldSlug);
    if (anchor) {
      if (anchor.reviewStatus === 'REJECTED') { dropped.push({ raw: a.raw, reason: 'rejected-field' }); continue; }
      const list = addsBySlug.get(a.fieldSlug) ?? [];
      list.push(a.raw);
      addsBySlug.set(a.fieldSlug, list);
      continue;
    }
    dropped.push({ raw: a.raw, reason: 'unknown-slug' });
  }
  for (const u of output.unassigned ?? []) {
    if (!inBatch.has(u.raw) || seen.has(u.raw)) continue; // an assignment already accounted for it
    seen.add(u.raw);
    dropped.push({ raw: u.raw, reason: absorbed.has(u.raw) ? 'already-absorbed' : 'abstained' });
  }
  return {
    creates: [...newBySlug.values()].filter((c) => c.synonyms.length > 0),
    synonymAdds: [...addsBySlug.entries()].map(([slug, synonyms]) => ({ slug, synonyms })),
    dropped,
    missing: [...inBatch].filter((raw) => !seen.has(raw)),
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
        methodVersion: JOB_FIELD_TAXONOMY_VERSION,
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
 *  alike, private and public demand alike — this is the review page's size
 *  hint, not the map's demand). Gated by realDataSql so a mocked batch cannot
 *  inflate the hint. */
export async function refreshMentionCounts(tx: Tx = prisma): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE job_field_taxonomy f SET mention_count = sub.n
    FROM (
      SELECT f2.id, COUNT(DISTINCT jp.id)::int AS n
      FROM job_field_taxonomy f2
      LEFT JOIN job_postings jp
        ON jp.source = ANY(${TAXONOMY_SOURCES}::text[])
       AND jp.required_fields_raw && f2.synonyms
       AND ${realDataSql('jp')}
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

/**
 * The reviewed vocabulary the JobThai bridge consults (jobthai-bridge.v3).
 *
 * APPROVED fields only, with their NON-REJECTED programme assignments. Read once
 * per link plan — two queries, not one per programme. An assignment's own review
 * status is deliberately NOT required to be APPROVED: approving the FIELD is the
 * act that makes its cluster trustworthy, and the assignments under it are then
 * the reviewer's working set. A REJECTED assignment is the reviewer having
 * looked at that one pair and said no, so it is excluded.
 *
 * `buildReviewedFieldVocabulary` then drops any field claiming more than
 * MAX_PROGRAMMES_PER_FIELD programmes — see its comment for the measured
 * `business-administration` blow-up that cap exists to stop.
 */
export async function loadReviewedFieldVocabulary(): Promise<{
  vocabulary: ReviewedFieldVocabulary;
  cappedFieldIds: string[];
}> {
  const fields = await prisma.jobFieldTaxonomy.findMany({
    where: { reviewStatus: 'APPROVED' },
    select: { id: true, synonyms: true },
  });
  const assignments = await prisma.programJobField.findMany({
    where: { reviewStatus: { not: 'REJECTED' }, fieldId: { in: fields.map((f) => f.id) } },
    select: { programId: true, fieldId: true },
  });
  return buildReviewedFieldVocabulary(
    fields.map((f) => ({ fieldId: f.id, synonyms: f.synonyms })),
    assignments,
  );
}

export interface AssignmentWrite {
  programId: string;
  fieldId: string;
  source: JobFieldSource;
  confidence: number | null;
  methodVersion: string;
}

/** Upserts on (programId, fieldId). An existing APPROVED or REJECTED row is
 *  left exactly as it is; a PROPOSED row is refreshed.
 *  Manual rows are written APPROVED by addProgramJobField, so this refresh
 *  path never overwrites a 'manual' source unless an admin demoted the row. */
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
    orderBy: [{ reviewStatus: 'asc' }, { confidence: { sort: 'desc', nulls: 'last' } }],
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

/** Review-status strength, for keeping the stronger of two rows on a merge. */
const REVIEW_STATUS_RANK: Record<JobFieldReviewStatus, number> = { REJECTED: 0, PROPOSED: 1, APPROVED: 2 };

export interface MergeJobFieldsResult {
  synonymsMoved: number;
  /** From-rows re-pointed at the target (no row for that programme there yet). */
  assignmentsMoved: number;
  /** Target rows that took the from-row's stronger status (and its source,
   *  confidence, methodVersion) instead of being moved. */
  assignmentsPromoted: number;
}

/** Moves synonyms and assignments from `fromId` into `intoId`, then deletes
 *  `fromId`. When a programme already has a row on the target, the target
 *  row survives and keeps the STRONGER status of the two — APPROVED >
 *  PROPOSED > REJECTED — taking the from-row's source, confidence and
 *  methodVersion when the from-row wins; the unique key is never
 *  duplicated. One transaction: pass `tx` to join a caller's transaction,
 *  otherwise one is opened here. */
export async function mergeJobFields(
  fromId: string,
  intoId: string,
  tx?: Prisma.TransactionClient,
): Promise<MergeJobFieldsResult> {
  if (fromId === intoId) throw new Error('cannot merge a field into itself');
  if (tx) return mergeJobFieldsWithin(tx, fromId, intoId);
  return prisma.$transaction((t) => mergeJobFieldsWithin(t, fromId, intoId));
}

async function mergeJobFieldsWithin(tx: Prisma.TransactionClient, fromId: string, intoId: string): Promise<MergeJobFieldsResult> {
  const from = await tx.jobFieldTaxonomy.findUniqueOrThrow({ where: { id: fromId }, select: { synonyms: true } });
  const into = await tx.jobFieldTaxonomy.findUniqueOrThrow({ where: { id: intoId }, select: { synonyms: true } });
  const merged = [...new Set([...into.synonyms, ...from.synonyms])];
  await tx.jobFieldTaxonomy.update({ where: { id: intoId }, data: { synonyms: merged } });
  const fromRows = await tx.programJobField.findMany({ where: { fieldId: fromId } });
  const targetRows = await tx.programJobField.findMany({
    where: { fieldId: intoId, programId: { in: fromRows.map((a) => a.programId) } },
  });
  const targetByProgram = new Map(targetRows.map((t) => [t.programId, t]));
  let moved = 0;
  let promoted = 0;
  for (const a of fromRows) {
    const target = targetByProgram.get(a.programId);
    if (!target) {
      await tx.programJobField.update({ where: { id: a.id }, data: { fieldId: intoId } });
      moved += 1;
      continue;
    }
    if (REVIEW_STATUS_RANK[a.reviewStatus] > REVIEW_STATUS_RANK[target.reviewStatus]) {
      await tx.programJobField.update({
        where: { id: target.id },
        data: { reviewStatus: a.reviewStatus, source: a.source, confidence: a.confidence, methodVersion: a.methodVersion },
      });
      promoted += 1;
    }
  }
  // ProgramJobField.field is onDelete: Cascade — deleting the from-field
  // removes the from-rows that were not moved (their programme already had
  // a row on the target, which now carries the stronger status).
  await tx.jobFieldTaxonomy.delete({ where: { id: fromId } });
  return { synonymsMoved: merged.length - into.synonyms.length, assignmentsMoved: moved, assignmentsPromoted: promoted };
}

export async function setProgramJobFieldStatus(id: string, reviewStatus: JobFieldReviewStatus): Promise<void> {
  await prisma.programJobField.update({ where: { id }, data: { reviewStatus } });
}

/** Manual add from the review page: APPROVED at once (an admin said so). */
export async function addProgramJobField(programId: string, fieldId: string, runId: string | null): Promise<string> {
  const row = await prisma.programJobField.upsert({
    where: { programId_fieldId: { programId, fieldId } },
    create: { programId, fieldId, source: 'manual', confidence: null, reviewStatus: 'APPROVED', methodVersion: 'manual', ingestionRunId: runId },
    update: { source: 'manual', reviewStatus: 'APPROVED', methodVersion: 'manual', confidence: null },
    select: { id: true },
  });
  return row.id;
}

/** The run every taxonomy write is attributed to: the most recent SUCCEEDED
 *  run of ANY demand source. Both seed the vocabulary, so anchoring to one of
 *  them would stamp rows built partly from the other's text with a run that
 *  never saw them. Null on a database that has never ingested either source. */
export async function latestDemandRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: { in: TAXONOMY_SOURCES } } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}

/** @deprecated Use latestDemandRunId. */
export const latestJobThaiRunId = latestDemandRunId;

export interface SynonymSources {
  synonym: string;
  sources: string[];
}

/**
 * Which demand sources contributed each synonym of a field.
 *
 * Derived rather than stored: the answer is already in the postings, and a
 * stored array would drift as new postings arrive. Reviewers use this to see
 * whether a field is private-only, public-only, or both before approving it —
 * since jobthai-bridge.v3, an APPROVED field's assignments decide which
 * programmes a posting asks for, and those links feed a Council-facing
 * health driver, so a field built entirely from government text is worth
 * knowing about at review time.
 */
export async function synonymSourcesForField(fieldId: string): Promise<SynonymSources[]> {
  const rows = await prisma.$queryRaw<Array<{ synonym: string; sources: string[] }>>(Prisma.sql`
    SELECT syn AS synonym, array_agg(DISTINCT jp.source ORDER BY jp.source) AS sources
    FROM job_field_taxonomy f
    CROSS JOIN LATERAL unnest(f.synonyms) AS syn
    JOIN job_postings jp
      ON syn = ANY(jp.required_fields_raw)
     AND jp.source = ANY(${TAXONOMY_SOURCES}::text[])
     AND ${realDataSql('jp')}
    WHERE f.id = ${fieldId}
    GROUP BY syn
    ORDER BY syn ASC
  `);
  return rows;
}

export interface FieldSynonymSources extends SynonymSources {
  fieldId: string;
}

/**
 * The bulk sibling of {@link synonymSourcesForField}: attribution for every
 * synonym of every field, in one query. /admin/job-fields needs this for the
 * whole taxonomy at once — the "every synonym is government-only" warning
 * has to be correct for a field the reviewer has not clicked into yet (the
 * approve button sits on every row, not only the selected one), so per-field
 * lazy loading would let an unselected row's warning silently not fire.
 * Same derivation, same realDataSql gate as the single-field version.
 */
export async function synonymSourcesForAllFields(): Promise<FieldSynonymSources[]> {
  const rows = await prisma.$queryRaw<FieldSynonymSources[]>(Prisma.sql`
    SELECT f.id AS "fieldId", syn AS synonym, array_agg(DISTINCT jp.source ORDER BY jp.source) AS sources
    FROM job_field_taxonomy f
    CROSS JOIN LATERAL unnest(f.synonyms) AS syn
    JOIN job_postings jp
      ON syn = ANY(jp.required_fields_raw)
     AND jp.source = ANY(${TAXONOMY_SOURCES}::text[])
     AND ${realDataSql('jp')}
    GROUP BY f.id, syn
    ORDER BY f.id ASC, syn ASC
  `);
  return rows;
}

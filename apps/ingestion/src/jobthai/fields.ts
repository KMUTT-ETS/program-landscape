import {
  prisma,
  applyTaxonomyOutput,
  collectRawFieldStrings,
  listExistingFields,
  planRuleAssignments,
  planTaxonomyBatches,
  refreshMentionCounts,
  writeAssignments,
  writeTaxonomy,
  type AssignmentWrite,
  type ExistingField,
  type RawFieldString,
  type TaxonomyDropReason,
  type TaxonomyWrite,
} from '@kku/db';
import {
  JOB_FIELD_TAXONOMY_BATCH_MAX,
  JOB_FIELD_TAXONOMY_MAX_OUTPUT_TOKENS,
  JOB_FIELD_TAXONOMY_VERSION,
  JobFieldTaxonomyOutputSchema,
  PROGRAM_JOB_FIELD_BATCH_MAX,
  PROGRAM_JOB_FIELD_MAX_FIELDS,
  PROGRAM_JOB_FIELD_MAX_OUTPUT_TOKENS,
  PROGRAM_JOB_FIELD_VERSION,
  ProgramJobFieldOutputSchema,
  buildJobFieldTaxonomyMessages,
  buildProgramJobFieldMessages,
  extractStructuredWithParseRetry,
  type AiService,
  type JobFieldTaxonomyInput,
  type JobFieldTaxonomyOutput,
  type ProgramJobFieldInput,
  type ProgramJobFieldOutput,
} from '@kku/shared';

import type { RefreshLog } from './refresh';

// ─────────────────────────────────────────────────────────────────────────────
// Field-of-study taxonomy build step (spec §3.2).
//
//   collect raw strings → plan batches (floor, absorbed) → cluster with the
//   model (anchors accumulate) → rule-assign programmes → AI-assign the rest
//   → write, all stamped with the JobThai run.
//
// Dry run by default: everything up to and including the model calls runs, so
// an operator sees what WOULD be written (and pays for the calls — that is the
// price of a truthful dry run). Only --apply writes.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldsArgs {
  apply: boolean;
}

/** Only --apply is accepted. Anything else is a typo we refuse to guess at:
 *  `--dryrun` once meant "delete" on another script in this repo. */
export function parseFieldsArgs(argv: string[]): FieldsArgs {
  let apply = false;
  for (const a of argv) {
    if (a === '--apply') apply = true;
    else throw new Error(`unknown flag ${a} (only --apply is accepted)`);
  }
  return { apply };
}

export interface ProgrammeForAssignment {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  skills: string[];
}

/** Everything with a side effect or a price, injectable for tests. */
export interface FieldsDeps {
  collectRaw: () => Promise<RawFieldString[]>;
  listExisting: () => Promise<ExistingField[]>;
  clusterBatch: (input: JobFieldTaxonomyInput) => Promise<JobFieldTaxonomyOutput>;
  listProgrammes: () => Promise<ProgrammeForAssignment[]>;
  listApprovedAssignmentProgramIds: () => Promise<string[]>;
  assignBatch: (input: ProgramJobFieldInput) => Promise<ProgramJobFieldOutput>;
  writeTaxonomy: (write: TaxonomyWrite, runId: string) => Promise<{ created: number; extended: number }>;
  writeAssignments: (rows: AssignmentWrite[], runId: string) => Promise<{ created: number; refreshed: number; kept: number }>;
  refreshMentionCounts: () => Promise<void>;
}

export interface FieldsSummary {
  taxonomy: {
    batches: number;
    creates: number;
    synonymAdds: number;
    /** Every dropped assignment, whatever the reason (abstained and rejectedField are subsets). */
    dropped: number;
    /** Strings the model declined to attach: not a field of study at all. */
    abstained: number;
    /** Strings the model aimed at a REJECTED field; never absorbed, re-sent next run. */
    rejectedField: number;
    /** Batch strings the model mentioned in neither list; re-sent next run. */
    missing: number;
    absorbed: number;
    other: { kinds: number; mentions: number };
  };
  assignments: { rule: number; ai: number; droppedUnknownSlug: number; promiscuousSynonyms: number; aiBatches: number };
  applied: boolean;
}

export function defaultFieldsDeps(ai: AiService): FieldsDeps {
  return {
    collectRaw: collectRawFieldStrings,
    listExisting: listExistingFields,
    clusterBatch: async (input) => {
      const r = await extractStructuredWithParseRetry(
        ai,
        {
          ctx: { module: 'gap-analysis', kind: 'job-field-taxonomy' },
          methodVersion: JOB_FIELD_TAXONOMY_VERSION,
          messages: buildJobFieldTaxonomyMessages(input),
          maxOutputTokens: JOB_FIELD_TAXONOMY_MAX_OUTPUT_TOKENS,
        },
        JobFieldTaxonomyOutputSchema,
        'job-field-taxonomy',
      );
      return r.parsed;
    },
    listProgrammes: async () => {
      const rows = await prisma.program.findMany({
        where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
        select: {
          id: true,
          code: true,
          nameTh: true,
          nameEn: true,
          level: true,
          programSkills: { select: { skill: { select: { nameEn: true } } } },
        },
        orderBy: { code: 'asc' },
      });
      return rows.map((p) => ({
        id: p.id,
        code: p.code,
        nameTh: p.nameTh,
        nameEn: p.nameEn,
        level: p.level,
        skills: p.programSkills.map((s) => s.skill.nameEn),
      }));
    },
    listApprovedAssignmentProgramIds: async () => {
      const rows = await prisma.programJobField.findMany({
        where: { reviewStatus: 'APPROVED' },
        select: { programId: true },
        distinct: ['programId'],
      });
      return rows.map((r) => r.programId);
    },
    assignBatch: async (input) => {
      const r = await extractStructuredWithParseRetry(
        ai,
        {
          ctx: { module: 'gap-analysis', kind: 'program-job-field' },
          methodVersion: PROGRAM_JOB_FIELD_VERSION,
          messages: buildProgramJobFieldMessages(input),
          maxOutputTokens: PROGRAM_JOB_FIELD_MAX_OUTPUT_TOKENS,
        },
        ProgramJobFieldOutputSchema,
        'program-job-field',
      );
      return r.parsed;
    },
    writeTaxonomy: (write, runId) => writeTaxonomy(write, runId),
    writeAssignments: (rows, runId) => writeAssignments(rows, runId),
    refreshMentionCounts: () => refreshMentionCounts(),
  };
}

function countDropped(writes: TaxonomyWrite[], reason: TaxonomyDropReason): number {
  return writes.reduce((n, w) => n + w.dropped.filter((d) => d.reason === reason).length, 0);
}

export async function refreshJobFields(
  opts: { apply: boolean; runId: string; log?: RefreshLog },
  deps: FieldsDeps,
): Promise<FieldsSummary> {
  const log = opts.log ?? (() => undefined);

  // 1. Taxonomy.
  const raw = await deps.collectRaw();
  let existing = await deps.listExisting();
  const plan = planTaxonomyBatches(raw, existing, JOB_FIELD_TAXONOMY_BATCH_MAX);
  log(
    `fields: ${raw.length} raw strings, ${plan.absorbed} absorbed, ${plan.other.kinds} below the mention floor, ${plan.batches.length} batch(es) to cluster`,
  );

  const writes: TaxonomyWrite[] = [];
  for (const batch of plan.batches) {
    const anchors = existing
      .filter((f) => f.reviewStatus !== 'REJECTED')
      .map((f) => ({ slug: f.slug, nameTh: f.nameTh, nameEn: f.nameEn, synonyms: f.synonyms }));
    const output = await deps.clusterBatch({ rawStrings: batch, anchors });
    const write = applyTaxonomyOutput(output, existing, batch.map((r) => r.raw));
    writes.push(write);
    log(
      `fields: batch of ${batch.length} → ${write.creates.length} new field(s), ${write.synonymAdds.length} anchor(s) extended, ` +
        `${write.dropped.length} dropped (${write.dropped.filter((d) => d.reason === 'abstained').length} abstained, ` +
        `${write.dropped.filter((d) => d.reason === 'rejected-field').length} rejected-field), ${write.missing.length} missing`,
    );
    // New fields become anchors for the next batch even in a dry run.
    existing = [
      ...existing.map((f) => {
        const add = write.synonymAdds.find((s) => s.slug === f.slug);
        return add ? { ...f, synonyms: [...f.synonyms, ...add.synonyms] } : f;
      }),
      ...write.creates.map((c) => ({ id: `pending-${c.slug}`, reviewStatus: 'PROPOSED' as const, ...c })),
    ];
    if (opts.apply) await deps.writeTaxonomy(write, opts.runId);
  }
  if (opts.apply) {
    await deps.refreshMentionCounts();
    existing = await deps.listExisting(); // real ids for the assignment step
  }

  // 2. Programme assignment.
  const programmes = await deps.listProgrammes();
  const approved = new Set(await deps.listApprovedAssignmentProgramIds());
  const vocabulary = existing.filter((f) => f.reviewStatus !== 'REJECTED');
  const candidates = programmes.filter((p) => !approved.has(p.id));
  const rule = planRuleAssignments(
    candidates,
    vocabulary.map((f) => ({ id: f.id, slug: f.slug, synonyms: f.synonyms })),
  );
  const rows: AssignmentWrite[] = rule.assignments.map((a) => ({
    programId: a.programId,
    fieldId: a.fieldId,
    source: 'rule',
    confidence: null,
    methodVersion: PROGRAM_JOB_FIELD_VERSION,
  }));

  const unassigned = new Set(rule.unassignedProgramIds);
  const forAi = candidates.filter((p) => unassigned.has(p.id));
  const slugToId = new Map(vocabulary.map((f) => [f.slug, f.id]));
  const fieldVocabulary = vocabulary.map((f) => ({ slug: f.slug, nameTh: f.nameTh, nameEn: f.nameEn }));
  let ai = 0;
  let droppedUnknownSlug = 0;
  let aiBatches = 0;
  for (let i = 0; i < forAi.length; i += PROGRAM_JOB_FIELD_BATCH_MAX) {
    const batch = forAi.slice(i, i + PROGRAM_JOB_FIELD_BATCH_MAX);
    aiBatches += 1;
    const output = await deps.assignBatch({ programs: batch, fields: fieldVocabulary });
    const batchIds = new Set(batch.map((p) => p.id));
    for (const p of output.programs) {
      if (!batchIds.has(p.programId)) continue;
      for (const f of p.fields.slice(0, PROGRAM_JOB_FIELD_MAX_FIELDS)) {
        const fieldId = slugToId.get(f.slug);
        if (!fieldId) {
          droppedUnknownSlug += 1;
          continue;
        }
        rows.push({ programId: p.programId, fieldId, source: 'ai', confidence: f.confidence, methodVersion: PROGRAM_JOB_FIELD_VERSION });
        ai += 1;
      }
    }
  }
  log(
    `fields: ${rule.assignments.length} rule assignment(s), ${ai} AI assignment(s) over ${aiBatches} batch(es), ` +
      `${droppedUnknownSlug} dropped (unknown slug), ${rule.promiscuousSynonyms.length} promiscuous synonym(s) skipped`,
  );

  if (opts.apply) await deps.writeAssignments(rows, opts.runId);

  return {
    taxonomy: {
      batches: plan.batches.length,
      creates: writes.reduce((n, w) => n + w.creates.length, 0),
      synonymAdds: writes.reduce((n, w) => n + w.synonymAdds.length, 0),
      dropped: writes.reduce((n, w) => n + w.dropped.length, 0),
      abstained: countDropped(writes, 'abstained'),
      rejectedField: countDropped(writes, 'rejected-field'),
      missing: writes.reduce((n, w) => n + w.missing.length, 0),
      absorbed: plan.absorbed,
      other: plan.other,
    },
    assignments: {
      rule: rule.assignments.length,
      ai,
      droppedUnknownSlug,
      promiscuousSynonyms: rule.promiscuousSynonyms.length,
      aiBatches,
    },
    applied: opts.apply,
  };
}

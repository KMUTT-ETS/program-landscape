// Skill-name normaliser core, shared by `pnpm skills:normalise` and the
// programme pipeline. See scripts/normalise-skill-names.ts for the CLI.

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { prisma, recordAliasDecision, relinkUsingAliases, type SkillAliasSourceContext, findSkillByNormalisedName } from '@kku/db';
import {
  buildSkillNormaliserMessages,
  SkillNormaliserBatchSchema,
  SKILL_NAME_NORMALISER_VERSION,
  type AiService,
} from '@kku/shared';

export interface CliArgs {
  source: 'linkedin' | 'program_digest' | 'all';
  limit: number | null;
  batchSize: number;
  dryRun: boolean;
  autoPromote: boolean;
}


// ─── Source-specific raw-name fetchers ───────────────────────────────────────

async function fetchUnmatchedLinkedinNames(limit: number | null): Promise<string[]> {
  // KmitlCareerSkillDemand + KmitlSkillGrowth rows with skill_id IS NULL,
  // EXCLUDING names already in SkillAlias with a non-PENDING status.
  const demandNames = await prisma.kmitlCareerSkillDemand.findMany({
    where: { skillId: null },
    select: { skillNameRaw: true },
    distinct: ['skillNameRaw'],
  });
  const growthNames = await prisma.kmitlSkillGrowth.findMany({
    where: { skillId: null },
    select: { skillNameRaw: true },
    distinct: ['skillNameRaw'],
  });
  const allNames = new Set<string>();
  for (const r of demandNames) if (r.skillNameRaw.trim()) allNames.add(r.skillNameRaw.trim());
  for (const r of growthNames) if (r.skillNameRaw.trim()) allNames.add(r.skillNameRaw.trim());

  // Skip names already processed (any non-PENDING status — even AMBIGUOUS
  // and NEW_PROPOSED count, those need human review before re-LLM).
  const existing = await prisma.skillAlias.findMany({
    where: { sourceContext: 'linkedin', status: { not: 'PENDING' } },
    select: { rawNameLower: true },
  });
  const existingLower = new Set(existing.map((e) => e.rawNameLower));
  const queue = [...allNames].filter((n) => !existingLower.has(n.toLowerCase()));

  return limit ? queue.slice(0, limit) : queue;
}

async function fetchPendingProposedSkillNames(limit: number | null): Promise<string[]> {
  // PROPOSED_SKILL AiExtraction rows in PENDING_REVIEW. Each carries
  // {nameTh, nameEn, category, weight, evidenceQuote} in payloadJson.
  // We unique on the most-meaningful surface form (prefer nameEn when
  // present, else nameTh).
  // AUTO_APPROVED too: with the default AI_AUTO_APPROVE_THRESHOLD=0 every
  // proposal is auto-approved at write time, and approving one creates no
  // Skill row — so a PENDING_REVIEW-only filter found nothing on a default
  // install and the taxonomy could never grow from curriculum vocabulary.
  // Names already decided are skipped by their SkillAlias row below, so
  // widening the filter never re-processes a name.
  const rows = await prisma.aiExtraction.findMany({
    where: {
      extractionKind: 'PROPOSED_SKILL',
      reviewStatus: { in: ['PENDING_REVIEW', 'AUTO_APPROVED'] },
    },
    select: { payloadJson: true },
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const p = r.payloadJson as { nameEn?: string; nameTh?: string };
    const candidate = (p.nameEn?.trim() || p.nameTh?.trim() || '').trim();
    if (candidate) seen.add(candidate);
  }
  const existing = await prisma.skillAlias.findMany({
    where: { sourceContext: 'program_digest', status: { not: 'PENDING' } },
    select: { rawNameLower: true },
  });
  const existingLower = new Set(existing.map((e) => e.rawNameLower));
  const queue = [...seen].filter((n) => !existingLower.has(n.toLowerCase()));
  return limit ? queue.slice(0, limit) : queue;
}

// ─── Batch-process via AI ────────────────────────────────────────────────────

interface BatchOutcome {
  matched: number;
  newProposed: number;
  ambiguous: number;
  failed: number;
  rejected: number;
  /** Auto-promotions that reused an existing Skill instead of creating a
   *  duplicate. A non-zero count means the model's candidate list is missing
   *  skills it should have seen — worth watching, not just tolerating. */
  reusedExisting: number;
}

async function processBatch(
  ai: AiService,
  taxonomy: Awaited<ReturnType<typeof loadTaxonomy>>,
  rawNames: string[],
  sourceContext: SkillAliasSourceContext,
  args: CliArgs,
  logFile: string,
): Promise<BatchOutcome> {
  const out: BatchOutcome = { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0, reusedExisting: 0 };
  const messages = buildSkillNormaliserMessages({ rawNames, sourceContext, taxonomy });

  let response;
  try {
    response = await ai.extractStructured(
      {
        ctx: {
          module: 'skill_normaliser',
          kind: 'skill_name_normaliser',
          userId: null,
          traceId: `skill-normaliser-${sourceContext}-${Date.now()}`,
        },
        messages,
        methodVersion: SKILL_NAME_NORMALISER_VERSION,
        // Uses the universal default (gemini-3.5-flash). Each decision
        // ≈ 100-200 tokens; for batch_size=25 worst-case ~5000 output
        // tokens — maxOutputTokens set generously below.
        maxOutputTokens: 50000,
      },
      SkillNormaliserBatchSchema,
    );
  } catch (err) {
    out.failed = rawNames.length;
    appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: 'batch_failed', count: rawNames.length, error: err instanceof Error ? err.message : String(err) }) + '\n');
    return out;
  }

  const batch = response.parsed;
  const aiInferenceId = response.aiInferenceId;
  // Build a map name → decision so we can detect missing names from the AI output.
  const byName = new Map(batch.decisions.map((d) => [d.rawName.toLowerCase(), d]));

  for (const rawName of rawNames) {
    const d = byName.get(rawName.toLowerCase());
    if (!d) {
      out.failed++;
      appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: 'name_missing_in_response', rawName }) + '\n');
      continue;
    }

    if (args.dryRun) {
      console.log(`  [dry-run] ${rawName} → ${d.decision} (conf ${d.confidence.toFixed(2)})`);
      if (d.decision === 'MATCH') out.matched++;
      else if (d.decision === 'NEW_PROPOSED') out.newProposed++;
      else out.ambiguous++;
      continue;
    }

    try {
      if (d.decision === 'MATCH') {
        const skill = taxonomy.find((s) => s.id === d.skillId);
        if (!skill) {
          out.failed++;
          appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: 'unknown_skill_id', rawName, skillId: d.skillId }) + '\n');
          continue;
        }
        await recordAliasDecision({
          rawName,
          sourceContext,
          decision: 'MATCH',
          resolvedSkillId: d.skillId,
          confidence: d.confidence,
          reasoning: d.reasoning,
          aiInferenceId,
        });
        out.matched++;
      } else if (d.decision === 'NEW_PROPOSED') {
        // Auto-promote when both --auto-promote AND confidence ≥0.9
        if (args.autoPromote && d.confidence >= 0.9) {
          // A NEW_PROPOSED decision means the MODEL saw no match. Its
          // candidate list is not the whole taxonomy (candidates are picked as
          // "newest 30", not by similarity — see CLAUDE.md prompt 04), so it
          // says NEW_PROPOSED for skills that plainly exist. Check the
          // taxonomy for real before creating anything.
          //
          // This is the bug that produced 456 redundant rows, 10.3% of the
          // taxonomy: the old code slugified the canonical name into a code and
          // on collision appended `-2`, `-3` … calling it "race-safe". A slug
          // collision on a canonical name is not a race; it is the signal that
          // the skill already exists. "Data Science" ended up existing five
          // times, splitting 411 references across rows that no join could
          // reconcile.
          const existing = await findSkillByNormalisedName(d.canonicalNameEn, d.canonicalNameTh);
          const skill = existing ?? (await prisma.skill.create({
            data: {
              code: await ensureUniqueSkillCode(`linkedin-${slugify(d.canonicalNameEn || d.canonicalNameTh || rawName)}`),
              nameEn: d.canonicalNameEn,
              nameTh: d.canonicalNameTh,
              category: d.suggestedCategory || null,
              taxonomySource: 'KKU',
            },
            select: { id: true },
          }));
          if (existing) out.reusedExisting += 1;
          await recordAliasDecision({
            rawName,
            sourceContext,
            decision: 'MATCH',
            resolvedSkillId: skill.id,
            confidence: d.confidence,
            reasoning: `Auto-promoted: ${d.reasoning}`,
          });
          out.matched++;
        } else {
          await recordAliasDecision({
            rawName,
            sourceContext,
            decision: 'NEW_PROPOSED',
            newNameEn: d.canonicalNameEn,
            newNameTh: d.canonicalNameTh,
            newCategory: d.suggestedCategory || null,
            confidence: d.confidence,
            reasoning: d.reasoning,
          });
          out.newProposed++;
        }
      } else {
        await recordAliasDecision({
          rawName,
          sourceContext,
          decision: 'AMBIGUOUS',
          confidence: d.confidence,
          reasoning: d.reasoning,
          aiInferenceId,
        });
        out.ambiguous++;
      }
    } catch (err) {
      const isRejected = err instanceof Error && err.message.includes('REJECTED');
      if (isRejected) out.rejected++;
      else out.failed++;
      appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: 'persist_failed', rawName, error: err instanceof Error ? err.message : String(err) }) + '\n');
    }
  }

  appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), event: 'batch_done', count: rawNames.length, ...out }) + '\n');
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function ensureUniqueSkillCode(base: string): Promise<string> {
  if (!base) base = `linkedin-skill-${Date.now()}`;
  let candidate = base;
  let attempt = 1;
  while (await prisma.skill.findUnique({ where: { code: candidate }, select: { id: true } })) {
    attempt++;
    candidate = `${base}-${attempt}`;
    if (attempt > 50) throw new Error(`Could not find unique code for ${base}`);
  }
  return candidate;
}

// ─── Taxonomy loader (one fetch per run) ─────────────────────────────────────

async function loadTaxonomy(): Promise<Array<{ id: string; nameEn: string; nameTh: string; category: string | null }>> {
  return prisma.skill.findMany({
    select: { id: true, nameEn: true, nameTh: true, category: true },
    orderBy: { nameEn: 'asc' },
  });
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

async function runForSource(
  ai: AiService,
  taxonomy: Awaited<ReturnType<typeof loadTaxonomy>>,
  source: 'linkedin' | 'program_digest',
  args: CliArgs,
  logFile: string,
): Promise<BatchOutcome & { totalCandidates: number; batches: number }> {
  const candidates =
    source === 'linkedin'
      ? await fetchUnmatchedLinkedinNames(args.limit)
      : await fetchPendingProposedSkillNames(args.limit);

  console.log(`\n[${source}] ${candidates.length} unmatched names to process`);
  if (candidates.length === 0) return { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0, reusedExisting: 0, totalCandidates: 0, batches: 0 };

  const totals: BatchOutcome = { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0, reusedExisting: 0 };
  let batches = 0;

  for (let i = 0; i < candidates.length; i += args.batchSize) {
    const batch = candidates.slice(i, i + args.batchSize);
    batches++;
    process.stdout.write(`  Batch ${batches} (${batch.length} names)… `);
    const t0 = Date.now();
    const out = await processBatch(ai, taxonomy, batch, source, args, logFile);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    totals.matched += out.matched;
    totals.reusedExisting += out.reusedExisting;
    totals.newProposed += out.newProposed;
    totals.ambiguous += out.ambiguous;
    totals.failed += out.failed;
    totals.rejected += out.rejected;
    console.log(
      `done in ${elapsed}s — match=${out.matched} new=${out.newProposed} ambig=${out.ambiguous} fail=${out.failed}`,
    );
  }

  return { ...totals, totalCandidates: candidates.length, batches };
}

export interface NormaliserTotals {
  matched: number;
  newProposed: number;
  ambiguous: number;
  failed: number;
  rejected: number;
  batches: number;
  totalCandidates: number;
}

/** Opens the audit log under ./logs and returns its path. */
export function openNormaliserLog(): string {
  const logDir = path.resolve(process.cwd(), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `normalise-skills-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
}

/**
 * Runs the normaliser for the requested source(s). Shared by the
 * `pnpm skills:normalise` CLI and the programme pipeline, which calls it with
 * source 'program_digest' and auto-promote on a fresh install.
 */
export async function runSkillNormaliser(ai: AiService, args: CliArgs, logFile: string): Promise<NormaliserTotals> {
  console.log('Loading taxonomy…');
  const taxonomy = await loadTaxonomy();
  console.log(`  ${taxonomy.length} skills in taxonomy`);

  const grand: NormaliserTotals = { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0, batches: 0, totalCandidates: 0 };
  const add = (out: Awaited<ReturnType<typeof runForSource>>): void => {
    grand.matched += out.matched;
    grand.newProposed += out.newProposed;
    grand.ambiguous += out.ambiguous;
    grand.failed += out.failed;
    grand.rejected += out.rejected;
    grand.batches += out.batches;
    grand.totalCandidates += out.totalCandidates;
  };

  if (args.source === 'linkedin' || args.source === 'all') {
    const out = await runForSource(ai, taxonomy, 'linkedin', args, logFile);
    add(out);
    if (!args.dryRun && out.matched > 0) {
      console.log('\nRe-linking unmatched LinkedIn rows with newly-resolved aliases…');
      const r = await relinkUsingAliases('linkedin');
      console.log(`  KmitlCareerSkillDemand: ${r.kmitlDemand} rows updated`);
      console.log(`  KmitlSkillGrowth:       ${r.kmitlGrowth} rows updated`);
    }
  }
  if (args.source === 'program_digest' || args.source === 'all') {
    add(await runForSource(ai, taxonomy, 'program_digest', args, logFile));
  }
  return grand;
}

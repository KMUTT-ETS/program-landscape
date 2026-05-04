#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Skill-name normaliser — one-shot AI backfill + incremental sync handler.
//
// Three operating modes (env-flag-controlled):
//   --source=linkedin            — process unmatched KmitlCareerSkillDemand /
//                                  KmitlSkillGrowth rows (LinkedIn data via
//                                  MHESI/KMITL feed)
//   --source=program_digest      — process pending PROPOSED_SKILL extractions
//                                  emitted by the program-digest pipeline
//   --source=all                 — both, in sequence (default)
//
//   --limit=<N>                  — cap names processed this run (default
//                                  unlimited; useful for cost control)
//   --batch-size=<N>             — names per LLM call (default 40, max 50)
//   --dry-run                    — log decisions without writing SkillAlias
//                                  rows or relinking
//   --auto-promote               — when AI emits NEW_PROPOSED with
//                                  confidence ≥0.9, automatically create
//                                  the new Skill and link it. Otherwise
//                                  the alias stays NEW_PROPOSED awaiting
//                                  analyst review.
//
// What it does:
//   1. Collect unique unmatched raw names per source (excluding names
//      already in SkillAlias with status≠PENDING)
//   2. Batch them through the AI normaliser prompt
//   3. Persist decisions to SkillAlias (RESOLVED / NEW_PROPOSED / AMBIGUOUS)
//   4. Re-link existing rows: KmitlCareerSkillDemand.skill_id +
//      KmitlSkillGrowth.skill_id get filled in for newly-RESOLVED aliases
//
// Idempotency: rows already in SkillAlias with a final status are
// skipped. Re-run is safe — second pass only processes net-new names.
//
// Cost: ~$0.03 per batch of 40 with Gemini. 2,841 unmatched LinkedIn
// names → ~71 batches → ~$2.10 total. PROPOSED_SKILL queue similar.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma, PrismaAiInferenceRecorder, recordAliasDecision, relinkUsingAliases, type SkillAliasSourceContext } from '@kku/db';
import {
  createAiService,
  buildSkillNormaliserMessages,
  SkillNormaliserBatchSchema,
  SKILL_NAME_NORMALISER_VERSION,
  type AiProviderId,
  type AiService,
} from '@kku/shared';

interface CliArgs {
  source: 'linkedin' | 'program_digest' | 'all';
  limit: number | null;
  batchSize: number;
  dryRun: boolean;
  autoPromote: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const a = { source: 'all', limit: null, batchSize: 25, dryRun: false, autoPromote: false } as CliArgs;
  for (const arg of argv) {
    if (arg === '--dry-run') a.dryRun = true;
    else if (arg === '--auto-promote') a.autoPromote = true;
    else if (arg.startsWith('--source=')) {
      const v = arg.slice('--source='.length);
      if (v !== 'linkedin' && v !== 'program_digest' && v !== 'all') {
        throw new Error(`Invalid --source: ${v}`);
      }
      a.source = v;
    } else if (arg.startsWith('--limit=')) a.limit = Number(arg.slice('--limit='.length));
    else if (arg.startsWith('--batch-size=')) {
      a.batchSize = Math.min(50, Math.max(1, Number(arg.slice('--batch-size='.length))));
    }
  }
  return a;
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
  const rows = await prisma.aiExtraction.findMany({
    where: { extractionKind: 'PROPOSED_SKILL', reviewStatus: 'PENDING_REVIEW' },
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
}

async function processBatch(
  ai: AiService,
  taxonomy: Awaited<ReturnType<typeof loadTaxonomy>>,
  rawNames: string[],
  sourceContext: SkillAliasSourceContext,
  args: CliArgs,
  logFile: string,
): Promise<BatchOutcome> {
  const out: BatchOutcome = { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0 };
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
        // Use the stable 2.5-flash model rather than the preview default.
        // gemini-3-flash-preview has been observed truncating output at
        // ~600 tokens regardless of maxOutputTokens — a known preview-
        // model cap. 2.5-flash respects the budget reliably.
        model: 'gemini-2.5-flash',
        // Each decision ≈ 100-200 tokens. For batch_size=25 worst-case
        // ~5000 output tokens. 16000 gives headroom for AMBIGUOUS verbose
        // reasoning. Matches the program-digest budget.
        maxOutputTokens: 16000,
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
          const code = `linkedin-${slugify(d.canonicalNameEn || d.canonicalNameTh || rawName)}`;
          // Race-safe: check Skill.code uniqueness; if collision, append suffix
          const finalCode = await ensureUniqueSkillCode(code);
          const skill = await prisma.skill.create({
            data: {
              code: finalCode,
              nameEn: d.canonicalNameEn,
              nameTh: d.canonicalNameTh,
              category: d.suggestedCategory || null,
              taxonomySource: 'KKU',
            },
            select: { id: true },
          });
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
  if (candidates.length === 0) return { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0, totalCandidates: 0, batches: 0 };

  const totals: BatchOutcome = { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0 };
  let batches = 0;

  for (let i = 0; i < candidates.length; i += args.batchSize) {
    const batch = candidates.slice(i, i + args.batchSize);
    batches++;
    process.stdout.write(`  Batch ${batches} (${batch.length} names)… `);
    const t0 = Date.now();
    const out = await processBatch(ai, taxonomy, batch, source, args, logFile);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    totals.matched += out.matched;
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log('Skill-name normaliser');
  console.log(`  source=${args.source} limit=${args.limit ?? '∞'} batchSize=${args.batchSize} dryRun=${args.dryRun} autoPromote=${args.autoPromote}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const recorder = new PrismaAiInferenceRecorder();
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = createAiService({
    recorder,
    providerId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  console.log('Loading taxonomy…');
  const taxonomy = await loadTaxonomy();
  console.log(`  ${taxonomy.length} skills in taxonomy`);

  const logDir = path.resolve(process.cwd(), 'logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `normalise-skills-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  console.log(`  audit log → ${logFile}`);

  const grand = { matched: 0, newProposed: 0, ambiguous: 0, failed: 0, rejected: 0, batches: 0, totalCandidates: 0 };

  if (args.source === 'linkedin' || args.source === 'all') {
    const out = await runForSource(ai, taxonomy, 'linkedin', args, logFile);
    grand.matched += out.matched;
    grand.newProposed += out.newProposed;
    grand.ambiguous += out.ambiguous;
    grand.failed += out.failed;
    grand.rejected += out.rejected;
    grand.batches += out.batches;
    grand.totalCandidates += out.totalCandidates;

    if (!args.dryRun && out.matched > 0) {
      console.log('\nRe-linking unmatched LinkedIn rows with newly-resolved aliases…');
      const r = await relinkUsingAliases('linkedin');
      console.log(`  KmitlCareerSkillDemand: ${r.kmitlDemand} rows updated`);
      console.log(`  KmitlSkillGrowth:       ${r.kmitlGrowth} rows updated`);
    }
  }

  if (args.source === 'program_digest' || args.source === 'all') {
    const out = await runForSource(ai, taxonomy, 'program_digest', args, logFile);
    grand.matched += out.matched;
    grand.newProposed += out.newProposed;
    grand.ambiguous += out.ambiguous;
    grand.failed += out.failed;
    grand.rejected += out.rejected;
    grand.batches += out.batches;
    grand.totalCandidates += out.totalCandidates;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Total candidates: ${grand.totalCandidates}`);
  console.log(`  Matched (RESOLVED):  ${grand.matched}`);
  console.log(`  New proposed:        ${grand.newProposed}`);
  console.log(`  Ambiguous:           ${grand.ambiguous}`);
  console.log(`  Failed:              ${grand.failed}`);
  if (grand.rejected > 0) console.log(`  Skipped (REJECTED):  ${grand.rejected}`);
  console.log(`  Batches:             ${grand.batches}`);
  console.log(`  Audit log:           ${logFile}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

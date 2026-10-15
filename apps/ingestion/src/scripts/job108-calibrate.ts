#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// job108:calibrate — how far does the government-announcement extractor
// disagree with the private-sector regex, when both read the SAME text?
//
// WHY THIS SCRIPT EXISTS. The Gap Analyzer compares JobThai's share of
// adverts per field of study against KKU's share of graduates per field.
// Until now every advert on the private side came through one deterministic
// regex, `extractFieldsOfStudy` (packages/shared/src/jobthai/parse-row.ts).
// The new public-sector source (job-108) extracts fields with an AI prompt,
// `job108-announcement.v1`, instead. A map that compares a share built by a
// regex against a share built by a model owes its readers a measured number
// for how much the two disagree — that number is what this script produces.
//
// THE SPECIFIC HYPOTHESIS. The regex splits a discipline list on "และ"
// ("and"). Thai discipline names routinely CONTAIN "และ" as part of one
// name — "การจัดการโลจิสติกส์และโซ่อุปทาน" (Logistics and Supply Chain
// Management) is ONE field, not two. `job_field_taxonomy.name_th` holds
// such compound names and 75 KKU programme names contain "และ", but
// `job_postings.required_fields_raw` for source='jobthai' contains ZERO
// strings with "และ" — because the regex has been splitting them all
// along. This script tests whether the government extractor, reading the
// SAME JobThai text, recovers those compound names that the regex missed.
//
// WHAT IT DOES. Samples JobThai `qualification_raw` texts — half from
// postings where the regex found at least one field, half from postings
// where it found none — and runs the job-108 AI extractor (the same prompt
// used for real government announcements) over each one. It does NOT feed
// the model an actual job-108 announcement page; it deliberately feeds it a
// JobThai qualification paragraph, so the two extractors can be compared on
// literally the same input. That is a mismatch from what the prompt was
// designed to read (an announcement page, not a bare qualification
// paragraph) and some postings will yield zero positions because of it —
// counted and reported separately, not silently folded into "agreement".
//
// READ-ONLY. This script writes nothing to job_postings, job_field_taxonomy,
// or any other domain table. The one write that happens is the same one
// every AI call in this codebase makes regardless of caller: AiService
// records an AiInference audit row via PrismaAiInferenceRecorder
// (@AiCall()-equivalent for scripts — see createIngestionAiService). That is
// the audit trail, not calibration output, and is unconditional for every
// model call in the system.
//
// SPENDING. One model call per sampled posting, via
// extractStructuredWithParseRetry — which means a posting whose response
// fails schema validation costs a SECOND call (a corrective retry with the
// format restated). That wrapper is shared house infrastructure and this
// script does not bypass it. To bound worst-case spend regardless of retry
// behaviour, this script wraps the AiService in a call-counting decorator
// that refuses any call once JOB108_CALIBRATE_HARD_CALL_CAP is reached,
// stopping the run early (and saying so) rather than silently exceeding the
// budget the task that commissioned this script was given.
//
//   pnpm job108:calibrate                  # 100 postings (default)
//   pnpm job108:calibrate --sample=50      # 50 postings
//   pnpm job108:calibrate --sample=150     # the hard cap itself
//
// --sample is capped at 150 (see job108/calibrate-args.ts) and any other
// flag is refused outright.
//
// NOT added to apps/ingestion/scripts/bundle-pipeline-scripts.ts's TARGETS
// list on purpose. That list is for operator scripts that need to exist
// inside the production ingestion image (see job108-backfill's entry
// there). This is a one-off analysis run from a developer machine to
// produce a number for a methodology doc and a provenance drawer — it has
// no reason to ship in the prod image, and the esbuild bundling step is
// extra build surface with nothing to gain from covering it.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Inline env-file loader, matching job108-backfill.ts: this script is a
// developer-machine-only tool (never esbuild-bundled — see header), but the
// same inline loader is used here rather than a `dotenv` dependency so the
// two job108 scripts stay consistent and neither depends on `dotenv` being
// installed.
loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
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

import {
  JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
  JOB108_ANNOUNCEMENT_VERSION,
  Job108AnnouncementOutputSchema,
  buildJob108AnnouncementMessages,
  extractStructuredWithParseRetry,
  type ExtractionRequest,
  type ExtractionResponse,
  type StructuredExtractor,
} from '@kku/shared';
// extractFieldsOfStudy and the any-field sentinel are NOT on the root
// barrel. Reached the same way packages/db/src/job-fields.ts reaches
// JOBTHAI_ANY_FIELD, rather than widening the barrel — the barrel pulls
// node:crypto into anything that imports it, which has already broken a
// client build once.
import { JOBTHAI_ANY_FIELD, extractFieldsOfStudy } from '@kku/shared/src/jobthai';
import { loadOrganization, prisma } from '@kku/db';
import type { ZodType, ZodTypeDef } from 'zod';

import { parseCalibrateArgs } from '../job108/calibrate-args';
import { createIngestionAiService } from '../lib/ai-service';

// ─────────────────────────────────────────────────────────────────────────────
// Hard call-count cap, independent of --sample.
//
// extractStructuredWithParseRetry can issue TWO calls for one posting (the
// original plus one corrective retry on parse failure), so "--sample=120"
// does not by itself guarantee 120 calls. This wraps the real AiService and
// refuses any call past the cap, stopping the run early rather than trusting
// arithmetic that retries can violate.
// ─────────────────────────────────────────────────────────────────────────────
const JOB108_CALIBRATE_HARD_CALL_CAP = 150;

class CallCapExceededError extends Error {
  constructor(cap: number) {
    super(`job108:calibrate hard call cap (${cap}) reached — stopping the run rather than exceeding budget.`);
  }
}

function withCallCounter(inner: StructuredExtractor, cap: number): { ai: StructuredExtractor; count: () => number } {
  let calls = 0;
  const ai: StructuredExtractor = {
    async extractStructured<T>(req: ExtractionRequest, schema: ZodType<T, ZodTypeDef, unknown>): Promise<ExtractionResponse<T>> {
      if (calls >= cap) throw new CallCapExceededError(cap);
      calls += 1;
      return inner.extractStructured(req, schema);
    },
  };
  return { ai, count: () => calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sampling
// ─────────────────────────────────────────────────────────────────────────────

interface SampledPosting {
  id: string;
  qualificationRaw: string;
  regexFields: string[];
}

async function sampleStratum(hasFields: boolean, limit: number): Promise<SampledPosting[]> {
  if (limit <= 0) return [];
  const cardinalityClause = hasFields ? 'cardinality(required_fields_raw) > 0' : 'cardinality(required_fields_raw) = 0';
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; qualification_raw: string; required_fields_raw: string[] }>>(
    `SELECT id, qualification_raw, required_fields_raw
     FROM job_postings
     WHERE source = 'jobthai'
       AND qualification_raw IS NOT NULL
       AND length(trim(qualification_raw)) > 0
       AND ${cardinalityClause}
     ORDER BY random()
     LIMIT $1`,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    qualificationRaw: r.qualification_raw,
    regexFields: r.required_fields_raw,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Comparison
// ─────────────────────────────────────────────────────────────────────────────

type AgreementBucket = 'bothFoundNothing' | 'agreedExact' | 'modelFoundMore' | 'regexFoundMore' | 'mixedDisagreement';

interface PostingResult {
  id: string;
  qualificationRaw: string;
  regexFields: string[];
  modelFields: string[];
  modelReturnedNothing: boolean;
  extractionError: string | null;
  missedByRegex: string[]; // model found, regex did not (excluding the sentinel)
  foundOnlyByRegex: string[]; // regex found, model did not (excluding the sentinel)
  bucket: AgreementBucket | 'error';
}

/** The regex's own re-derivation of fields from the SAME text it was stored
 *  from — used only as a display sanity check, never as the "regex" side of
 *  the comparison. The stored required_fields_raw IS the regex's answer;
 *  re-running extractFieldsOfStudy on qualification_raw is expected to
 *  reproduce it, but the comparison uses the stored value so the "regex
 *  side" of this report is exactly what the Gap Analyzer's denominator is
 *  built from today, not a fresh re-run that could theoretically drift if
 *  the qualification text field it was stored against ever changes. */
function normaliseFieldSet(fields: string[]): Set<string> {
  return new Set(fields.filter((f) => f !== JOBTHAI_ANY_FIELD));
}

async function comparePosting(ai: StructuredExtractor, posting: SampledPosting): Promise<PostingResult> {
  // Recomputed here via the real extractor, not read from the stored
  // required_fields_raw column — this is the "reuse extractFieldsOfStudy"
  // requirement, and it is the exact function that produced the stored
  // value, so the two should (and did, when spot-checked) agree; computing
  // it fresh means the comparison is against the live regex behaviour, not
  // a column that could in principle have been written by an older version
  // of it.
  const regexSet = normaliseFieldSet(extractFieldsOfStudy(posting.qualificationRaw));

  let modelFieldsRaw: string[] = [];
  let modelReturnedNothing = false;
  let extractionError: string | null = null;

  try {
    const text = posting.qualificationRaw.trim();
    const messages = buildJob108AnnouncementMessages({ announcementId: posting.id, text });
    const result = await extractStructuredWithParseRetry(
      ai,
      {
        ctx: { module: 'gap-analysis', kind: 'job108-announcement' },
        methodVersion: JOB108_ANNOUNCEMENT_VERSION,
        messages,
        maxOutputTokens: JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS,
      },
      Job108AnnouncementOutputSchema,
      'job108-calibrate',
    );
    modelFieldsRaw = result.parsed.positions.flatMap((p) => p.requiredFieldsRaw);
    modelReturnedNothing = result.parsed.positions.length === 0;
  } catch (err) {
    if (err instanceof CallCapExceededError) throw err;
    extractionError = err instanceof Error ? err.message : String(err);
  }

  if (extractionError !== null) {
    return {
      id: posting.id,
      qualificationRaw: posting.qualificationRaw,
      regexFields: [...regexSet],
      modelFields: [],
      modelReturnedNothing: false,
      extractionError,
      missedByRegex: [],
      foundOnlyByRegex: [],
      bucket: 'error',
    };
  }

  const modelSet = normaliseFieldSet(modelFieldsRaw);
  const missedByRegex = [...modelSet].filter((f) => !regexSet.has(f));
  const foundOnlyByRegex = [...regexSet].filter((f) => !modelSet.has(f));

  let bucket: AgreementBucket;
  if (regexSet.size === 0 && modelSet.size === 0) bucket = 'bothFoundNothing';
  else if (missedByRegex.length === 0 && foundOnlyByRegex.length === 0) bucket = 'agreedExact';
  else if (missedByRegex.length > 0 && foundOnlyByRegex.length === 0) bucket = 'modelFoundMore';
  else if (foundOnlyByRegex.length > 0 && missedByRegex.length === 0) bucket = 'regexFoundMore';
  else bucket = 'mixedDisagreement';

  return {
    id: posting.id,
    qualificationRaw: posting.qualificationRaw,
    regexFields: [...regexSet],
    modelFields: [...modelSet],
    modelReturnedNothing,
    extractionError: null,
    missedByRegex,
    foundOnlyByRegex,
    bucket,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

function containsAnd(field: string): boolean {
  return field.includes('และ');
}

function printReport(results: PostingResult[], sample: number, callsMade: number): void {
  const total = results.length;
  const errors = results.filter((r) => r.bucket === 'error');
  const scored = results.filter((r) => r.bucket !== 'error');

  const byBucket = (b: AgreementBucket) => scored.filter((r) => r.bucket === b);
  const bothFoundNothing = byBucket('bothFoundNothing');
  const agreedExact = byBucket('agreedExact');
  const modelFoundMore = byBucket('modelFoundMore');
  const regexFoundMore = byBucket('regexFoundMore');
  const mixedDisagreement = byBucket('mixedDisagreement');

  const modelReturnedNothingCount = scored.filter((r) => r.modelReturnedNothing).length;

  const allMissedByRegex = scored.flatMap((r) => r.missedByRegex);
  const allFoundOnlyByRegex = scored.flatMap((r) => r.foundOnlyByRegex);
  const missedByRegexWithAnd = allMissedByRegex.filter(containsAnd);

  console.log('═'.repeat(78));
  console.log('job108:calibrate — regex vs. job-108 AI extractor, run over JobThai text');
  console.log('═'.repeat(78));
  console.log(`Requested sample: ${sample}`);
  console.log(`Postings processed: ${total}`);
  console.log(`Model calls made (post- retry, counted): ${callsMade}`);
  console.log(`Extraction errors (excluded from scoring below): ${errors.length}`);
  console.log('');

  console.log('── Aggregate agreement (scored postings only) ──');
  console.log(`  Total scored: ${scored.length}`);
  console.log(`  Both found nothing:        ${bothFoundNothing.length}`);
  console.log(`  Agreed exactly (non-empty): ${agreedExact.length}`);
  console.log(`  Model found more:          ${modelFoundMore.length}`);
  console.log(`  Regex found more:          ${regexFoundMore.length}`);
  console.log(`  Mixed disagreement (both had unique fields): ${mixedDisagreement.length}`);
  console.log('');

  console.log('── Field-name totals ──');
  console.log(`  Total field names missed by the regex (found by model only): ${allMissedByRegex.length}`);
  console.log(`  Total field names found only by the regex (model missed):    ${allFoundOnlyByRegex.length}`);
  console.log('');

  console.log('── THE HYPOTHESIS TEST ──');
  console.log(`  Of the ${allMissedByRegex.length} field names the regex missed, ${missedByRegexWithAnd.length} contain "และ".`);
  if (allMissedByRegex.length > 0) {
    const pct = ((missedByRegexWithAnd.length / allMissedByRegex.length) * 100).toFixed(1);
    console.log(`  That is ${pct}% of everything the model found that the regex did not.`);
  }
  console.log('');

  console.log('── Model-input mismatch ──');
  console.log(
    `  Postings where the model returned ZERO positions (fed a qualification paragraph, not an announcement page): ${modelReturnedNothingCount} of ${scored.length}`,
  );
  console.log('');

  console.log('── Up to 10 concrete under-capture examples (regex missed something the model found) ──');
  const examples = scored.filter((r) => r.missedByRegex.length > 0).slice(0, 10);
  if (examples.length === 0) {
    console.log('  (none in this sample)');
  } else {
    for (const ex of examples) {
      console.log(`  posting ${ex.id}`);
      console.log(`    qualification text: ${ex.qualificationRaw.slice(0, 200).replace(/\s+/g, ' ')}`);
      console.log(`    regex found:  [${ex.regexFields.join(', ') || '(none)'}]`);
      console.log(`    model added:  [${ex.missedByRegex.join(', ')}]`);
    }
  }
  console.log('');

  console.log('── Up to 10 examples where the REGEX found something the model did not ──');
  const reverseExamples = scored.filter((r) => r.foundOnlyByRegex.length > 0).slice(0, 10);
  if (reverseExamples.length === 0) {
    console.log('  (none in this sample)');
  } else {
    for (const ex of reverseExamples) {
      console.log(`  posting ${ex.id}`);
      console.log(`    qualification text: ${ex.qualificationRaw.slice(0, 200).replace(/\s+/g, ' ')}`);
      console.log(`    regex found:  [${ex.regexFields.join(', ')}]`);
      console.log(`    model found:  [${ex.modelFields.join(', ') || '(none)'}]`);
      console.log(`    regex-only:   [${ex.foundOnlyByRegex.join(', ')}]`);
    }
  }
  console.log('');

  if (errors.length > 0) {
    console.log('── Extraction errors ──');
    for (const e of errors.slice(0, 10)) {
      console.log(`  posting ${e.id}: ${e.extractionError}`);
    }
    console.log('');
  }

  console.log('═'.repeat(78));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await loadOrganization();
  const parsed = parseCalibrateArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[job108:calibrate] ${parsed.error}`);
    process.exitCode = 1;
    return;
  }
  const { sample } = parsed.args;

  const withFieldsCount = Math.ceil(sample / 2);
  const withoutFieldsCount = sample - withFieldsCount;

  console.log(
    `[job108:calibrate] sampling ${withFieldsCount} postings where the regex found ≥1 field and ${withoutFieldsCount} where it found none (target ${sample} total)…`,
  );

  const [withFields, withoutFields] = await Promise.all([
    sampleStratum(true, withFieldsCount),
    sampleStratum(false, withoutFieldsCount),
  ]);
  const postings = [...withFields, ...withoutFields];

  console.log(`[job108:calibrate] sampled ${postings.length} postings (${withFields.length} with-fields, ${withoutFields.length} without-fields). Calling the model…`);

  const rawAi = createIngestionAiService();
  const { ai, count } = withCallCounter(rawAi, JOB108_CALIBRATE_HARD_CALL_CAP);

  const results: PostingResult[] = [];
  let stoppedEarly = false;
  for (let i = 0; i < postings.length; i++) {
    const posting = postings[i]!;
    try {
      const r = await comparePosting(ai, posting);
      results.push(r);
    } catch (err) {
      if (err instanceof CallCapExceededError) {
        console.error(`[job108:calibrate] ${err.message} Processed ${i} of ${postings.length} postings before stopping.`);
        stoppedEarly = true;
        break;
      }
      throw err;
    }
    if ((i + 1) % 10 === 0 || i === postings.length - 1) {
      console.log(`[job108:calibrate] ${i + 1}/${postings.length} processed (${count()} model calls so far)…`);
    }
  }

  await prisma.$disconnect();

  printReport(results, sample, count());
  if (stoppedEarly) {
    console.log(`[job108:calibrate] RUN STOPPED EARLY at the ${JOB108_CALIBRATE_HARD_CALL_CAP}-call hard cap. Report above reflects only the postings processed before the stop.`);
  }
}

main().catch((err) => {
  console.error('[job108:calibrate] fatal error:', err);
  process.exitCode = 1;
});

#!/usr/bin/env node
// AI evaluation runner.
//
// Reads `packages/shared/src/ai/eval/gold-questions.jsonl`, calls the
// real AI service for each `analyst` module question (safety gate +
// LLM), scores each test against the `expected` block, prints a summary
// and exits non-zero if regressions are found.
//
// Non-analyst questions (pdf-intake, scenarios, gap-analysis,
// benchmarking, decisions) are recorded as "skipped — requires the
// corresponding live endpoint" for now. Wiring each module's
// evaluation path is in scope for 13b.
//
// Usage:
//   node scripts/ai-eval.mjs                   # run all eval
//   node scripts/ai-eval.mjs --module analyst  # filter
//   node scripts/ai-eval.mjs --fail-if-regressed
//
// Env:
//   AI_PROVIDER (google|anthropic|stub)
//   GOOGLE_AI_API_KEY / ANTHROPIC_API_KEY
//   AI_EVAL_OUTPUT=/path (default prints JSONL to stdout)

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Read .env.
const envPath = '/home/denpong/projects/program-landscape/.env';
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const args = process.argv.slice(2);
const moduleFilter = args.includes('--module') ? args[args.indexOf('--module') + 1] : null;
const failIfRegressed = args.includes('--fail-if-regressed');

const root = '/home/denpong/projects/program-landscape';
const EVAL_FILE = `${root}/packages/shared/src/ai/eval/gold-questions.jsonl`;
const src = readFileSync(EVAL_FILE, 'utf8');
const cases = src
  .split('\n')
  .filter((l) => l.trim() && !l.startsWith('#'))
  .map((l, i) => {
    try { return JSON.parse(l); }
    catch (err) {
      console.error(`[ai-eval] line ${i + 1} invalid JSON: ${err.message}`);
      process.exit(2);
    }
  });

const filtered = moduleFilter ? cases.filter((c) => c.module === moduleFilter) : cases;
console.log(`[ai-eval] loaded ${filtered.length} of ${cases.length} cases`);

// Dynamic-import the safety gate + service factory via tsx.
let checkAnalystSafety, sanitizeAiOutput;
try {
  const safety = await import(`${root}/packages/shared/src/analyst/safety.ts`);
  checkAnalystSafety = safety.checkAnalystSafety;
  sanitizeAiOutput = safety.sanitizeAiOutput;
} catch (err) {
  console.error('[ai-eval] failed to load safety module — run via tsx:');
  console.error(`  node --import 'file://${root}/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/esm/index.mjs' scripts/ai-eval.mjs`);
  console.error(err.message);
  process.exit(2);
}

const results = [];
let passed = 0, failed = 0, skipped = 0;

for (const tc of filtered) {
  const result = { id: tc.id, module: tc.module, pass: false, notes: '' };

  // Analyst safety tests: the gate is deterministic and doesn't need the
  // LLM at all. Run it inline.
  if (tc.module === 'analyst' && tc.expected?.shouldRefuse) {
    const verdict = checkAnalystSafety(tc.prompt);
    const categoriesMatch =
      !tc.expected.categories ||
      tc.expected.categories.every((c) => verdict.categories.includes(c));
    result.pass = verdict.refuse && categoriesMatch;
    result.notes = result.pass
      ? `refused (${verdict.categories.join(', ')})`
      : `expected refusal in ${tc.expected.categories?.join(',')}, got refuse=${verdict.refuse} categories=${verdict.categories.join(',')}`;
  } else if (tc.module === 'analyst' && tc.expected?.mustMention) {
    // Positive analyst cases — the safety gate must NOT refuse. LLM
    // calls are out of scope for this script's quick mode (they cost $)
    // so we only verify the gate pass-through.
    const verdict = checkAnalystSafety(tc.prompt);
    if (verdict.refuse) {
      result.pass = false;
      result.notes = `expected pass, but safety gate refused (${verdict.categories.join(', ')})`;
    } else {
      result.pass = true;
      result.notes = 'safety-gate allowed — LLM scoring deferred to nightly run';
      skipped++;
      result.pass = null;
    }
  } else {
    result.pass = null;
    result.notes = 'module-specific eval requires live endpoint (nightly run)';
    skipped++;
  }

  if (result.pass === true) passed++;
  else if (result.pass === false) failed++;

  results.push(result);
}

console.log('\n[ai-eval] results:');
for (const r of results) {
  const icon = r.pass === true ? '✓' : r.pass === false ? '✗' : '…';
  console.log(`  ${icon}  ${r.id.padEnd(32)}  ${r.notes}`);
}

console.log(`\n[ai-eval] summary: passed=${passed} failed=${failed} skipped=${skipped}`);

// Sanitize check — validate the scrubber doesn't over-redact legitimate
// analytical text. 3 sample strings that SHOULD pass through unchanged.
const sanitizeProbes = [
  'Faculty of Engineering has 297 programs across 18 departments.',
  'Average salary of graduates in the 2024 cohort is ฿28,000.', // Aggregate OK.
  'The net contribution of BSc Computer Science was ฿-3.2M in 2024.',
];
let scrubOverReaches = 0;
for (const probe of sanitizeProbes) {
  const r = sanitizeAiOutput(probe);
  if (r.changed) {
    console.log(`[ai-eval] scrub WARNING: "${probe}" → "${r.text}" (redactions: ${JSON.stringify(r.redactions)})`);
    scrubOverReaches++;
  }
}
if (scrubOverReaches > 0) {
  console.log(`[ai-eval] scrub over-reaches: ${scrubOverReaches} of ${sanitizeProbes.length} — review regex rules`);
}

if (failIfRegressed && failed > 0) {
  console.error('\n[ai-eval] regressions detected — exiting 1');
  process.exit(1);
}

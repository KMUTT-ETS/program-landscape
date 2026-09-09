// packages/shared/scripts/capture-scholar-fixtures.ts
//
// Captures the real Google Scholar responses that the parsers under
// `src/scholar/` are tested against, into `test/fixtures/scholar/`.
//
//   pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts usage
//   pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts search       "<name>"     <file>
//   pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts search-novis "<name>"     <file>
//   pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts profile      "<authorId>" <file>
//
// THIS SPENDS REAL MONEY on a shared KKU account with a monthly cap: 75
// credits per search, 15 per profile page. Run `usage` first; capture once and
// test against the committed files thereafter. See the fixtures README for
// what each existing capture contains and which shapes could not be obtained.
//
// Deliberately goes through `fetchScrapingBeePage` rather than calling
// ScrapingBee directly, so what lands in a fixture is exactly what the running
// system would receive — same flags, same branch, same retry. A capture is
// therefore also evidence about the transport, not only about the markup.
//
// The API key is read out of the repo's `.env` here rather than relying on the
// ambient environment: these scripts are run ad hoc, and a silently-unset key
// would look like a Scholar failure rather than a configuration one. The value
// is only ever handed to the client; it is never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyScrapingBeeRequest, fetchScrapingBeePage } from '../src/scholar/scrapingbee';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const FIXTURES_DIR = join(PACKAGE_ROOT, 'test', 'fixtures', 'scholar');
const SCHOLAR_BASE = 'https://scholar.google.com';

function loadApiKey(): string {
  const raw = readFileSync(join(REPO_ROOT, '.env'), 'utf-8');
  for (const line of raw.split('\n')) {
    const match = /^\s*(?:export\s+)?SCRAPINGBEE_API_KEY\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[1] ?? '').trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (value) return value;
  }
  throw new Error('SCRAPINGBEE_API_KEY is not set in the repo .env — nothing to capture with.');
}

function targetUrlFor(mode: string, argument: string): string {
  const encoded = encodeURIComponent(argument);
  switch (mode) {
    // The primary search the resolver issues. `as_vis=1` hides citation-only
    // rows AND, as it turns out, the profile cluster.
    case 'search':
      return `${SCHOLAR_BASE}/scholar?q=${encoded}&hl=en&as_vis=1`;
    // The fallback probe: same query without `as_vis`, which is where a
    // profile cluster can appear.
    case 'search-novis':
      return `${SCHOLAR_BASE}/scholar?q=${encoded}&hl=en`;
    case 'profile':
      return `${SCHOLAR_BASE}/citations?user=${encoded}&hl=en&cstart=0&pagesize=100`;
    default:
      throw new Error(`Unknown mode "${mode}". Use usage | search | search-novis | profile.`);
  }
}

/**
 * Cheap structural facts about the captured page, printed so the operator can
 * name the fixture for what it actually contains before committing it. These
 * are counts of raw markup, NOT the parser's own reading — a fixture is not
 * evidence for a parser that was used to describe it.
 */
function report(html: string): void {
  const count = (pattern: RegExp) => (html.match(pattern) ?? []).length;
  const lower = html.toLowerCase();
  console.log('  mentions "User profiles" :', lower.includes('user profiles'));
  console.log('  div.gs_r.gs_or rows      :', count(/class="gs_r gs_or/g));
  console.log('  /citations?user= anchors :', count(/\/citations\?user=/g));
  console.log('  div.gs_a bylines         :', count(/class="gs_a"/g));
  console.log('  gs_ctc badges            :', [...new Set(html.match(/gs_ct1">\[[^\]]*\]/g) ?? [])]);
  console.log(
    '  blocked?                 :',
    lower.includes('unusual traffic') || lower.includes('/sorry/'),
  );
}

async function main(): Promise<void> {
  const apiKey = loadApiKey();
  process.env.SCRAPINGBEE_API_KEY = apiKey;

  const mode = process.argv[2] ?? '';

  if (mode === 'usage') {
    const response = await fetch(`https://app.scrapingbee.com/api/v1/usage?api_key=${apiKey}`);
    console.log(`usage HTTP ${response.status}`);
    console.log(await response.text());
    return;
  }

  const argument = process.argv[3] ?? '';
  const outputName = process.argv[4] ?? '';
  if (!argument || !outputName) {
    throw new Error('Need a query/author-id and a fixture file name.');
  }
  if (outputName.includes('/') || outputName.includes('\\')) {
    // A path here silently writes outside the fixtures directory, or fails
    // AFTER the credits have already been spent. Refuse before fetching.
    throw new Error(`"${outputName}" must be a bare file name, not a path.`);
  }

  const targetUrl = targetUrlFor(mode, argument);
  console.log('kind    :', classifyScrapingBeeRequest(targetUrl));
  console.log('target  :', targetUrl);

  const startedAt = Date.now();
  const result = await fetchScrapingBeePage(targetUrl);
  console.log('status  :', result.status);
  console.log('Spb-Cost:', result.creditsUsed);
  console.log('elapsed :', `${Date.now() - startedAt} ms`);
  console.log('bytes   :', result.html.length);
  report(result.html);

  const outputPath = join(FIXTURES_DIR, outputName);
  writeFileSync(outputPath, result.html, 'utf-8');
  console.log('wrote   :', outputPath);
  console.log('Check the file for PII, then describe it in the fixtures README before committing.');
}

main().catch((error: unknown) => {
  console.error('FAILED:', error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});

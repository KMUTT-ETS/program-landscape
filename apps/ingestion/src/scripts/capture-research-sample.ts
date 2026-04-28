#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Discovery-only capture for the kku-research connector. Two sources:
//
//   1. OpenAlex (https://api.openalex.org) — FREE, no API key required
//      - Find KKU's institution ID once.
//      - Then list works by `authorships.institutions.id:<kku-id>` —
//        gets ALL KKU-authored papers in one paginated query.
//      - "Polite pool" via mailto= query param (10 req/s vs 1 req/s).
//
//   2. Scopus (https://api.elsevier.com/content/search/scopus) — Elsevier
//      API, KKU has institutional license.
//      - Query by AFFIL("Khon Kaen University") — paginated.
//      - Auth: `X-ELS-APIKey` header (always) + `X-ELS-Insttoken` header
//        (when called from off-campus).
//      - Quota: typical institutional plans give 20,000 reqs/week;
//        burn rate ~6% if we paginate at 25/page over ~30k papers.
//
// Google Scholar has NO official API; SerpAPI ($50/mo) is the only
// reliable wrapper. We do NOT use Google Scholar — OpenAlex covers
// the same ground for free.
//
// Usage:
//   pnpm research:capture openalex-discover  # find KKU institution ID + counts
//   pnpm research:capture openalex-sample    # pull 25 sample KKU works
//   pnpm research:capture scopus-discover    # confirm API key + KKU author count
//   pnpm research:capture scopus-sample      # pull 25 sample KKU papers
//   pnpm research:capture all                # all four (Scopus skipped if no key)
//
// Reads OPENALEX_MAILTO (optional, polite pool) and KKU_SCOPUS_API_KEY
// (optional; required for the scopus-* subcommands) from .env.
//
// Output JSON fixtures land in apps/ingestion/test/fixtures/kku-research/.
// All fixtures are aggregate counts + a small sample of public-paper
// metadata (titles, DOIs, citation counts, author lists). NO author
// emails or other PII.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const FIXTURE_DIR = path.resolve(
  __dirname,
  '../../test/fixtures/kku-research',
);

async function ensureDir(): Promise<void> {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
}

async function writeFixture(name: string, data: unknown): Promise<void> {
  const target = path.join(FIXTURE_DIR, `${name}.json`);
  await fs.writeFile(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  → wrote ${path.relative(process.cwd(), target)}`);
}

const OPENALEX_BASE = 'https://api.openalex.org';
const SCOPUS_BASE = 'https://api.elsevier.com/content';

function openalexMailto(): string | undefined {
  return process.env.OPENALEX_MAILTO;
}

interface OpenAlexInstitution {
  id: string; // e.g., "https://openalex.org/I137876101"
  display_name: string;
  ror?: string;
  country_code?: string;
  works_count?: number;
  cited_by_count?: number;
}

interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string;
  display_name?: string;
  publication_year?: number;
  type?: string;
  cited_by_count?: number;
  authorships?: Array<{
    author?: { id?: string; display_name?: string; orcid?: string | null };
    institutions?: Array<{ id?: string; display_name?: string }>;
  }>;
  primary_location?: {
    source?: { display_name?: string; type?: string };
  };
}

interface OpenAlexInstitutionsResponse {
  results: OpenAlexInstitution[];
  meta: { count: number };
}

interface OpenAlexWorksResponse {
  results: OpenAlexWork[];
  meta: {
    count: number;
    page?: number;
    per_page?: number;
  };
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ─────────────────────────────────────────────────────────────────────
// 1. OpenAlex discovery — find KKU's institution + total works
// ─────────────────────────────────────────────────────────────────────

async function discoverOpenAlex(): Promise<void> {
  console.log('[openalex-discover] looking up KKU institution on OpenAlex…');
  const mailto = openalexMailto();
  if (!mailto) {
    console.warn('  ⚠️  OPENALEX_MAILTO not set; using anonymous (slower) pool.');
  }
  const mailtoQs = mailto ? `&mailto=${encodeURIComponent(mailto)}` : '';

  // Search by display_name; KKU's English name is "Khon Kaen University".
  const inst = await fetchJson<OpenAlexInstitutionsResponse>(
    `${OPENALEX_BASE}/institutions?search=Khon%20Kaen%20University&per_page=10${mailtoQs}`,
  );
  console.log(`  matched ${inst.meta.count} institutions; top 5:`);
  for (const i of inst.results.slice(0, 5)) {
    console.log(
      `    ${i.id.split('/').pop()} | ${i.display_name} | ROR=${i.ror ?? '(none)'} | works=${i.works_count?.toLocaleString() ?? '?'}`,
    );
  }
  const kkuMatch = inst.results.find((i) =>
    /khon\s*kaen/i.test(i.display_name) && (i.country_code === 'TH' || !i.country_code),
  );
  if (!kkuMatch) {
    console.warn('  ⚠️  no exact-match KKU institution found.');
    await writeFixture('openalex-discover', { matched: inst.results });
    return;
  }
  const kkuId = kkuMatch.id.split('/').pop();
  console.log(
    `  selected KKU = ${kkuId} (${kkuMatch.display_name}); ROR=${kkuMatch.ror ?? '(none)'}; total works=${kkuMatch.works_count?.toLocaleString() ?? '?'}`,
  );

  // Yearly count over last 10 years.
  const yearCounts = await fetchJson<{
    group_by: Array<{ key: string; count: number }>;
  }>(
    `${OPENALEX_BASE}/works?filter=authorships.institutions.id:${kkuId},publication_year:>2014&group_by=publication_year${mailtoQs}`,
  );
  const yearly = yearCounts.group_by
    .map((g) => ({ year: Number(g.key), count: g.count }))
    .sort((a, b) => b.year - a.year);
  console.log(`  yearly publication counts (last 10y):`);
  for (const r of yearly.slice(0, 10)) {
    console.log(`    ${r.year}: ${r.count.toLocaleString()}`);
  }

  // Top types (article / book / chapter / etc).
  const typeCounts = await fetchJson<{
    group_by: Array<{ key: string; count: number }>;
  }>(
    `${OPENALEX_BASE}/works?filter=authorships.institutions.id:${kkuId}&group_by=type${mailtoQs}`,
  );
  const byType = typeCounts.group_by.map((g) => ({ type: g.key, count: g.count }));
  console.log(`  by type:`);
  for (const r of byType.slice(0, 8)) {
    console.log(`    ${r.type}: ${r.count.toLocaleString()}`);
  }

  await writeFixture('openalex-discover', {
    selectedInstitutionId: kkuId,
    institution: kkuMatch,
    yearlyCounts: yearly,
    byType,
    matchedInstitutions: inst.results.map((i) => ({
      id: i.id.split('/').pop(),
      display_name: i.display_name,
      ror: i.ror,
      country_code: i.country_code,
      works_count: i.works_count,
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────
// 2. OpenAlex sample — pull a small sample of KKU works to confirm
//    the data shape we'll project into ResearchOutput
// ─────────────────────────────────────────────────────────────────────

async function sampleOpenAlex(): Promise<void> {
  console.log('[openalex-sample] pulling 25 sample KKU works…');
  const mailto = openalexMailto();
  const mailtoQs = mailto ? `&mailto=${encodeURIComponent(mailto)}` : '';

  // Re-resolve KKU institution ID; we don't cache here on purpose so
  // re-running picks up any institution change (rare but possible).
  const inst = await fetchJson<OpenAlexInstitutionsResponse>(
    `${OPENALEX_BASE}/institutions?search=Khon%20Kaen%20University&per_page=10${mailtoQs}`,
  );
  const kkuMatch = inst.results.find(
    (i) => /khon\s*kaen/i.test(i.display_name) && (i.country_code === 'TH' || !i.country_code),
  );
  if (!kkuMatch) {
    console.error('  KKU institution not found; abort.');
    return;
  }
  const kkuId = kkuMatch.id.split('/').pop();

  const works = await fetchJson<OpenAlexWorksResponse>(
    `${OPENALEX_BASE}/works?filter=authorships.institutions.id:${kkuId}&per_page=25&sort=cited_by_count:desc${mailtoQs}`,
  );
  console.log(`  fetched ${works.results.length} of ${works.meta.count.toLocaleString()} total KKU works`);

  // Project to a minimal sample — keep size bounded; no PII.
  const sample = works.results.map((w) => ({
    openalexId: w.id.split('/').pop(),
    doi: w.doi,
    title: (w.title ?? w.display_name ?? '').slice(0, 200),
    year: w.publication_year ?? null,
    type: w.type ?? null,
    citationsCount: w.cited_by_count ?? 0,
    venue: w.primary_location?.source?.display_name ?? null,
    venueType: w.primary_location?.source?.type ?? null,
    authorCount: w.authorships?.length ?? 0,
    // First 5 author names + their institution affiliations (truncate
    // longer lists; full author list would balloon the fixture).
    firstFiveAuthors: (w.authorships ?? []).slice(0, 5).map((a) => ({
      name: a.author?.display_name ?? '?',
      orcid: a.author?.orcid ?? null,
      affiliations: (a.institutions ?? []).map((i) => i.display_name).slice(0, 3),
    })),
  }));

  await writeFixture('openalex-sample', {
    institutionId: kkuId,
    totalCount: works.meta.count,
    sample,
  });
}

// ─────────────────────────────────────────────────────────────────────
// 3. Scopus discovery — confirm API key works + counts
// ─────────────────────────────────────────────────────────────────────

interface ScopusSearchResponse {
  'search-results': {
    'opensearch:totalResults': string;
    'opensearch:itemsPerPage'?: string;
    'opensearch:startIndex'?: string;
    entry?: Array<Record<string, unknown>>;
  };
}

function scopusHeaders(): Record<string, string> {
  const apiKey = process.env.KKU_SCOPUS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'KKU_SCOPUS_API_KEY not set; obtain from KKU Library / Elsevier and add to .env',
    );
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-ELS-APIKey': apiKey,
  };
  const instToken = process.env.KKU_SCOPUS_INST_TOKEN;
  if (instToken) headers['X-ELS-Insttoken'] = instToken;
  return headers;
}

async function discoverScopus(): Promise<void> {
  console.log('[scopus-discover] confirming API key + KKU paper counts…');
  let headers: Record<string, string>;
  try {
    headers = scopusHeaders();
  } catch (err) {
    console.error(`  SKIP — ${err instanceof Error ? err.message : String(err)}`);
    await writeFixture('scopus-discover', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Total KKU papers (all years).
  const total = await fetchJson<ScopusSearchResponse>(
    `${SCOPUS_BASE}/search/scopus?query=${encodeURIComponent('AFFIL("Khon Kaen University")')}&count=0`,
    headers,
  );
  const totalCount = Number(total['search-results']['opensearch:totalResults']);
  console.log(`  total KKU papers in Scopus: ${totalCount.toLocaleString()}`);

  // Per-year counts (last 10 years) via separate queries — Scopus has
  // no group-by, so we pay one request per year. Acceptable cost.
  const currentYear = new Date().getFullYear();
  const yearly: Array<{ year: number; count: number }> = [];
  for (let y = currentYear; y > currentYear - 10; y--) {
    const r = await fetchJson<ScopusSearchResponse>(
      `${SCOPUS_BASE}/search/scopus?query=${encodeURIComponent(`AFFIL("Khon Kaen University") AND PUBYEAR=${y}`)}&count=0`,
      headers,
    );
    yearly.push({ year: y, count: Number(r['search-results']['opensearch:totalResults']) });
    console.log(`    ${y}: ${yearly[yearly.length - 1]!.count.toLocaleString()}`);
  }

  await writeFixture('scopus-discover', {
    queryUsed: 'AFFIL("Khon Kaen University")',
    totalCount,
    yearlyCounts: yearly,
  });
}

// ─────────────────────────────────────────────────────────────────────
// 4. Scopus sample — pull 25 KKU papers to confirm shape
// ─────────────────────────────────────────────────────────────────────

async function sampleScopus(): Promise<void> {
  console.log('[scopus-sample] pulling 25 sample KKU papers…');
  let headers: Record<string, string>;
  try {
    headers = scopusHeaders();
  } catch (err) {
    console.error(`  SKIP — ${err instanceof Error ? err.message : String(err)}`);
    await writeFixture('scopus-sample', {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const r = await fetchJson<ScopusSearchResponse>(
    `${SCOPUS_BASE}/search/scopus?query=${encodeURIComponent('AFFIL("Khon Kaen University")')}&count=25&sort=citedby-count`,
    headers,
  );
  const totalCount = Number(r['search-results']['opensearch:totalResults']);
  const entries = r['search-results'].entry ?? [];
  console.log(`  fetched ${entries.length} of ${totalCount.toLocaleString()} total`);

  // Project a minimal sample — Scopus entry objects have ~30 fields;
  // we keep the ones we'll use in the connector projection.
  const sample = entries.map((e) => {
    const get = (k: string): unknown => e[k];
    return {
      scopusId: get('dc:identifier'),
      doi: get('prism:doi'),
      title: String(get('dc:title') ?? '').slice(0, 200),
      year: Number(String(get('prism:coverDate') ?? '').slice(0, 4)) || null,
      venue: get('prism:publicationName') ?? null,
      type: get('prism:aggregationType') ?? null,
      citationsCount: Number(get('citedby-count') ?? 0),
      authors: String(get('dc:creator') ?? '').slice(0, 200),
      authorCount:
        Array.isArray(get('author'))
          ? (get('author') as unknown[]).length
          : null,
    };
  });

  await writeFixture('scopus-sample', {
    queryUsed: 'AFFIL("Khon Kaen University")',
    totalCount,
    sample,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────

const HELP = `
Usage: pnpm research:capture <subcommand>

Subcommands:
  openalex-discover   find KKU institution ID, yearly counts, type breakdown (free; no key)
  openalex-sample     pull 25 sample KKU works (free; no key)
  scopus-discover     confirm KKU_SCOPUS_API_KEY works + paper counts
  scopus-sample       pull 25 sample KKU papers from Scopus
  all                 run all four (Scopus subcommands skip cleanly if no key)

Reads OPENALEX_MAILTO (optional, polite pool) and KKU_SCOPUS_API_KEY
(required for scopus-*) from .env.

Writes JSON fixtures to apps/ingestion/test/fixtures/kku-research/<name>.json.
All fixtures are aggregate counts + small samples of public paper
metadata; no PII.
`.trim();

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  if (!subcommand) {
    console.error(HELP);
    process.exit(1);
  }
  await ensureDir();
  switch (subcommand) {
    case 'openalex-discover':
      await discoverOpenAlex();
      break;
    case 'openalex-sample':
      await sampleOpenAlex();
      break;
    case 'scopus-discover':
      await discoverScopus();
      break;
    case 'scopus-sample':
      await sampleScopus();
      break;
    case 'all':
      await discoverOpenAlex();
      await sampleOpenAlex();
      await discoverScopus();
      await sampleScopus();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}\n\n${HELP}`);
      process.exit(1);
  }
  console.log('[research:capture] done');
}

void main().catch((err: unknown) => {
  console.error('[research:capture] failed:', err);
  process.exit(1);
});

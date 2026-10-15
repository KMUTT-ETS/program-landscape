#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Enrich FacultyMember.scopusAuthorId from OpenAlex.
//
// OpenAlex author records expose cross-system identifiers under `ids` —
// including a Scopus URL of the form
//   http://www.scopus.com/inst/MainServlet.url?accessor=AUTH&authorID=XXXX
// We parse the `authorID` parameter and store it on FacultyMember so the
// raw-data viewer can link directly to the Scopus profile at
//   https://www.scopus.com/authid/detail.uri?authorId=<id>
//
// No Elsevier API key required — OpenAlex enriches authors from public
// Scopus author records and exposes the IDs free.
//
// Idempotent: only updates rows where scopus_author_id IS NULL AND
// openalex_author_id IS NOT NULL. Re-running picks up any new authors
// added by subsequent kku-research syncs.
//
// Polite throttle: 200ms between requests (well under OpenAlex's
// polite-pool ceiling of 10 req/s).
//
// Usage:
//   pnpm tsx apps/ingestion/src/scripts/enrich-scopus-ids.ts            # dry-run
//   pnpm tsx apps/ingestion/src/scripts/enrich-scopus-ids.ts --apply    # commit
//   pnpm tsx apps/ingestion/src/scripts/enrich-scopus-ids.ts --apply --limit=50
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
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

import { loadOrganization, prisma } from '@kku/db';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const limitArg = [...args].find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : null;

const OPENALEX_BASE = 'https://api.openalex.org';
const POLITE_MAILTO = process.env.OPENALEX_MAILTO ?? '';
const REQUEST_DELAY_MS = 200;

interface OpenAlexAuthor {
  id: string;
  display_name?: string;
  ids?: {
    openalex?: string;
    orcid?: string;
    scopus?: string;
    twitter?: string;
    wikipedia?: string;
  };
}

/** Extracts the numeric authorID from a Scopus URL. Two formats observed:
 *  - http://www.scopus.com/inst/MainServlet.url?accessor=AUTH&authorID=12345678900
 *  - https://www.scopus.com/authid/detail.uri?authorId=12345678900
 *  Returns null when neither matches. */
function extractScopusAuthorId(scopusUrl: string | undefined): string | null {
  if (!scopusUrl) return null;
  const m = scopusUrl.match(/authorID?=(\d+)/i);
  return m ? m[1]! : null;
}

async function fetchAuthor(openalexId: string): Promise<OpenAlexAuthor | null> {
  const id = openalexId.startsWith('A') ? openalexId : `A${openalexId}`;
  const url = new URL(`${OPENALEX_BASE}/authors/${id}`);
  if (POLITE_MAILTO) url.searchParams.set('mailto', POLITE_MAILTO);
  const headers: Record<string, string> = {};
  if (POLITE_MAILTO) headers['User-Agent'] = `KKU-Curriculum-Landscape/1.0 (${POLITE_MAILTO})`;
  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      // 404 = author no longer exists / merged. Skip silently.
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as OpenAlexAuthor;
  } catch (err) {
    console.error(`  ✗ ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  await loadOrganization();
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN'}`);
  console.log(`Polite mailto: ${POLITE_MAILTO || '(none — will throttle harder)'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const candidates = await prisma.facultyMember.findMany({
    where: {
      openalexAuthorId: { not: null },
      scopusAuthorId: null,
    },
    select: { id: true, employeeId: true, nameEn: true, openalexAuthorId: true, orcid: true },
    orderBy: { nameEn: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Candidates: ${candidates.length} (faculty members with OpenAlex ID, no Scopus ID yet)`);
  if (candidates.length === 0) {
    console.log('Nothing to do. Run kku-research first to populate openalex_author_id.');
    return;
  }

  const stats = {
    fetched: 0,
    found_scopus: 0,
    found_orcid_too: 0,
    no_scopus: 0,
    not_found: 0,
    written: 0,
  };

  for (const c of candidates) {
    process.stdout.write(`  ${c.nameEn} (emp ${c.employeeId ?? '—'}, OA ${c.openalexAuthorId})… `);
    const author = await fetchAuthor(c.openalexAuthorId!);
    stats.fetched++;
    if (!author) {
      stats.not_found++;
      console.log('not-found');
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    const scopusId = extractScopusAuthorId(author.ids?.scopus);
    const orcidFromOA = author.ids?.orcid?.replace(/^https?:\/\/orcid\.org\//, '');
    if (!scopusId) {
      stats.no_scopus++;
      console.log('no-scopus');
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    stats.found_scopus++;
    if (orcidFromOA && !c.orcid) stats.found_orcid_too++;

    if (APPLY) {
      try {
        await prisma.facultyMember.update({
          where: { id: c.id },
          data: {
            scopusAuthorId: scopusId,
            // Opportunistic ORCID enrichment — if OpenAlex has an ORCID
            // and our row doesn't, fill it now. Free side-benefit.
            ...(orcidFromOA && !c.orcid ? { orcid: orcidFromOA } : {}),
          },
        });
        stats.written++;
        console.log(`scopus=${scopusId}${orcidFromOA && !c.orcid ? `, orcid=${orcidFromOA}` : ''}`);
      } catch (err) {
        // Most likely cause: scopusAuthorId unique-constraint collision.
        // Multiple FacultyMember rows can map to the same Scopus author
        // when KKU's HR has duplicate identity records — leave that to
        // analyst reconciliation.
        console.log(`✗ persist-failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log(`scopus=${scopusId}${orcidFromOA && !c.orcid ? `, orcid=${orcidFromOA}` : ''} (dry)`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Fetched:           ${stats.fetched}`);
  console.log(`Found Scopus ID:   ${stats.found_scopus}`);
  console.log(`Also got ORCID:    ${stats.found_orcid_too}`);
  console.log(`No Scopus ID:      ${stats.no_scopus}`);
  console.log(`Not found (404):   ${stats.not_found}`);
  if (APPLY) console.log(`Written:           ${stats.written}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

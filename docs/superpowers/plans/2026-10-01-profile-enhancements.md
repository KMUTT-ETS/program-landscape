# /profile Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Google Scholar papers real co-author lists, make the publication metadata row readable, remove Top venues, and replace the "My teaching evaluations" link card with an embedded KPI + radar panel.

**Architecture:** The Scholar sync keeps the author line it already downloads and, for lists Scholar shortened, fetches each paper's detail page once (≤20 per sync), storing `{names, complete, fetchedAt}` in a new `research_outputs.scholar_authors` column that the profile builder reads. The pill row and the evaluation panel are new focused client components fed by pure, unit-tested helpers; evaluation data comes server-side from the existing `instructorPersonal()`.

**Tech Stack:** TypeScript, Prisma 5 / Postgres 16, Next.js 14 (App Router, client components), NestJS-free (web + db + shared only), vitest (node env, `renderToStaticMarkup` for render tests), recharts via `@kku/ui` `RadarChartSmall`.

**Spec:** `docs/superpowers/specs/2026-10-01-profile-enhancements-design.md` — read it first.

---

## Ground rules for every task

- Work on `main` (user-approved). Commit with `git commit -F <file>`; message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage by explicit path; never stage `handoff.md`, `presentation_en.md`, `presentation_th.md`.
- **CI no-delete gate:** `.github/workflows/pr.yml` job `scholar-no-delete` greps `packages/db/src/scholar-fetch.ts` and `packages/db/src/scholar-console.ts` for the SUBSTRINGS `delete` / `deleteMany` — anywhere, including comments and identifiers. Never write that substring in those files (say "remove"/"drop" in comments).
- Migrations: hand-written SQL applied with `pnpm db:migrate`. Never `prisma migrate dev`, `db push`, `migrate reset`, `migrate diff --from-migrations`, `--shadow-database-url` (a hook blocks them). Prisma only via `pnpm --filter @kku/db exec prisma …`.
- Never print `.env`. ScrapingBee calls cost real credits: only Task 2 Step 1 and Task 10 make live calls, as stated there.
- Client components must never runtime-import `@kku/db` or the `@kku/shared` barrel — `import type` only, or deep paths to browser-safe files.
- Tailwind: half-scale spacing (missing keys emit nothing); `success`/`warning`/`danger` have no `-default` key (`text-danger` not `text-danger-default`); no bare `rounded`; `border-border-*` emits nothing (use `border-subtle`/`border-default`). `Badge tone="outline"` and `tone="neutral"` use `border-border-*` internally and so render no border — don't rely on Badge for the new chips.
- Known pre-existing failures: 4 tests in `packages/shared/test/usage-action-coverage.test.ts`. Add none.
- `nest start --watch` / `next dev` do not reload `packages/*`; restart dev servers before any live check (resolve PIDs with `ss -ltnp`; never `pkill -f "pnpm dev"`).
- Test commands: `pnpm --filter @kku/shared test`, `pnpm --filter @kku/db test`, `pnpm --filter web test`; typecheck `pnpm --filter <pkg> typecheck`.

## File map

**Create**
- `packages/shared/src/scholar/author-names.ts` — Scholar author-line splitting + name → `AuthorName` (Task 1)
- `packages/shared/src/scholar/citation-detail.ts` — detail-page author parser (Task 2)
- `packages/shared/test/fixtures/scholar/citation-detail-hinton.html` — captured real page (Task 2)
- `packages/db/prisma/migrations/20261001100000_research_output_scholar_authors/migration.sql` (Task 3)
- `packages/db/scripts/scholar-authors-backfill.ts` — dev backfill from the archive (Task 5)
- `apps/web/src/lib/publication-meta.ts` — type/source labels, identifier links, author status (Task 7)
- `apps/web/app/profile/publication-meta-row.tsx` — the new pill row (Task 7)
- `apps/web/src/lib/teaching-evaluation-summary.ts` — pure evaluation aggregation (Task 8)
- `apps/web/app/profile/teaching-evaluation-panel.tsx` — the panel (Task 9)
- Tests per task.

**Modify**
- `packages/shared/src/scholar/merge.ts` (`ScholarPaper`), `packages/shared/src/scholar/parse.ts`, `packages/shared/src/scholar/index.ts`
- `packages/db/prisma/schema.prisma`, `packages/db/src/scholar-fetch.ts`, `packages/db/src/staff-profile/profile.ts`
- `apps/web/src/lib/profile-data.ts`, `apps/web/app/profile/page.tsx`, `apps/web/app/profile/profile-view.tsx`

---

### Task 1: Scholar author lines — capture and parse names

Scholar's profile list page prints each row's authors in the first `<div class="gs_gray">`, comma-separated, initials first: `A Krizhevsky, I Sutskever, GE Hinton`, `L van der Maaten, G Hinton`. Long lists end with a literal `, ...` (4 of 100 rows in `profile-hinton.html`, 8 in `profile-hinton-page2.html`). Thai names may appear as full names (`เด่นพงษ์ สุดภักดี`).

**Files:**
- Create: `packages/shared/src/scholar/author-names.ts`
- Modify: `packages/shared/src/scholar/merge.ts` (ScholarPaper), `packages/shared/src/scholar/parse.ts`, `packages/shared/src/scholar/index.ts`
- Test: `packages/shared/test/scholar-author-names.test.ts`, extend `packages/shared/test/scholar-parse.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/scholar-author-names.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseScholarAuthorName, splitScholarAuthorLine } from '../src/scholar/author-names';

describe('splitScholarAuthorLine', () => {
  it('splits a complete list', () => {
    expect(splitScholarAuthorLine('A Krizhevsky, I Sutskever, GE Hinton')).toEqual({
      names: ['A Krizhevsky', 'I Sutskever', 'GE Hinton'],
      complete: true,
    });
  });
  it('marks a list Scholar shortened with a trailing "..." or "…"', () => {
    expect(splitScholarAuthorLine('G Hinton, L Deng, D Yu, ...')).toEqual({
      names: ['G Hinton', 'L Deng', 'D Yu'],
      complete: false,
    });
    expect(splitScholarAuthorLine('G Hinton, L Deng …')).toEqual({ names: ['G Hinton', 'L Deng'], complete: false });
  });
  it('returns null for an empty line', () => {
    expect(splitScholarAuthorLine('')).toBeNull();
    expect(splitScholarAuthorLine('  ')).toBeNull();
    expect(splitScholarAuthorLine('...')).toBeNull();
  });
});

describe('parseScholarAuthorName', () => {
  it('reads leading capital initials as initials and the rest as the family name', () => {
    expect(parseScholarAuthorName('GE Hinton')).toEqual({ family: 'Hinton', given: null, initials: 'G.E.' });
    expect(parseScholarAuthorName('L van der Maaten')).toEqual({ family: 'van der Maaten', given: null, initials: 'L.' });
    expect(parseScholarAuthorName('R Müller')).toEqual({ family: 'Müller', given: null, initials: 'R.' });
  });
  it('reads a full name (no initials token) as given + family', () => {
    expect(parseScholarAuthorName('เด่นพงษ์ สุดภักดี')).toEqual({ family: 'สุดภักดี', given: 'เด่นพงษ์', initials: null });
    expect(parseScholarAuthorName('Denpong Soodphakdee')).toEqual({ family: 'Soodphakdee', given: 'Denpong', initials: null });
  });
  it('keeps a single token as the family name', () => {
    expect(parseScholarAuthorName('Hinton')).toEqual({ family: 'Hinton', given: null, initials: null });
  });
});
```

Append to `packages/shared/test/scholar-parse.test.ts` (inside the file's top-level, reusing its fixture loader — read the file to find its helper name, e.g. `fixture(name)`):
```ts
describe('author lines (scholar-parse.v2)', () => {
  it('captures every row author line from the real Hinton capture', () => {
    const papers = parseScholarPublications(fixture('profile-hinton.html'));
    const imagenet = papers.find((p) => p.scholarPaperId === 'JicYPdAAAAAJ:VN7nJs4JPk0C')!;
    expect(imagenet.authors).toEqual({ names: ['A Krizhevsky', 'I Sutskever', 'GE Hinton'], complete: true });
    expect(papers.filter((p) => p.authors && !p.authors.complete)).toHaveLength(4);
    expect(papers.every((p) => p.authors !== undefined)).toBe(true);
  });
});
```
and change the version assertion (around line 23) to `expect(SCHOLAR_PARSER_VERSION).toBe('scholar-parse.v2');`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @kku/shared exec vitest run test/scholar-author-names.test.ts test/scholar-parse.test.ts`
Expected: FAIL — module not found / `authors` undefined / version mismatch.

- [ ] **Step 3: Implement**

`packages/shared/src/scholar/author-names.ts`:
```ts
// Google Scholar author strings.
//
// The profile list page prints a row's authors initials-first, comma-separated
// ("A Krizhevsky, I Sutskever, GE Hinton") and shortens long lists with a
// trailing "..." (observed as ASCII in every real capture; "…" accepted too).
// Thai authors often appear as full names ("เด่นพงษ์ สุดภักดี").
// Pure and browser-safe: no imports.
import type { AuthorName } from '../staff-profile/types';

export interface ScholarAuthorLine {
  names: string[];
  /** False when Scholar shortened the list with a trailing ellipsis. */
  complete: boolean;
}

const TRAILING_ELLIPSIS_RE = /,?\s*(?:\.\.\.|…)\s*$/;

export function splitScholarAuthorLine(line: string): ScholarAuthorLine | null {
  const trimmed = line.trim();
  const complete = !TRAILING_ELLIPSIS_RE.test(trimmed);
  const body = trimmed.replace(TRAILING_ELLIPSIS_RE, '');
  const names = body
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return names.length === 0 ? null : { names, complete };
}

// One to three capital letters, optionally dotted: "G", "GE", "J.K.".
const INITIALS_TOKEN_RE = /^(?:\p{Lu}\.?){1,3}$/u;

export function parseScholarAuthorName(name: string): AuthorName {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { family: tokens[0] ?? '', given: null, initials: null };
  const first = tokens[0]!;
  if (INITIALS_TOKEN_RE.test(first)) {
    const letters = first.replace(/\./g, '').split('');
    return { family: tokens.slice(1).join(' '), given: null, initials: letters.map((l) => `${l}.`).join('') };
  }
  return { family: tokens.slice(1).join(' '), given: first, initials: null };
}
```

`packages/shared/src/scholar/merge.ts` — add to `ScholarPaper` (after `type`):
```ts
  /** The row's author line as Scholar printed it; null when the row had none.
   *  `complete` is false when Scholar shortened the list. */
  authors: ScholarAuthorLine | null;
```
with `import type { ScholarAuthorLine } from './author-names';` at the top. Fix every construction site the compiler names (tests' fixture builders included) by passing `authors: null` where no line exists.

`packages/shared/src/scholar/parse.ts`:
- `export const SCHOLAR_PARSER_VERSION = 'scholar-parse.v2';` and add a one-line note above it: `// v2 (2026-10-01): captures each row's author line.`
- Add next to the other regexes:
```ts
const AUTHORS_RE = /class="gsc_a_at">[\s\S]*?<\/a>\s*<div class="gs_gray">([\s\S]*?)<\/div>/;
```
- In the row loop, after the venue is computed:
```ts
      const authorsRaw = AUTHORS_RE.exec(rowHtml)?.[1];
      const authors = authorsRaw ? splitScholarAuthorLine(htmlToText(authorsRaw)) : null;
```
  (use the loop's actual row-HTML variable name) and add `authors` to the pushed object. Import `splitScholarAuthorLine` from `./author-names`.
- Update the header comment block's "NOT present" / field list to say the author line is now captured.

`packages/shared/src/scholar/index.ts` — add `export * from './author-names';`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kku/shared exec vitest run test/scholar-author-names.test.ts test/scholar-parse.test.ts test/scholar-merge.test.ts` → PASS. Then `pnpm --filter @kku/shared test` (only the 4 known failures) and `pnpm --filter @kku/shared typecheck`, `pnpm --filter @kku/db typecheck` (db constructs `ScholarPaper` in tests/runner — fix every site the compiler names with `authors: null` or the parsed value).

- [ ] **Step 5: Mutation check, then commit**

Change `TRAILING_ELLIPSIS_RE` to `/$^/` → the shortened-list tests must FAIL; revert.
```bash
git add packages/shared/src/scholar packages/shared/test/scholar-author-names.test.ts packages/shared/test/scholar-parse.test.ts <any db test files you had to touch>
git commit -F <msg>   # feat(scholar): keep each paper's author line from the profile list
```

---

### Task 2: Scholar detail page — capture a real fixture and parse its full author list

**Files:**
- Create: `packages/shared/test/fixtures/scholar/citation-detail-hinton.html`, `packages/shared/src/scholar/citation-detail.ts`
- Modify: `packages/shared/src/scholar/index.ts`
- Test: `packages/shared/test/scholar-citation-detail.test.ts`

- [ ] **Step 1: Capture one real detail page (LIVE — 15 ScrapingBee credits, once)**

Pick a shortened Hinton paper from the existing fixture: `grep -o 'citation_for_view=JicYPdAAAAAJ:[^"&]*"[^>]*>[^<]*</a><div class="gs_gray">[^<]*\.\.\.' packages/shared/test/fixtures/scholar/profile-hinton.html | head -1` → take its paper id (`JicYPdAAAAAJ:XXXX`).
Write a throwaway script in the scratchpad (NOT in the repo):
```ts
import { writeFileSync } from 'node:fs';
import { fetchScrapingBeePage } from '@kku/shared/src/scholar/scrapingbee';
const id = process.argv[2]!;
const url = `https://scholar.google.com/citations?view_op=view_citation&hl=en&user=JicYPdAAAAAJ&citation_for_view=${encodeURIComponent(id)}`;
const r = await fetchScrapingBeePage(url);
writeFileSync(process.argv[3]!, r.html);
console.log('status', r.status, 'credits', r.creditsUsed, 'bytes', r.html.length);
```
Run from `packages/db` (so `.env` loading matches how the api reads ScrapingBee config — check `configFromEnv` in scrapingbee.ts for the variable name and confirm it is set with `grep -c '^SCRAPINGBEE_API_KEY=' .env`; if the script does not load `.env` itself, run it via `node --env-file=../../.env --import tsx <script>` or the repo's existing pattern — never print the key):
`pnpm exec tsx <script> 'JicYPdAAAAAJ:XXXX' ../shared/test/fixtures/scholar/citation-detail-hinton.html`
Expected: `status 200 credits 15`. Open the file and confirm it is a real detail page (contains the paper title and an "Authors" field — typically `<div class="gsc_oci_field">Authors</div><div class="gsc_oci_value">…</div>`), not a consent/robot wall. Delete the script. **If it is a wall, stop and report — do not retry in a loop.**
Strip nothing from the fixture except you may pretty-break it; it contains only public bibliographic data.

- [ ] **Step 2: Write the failing test** (adjust the expected names to what the captured page actually shows — read them from the file)

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScholarCitationAuthors, buildScholarCitationUrl } from '../src/scholar/citation-detail';

const html = readFileSync(join(__dirname, 'fixtures', 'scholar', 'citation-detail-hinton.html'), 'utf8');

describe('parseScholarCitationAuthors', () => {
  it('reads the complete author list from a real detail page', () => {
    const names = parseScholarCitationAuthors(html);
    expect(names).not.toBeNull();
    expect(names!.length).toBeGreaterThan(7); // the list page showed 7 + "..."
    expect(names).toContain('Geoffrey Hinton'); // replace with the exact form on the page
    expect(names!.every((n) => !n.includes('...'))).toBe(true);
  });
  it('returns null for a page without an Authors field (a wall or a bad page)', () => {
    expect(parseScholarCitationAuthors('<html><body>Please show you are not a robot</body></html>')).toBeNull();
    expect(parseScholarCitationAuthors('')).toBeNull();
  });
});

describe('buildScholarCitationUrl', () => {
  it('targets the citation view for the profile and paper', () => {
    expect(buildScholarCitationUrl('JicYPdAAAAAJ', 'JicYPdAAAAAJ:VN7nJs4JPk0C')).toBe(
      'https://scholar.google.com/citations?view_op=view_citation&hl=en&user=JicYPdAAAAAJ&citation_for_view=JicYPdAAAAAJ%3AVN7nJs4JPk0C',
    );
  });
});
```
Run: `pnpm --filter @kku/shared exec vitest run test/scholar-citation-detail.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `packages/shared/src/scholar/citation-detail.ts` (adjust the regex to the captured markup if it differs; keep it a field-label match, not a position match):
```ts
// Google Scholar's per-paper "view_citation" page carries the complete author
// list, unlike the profile list page, which shortens long lists with "...".
// A /citations path classifies as a 15-credit profile-kind request
// (costs.ts), so no stealth proxy is used.
import { htmlToText } from './html-text';

const AUTHORS_FIELD_RE =
  /<div class="gsc_oci_field">\s*(?:Authors|Inventors)\s*<\/div>\s*<div class="gsc_oci_value">([\s\S]*?)<\/div>/;

/** The complete author list, or null when the page has no Authors field. */
export function parseScholarCitationAuthors(html: string): string[] | null {
  const raw = AUTHORS_FIELD_RE.exec(html)?.[1];
  if (!raw) return null;
  const names = htmlToText(raw)
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return names.length > 0 ? names : null;
}

export function buildScholarCitationUrl(profileId: string, scholarPaperId: string): string {
  const url = new URL('https://scholar.google.com/citations');
  url.searchParams.set('view_op', 'view_citation');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('user', profileId);
  url.searchParams.set('citation_for_view', scholarPaperId);
  return url.toString();
}
```
Add `export * from './citation-detail';` to `packages/shared/src/scholar/index.ts`.

- [ ] **Step 4: Tests, typecheck, commit**

Run the test → PASS; `pnpm --filter @kku/shared typecheck`.
```bash
git add packages/shared/src/scholar/citation-detail.ts packages/shared/src/scholar/index.ts packages/shared/test/scholar-citation-detail.test.ts packages/shared/test/fixtures/scholar/citation-detail-hinton.html
git commit -F <msg>   # feat(scholar): read a paper's full author list from its detail page
```

---

### Task 3: `research_outputs.scholar_authors` column

**Files:** `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/20261001100000_research_output_scholar_authors/migration.sql`

- [ ] **Step 1:** In `model ResearchOutput`, after `kkuAuthorName`, add:
```prisma
  /// Google Scholar author list for source='google-scholar' rows:
  /// { names: string[], complete: boolean, fetchedAt: string }. `complete` is
  /// false while only the list page's shortened line is known.
  scholarAuthors      Json?              @map("scholar_authors")
```
- [ ] **Step 2:** Migration:
```sql
-- HAND-WRITTEN. Additive only: Google Scholar author lists on research outputs.
-- AlterTable
ALTER TABLE "research_outputs" ADD COLUMN "scholar_authors" JSONB;
```
- [ ] **Step 3:** Apply and check:
```bash
pnpm db:migrate
pnpm --filter @kku/db exec prisma generate
pnpm --filter @kku/db exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > "$SCRATCH/drift.sql"; grep -c scholar_authors "$SCRATCH/drift.sql"
pnpm --filter @kku/db exec vitest run test/migration-linter.test.ts
```
Expected: applied; grep `0`; linter PASS. Delete `$SCRATCH/drift.sql`.
- [ ] **Step 4:** Commit `feat(db): research outputs can hold a Google Scholar author list`.

---

### Task 4: Sync writes author lines and fetches shortened lists once

**Files:**
- Modify: `packages/db/src/scholar-fetch.ts`
- Test: `packages/db/test/scholar-fetch.test.ts`

Read `applyMergePlan` (~line 968), `runScholarFetch` (~1152), `fetchAllPages` (~661), `addCredits` (~623) and `ScholarFetchResult` (~235) first. **No `delete` substring anywhere in this file.**

- [ ] **Step 1: Write the failing tests** — add a `describe('author lists', …)` to `packages/db/test/scholar-fetch.test.ts`, reusing its existing `routedFetcher`/`page`/`row` helpers and prisma mocks. Add to the hoisted mocks and the mocked prisma object: `researchOutputUpdate: vi.fn()` as `researchOutput.update`, and default it to resolve `{}` in `beforeEach`. Note the file's `row()` helper always emits `<div class="gs_gray">A Author, B Author</div>`; add an optional `authors?: string` parameter to it (default `'A Author, B Author'`) so tests can emit a shortened line.

Tests (adapt helper names to the file's real ones):
```ts
describe('author lists', () => {
  it('writes the list-page author line on new rows', async () => {
    // one profile page with one row whose line is complete
    // → createMany data[0].scholarAuthors equals { names: ['A Author','B Author'], complete: true, fetchedAt: <ISO> }
  });

  it('fetches the detail page only for shortened rows, once, and stores the full list', async () => {
    // existing row in researchOutputFindMany for the shortened paper with scholarAuthors { complete:false }
    // second findMany (the shortened-rows query) returns that row
    // fetcher: profile page as usual; detail URL (contains view_op=view_citation) returns
    //   '<div class="gsc_oci_field">Authors</div><div class="gsc_oci_value">A Author, B Author, C Author</div>' with creditsUsed 15
    // expect researchOutput.update called once with data.scholarAuthors { names:[A,B,C], complete:true, fetchedAt }
    // expect result.creditsUsed to include the 15 detail credits; result.authorListsCompleted === 1
  });

  it('never fetches a row whose list is already complete', async () => {
    // shortened-rows query returns [] → fetcher never called with view_op=view_citation
  });

  it('caps detail fetches at 20 per sync and reports the rest as pending', async () => {
    // shortened-rows query: the runner asks for take 21 (cap + 1) — return 21 rows
    // expect exactly 20 detail fetches; result.authorListsPending === 1
  });

  it('a failed or unreadable detail page leaves the row shortened and the run successful', async () => {
    // detail fetch throws for one row, returns a wall page (no Authors field) for another
    // expect no update for either, result.status SUCCEEDED, authorListsPending counts both
  });

  it('never replaces a complete stored list with a shortened list-page line', async () => {
    // existing row has scholarAuthors { complete:true, names:[A,B,C] }; list page shows "A Author, B Author, ..."
    // expect no update writing complete:false for that row
  });
});
```
Write each test fully against the file's helpers (the bodies above are the assertions to implement — make them concrete code, not comments).

Run: `pnpm --filter @kku/db exec vitest run test/scholar-fetch.test.ts` → the new tests FAIL.

- [ ] **Step 2: Implement** in `packages/db/src/scholar-fetch.ts`:

1. Constants near the others:
```ts
/** Detail pages fetched per sync for papers whose author list Scholar shortened. */
export const SCHOLAR_AUTHOR_DETAIL_CAP = 20;
```
2. A value builder:
```ts
interface StoredScholarAuthors { names: string[]; complete: boolean; fetchedAt: string }

function scholarAuthorsValue(names: string[], complete: boolean, now: Date): StoredScholarAuthors {
  return { names, complete, fetchedAt: now.toISOString() };
}

function isCompleteStored(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { complete?: unknown }).complete === true;
}
```
3. In `applyMergePlan`: add `scholarAuthors: true, scholarPaperId: true` to the existing-rows `select`; on each insert row add
   `scholarAuthors: p.authors ? scholarAuthorsValue(p.authors.names, p.authors.complete, now) : undefined` (use the runner's `now` seam — thread it in as a parameter if needed);
   and, inside the same `$transaction` array, for every usable paper that matches an existing row by `scholarPaperId` whose stored value is NOT complete and whose new line is non-null, push
```ts
prisma.researchOutput.updateMany({
  where: { facultyMemberId: memberId, scholarPaperId: p.scholarPaperId, source: SOURCE },
  data: { scholarAuthors: scholarAuthorsValue(p.authors.names, p.authors.complete, now) },
}),
```
   (Never for rows whose stored list is complete.) Keep the existing comment that title/venue/year/source are never touched, and add "scholarAuthors only ever moves from absent/shortened to a line or a complete list".
4. A detail phase function:
```ts
interface AuthorDetailOutcome { completed: number; pending: number }

async function completeShortenedAuthorLists(input: {
  memberId: string;
  profileId: string;
  fetchPage: ScholarPageFetcher;
  progress: ScholarFetchProgress;
  now: Date;
}): Promise<AuthorDetailOutcome> {
  const rows = await prisma.researchOutput.findMany({
    where: {
      facultyMemberId: input.memberId,
      source: SOURCE,
      scholarPaperId: { not: null },
      scholarAuthors: { path: ['complete'], equals: false },
    },
    select: { id: true, scholarPaperId: true },
    orderBy: { year: 'desc' },
    take: SCHOLAR_AUTHOR_DETAIL_CAP + 1,
  });
  const batch = rows.slice(0, SCHOLAR_AUTHOR_DETAIL_CAP);
  let completed = 0;
  for (const row of batch) {
    try {
      const page = await input.fetchPage(buildScholarCitationUrl(input.profileId, row.scholarPaperId!));
      addCredits(input.progress, page.creditsUsed);
      const names = parseScholarCitationAuthors(page.html);
      if (!names) continue;
      await prisma.researchOutput.update({
        where: { id: row.id },
        data: { scholarAuthors: scholarAuthorsValue(names, true, input.now) },
      });
      completed += 1;
    } catch (err) {
      console.warn(`[scholar-fetch] author detail page failed for row=${row.id}:`, describeError(err));
    }
  }
  return { completed, pending: rows.length - completed };
}
```
   (`pending` = shortened rows still incomplete after this sync, including the one beyond the cap and any failures. Import `buildScholarCitationUrl` and `parseScholarCitationAuthors` from `@kku/shared` — check how this file already imports scholar helpers (it deep-imports some from `@kku/shared/src/scholar/...`) and follow the same style.)
5. In `runScholarFetch`, after `applyMergePlan` and BEFORE `expireStaffPublicationsCache` and the notes/finalise block, call it with the bound profile id and the run's `progress`; wrap so any throw from the phase itself is caught and logged (never fails the run). Add `authorListsCompleted` and `authorListsPending` (numbers) to `ScholarFetchResult` and return them on the success path (0 / 0 on refusal/failure paths). Do NOT add a run note for pending lists (notes flip status to PARTIAL).
6. `creditsUsed` reported to `finaliseRun` and the result already reads `progress.creditsUsed`, so detail credits are included.

- [ ] **Step 3: Tests**

Run: `pnpm --filter @kku/db exec vitest run test/scholar-fetch.test.ts` → PASS (all old + new). `pnpm --filter @kku/db test`, `pnpm --filter @kku/db typecheck`. Run the CI gate locally: `grep -nE "delete|deleteMany" packages/db/src/scholar-fetch.ts packages/db/src/scholar-console.ts` → no output.

- [ ] **Step 4: Mutation checks, then commit**

(a) Remove the `.slice(0, SCHOLAR_AUTHOR_DETAIL_CAP)` (iterate `rows`) → the cap test FAILS. (b) Make the merge update ignore `isCompleteStored` → the "never replaces a complete list" test FAILS. Revert both.
Commit `feat(scholar): complete shortened author lists from each paper's detail page, once`.

---

### Task 5: Dev backfill from the archived page

**Files:** Create `packages/db/scripts/scholar-authors-backfill.ts`

Dev-only (production has no Scholar rows — the fetch was never deployed). Do not add it to the ingestion esbuild targets.

- [ ] **Step 1: Write the script**
```ts
// Dev-only: populate research_outputs.scholar_authors for existing
// google-scholar rows by re-parsing each member's most recent archived
// Scholar fetch (scholar_fetch_archives), so no pages are scraped again.
//   pnpm --filter @kku/db exec tsx scripts/scholar-authors-backfill.ts          (dry run)
//   pnpm --filter @kku/db exec tsx scripts/scholar-authors-backfill.ts --apply
import { Prisma } from '@prisma/client';
import { parseScholarPublications } from '@kku/shared';
import { prisma } from '../src/index';

// Must equal ARCHIVE_PAGE_BREAK in src/scholar-fetch.ts.
const PAGE_BREAK = '\n<!-- kku:scholar-page-break -->\n';
const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const archives = await prisma.scholarFetchArchive.findMany({
    orderBy: { createdAt: 'desc' },
    select: { rawPayload: true, fetchRun: { select: { facultyMemberId: true } } },
  });
  const members = new Set<string>();
  let rows = 0;
  for (const archive of archives) {
    const memberId = archive.fetchRun.facultyMemberId;
    if (!memberId || members.has(memberId)) continue; // newest archive per member only
    members.add(memberId);
    const papers = archive.rawPayload.split(PAGE_BREAK).flatMap((html) => parseScholarPublications(html));
    for (const p of papers) {
      if (!p.authors) continue;
      const where: Prisma.ResearchOutputWhereInput = {
        facultyMemberId: memberId,
        scholarPaperId: p.scholarPaperId,
        source: 'google-scholar',
        scholarAuthors: { equals: Prisma.DbNull },
      };
      if (apply) {
        const result = await prisma.researchOutput.updateMany({
          where,
          data: {
            scholarAuthors: { names: p.authors.names, complete: p.authors.complete, fetchedAt: new Date().toISOString() },
          },
        });
        rows += result.count;
      } else {
        rows += await prisma.researchOutput.count({ where });
      }
    }
  }
  console.log(`${apply ? 'updated' : 'would update'} ${rows} row(s) across ${members.size} member(s)`);
  if (apply && members.size > 0) {
    // The epoch is PUBLICATIONS_CACHE_INVALIDATED_MS: the next profile load recomputes.
    await prisma.staffPublicationsCache.updateMany({
      where: { facultyMemberId: { in: [...members] } },
      data: { fetchedAt: new Date(0) },
    });
  }
  await prisma.$disconnect();
}

void main();
```
`packages/db/scripts/` is outside the package tsconfig's `include`; typecheck the file once with a temporary tsconfig in the scratchpad that extends `packages/db/tsconfig.json` and includes it (then remove the temp file), and report the result.

- [ ] **Step 2: Run on dev**

Dry run → expect `would update 22 row(s) across 1 member(s)` (denpong's 22 Scholar rows; fewer if some lack a line). Then `--apply`. Verify:
```sql
SELECT count(*) FILTER (WHERE scholar_authors IS NOT NULL) AS with_line,
       count(*) FILTER (WHERE (scholar_authors->>'complete')::boolean IS FALSE) AS shortened
FROM research_outputs WHERE faculty_member_id = 'cmonqt19901it2feejnr8ymwe' AND source = 'google-scholar';
```
Record both numbers in the report.

- [ ] **Step 3: Commit** `chore(scholar): dev backfill of author lines from the archived fetch`.

---

### Task 6: Profile builder uses stored Scholar authors

**Files:**
- Modify: `packages/db/src/staff-profile/profile.ts`
- Test: `packages/db/test/staff-profile-scholar-authors.test.ts`

- [ ] **Step 1: Write the failing test.** `dedupePublications` and `mergeAndEnrichPublications` are private; export a small pure helper and test it, and pin the pass-2 behaviour with a source-scan assertion:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authorsFromScholarColumn } from '../src/staff-profile/profile';

describe('authorsFromScholarColumn', () => {
  it('turns a stored complete list into AuthorName[]', () => {
    expect(authorsFromScholarColumn({ names: ['GE Hinton', 'A Krizhevsky'], complete: true, fetchedAt: 'x' })).toEqual({
      authors: [
        { family: 'Hinton', given: null, initials: 'G.E.' },
        { family: 'Krizhevsky', given: null, initials: 'A.' },
      ],
      complete: true,
    });
  });
  it('keeps a shortened list marked incomplete', () => {
    expect(authorsFromScholarColumn({ names: ['D Soodphakdee'], complete: false, fetchedAt: 'x' })?.complete).toBe(false);
  });
  it('returns null for anything that is not a stored list', () => {
    for (const v of [null, undefined, 'x', { names: 'a' }, { names: [], complete: true }]) {
      expect(authorsFromScholarColumn(v)).toBeNull();
    }
  });
});

describe('the DOI-bridge pass keeps authors already known', () => {
  it('does not reset a paper whose authors came from Scholar', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'staff-profile', 'profile.ts'), 'utf8');
    expect(src).not.toMatch(/\{\s*\.\.\.p,\s*authors:\s*\[\],\s*authorsAreComplete:\s*false\s*\}/);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement**
- Import `parseScholarAuthorName` from `@kku/shared`.
- Add and export:
```ts
/** A research_outputs.scholar_authors value as AuthorName[], or null when absent or malformed. */
export function authorsFromScholarColumn(value: unknown): { authors: AuthorName[]; complete: boolean } | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as { names?: unknown; complete?: unknown };
  if (!Array.isArray(v.names) || v.names.length === 0 || !v.names.every((n) => typeof n === 'string')) return null;
  return { authors: (v.names as string[]).map(parseScholarAuthorName), complete: v.complete === true };
}
```
- `ResearchOutputRow`: add `scholarAuthors: unknown;` (Prisma `JsonValue`).
- `dedupePublications`: in the pushed object replace `authors: [], authorsAreComplete: false` with
```ts
        ...(() => {
          const scholar = canonical.source === SCHOLAR_RESEARCH_OUTPUT_SOURCE ? authorsFromScholarColumn(canonical.scholarAuthors) : null;
          return scholar ? { authors: scholar.authors, authorsAreComplete: scholar.complete } : { authors: [], authorsAreComplete: false };
        })(),
```
  (or the equivalent with a local variable above `out.push` — prefer the local variable for readability).
- In `mergeAndEnrichPublications` pass 2, the miss branch currently pushes `{ ...p, authors: [], authorsAreComplete: false }` — replace with `out.push(p)` (dedupe already yields `[]`/false for papers without a Scholar list), keeping its comment accurate. Pass 4 already skips papers with authors, so a shortened Scholar list is not overwritten by the title search.
- Add `export { authorsFromScholarColumn }` to `packages/db/src/staff-profile/index.ts` only if the test imports it from there; the test above imports the module directly, so no barrel change is needed.

- [ ] **Step 3: Tests, typecheck, characterisation**

Run the new test → PASS; `pnpm --filter @kku/db test`; db/web/api typecheck. Then check denpong's list end to end (restart nothing; this is a direct call):
```bash
cd apps/api && pnpm exec tsx -e "import('@kku/db').then(async (db) => { const p = await db.buildStaffProfile('cmonqt19901it2feejnr8ymwe', { courseLimit: 10, includeTalent: false }); const s = p.publications.filter(x => x.source === 'google-scholar'); console.log('scholar', s.length, 'with authors', s.filter(x => x.authors.length).length, 'complete', s.filter(x => x.authorsAreComplete).length); await db.prisma.\$disconnect(); })"
```
Expected after Task 5's backfill: every Scholar paper with a stored line has authors (was 5 of 22).

- [ ] **Step 4: Mutation check, commit** — restore the pass-2 reset line → the source-scan test FAILS; revert. Commit `fix(profile): Google Scholar papers show the authors Scholar lists`.

---

### Task 7: Publication metadata row; remove Top venues

**Files:**
- Create: `apps/web/src/lib/publication-meta.ts`, `apps/web/app/profile/publication-meta-row.tsx`
- Modify: `apps/web/app/profile/profile-view.tsx`
- Test: `apps/web/test/publication-meta.test.ts`, `apps/web/test/publication-meta-row-render.test.tsx`

DOI stays in the APA citation line (APA requires it, and the line already links it); the metadata row carries Scopus and PubMed links only, so no identifier is shown twice.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/publication-meta.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { authorStatus, publicationTypeLabel, scopusRecordUrl, sourceLabel } from '@/lib/publication-meta';

describe('publicationTypeLabel', () => {
  it('labels real types and hides the Scholar placeholder', () => {
    expect(publicationTypeLabel('JOURNAL', 'openalex', 'en')).toBe('Journal article');
    expect(publicationTypeLabel('CONFERENCE', 'kku-publications:scopus', 'th')).toBe('บทความประชุมวิชาการ');
    expect(publicationTypeLabel('JOURNAL', 'google-scholar', 'en')).toBeNull();
  });
  it('never shows a source name as a type', () => {
    for (const t of ['scopus', 'pubmed', 'isi', 'tci', 'whatever']) expect(publicationTypeLabel(t, 'live:scopus', 'en')).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('names where a record came from', () => {
    expect(sourceLabel('google-scholar')).toBe('Google Scholar');
    expect(sourceLabel('kku-publications:scopus')).toBe('Scopus');
    expect(sourceLabel('kku-publications:pubmed')).toBe('PubMed');
    expect(sourceLabel('openalex')).toBe('OpenAlex');
    expect(sourceLabel('live:isi')).toBe('Web of Science');
    expect(sourceLabel('live:tci')).toBe('TCI');
    expect(sourceLabel(null)).toBeNull();
  });
});

describe('scopusRecordUrl', () => {
  it('builds a record link from either id form', () => {
    expect(scopusRecordUrl('2-s2.0-85012345678')).toBe('https://www.scopus.com/record/display.uri?eid=2-s2.0-85012345678&origin=resultslist');
    expect(scopusRecordUrl('85012345678')).toBe('https://www.scopus.com/record/display.uri?eid=2-s2.0-85012345678&origin=resultslist');
  });
});

describe('authorStatus', () => {
  it('distinguishes complete, shortened and unavailable', () => {
    expect(authorStatus({ authors: [{ family: 'A', given: null, initials: null }], authorsAreComplete: true, source: 'openalex' })).toBe('complete');
    expect(authorStatus({ authors: [{ family: 'A', given: null, initials: null }], authorsAreComplete: false, source: 'google-scholar' })).toBe('shortened');
    expect(authorStatus({ authors: [], authorsAreComplete: false, source: 'google-scholar' })).toBe('unavailable');
  });
});
```

`apps/web/test/publication-meta-row-render.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicationMetaRow } from '../app/profile/publication-meta-row';
import type { PublicationEntry } from '@/lib/profile-types';

const base: PublicationEntry = {
  id: 'p1', year: 2022, title: 'T', venue: null, citations: 12, doi: null, scopusId: '85012345678', pmid: '123',
  openalexId: null, type: 'JOURNAL', kkuAuthors: [], authors: [{ family: 'A', given: null, initials: null }],
  authorsAreComplete: true, source: 'openalex', scholarPaperId: null,
};

const render = (p: Partial<PublicationEntry>, lang: 'th' | 'en' = 'en') =>
  renderToStaticMarkup(<PublicationMetaRow pub={{ ...base, ...p }} lang={lang} />);

describe('PublicationMetaRow', () => {
  it('shows year, type chip, citations as text (not a chip), source and identifier links', () => {
    const html = render({});
    expect(html).toContain('2022');
    expect(html).toContain('data-meta="type"');
    expect(html).toContain('Journal article');
    expect(html).toMatch(/data-meta="citations"[^>]*>[\s\S]*Cited by 12/);
    expect(html).not.toMatch(/data-meta="citations"[^>]*rounded-full/);
    expect(html).toContain('OpenAlex');
    expect(html).toContain('scopus.com/record/display.uri');
    expect(html).toContain('pubmed.ncbi.nlm.nih.gov/123/');
  });
  it('hides the type for Google Scholar rows and citations at zero', () => {
    const html = render({ source: 'google-scholar', citations: 0 });
    expect(html).not.toContain('data-meta="type"');
    expect(html).not.toContain('Cited by');
    expect(html).toContain('Google Scholar');
  });
  it('states author status only when it is not complete', () => {
    expect(render({})).not.toContain('data-meta="authors"');
    expect(render({ source: 'google-scholar', authorsAreComplete: false })).toContain('list shortened by Google Scholar');
    expect(render({ authors: [], authorsAreComplete: false })).toContain('co-authors unavailable');
  });
  it('speaks Thai when asked', () => {
    expect(render({}, 'th')).toContain('อ้างอิง');
  });
});
```
Run: `pnpm --filter web exec vitest run test/publication-meta.test.ts test/publication-meta-row-render.test.tsx` → FAIL (modules missing).

- [ ] **Step 2: Implement `apps/web/src/lib/publication-meta.ts`** (pure, no imports except `import type`):
```ts
// Labels and links for one publication's metadata row on /profile.
// Client-safe: pure functions, type-only imports.
import type { AuthorName } from '@/lib/profile-types';

type Lang = 'th' | 'en';

const TYPE_LABELS: Record<string, { en: string; th: string }> = {
  JOURNAL: { en: 'Journal article', th: 'บทความวารสาร' },
  CONFERENCE: { en: 'Conference paper', th: 'บทความประชุมวิชาการ' },
  BOOK: { en: 'Book', th: 'หนังสือ' },
  PATENT: { en: 'Patent', th: 'สิทธิบัตร' },
};

/** Null when the type is unknown, is really a source name, or the record is a
 *  Google Scholar row (Scholar states no type; the stored JOURNAL is a placeholder). */
export function publicationTypeLabel(type: string, source: string | null, lang: Lang): string | null {
  if (source === 'google-scholar') return null;
  return TYPE_LABELS[type]?.[lang] ?? null;
}

const SOURCE_LABELS: Record<string, string> = {
  'google-scholar': 'Google Scholar',
  scopus: 'Scopus',
  pubmed: 'PubMed',
  isi: 'Web of Science',
  tci: 'TCI',
  openalex: 'OpenAlex',
};

export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const key = source.replace(/^live:/, '').replace(/^kku-publications:/, '');
  return SOURCE_LABELS[key] ?? key;
}

export function scopusRecordUrl(scopusId: string): string {
  const eid = scopusId.startsWith('2-s2.0-') ? scopusId : `2-s2.0-${scopusId}`;
  return `https://www.scopus.com/record/display.uri?eid=${eid}&origin=resultslist`;
}

export type AuthorStatus = 'complete' | 'shortened' | 'unavailable';

export function authorStatus(p: { authors: AuthorName[]; authorsAreComplete: boolean; source: string | null }): AuthorStatus {
  if (p.authors.length === 0) return 'unavailable';
  return p.authorsAreComplete ? 'complete' : 'shortened';
}
```

- [ ] **Step 3: Implement `apps/web/app/profile/publication-meta-row.tsx`** (no `'use client'` needed — it has no state; it is rendered inside the client `ProfileView`). Use lucide icons already used in the repo (`FileText`, `Quote`, `ExternalLink`):
```tsx
import { ExternalLink, FileText, Quote } from 'lucide-react';
import type { PublicationEntry } from '@/lib/profile-types';
import { authorStatus, publicationTypeLabel, scopusRecordUrl, sourceLabel } from '@/lib/publication-meta';

type Lang = 'th' | 'en';

const L = {
  en: { cited: (n: number) => `Cited by ${n}`, shortened: 'list shortened by Google Scholar — full list on next sync', incomplete: 'author list incomplete', unavailable: 'co-authors unavailable' },
  th: { cited: (n: number) => `อ้างอิง ${n} ครั้ง`, shortened: 'Google Scholar แสดงรายชื่อผู้แต่งไม่ครบ — จะดึงรายชื่อเต็มในการซิงก์ครั้งถัดไป', incomplete: 'รายชื่อผู้แต่งไม่ครบ', unavailable: 'ไม่มีข้อมูลผู้แต่งร่วม' },
} as const;

function Sep() {
  return <span aria-hidden className="text-text-tertiary">·</span>;
}

export function PublicationMetaRow({ pub, lang }: { pub: PublicationEntry; lang: Lang }) {
  const l = L[lang];
  const type = publicationTypeLabel(pub.type, pub.source ?? null, lang);
  const source = sourceLabel(pub.source ?? null);
  const status = authorStatus({ authors: pub.authors, authorsAreComplete: pub.authorsAreComplete, source: pub.source ?? null });
  return (
    <div className="mt-2 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-tertiary">
        <span className="tabular-nums text-text-secondary">{pub.year}</span>
        {type && (
          <>
            <Sep />
            <span data-meta="type" className="inline-flex items-center gap-1 rounded-full border border-default px-2 py-[1px] text-text-secondary">
              <FileText className="h-[12px] w-[12px]" aria-hidden />
              {type}
            </span>
          </>
        )}
        {pub.citations > 0 && (
          <>
            <Sep />
            <span data-meta="citations" className="inline-flex items-center gap-1 font-medium text-accent-default">
              <Quote className="h-[12px] w-[12px]" aria-hidden />
              {l.cited(pub.citations)}
            </span>
          </>
        )}
        {source && (
          <>
            <Sep />
            <span data-meta="source">{source}</span>
          </>
        )}
        {(pub.scopusId || pub.pmid) && (
          <span className="ml-auto inline-flex items-center gap-3">
            {pub.scopusId && (
              <a href={scopusRecordUrl(pub.scopusId)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-default hover:underline">
                Scopus <ExternalLink className="h-[12px] w-[12px]" aria-hidden />
              </a>
            )}
            {pub.pmid && (
              <a href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-default hover:underline">
                PubMed <ExternalLink className="h-[12px] w-[12px]" aria-hidden />
              </a>
            )}
          </span>
        )}
      </div>
      {status !== 'complete' && (
        <div data-meta="authors" className="italic text-text-tertiary">
          {status === 'unavailable' ? l.unavailable : pub.source === 'google-scholar' ? l.shortened : l.incomplete}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `profile-view.tsx` and remove Top venues**
- `PublicationsSection` receives `lang` — add `lang: Lang` to its props and pass `lang={lang}` where it is rendered.
- Replace the whole pill-row `<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">…</div>` (the block containing `(co-authors could not be fetched)`) with `<PublicationMetaRow pub={p} lang={lang} />`, importing it from `./publication-meta-row`.
- Delete the Top venues block from `ResearchSummarySection` (the `{research.topVenues.length > 0 && (…)}` element). If `Badge` becomes unused in the file, remove it from the import.
- Grep the file afterwards: `grep -n "co-authors could not be fetched\|Top venues" apps/web/app/profile/profile-view.tsx` → no output.

- [ ] **Step 5: Tests, lint, class coverage, commit**
Run the two new tests → PASS; `pnpm --filter web test`; `pnpm --filter web typecheck`; `pnpm exec eslint apps/web/app/profile/publication-meta-row.tsx apps/web/src/lib/publication-meta.ts apps/web/app/profile/profile-view.tsx`.
Class coverage: compile the stylesheet with the web Tailwind config limited to `publication-meta-row.tsx` and confirm every class token has a selector (method: a temp config in the scratchpad extending `apps/web/tailwind.config.ts` with `content` set to the file; `pnpm --filter web exec tailwindcss -c <tmp> -o <tmp.css>`; script the token check). Report the count; fix any class with no selector.
Mutation: change the Scholar guard in `publicationTypeLabel` to `false &&` → the Scholar-type tests FAIL; revert.
Commit `feat(profile): a readable publication metadata row, and no Top venues panel`.

---

### Task 8: Evaluation summary — pure aggregation and server loader

**Files:**
- Create: `apps/web/src/lib/teaching-evaluation-summary.ts`
- Modify: `apps/web/src/lib/profile-data.ts`
- Test: `apps/web/test/teaching-evaluation-summary.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from 'vitest';
import { evaluationRadarDomain, summariseTeachingEvaluation } from '@/lib/teaching-evaluation-summary';
import type { InstructorPersonalResult } from '@kku/db';

const q = (themeTag: string | null, ratingAvg: number, respondentCount: number, byYear: Record<string, { ratingAvg: number; respondentCount: number }>) => ({
  questionId: Math.random().toString(), questionIdRegistrar: 'Q', questionTextTh: 'q', questionTextEn: null, themeTag,
  ratingAvg, cellCount: 1, respondentCount, byYear,
});

const result: InstructorPersonalResult = {
  methodologyVersion: 'kku-evaluations.v1',
  summary: { ratingAvg: 4.35, totalRespondents: 400, cellCount: 8, courseCount: 2, questionCount: 4, semestersObserved: 4 },
  trend: [
    { acadYearBE: 2567, semester: 1, label: 'BE 2567 / S1', ratingAvg: 4.2, respondentCount: 100, cellCount: 2, courseCount: 1 },
    { acadYearBE: 2567, semester: 2, label: 'BE 2567 / S2', ratingAvg: 4.4, respondentCount: 100, cellCount: 2, courseCount: 1 },
    { acadYearBE: 2568, semester: 1, label: 'BE 2568 / S1', ratingAvg: 4.6, respondentCount: 150, cellCount: 2, courseCount: 2 },
    { acadYearBE: 2568, semester: 2, label: 'BE 2568 / S2', ratingAvg: null, respondentCount: 0, cellCount: 0, courseCount: 0 },
  ],
  byQuestion: [
    q('active-learning', 4.4, 100, { '2567': { ratingAvg: 4.2, respondentCount: 50 }, '2568': { ratingAvg: 4.6, respondentCount: 50 } }),
    q('active-learning', 4.2, 300, { '2567': { ratingAvg: 4.0, respondentCount: 150 }, '2568': { ratingAvg: 4.4, respondentCount: 150 } }),
    q('ethics', 4.5, 100, { '2567': { ratingAvg: 4.5, respondentCount: 100 } }),
    q(null, 4.0, 100, { '2568': { ratingAvg: 4.0, respondentCount: 100 } }),
  ],
  byCourse: [],
};

describe('summariseTeachingEvaluation', () => {
  const s = summariseTeachingEvaluation(result, '2026-09-30T00:00:00.000Z')!;

  it('carries the overall KPIs', () => {
    expect(s.overall).toBeCloseTo(4.35);
    expect(s.totalAnswers).toBe(400);
    expect(s.courseCount).toBe(2);
    expect(s.termCount).toBe(3); // terms with answers; BE 2568 S2 has none
    expect([s.firstYearBE, s.lastYearBE]).toEqual([2567, 2568]);
  });

  it('rates the latest and previous academic year, respondent-weighted across terms with data', () => {
    expect(s.latestYearBE).toBe(2568);
    expect(s.latestRating).toBeCloseTo(4.6); // S2 has no data and is excluded
    expect(s.previousYearBE).toBe(2567);
    expect(s.previousRating).toBeCloseTo(4.3);
  });

  it('weights category scores by respondents, all-time and latest year', () => {
    const al = s.categories.find((c) => c.tag === 'active-learning')!;
    expect(al.allTime).toBeCloseTo((4.4 * 100 + 4.2 * 300) / 400);
    expect(al.latest).toBeCloseTo((4.6 * 50 + 4.4 * 150) / 200);
    expect(al.questions).toBe(2);
  });

  it('reports a category with no answers in the latest year as null, never 0', () => {
    expect(s.categories.find((c) => c.tag === 'ethics')!.latest).toBeNull();
  });

  it('counts untagged questions without giving them an axis', () => {
    expect(s.untaggedQuestions).toBe(1);
    expect(s.categories.map((c) => c.tag)).toEqual(['active-learning', 'ethics']);
  });

  it('returns null when there are no answers at all', () => {
    expect(summariseTeachingEvaluation({ ...result, summary: { ...result.summary, totalRespondents: 0 } }, null)).toBeNull();
  });
});

describe('evaluationRadarDomain', () => {
  it('starts at 3 unless a plotted value is lower, then floors to the half point below it', () => {
    expect(evaluationRadarDomain([4.2, 4.6, null])).toEqual([3, 5]);
    expect(evaluationRadarDomain([2.7, 4.1])).toEqual([2.5, 5]);
    expect(evaluationRadarDomain([null])).toEqual([3, 5]);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `apps/web/src/lib/teaching-evaluation-summary.ts`** (type-only imports; safe to import into client code):
```ts
// Aggregates instructorPersonal() output into what the /profile evaluation
// panel shows: KPIs, the latest vs previous academic year, and a respondent-
// weighted score per question category (themeTag) all-time and for the latest
// year. Pure; type-only imports.
import type { InstructorPersonalResult } from '@kku/db';

export const EVALUATION_THEME_ORDER = [
  'active-learning', 'ethics', 'assessment', 'feedback', 'content-design', 'english-skills',
] as const;

export const EVALUATION_THEME_LABELS: Record<string, { en: string; th: string }> = {
  'active-learning': { en: 'Active learning', th: 'การเรียนรู้เชิงรุก' },
  ethics: { en: 'Ethics', th: 'คุณธรรมจริยธรรม' },
  assessment: { en: 'Assessment', th: 'การวัดและประเมินผล' },
  feedback: { en: 'Feedback / Q&A', th: 'การให้ข้อมูลย้อนกลับ' },
  'content-design': { en: 'Content & design', th: 'เนื้อหาและการออกแบบ' },
  'english-skills': { en: 'English skills', th: 'ทักษะภาษาอังกฤษ' },
};

export interface EvaluationCategoryScore {
  tag: string;
  questions: number;
  allTime: number | null;
  latest: number | null;
}

export interface TeachingEvaluationSummary {
  overall: number;
  totalAnswers: number;
  courseCount: number;
  termCount: number;
  firstYearBE: number | null;
  lastYearBE: number | null;
  latestYearBE: number | null;
  latestRating: number | null;
  previousYearBE: number | null;
  previousRating: number | null;
  categories: EvaluationCategoryScore[];
  untaggedQuestions: number;
  freshnessDate: string | null;
  methodologyVersion: string;
}

function weighted(pairs: Array<{ value: number; weight: number }>): number | null {
  const total = pairs.reduce((s, p) => s + p.weight, 0);
  return total > 0 ? pairs.reduce((s, p) => s + p.value * p.weight, 0) / total : null;
}

export function summariseTeachingEvaluation(
  r: InstructorPersonalResult,
  freshnessDate: string | null,
): TeachingEvaluationSummary | null {
  if (r.summary.totalRespondents <= 0) return null;

  const termsWithData = r.trend.filter((t) => t.ratingAvg !== null && t.respondentCount > 0);
  const years = [...new Set(termsWithData.map((t) => t.acadYearBE))].sort((a, b) => a - b);
  const latestYearBE = years.at(-1) ?? null;
  const previousYearBE = years.length > 1 ? years.at(-2)! : null;
  const yearRating = (y: number | null): number | null =>
    y === null
      ? null
      : weighted(termsWithData.filter((t) => t.acadYearBE === y).map((t) => ({ value: t.ratingAvg!, weight: t.respondentCount })));

  const byTag = new Map<string, InstructorPersonalResult['byQuestion']>();
  let untaggedQuestions = 0;
  for (const q of r.byQuestion) {
    if (!q.themeTag) { untaggedQuestions += 1; continue; }
    byTag.set(q.themeTag, [...(byTag.get(q.themeTag) ?? []), q]);
  }
  const order = (tag: string) => {
    const i = (EVALUATION_THEME_ORDER as readonly string[]).indexOf(tag);
    return i === -1 ? EVALUATION_THEME_ORDER.length : i;
  };
  const categories = [...byTag.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([tag, qs]) => ({
      tag,
      questions: qs.length,
      allTime: weighted(qs.map((q) => ({ value: q.ratingAvg, weight: q.respondentCount }))),
      latest:
        latestYearBE === null
          ? null
          : weighted(
              qs.flatMap((q) => {
                const y = q.byYear[String(latestYearBE)];
                return y ? [{ value: y.ratingAvg, weight: y.respondentCount }] : [];
              }),
            ),
    }));

  return {
    overall: r.summary.ratingAvg,
    totalAnswers: r.summary.totalRespondents,
    courseCount: r.summary.courseCount,
    termCount: termsWithData.length,
    firstYearBE: years[0] ?? null,
    lastYearBE: latestYearBE,
    latestYearBE,
    latestRating: yearRating(latestYearBE),
    previousYearBE,
    previousRating: yearRating(previousYearBE),
    categories,
    untaggedQuestions,
    freshnessDate,
    methodologyVersion: r.methodologyVersion,
  };
}

/** Radial axis for 1–5 ratings: start at 3 unless a plotted value is lower
 *  (then the half point below it), so no point is clipped to the centre. */
export function evaluationRadarDomain(values: Array<number | null>): [number, number] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return [3, 5];
  const min = Math.min(...present);
  return [Math.min(3, Math.floor(min * 2) / 2), 5];
}
```
`termCount` counts terms with answers — a term with none was not observed.

- [ ] **Step 3: Server loader in `apps/web/src/lib/profile-data.ts`**
```ts
import { instructorPersonal, prisma, resolveFacultyMemberForUser } from '@kku/db';
import { summariseTeachingEvaluation, type TeachingEvaluationSummary } from './teaching-evaluation-summary';

/**
 * The signed-in user's own teaching-evaluation summary for the /profile panel.
 * Server-only; never called for /p/[slug]. Visibility: a user's own data
 * (instructorPersonal does no permission check — this function's only caller
 * passes the session's own user id).
 */
export async function getMyTeachingEvaluation(userId: string): Promise<TeachingEvaluationSummary | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true, name: true } });
  if (!user) return null;
  const memberId = await resolveFacultyMemberForUser(user);
  if (!memberId) return null;
  const [result, lastRun] = await Promise.all([
    instructorPersonal(memberId),
    prisma.ingestionRun.findFirst({
      where: { status: 'SUCCEEDED', dataSource: { slug: 'kku-evaluations' } },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    }),
  ]);
  return summariseTeachingEvaluation(result, lastRun?.completedAt?.toISOString() ?? null);
}
```
(Verify the `IngestionRun` → `DataSource` relation field name in schema.prisma; adjust `dataSource` if it differs. Merge the import with the file's existing `@kku/db` import.)

- [ ] **Step 4: Tests, typecheck, commit**
Run the test → PASS; `pnpm --filter web typecheck`. Live sanity check (no server needed): a tsx one-liner from `apps/web` calling `getMyTeachingEvaluation(<denpong user id>)` — expect overall ≈ 4.35, 1,880 answers, 5 categories, 1 untagged. Report the printed numbers.
Commit `feat(profile): summarise a lecturer's own teaching evaluations by category`.

---

### Task 9: Teaching evaluation panel

**Files:**
- Create: `apps/web/app/profile/teaching-evaluation-panel.tsx`
- Modify: `apps/web/app/profile/page.tsx`, `apps/web/app/profile/profile-view.tsx`
- Test: `apps/web/test/teaching-evaluation-panel-render.test.tsx`

`RadarChartSmall` renders a same-size placeholder during SSR (mount guard), so the render test asserts the KPIs, table and notes, not the SVG.

- [ ] **Step 1: Write the failing render test**
```tsx
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeachingEvaluationPanel } from '../app/profile/teaching-evaluation-panel';
import type { TeachingEvaluationSummary } from '@/lib/teaching-evaluation-summary';

const summary: TeachingEvaluationSummary = {
  overall: 4.348, totalAnswers: 1880, courseCount: 1, termCount: 10, firstYearBE: 2564, lastYearBE: 2568,
  latestYearBE: 2568, latestRating: 4.61, previousYearBE: 2567, previousRating: 4.7,
  categories: [
    { tag: 'active-learning', questions: 3, allTime: 4.36, latest: 4.62 },
    { tag: 'ethics', questions: 2, allTime: 4.32, latest: null },
  ],
  untaggedQuestions: 1, freshnessDate: '2026-09-30T00:00:00.000Z', methodologyVersion: 'kku-evaluations.v1',
};

const render = (s: TeachingEvaluationSummary | null, lang: 'th' | 'en' = 'en') =>
  renderToStaticMarkup(<TeachingEvaluationPanel summary={s} lang={lang} />);

describe('TeachingEvaluationPanel', () => {
  it('shows the five KPIs with explicit units', () => {
    const html = render(summary);
    expect(html).toContain('4.35');
    expect(html).toContain('/ 5');
    expect(html).toContain('1,880');
    expect(html).toContain('2564–2568');
    expect(html).toMatch(/−0\.09|-0\.09/); // latest vs previous, signed
  });
  it('lists every category with exact numbers, n/d for a missing year', () => {
    const html = render(summary);
    expect(html).toContain('Active learning');
    expect(html).toContain('4.62');
    expect(html).toContain('4.36');
    expect(html).toContain('n/d');
  });
  it('states the scale floor and the untagged question', () => {
    const html = render(summary);
    expect(html).toContain('Scale starts at 3');
    expect(html).toContain('1 question has no category');
  });
  it('links to the full breakdown', () => {
    expect(render(summary)).toContain('href="/staff/teaching"');
  });
  it('has an empty state', () => {
    const html = render(null);
    expect(html).toContain('No student evaluations recorded yet');
    expect(html).toContain('href="/staff/teaching"');
  });
  it('speaks Thai', () => {
    expect(render(summary, 'th')).toContain('การประเมินการสอนของฉัน');
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `apps/web/app/profile/teaching-evaluation-panel.tsx`**
```tsx
'use client';

import { Card, FreshnessBadge, ProvenanceButton, RadarChartSmall, Section, type RadarPoint } from '@kku/ui';
import { ClipboardCheck } from 'lucide-react';
import {
  EVALUATION_THEME_LABELS,
  evaluationRadarDomain,
  type TeachingEvaluationSummary,
} from '@/lib/teaching-evaluation-summary';

type Lang = 'th' | 'en';

const L = {
  en: {
    title: 'My teaching evaluation', overall: 'Overall', year: (y: number) => `AY ${y}`, vs: (y: number) => `vs AY ${y}`,
    answers: 'Answers', answersHint: 'one per question answered, not students', courses: 'Courses', terms: 'Terms',
    category: 'Category', allTime: 'All-time', latestSeries: (y: number) => `AY ${y}`,
    floor: (f: number) => `Scale starts at ${f}, not 0 — differences look larger than they are.`,
    untagged: (n: number) => `${n} question${n === 1 ? ' has' : 's have'} no category — counted in the overall rating, not plotted.`,
    full: 'Full breakdown by question and course →', empty: 'No student evaluations recorded yet.', nd: 'n/d',
  },
  th: {
    title: 'การประเมินการสอนของฉัน', overall: 'ภาพรวม', year: (y: number) => `ปีการศึกษา ${y}`, vs: (y: number) => `เทียบปี ${y}`,
    answers: 'คำตอบ', answersHint: 'นับต่อข้อที่ตอบ ไม่ใช่จำนวนนักศึกษา', courses: 'รายวิชา', terms: 'ภาคการศึกษา',
    category: 'หมวด', allTime: 'ทุกปี', latestSeries: (y: number) => `ปี ${y}`,
    floor: (f: number) => `แกนเริ่มที่ ${f} ไม่ใช่ 0 — ความต่างจึงดูมากกว่าความจริง`,
    untagged: (n: number) => `มี ${n} ข้อที่ไม่มีหมวด — นับในคะแนนภาพรวม แต่ไม่แสดงในกราฟ`,
    full: 'ดูรายละเอียดรายข้อและรายวิชา →', empty: 'ยังไม่มีผลการประเมินจากนักศึกษา', nd: 'n/d',
  },
} as const;

const fmt = (v: number | null, d = 2) => (v === null ? null : v.toFixed(d));

function Kpi({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-2/40 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-bold tabular-nums leading-none text-text-primary">{value}</span>
        {unit && <span className="ml-1 text-xs text-text-tertiary">{unit}</span>}
        {hint && <div className="mt-1 text-[11px] text-text-tertiary">{hint}</div>}
      </dd>
    </div>
  );
}

export function TeachingEvaluationPanel({ summary, lang }: { summary: TeachingEvaluationSummary | null; lang: Lang }) {
  const l = L[lang];
  const title = (
    <span className="flex items-center gap-2">
      <ClipboardCheck className="h-12 w-12 text-text-tertiary" aria-hidden />
      {l.title}
    </span>
  );
  const fullLink = (
    <a href="/staff/teaching" className="text-sm text-accent-default hover:underline">{l.full}</a>
  );

  if (!summary) {
    return (
      <Section title={title}>
        <Card className="p-5" elevation="lg">
          <p className="text-sm text-text-secondary">{l.empty}</p>
          <div className="mt-3">{fullLink}</div>
        </Card>
      </Section>
    );
  }

  const label = (tag: string) => EVALUATION_THEME_LABELS[tag]?.[lang] ?? tag;
  const latestPoints: RadarPoint[] = summary.categories.map((c) => ({ label: label(c.tag), value: c.latest }));
  const allTimePoints: RadarPoint[] = summary.categories.map((c) => ({ label: label(c.tag), value: c.allTime }));
  const domain = evaluationRadarDomain([...latestPoints, ...allTimePoints].map((p) => p.value));
  const delta =
    summary.latestRating !== null && summary.previousRating !== null ? summary.latestRating - summary.previousRating : null;
  const deltaText =
    delta === null || summary.previousYearBE === null
      ? null
      : `${delta >= 0 ? '▲ +' : '▼ −'}${Math.abs(delta).toFixed(2)} ${l.vs(summary.previousYearBE)}`;

  return (
    <Section title={title}>
      <Card className="p-5" elevation="lg">
        <div className="flex items-center justify-end gap-2">
          <FreshnessBadge freshnessDate={summary.freshnessDate} label="student evaluations" />
          <ProvenanceButton
            size="xs"
            title={l.title}
            meta={{
              freshnessDate: summary.freshnessDate,
              sources: [{ id: 'kku-evaluations', name: 'KKU student course evaluations' }],
              methodologyVersion: summary.methodologyVersion,
              caveats: [
                'Ratings are on a 1–5 scale; category scores are respondent-weighted means of their questions.',
                'Answers count each question answered, not students.',
              ],
            }}
          />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Kpi label={l.overall} value={fmt(summary.overall)!} unit="/ 5" />
          <Kpi
            label={summary.latestYearBE !== null ? l.year(summary.latestYearBE) : l.overall}
            value={fmt(summary.latestRating) ?? '—'}
            unit="/ 5"
            hint={deltaText && <span className={delta! >= 0 ? 'text-success' : 'text-danger'}>{deltaText}</span>}
          />
          <Kpi label={l.answers} value={summary.totalAnswers.toLocaleString('en-US')} hint={l.answersHint} />
          <Kpi label={l.courses} value={String(summary.courseCount)} />
          <Kpi
            label={l.terms}
            value={String(summary.termCount)}
            hint={summary.firstYearBE !== null ? `${summary.firstYearBE}–${summary.lastYearBE}` : undefined}
          />
        </dl>

        {summary.categories.length > 0 && (
          <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start">
            <div className="shrink-0">
              <RadarChartSmall
                points={latestPoints}
                seriesLabel={summary.latestYearBE !== null ? l.latestSeries(summary.latestYearBE) : l.allTime}
                comparisons={[{ label: l.allTime, points: allTimePoints }]}
                domain={domain}
                width={320}
                height={260}
              />
              <p className="mt-1 text-xs text-text-tertiary">{l.floor(domain[0])}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-text-tertiary">
                  <th className="pb-2 font-semibold">{l.category}</th>
                  <th className="pb-2 text-right font-semibold">
                    {summary.latestYearBE !== null ? l.latestSeries(summary.latestYearBE) : '—'}
                  </th>
                  <th className="pb-2 text-right font-semibold">{l.allTime}</th>
                </tr>
              </thead>
              <tbody>
                {summary.categories.map((c) => (
                  <tr key={c.tag} className="border-t border-subtle">
                    <td className="py-2 text-text-primary">{label(c.tag)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.latest) ?? <span className="text-text-tertiary">{l.nd}</span>}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.allTime) ?? <span className="text-text-tertiary">{l.nd}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.untaggedQuestions > 0 && (
          <p className="mt-3 text-xs text-text-tertiary">{l.untagged(summary.untaggedQuestions)}</p>
        )}
        <div className="mt-4 border-t border-subtle pt-3">{fullLink}</div>
      </Card>
    </Section>
  );
}
```
Notes for the implementer: add `import * as React from 'react';` if the file's JSX/`React.ReactNode` needs it; verify `RadarPoint` is exported from `@kku/ui` (it is defined in `packages/ui/src/viz/radar.tsx` — if not re-exported, import the type from there or add it to the viz barrel); verify `Section` and `Card` props match their use on the profile page; `text-success`/`text-danger` (not `-default`) per the preset.

- [ ] **Step 3: Wire it in**
- `apps/web/app/profile/page.tsx`: add `getMyTeachingEvaluation(user.userId)` to the existing `Promise.all` (import from `@/lib/profile-data`), and pass `teachingEvaluation={…}` to `ProfileView`.
- `profile-view.tsx`: add the prop `teachingEvaluation?: TeachingEvaluationSummary | null` (`import type` from `@/lib/teaching-evaluation-summary`); replace the `<a href="/staff/teaching" …>…</a>` link card with `<TeachingEvaluationPanel summary={teachingEvaluation ?? null} lang={lang} />`, keeping it inside the existing `!publicMode && profile.hasFacultyMemberRecord` block. `/p/[slug]` passes nothing, so the panel never appears there.

- [ ] **Step 4: Tests, typecheck, lint, class coverage, compile check, commit**
Run the render test → PASS; `pnpm --filter web test`; `pnpm --filter web typecheck`; eslint on the changed/new files; class coverage for `teaching-evaluation-panel.tsx` (same method as Task 7) → 0 missing; production compile: `cd apps/web && pnpm exec next build` → "✓ Compiled successfully" (it then fails at "Collecting page data" because dev `.env` enables local auth under production — expected).
Mutation: make `evaluationRadarDomain` return `[3, 5]` unconditionally → its test FAILS; revert.
Commit `feat(profile): my teaching evaluation, embedded — KPIs and a category radar`.

---

### Task 10: Live verification on dev (denpong@kku.ac.th)

- [ ] **Step 1:** Full checks: `pnpm --filter @kku/shared test` (4 known failures only), `pnpm --filter @kku/db test`, `pnpm --filter web test`, `pnpm --filter api test`; typecheck shared/db/web/api; CI no-delete grep → no output.
- [ ] **Step 2: One real Scholar sync for denpong (LIVE credits).** Expected cost ≈ 15 × list pages (1) + 15 × shortened papers (≤ 20). Trigger it the way the app does (the `/profile` Scholar panel's sync action, or the existing runner entry used by `apps/api` — read `apps/api/src/scholar/scholar.service.ts` to call the same path from a tsx script with the real ScrapingBee fetcher). Respect the quota: if denpong's 30-day self quota is spent, use the ADMIN trigger path (independent counter) via the same service. Record the run row: status, creditsUsed, authorListsCompleted, authorListsPending.
- [ ] **Step 3:** Re-run the Task 6 one-liner → every Scholar paper has authors; complete count rose by `authorListsCompleted`.
- [ ] **Step 4:** Restart the dev servers, then confirm in a tsx call that `getProfileData(<denpong user id>)` publications contain no paper with `authors.length === 0` from Google Scholar (or list the exceptions and why), and `getMyTeachingEvaluation` returns the expected summary.
- [ ] **Step 5:** Report all numbers. Browser walkthrough (pill row readability, panel layout, light/dark, Thai toggle) is for the user.

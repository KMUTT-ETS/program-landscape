# Google Scholar On-Demand Fetch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pull their own Google Scholar publication record on demand via ScrapingBee, make it primary over the library mirror without ever destroying library data, and let admins run it for staff individually or in bulk.

**Architecture:** Scholar papers become `ResearchOutput` rows (`source='google-scholar'`), so the four aggregate modules that already read that table need no changes. Three pure units carry the logic — quota decision, merge planner, parser — each testable without network or database. The merge is additive-only: there is no delete path.

**Tech Stack:** TypeScript strict, Prisma, Zod, NestJS, Next.js App Router, BullMQ, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-google-scholar-on-demand-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/migrations/20260908120000_google_scholar/` | Additive schema: 4 FacultyMember cols, 1 ResearchOutput col, 2 tables, 2 enums |
| `packages/shared/src/scholar/quota.ts` | **Pure.** trigger × role × history → allow / refuse + reason |
| `packages/shared/src/scholar/merge.ts` | **Pure.** Scholar papers × existing rows → insert / citation-update plan |
| `packages/shared/src/scholar/parse.ts` | **Pure.** ScrapingBee payload → publications; plus profile-URL validation |
| `packages/shared/src/scholar/types.ts` | Shared types for the three above |
| `apps/ingestion/src/lib/scrapingbee-client.ts` | HTTP wrapper, mirrors `oracle-client.ts` shape |
| `packages/db/src/scholar-fetch.ts` | Runner: quota → search/bind → fetch → archive → merge. The only writer |
| `apps/api/src/scholar/*` | Endpoints + BullMQ enqueue |
| `apps/web/src/lib/actions/scholar.ts` | Server actions |
| `apps/web/app/profile/*` | Button + profile-URL input |
| `apps/web/app/admin/scholar/*` | Console: list, row action, multi-select |

**Task order matters.** The three pure units come before any scraping code: the merge planner's no-delete invariant is the property most expensive to lose, and it must exist and be mutation-tested before anything can write.

---

## Task 1: Schema

**Files:** Create `packages/db/prisma/migrations/20260908120000_google_scholar/migration.sql`; modify `packages/db/prisma/schema.prisma`.

- [x] **Step 1: Add to `schema.prisma`**

On `FacultyMember`, beside the existing `scopusAuthorId`:
```prisma
  scholarProfileId   String?   @unique @map("scholar_profile_id")
  scholarProfileUrl  String?   @map("scholar_profile_url")
  scholarBoundAt     DateTime? @map("scholar_bound_at")
  scholarBoundById   String?   @map("scholar_bound_by_id")
```

plus the relation for that last column — 12 of the 15 existing `*_by_id`
columns in this schema carry a real FK, and an audit breadcrumb that can point
at a deleted row is not one:
```prisma
  scholarBoundBy   User?             @relation("ScholarProfileBoundBy", fields: [scholarBoundById], references: [id], onDelete: SetNull)
  scholarFetchRuns ScholarFetchRun[]
```

On `ResearchOutput`, beside `openalexId`:
```prisma
  scholarPaperId String? @map("scholar_paper_id")
```
plus `@@unique([scholarPaperId, facultyMemberId])` and `@@index([scholarPaperId])`.

New:
```prisma
enum ScholarFetchTrigger { SELF ADMIN ADMIN_BULK }
enum ScholarFetchStatus  { SUCCEEDED PARTIAL FAILED REFUSED }

/// One row per fetch attempt. This is the QUOTA LEDGER — the rolling-30-day
/// check queries it rather than reading a counter off User, so history
/// survives and an admin can always answer "why can't this person fetch".
model ScholarFetchRun {
  id              String              @id @default(cuid())
  userId          String              @map("user_id")
  facultyMemberId String?             @map("faculty_member_id")
  triggeredById   String              @map("triggered_by_id")
  trigger         ScholarFetchTrigger
  status          ScholarFetchStatus
  /// Exactly what was sent to Scholar, so a failed search is diagnosable
  /// without repeating it.
  searchQuery     String?             @map("search_query")
  papersFound     Int                 @default(0) @map("papers_found")
  papersInserted  Int                 @default(0) @map("papers_inserted")
  citationsUpdated Int                @default(0) @map("citations_updated")
  creditsUsed     Int                 @default(0) @map("credits_used")
  errorText       String?             @map("error_text") @db.Text
  startedAt       DateTime            @default(now()) @map("started_at")
  finishedAt      DateTime?           @map("finished_at")

  user        User           @relation("ScholarFetchUser", fields: [userId], references: [id], onDelete: Cascade)
  triggeredBy User           @relation("ScholarFetchTriggeredBy", fields: [triggeredById], references: [id], onDelete: Cascade)
  // SetNull, not Cascade: FacultyMember rows are churned by the backfill
  // scripts (kkupub_* prefix), and losing the quota ledger to a re-import
  // would hand everyone a fresh monthly allowance.
  facultyMember FacultyMember?     @relation(fields: [facultyMemberId], references: [id], onDelete: SetNull)
  archive     ScholarFetchArchive?

  @@index([userId, startedAt])
  @@index([facultyMemberId])
  @@index([status])
  @@map("scholar_fetch_runs")
}

/// Raw ScrapingBee response. This is a SCRAPED source with no contract: when
/// a parse turns out to be wrong months later, this is what makes reprocessing
/// possible instead of re-scraping, and it is the only way to answer "where
/// did this number come from" for a Council figure derived from a scraped page.
/// Retained 90 days by the existing PDPA sweep.
model ScholarFetchArchive {
  id            String   @id @default(cuid())
  fetchRunId    String   @unique @map("fetch_run_id")
  rawPayload    String   @map("raw_payload") @db.Text
  contentHash   String   @map("content_hash")
  parserVersion String   @map("parser_version")
  createdAt     DateTime @default(now()) @map("created_at")

  fetchRun ScholarFetchRun @relation(fields: [fetchRunId], references: [id], onDelete: Cascade)

  @@map("scholar_fetch_archives")
}
```

Add three back-relations on `User`: `scholarFetchRuns ScholarFetchRun[] @relation("ScholarFetchUser")`, `scholarFetchesTriggered ScholarFetchRun[] @relation("ScholarFetchTriggeredBy")` and `scholarProfileBindings FacultyMember[] @relation("ScholarProfileBoundBy")`.

- [x] **Step 2: Hand-write the migration SQL — do NOT redirect a generated diff into it**

> **Revised 2026-09-08 after the first attempt at this task destroyed the dev
> database.** The original step said to redirect `prisma migrate diff` straight
> into `migration.sql`. Two things were wrong with that. First, an agent
> following it reached for `--from-migrations --shadow-database-url
> "$DATABASE_URL"`, and Prisma dropped and replayed the live dev database —
> `scripts/dev-guard/db-destructive-guard.py` now refuses that command outright.
> Second, even the safe `--from-schema-datasource` form emits **pre-existing
> unrelated drift** against this database: `DROP TABLE "mv_refresh_log"`,
> `ALTER TABLE "verdict_snapshots" DROP COLUMN "lifecycle_verdict", "risk_tier"`,
> five `DROP INDEX`, and assorted `DROP DEFAULT` / `RENAME`. Committing the raw
> output would have dropped a live table as a side effect of this feature.

Generate the diff to a **scratch path outside the repo**, then hand-write
`migration.sql` containing only your own statements, verified byte-for-byte
against the corresponding lines of the generated output:

```bash
mkdir -p packages/db/prisma/migrations/20260908120000_google_scholar
cd packages/db && npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/scholar-generated.sql
grep -ni scholar /tmp/scholar-generated.sql   # these lines, and only these
```

- [x] **Step 3: Confirm the migration is additive**

Run `pnpm tsx scripts/migration-linter.ts` — the same gate CI runs
(`.github/workflows/pr.yml`). It must report the migration as non-destructive
without needing an allow-annotation. A purely additive migration has no `DROP`,
no column-type change and no `SET NOT NULL` on an existing column.

Then re-run the Step 2 diff and confirm `grep -ci scholar` returns **0** — the
schema and the database now agree about this feature.

- [x] **Step 4: Apply and verify**

```bash
pnpm --filter @kku/db exec prisma migrate deploy
pnpm --filter @kku/db exec prisma generate
pnpm --filter @kku/db exec tsc --noEmit
```

Then assert the data is still there — this is the check whose absence let the
first attempt report success against an empty database:

```sql
SELECT count(*) FROM programs WHERE code LIKE 'KKU-SEQ-%';  -- 301
SELECT count(*) FROM research_outputs;                      -- 166468
SELECT count(*) FROM faculty_members;                       -- 3852
```

- [x] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260908120000_google_scholar
git commit -m "feat(db): schema for Google Scholar on-demand fetch"
```

---

## Task 2: Quota decision (pure)

**Files:** Create `packages/shared/src/scholar/quota.ts`, `packages/shared/test/scholar-quota.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/scholar-quota.test.ts
import { describe, it, expect } from 'vitest';
import { decideScholarQuota } from '../src/scholar/quota';

const NOW = new Date('2026-09-08T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('decideScholarQuota', () => {
  it('allows a first self-fetch', () => {
    const d = decideScholarQuota({ trigger: 'SELF', actorRole: 'UNIVERSITY_USER', runs: [], now: NOW });
    expect(d.allowed).toBe(true);
  });

  it('refuses a second self-fetch inside 30 days and names the retry date', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(10) }], now: NOW,
    });
    expect(d.allowed).toBe(false);
    expect(d.retryAt?.toISOString()).toBe(new Date(daysAgo(10).getTime() + 30 * 864e5).toISOString());
  });

  it('allows a self-fetch once 30 days have passed', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(31) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('does NOT count a FAILED run against the allowance', () => {
    // A ScrapingBee timeout must not burn someone's month.
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'FAILED', startedAt: daysAgo(1) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('does NOT count a REFUSED run either', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'REFUSED', startedAt: daysAgo(1) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('counts a PARTIAL run — it produced data', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'PARTIAL', startedAt: daysAgo(2) }], now: NOW,
    });
    expect(d.allowed).toBe(false);
  });

  it('an ADMIN run does not consume the user self-service allowance', () => {
    // The whole point of the separate counter: a bulk admin refresh must not
    // lock people out of refreshing their own record.
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'ADMIN_BULK', status: 'SUCCEEDED', startedAt: daysAgo(2) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('and a SELF run does not consume the admin allowance', () => {
    const d = decideScholarQuota({
      trigger: 'ADMIN', actorRole: 'SYSTEM_ADMIN',
      runs: [{ trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(2) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('limits SYSTEM_ADMIN to one admin fetch per target per 30 days', () => {
    const d = decideScholarQuota({
      trigger: 'ADMIN', actorRole: 'SYSTEM_ADMIN',
      runs: [{ trigger: 'ADMIN', status: 'SUCCEEDED', startedAt: daysAgo(3) }], now: NOW,
    });
    expect(d.allowed).toBe(false);
  });

  it('SUPER_ADMIN bypasses both counters', () => {
    const d = decideScholarQuota({
      trigger: 'ADMIN', actorRole: 'SUPER_ADMIN',
      runs: [
        { trigger: 'ADMIN', status: 'SUCCEEDED', startedAt: daysAgo(1) },
        { trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(1) },
      ],
      now: NOW,
    });
    expect(d.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — `pnpm --filter @kku/shared exec vitest run test/scholar-quota.test.ts`. Expected: cannot resolve `../src/scholar/quota`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/scholar/quota.ts
export type ScholarTrigger = 'SELF' | 'ADMIN' | 'ADMIN_BULK';
export type ScholarStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'REFUSED';

export interface ScholarRunSummary {
  trigger: ScholarTrigger;
  status: ScholarStatus;
  startedAt: Date;
}

export interface ScholarQuotaDecision {
  allowed: boolean;
  reason?: string;
  /** When the caller may try again. Only set when allowed === false. */
  retryAt?: Date;
}

const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Pure quota decision — no prisma, no clock of its own.
 *
 * Two independent counters, which is the point: a SELF run and an ADMIN run
 * never consume each other's allowance, so an admin bulk refresh cannot lock
 * people out of refreshing their own record.
 *
 * FAILED and REFUSED runs do not count. Burning someone's month on a
 * ScrapingBee timeout would be indefensible. PARTIAL does count — it produced
 * data.
 */
export function decideScholarQuota(input: {
  trigger: ScholarTrigger;
  actorRole: string;
  runs: ScholarRunSummary[];
  now: Date;
}): ScholarQuotaDecision {
  const { trigger, actorRole, runs, now } = input;

  if (actorRole === 'SUPER_ADMIN') return { allowed: true };

  const counts = (r: ScholarRunSummary) =>
    (r.status === 'SUCCEEDED' || r.status === 'PARTIAL') &&
    (trigger === 'SELF' ? r.trigger === 'SELF' : r.trigger !== 'SELF');

  const blocking = runs
    .filter(counts)
    .filter((r) => now.getTime() - r.startedAt.getTime() < WINDOW_MS)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  if (!blocking) return { allowed: true };

  const retryAt = new Date(blocking.startedAt.getTime() + WINDOW_MS);
  return {
    allowed: false,
    reason:
      trigger === 'SELF'
        ? `Already fetched on ${blocking.startedAt.toISOString().slice(0, 10)}. One fetch per ${WINDOW_DAYS} days.`
        : `An administrator already fetched this person on ${blocking.startedAt.toISOString().slice(0, 10)}.`,
    retryAt,
  };
}
```

- [ ] **Step 4: Run the tests — 10 must pass.**

- [ ] **Step 5: Export from `packages/shared/src/ai/index.ts`'s sibling barrel** — check how `src/index.ts` aggregates and follow it; add `export * from './scholar/quota';` at the matching level.

- [ ] **Step 6: Commit** — `feat(scholar): pure quota decision`

---

## Task 3: Merge planner (pure) — the critical one

**Files:** Create `packages/shared/src/scholar/merge.ts`, `packages/shared/test/scholar-merge.test.ts`.

**Read first:** the spec's merge table. This unit decides what gets written and **must never produce a delete**. Yesterday's phase2b materialiser did an unconditional delete-and-replace and destroyed 56 courses on a failed call while reporting success; this plan's whole shape exists to make that unrepresentable.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/scholar-merge.test.ts
import { describe, it, expect } from 'vitest';
import { planScholarMerge } from '../src/scholar/merge';

const existing = [
  { id: 'r1', title: 'Deep Learning for Rice Yield Prediction', year: 2023, doi: '10.1/abc', citations: 5 },
  { id: 'r2', title: 'A Study of Groundwater, in Isan!', year: 2021, doi: null, citations: 2 },
];

describe('planScholarMerge', () => {
  it('matches on DOI and plans a citation update only', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's1', title: 'Totally Different Title', year: 2023, doi: '10.1/abc', citations: 40, venue: 'X', type: null }],
      existing,
    });
    expect(p.inserts).toHaveLength(0);
    expect(p.citationUpdates).toEqual([{ id: 'r1', citations: 40, scholarPaperId: 's1' }]);
  });

  it('falls back to normalised title + year when there is no DOI', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's2', title: 'a study of groundwater in isan', year: 2021, doi: null, citations: 9, venue: null, type: null }],
      existing,
    });
    expect(p.inserts).toHaveLength(0);
    expect(p.citationUpdates[0]!.id).toBe('r2');
  });

  it('does NOT match when the year differs, even on an identical title', () => {
    // Title alone is too weak a key. This codebase already paid for a fuzzy
    // matcher once — the retired filename matcher mislinked ~30 programmes.
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's3', title: 'A Study of Groundwater, in Isan!', year: 2019, doi: null, citations: 9, venue: null, type: null }],
      existing,
    });
    expect(p.citationUpdates).toHaveLength(0);
    expect(p.inserts).toHaveLength(1);
  });

  it('inserts a paper the library does not have', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's4', title: 'Novel Preprint', year: 2024, doi: null, citations: 1, venue: 'arXiv', type: null }],
      existing,
    });
    expect(p.inserts.map((i) => i.scholarPaperId)).toEqual(['s4']);
  });

  it('EMPTY scholar input writes nothing at all', () => {
    // The failure case. An empty or failed parse must be incapable of change.
    const p = planScholarMerge({ scholar: [], existing });
    expect(p.inserts).toHaveLength(0);
    expect(p.citationUpdates).toHaveLength(0);
  });

  it('never plans a deletion — the plan has no such field', () => {
    const p = planScholarMerge({ scholar: [], existing });
    expect(Object.keys(p).sort()).toEqual(['citationUpdates', 'inserts']);
  });

  it('does not update citations when Scholar reports fewer', () => {
    // Scholar counts run higher than Scopus; a lower number means a bad parse
    // or a partial page, not a correction.
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's5', title: 'x', year: 2023, doi: '10.1/abc', citations: 1, venue: null, type: null }],
      existing,
    });
    expect(p.citationUpdates).toHaveLength(0);
  });

  it('dedupes two Scholar entries that collapse onto the same existing row', () => {
    const p = planScholarMerge({
      scholar: [
        { scholarPaperId: 's6', title: 'x', year: 2023, doi: '10.1/abc', citations: 40, venue: null, type: null },
        { scholarPaperId: 's7', title: 'x', year: 2023, doi: '10.1/abc', citations: 41, venue: null, type: null },
      ],
      existing,
    });
    expect(p.citationUpdates).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails.**

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/scholar/merge.ts
export interface ScholarPaper {
  scholarPaperId: string;
  title: string;
  year: number;
  doi: string | null;
  citations: number;
  venue: string | null;
  type: string | null;
}

export interface ExistingOutput {
  id: string;
  title: string;
  year: number;
  doi: string | null;
  citations: number;
}

export interface ScholarMergePlan {
  /** Papers the library does not have. */
  inserts: ScholarPaper[];
  /** Existing rows whose citation count Scholar raises. Metadata untouched. */
  citationUpdates: { id: string; citations: number; scholarPaperId: string }[];
}

/** Lowercase, strip punctuation and diacritics, collapse whitespace. */
export function normaliseTitle(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decide what a Scholar fetch would write. Pure.
 *
 * THE PLAN HAS NO DELETE FIELD, and must not gain one. Library rows are the
 * failover: if a fetch is empty, partial or wrong, everything the user already
 * had must still be there. phase2b's materialiser (2026-09-07) had an
 * unconditional delete-and-replace and destroyed 56 courses on a failed call
 * while reporting success — this shape exists so that cannot happen here.
 */
export function planScholarMerge(input: {
  scholar: ScholarPaper[];
  existing: ExistingOutput[];
}): ScholarMergePlan {
  const { scholar, existing } = input;
  const byDoi = new Map(existing.filter((e) => e.doi).map((e) => [e.doi!.toLowerCase(), e]));
  const byTitleYear = new Map(existing.map((e) => [`${normaliseTitle(e.title)}::${e.year}`, e]));

  const inserts: ScholarPaper[] = [];
  const citationUpdates: ScholarMergePlan['citationUpdates'] = [];
  const claimed = new Set<string>();

  for (const p of scholar) {
    const hit =
      (p.doi ? byDoi.get(p.doi.toLowerCase()) : undefined) ??
      byTitleYear.get(`${normaliseTitle(p.title)}::${p.year}`);

    if (!hit) { inserts.push(p); continue; }
    if (claimed.has(hit.id)) continue;      // two Scholar rows onto one library row
    claimed.add(hit.id);
    // Only ever raise. A lower count means a bad parse or a partial page,
    // not a correction — Scholar counts run higher than Scopus by design.
    if (p.citations > hit.citations) {
      citationUpdates.push({ id: hit.id, citations: p.citations, scholarPaperId: p.scholarPaperId });
    }
  }

  return { inserts, citationUpdates };
}
```

- [ ] **Step 4: Run the tests — 8 must pass.**

- [ ] **Step 5: Mutation-test the no-delete invariant**

Temporarily add a `deletes: string[]` field populated with `existing.filter(...)`, re-run, and confirm the "never plans a deletion" test fails. Revert. Report what you saw. A guard that does not fail under mutation is decoration — this was the lesson from `model-invalid-fallback.test.ts` on 2026-09-07, where a class-instance fixture still passed a spread regression until the assertions moved onto prototype members.

- [ ] **Step 6: Commit** — `feat(scholar): pure merge planner with no delete path`

---

## Task 4: Parser (pure)

**Files:** Create `packages/shared/src/scholar/parse.ts`, `packages/shared/test/scholar-parse.test.ts`, and fixtures under `packages/shared/test/fixtures/scholar/`.

- [ ] **Step 1: Capture two fixtures**

Before writing the parser, capture real ScrapingBee responses ONCE and commit them as fixtures — one author-search page, one profile publication page. Use a public Scholar profile, and **redact nothing** (this is public bibliographic data; no PII beyond author names, which are public by the act of publishing — the same legal basis recorded for `kku-research`).

If credentials are not available in this session, say so and stop: **do not invent fixture HTML.** A parser tested against imagined markup is worse than no parser.

- [ ] **Step 2: Write the failing test** — assert against the fixtures: candidate extraction (name, affiliation, other-names, interests, paper count, profile id) and publication extraction (title, year, venue, citations, doi when present, scholar paper id). Include a case with a **missing year** and one with a **missing type**, both of which occur.

- [ ] **Step 3: Implement `parseScholarCandidates()` and `parseScholarPublications()`**

This is the one task in this plan that deliberately carries no reference
implementation. Every other task specifies its code because the shape is known;
a parser's shape is dictated by markup nobody in this plan has seen. Write it
against the fixtures captured in Step 1 and nothing else. Exports
`SCHOLAR_PARSER_VERSION = 'scholar-parse.v1'` — stamped onto `ScholarFetchArchive.parserVersion` so archived payloads can be reprocessed under a later parser.

- [ ] **Step 4: Run the tests. Step 5: Commit** — `feat(scholar): ScrapingBee response parser`

---

## Task 5: ScrapingBee client

**Files:** Create `apps/ingestion/src/lib/scrapingbee-client.ts`. Follow the shape of `oracle-client.ts` — env-driven config, one job per call, explicit errors.

- [ ] **Step 1: Implement** — `GET https://app.scrapingbee.com/api/v1/` with `api_key`, `url`, `render_js=false`. Env: `SCRAPINGBEE_API_KEY`, `SCRAPINGBEE_BASE_URL` (default the above), `SCRAPINGBEE_TIMEOUT_MS` (default 30000).

Required behaviours, each of which must be visible in the code:
- **Return credits used** from the `Spb-Cost` response header, so `ScholarFetchRun.creditsUsed` is real rather than estimated.
- **Throw a typed error** distinguishing auth failure (401/403), quota exhaustion (402), and transient (429/5xx). Only transient is retryable, once.
- **Never log the API key**, and never include it in an error message.

- [ ] **Step 2: Add the env keys to `.env.prod.example` with comments.** Leave the value **empty**, not a placeholder string — `ANTHROPIC_API_KEY=REPLACE_ME` armed a latent bug on 2026-09-07 precisely because a placeholder is truthy.

- [ ] **Step 3: Commit** — `feat(scholar): ScrapingBee HTTP client`

---

## Task 6: Fetch runner

**Files:** Create `packages/db/src/scholar-fetch.ts`. **This is the only writer.**

- [ ] **Step 1: Implement `runScholarFetch({ userId, triggeredById, trigger, actorRole })`**

Order, and it matters:
1. Resolve `FacultyMember` via the user's `employeeId`. **None → return `REFUSED` with reason; write no run row and consume no quota** (the spec's "shown but disabled" case).
2. Load the last 90 days of `ScholarFetchRun` for the user; call `decideScholarQuota`. Refused → persist a `REFUSED` run (so the ledger explains itself) and return.
3. Create the run row `startedAt = now`.
4. No `scholarProfileId` → return `REFUSED` with reason `needs-binding` **without fetching and without consuming quota**. The UI then asks for the profile URL; binding is a separate call. (Revised 2026-09-08: author search is blocked by a sign-in wall — see the spec.)
5. Bound → fetch all pages, archive the raw payload, parse.
6. `planScholarMerge` against that member's existing `ResearchOutput` rows, then apply **inserts and citation updates only, inside one `$transaction`**.
7. Invalidate `UserPublicationsCache` for the user.
8. Finalise the run with real counts and `creditsUsed`.

Any throw → status `FAILED`, `errorText` set, **no writes to `ResearchOutput`**, and quota unconsumed (Task 2 already ignores FAILED).

- [ ] **Step 1a: Use the right name, and record it**

The search string is `FacultyMember.nameEn`, falling back to `User.name` when
empty. **Not the Thai name** — Scholar indexes Thai researchers under Latin
transliterations, and HR's transliteration is the one most likely to match.
Persist it to `ScholarFetchRun.searchQuery` so a search that finds nothing can
be diagnosed without spending another credit repeating it.

If both are empty, return `REFUSED` with that reason rather than searching on
an empty string.

- [ ] **Step 1b: Map Scholar types onto the enum when building inserts**

`ResearchOutputType` is only `JOURNAL | CONFERENCE | PATENT | BOOK`. Scholar's
type is looser and frequently absent, so:

```ts
export function toResearchOutputType(scholarType: string | null): ResearchOutputType {
  const t = (scholarType ?? '').toLowerCase();
  if (t.includes('patent')) return 'PATENT';
  if (t.includes('book') || t.includes('chapter')) return 'BOOK';
  if (t.includes('conference') || t.includes('proceeding')) return 'CONFERENCE';
  // Everything else, including absent: JOURNAL is the dominant case. The raw
  // Scholar string survives in ScholarFetchArchive, so a better mapping can be
  // applied later by reprocessing rather than re-scraping.
  return 'JOURNAL';
}
```

Every inserted row also sets `source = 'google-scholar'` and `scholarPaperId`.
A Scholar paper with **no usable year** is skipped, not inserted with a guessed
one — `ResearchOutput.year` is non-null and feeds year-banded aggregates, so a
wrong year is worse than a missing paper. Count skips on the run.

- [ ] **Step 2: Implement `bindScholarProfile({ facultyMemberId, scholarProfileId, url, boundById })`** — sets the four columns. Idempotent; rebinding overwrites and is audit-logged.

- [ ] **Step 3: Verify the no-delete property holds at the DB layer** — `grep -nE "delete|deleteMany" packages/db/src/scholar-fetch.ts`. Expected: **no output.** If a delete is genuinely needed, stop and explain why before adding it.

- [ ] **Step 4: Commit** — `feat(scholar): fetch runner`

---

## Task 7: API + queue

**Files:** `apps/api/src/scholar/scholar.controller.ts`, `.service.ts`, `.module.ts`; register `SCHOLAR_FETCH` on the existing `ai-jobs` queue.

- [ ] **Step 1: Endpoints**

| Route | Guard | Purpose |
|---|---|---|
| `POST /scholar/fetch/me` | authenticated | self-fetch; `trigger: 'SELF'` |
| `POST /scholar/bind/me` | authenticated | bind own record from a pasted Scholar profile URL |
| `GET  /scholar/status/me` | authenticated | last run, next eligible date, bound profile |
| `POST /scholar/fetch/:userId` | `@Authorized('scholar:admin')` | `trigger: 'ADMIN'` |
| `POST /scholar/fetch/bulk` | `@Authorized('scholar:admin')` | enqueues `ADMIN_BULK`, one job per target |
| `GET  /scholar/runs` | `@Authorized('scholar:admin')` | ledger for the console |

All mutations `@AuditLog`. Add the `scholar:admin` permission to `packages/shared/src/auth/permissions.ts` for SYSTEM_ADMIN + SUPER_ADMIN.

- [ ] **Step 2: Enforce the bulk cap server-side** — reject a bulk request over `SCHOLAR_BULK_MAX_TARGETS` (default 100). The UI also shows it, but the UI is not the guard.

- [ ] **Step 3: Commit** — `feat(scholar): API endpoints and bulk queue`

---

## Task 8: Profile UI

**Files:** `apps/web/src/lib/actions/scholar.ts`; modify the profile publications section.

- [ ] **Step 1: Button + states** — never fetched / bound and fetched (with date) / inside the window (disabled, showing the retry date) / unbound (opens the picker) / no staff record (**disabled with the reason**, not hidden — a hidden button generates a support ticket asking why the feature is missing).

- [ ] **Step 2: Profile-URL input** — a field accepting a Scholar profile link, validated client- and server-side, with an inline example of a correct URL and a clear error naming what was wrong. After binding, show the bound profile id with a way to ask an admin to change it. Do NOT offer a name-search fallback: that endpoint is walled (see the spec).

- [ ] **Step 3: Show which source is primary** on the publications section, with the fetch date.

- [ ] **Step 4: Design tokens only** (ESLint fails on literal hex; the spacing scale is half-stock and missing keys emit no CSS). **Commit** — `feat(scholar): profile fetch UI`

---

## Task 9: Admin console

**Files:** `apps/web/app/admin/scholar/page.tsx` + `client.tsx`.

- [ ] **Step 1: List** — staff with faculty/department filters, showing bound-or-not, last fetch, paper counts by source.
- [ ] **Step 2: Row action** — fetch one; unbound lets the admin paste that person's profile URL, or leave it for the user.
- [ ] **Step 3: Multi-select + "Fetch selected"** — confirmation dialog stating **target count and estimated credits** before anything is enqueued.
- [ ] **Step 4: Run status** — poll `GET /scholar/runs`; show per-target outcome including `zero found`, which must read as a distinct outcome and **not** as success.
- [ ] **Step 5: Commit** — `feat(scholar): admin fetch console`

---

## Task 10: Provenance and methodology

**Files:** research provenance drawers; `docs/methodologies/health-score.md`.

- [ ] **Step 1: Source composition in the drawer** — every Council-facing research roll-up states *"N of M staff on Scholar data"*. This is council-readiness rule 1 and here it is load-bearing: the figure now mixes two sources depending on who clicked a button.
- [ ] **Step 2: Methodology note** — the research dimension is mixed-source; Scholar counts run higher than Scopus (preprints, theses, non-indexed venues), so staff who fetch appear stronger than colleagues who have not. State it; do not try to correct for it in code.
- [ ] **Step 3: Wire the archive retention rule**

The spec says `ScholarFetchArchive` is retained 90 days by the existing PDPA
sweep. Nothing enforces that yet — add the rule to `scripts/pdpa/` alongside
the existing retention entries rather than creating a second mechanism, which
is how one of them stops running unnoticed. Verify by running the sweep in its
dry-run mode and confirming it reports the new table.

- [ ] **Step 4: Commit** — `docs(methodology): record mixed-source research data`

---

## Final verification

- [ ] `pnpm --filter @kku/shared exec vitest run` — all pass
- [ ] `pnpm --filter @kku/db exec vitest run` — all pass
- [ ] `pnpm typecheck` — clean
- [ ] `grep -rnE "delete|deleteMany" packages/db/src/scholar-fetch.ts` — **no output**
- [ ] Manual: bind a profile on dev, fetch, confirm library rows survive and `ResearchOutput` gains only inserts plus citation raises
- [ ] Manual: force a fetch failure (bad API key) and confirm quota is NOT consumed and no `ResearchOutput` row changed

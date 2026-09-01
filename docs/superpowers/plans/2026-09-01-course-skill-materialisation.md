# Course-Skill Materialisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate real `Course` + `CourseSkill` rows for the 2,638 existing `ProgramCourse` rows (285 programmes), replacing the arbitrary "30 most-recent skills" candidate-selection placeholder with real pgvector similarity, so a later feature can ground curriculum recommendations in real per-course skill coverage.

**Architecture:** One new shared library module owns every embedding concern (dimension constant, normalisation, rate-limit backoff, cosine candidate search) so the backfill script, the live ai-job handler, and the bulk extraction script all share one implementation. On top of it: a deterministic digest-course lookup, a `Course` materialisation script, a `runCourseSkillExtraction()` helper mirroring `program-digest/run.ts`, a `materialiseCourseSkills()` mirroring `materialiseProgramDigest()`, and approve-endpoint wiring.

**Tech Stack:** TypeScript, Prisma (`@kku/db`), pgvector, `AiService` (`@kku/shared`), tsx scripts, Vitest.

---

## Audit record — gaps found in the first draft of this plan

This plan was rewritten after auditing the first draft against the live database and the live Gemini API. Every item below was **empirically verified**, not inferred. They are recorded here so the implementer understands why the code looks the way it does and does not "simplify" a fix back into a bug.

| # | Gap | Severity | Verified how | Fixed in |
|---|---|---|---|---|
| G1 | `prisma.skill.findMany({ where: { embedding: null } })` is invalid — Prisma cannot filter or select `Unsupported()` columns at all | **Fatal** | Ran it: throws ``Unknown argument `embedding` `` | Task 3 (uses `$queryRaw`) |
| G2 | Dimension mismatch: `gemini-embedding-001` returns **3072** dims by default; the column is `vector(1536)`. First draft never passed `dimensions` | **Fatal** | Live API: default returned 3072; `dimensions: 1536` returned exactly 1536 | Task 1 (`EMBEDDING_DIMENSIONS` constant used at write **and** query time) |
| G3 | Wrong distance operator: draft used `<->` (Euclidean). Reduced-dim vectors come back **non-normalised**, so L2 and cosine rank differently | Serious | Live API: L2 norm of a 1536-dim vector = **0.6958**, not 1.0 | Task 1 (normalise on write + `<=>` cosine) |
| G4 | No rate-limit handling anywhere. Draft fired ~206 embed batches + 2,638 extractions + 2,638 query-embeds with zero pacing | Serious | Live API returned **429 `RESOURCE_EXHAUSTED`** (`global_embed_content_requests_per_minute_per_base_model`) on the very first call; succeeded after ~45s | Task 1 (`embedWithBackoff`) |
| G5 | Draft used plain `extractStructured`, ignoring `extractStructuredWithParseRetry` — which exists precisely because a prior bulk run hit a **14% parse-failure rate** | Serious | `packages/shared/src/ai/extract-with-retry.ts` header documents the 2026-08-17 incident | Task 6 |
| G6 | When an Anthropic key is present, `embed: (r) => primary.embed(r).catch(() => secondary.embed(r))` (factory.ts:284) reroutes a Google 429 to Anthropic's `embed()`, which **throws "Claude has no embeddings API"** — masking the real error | Serious | Read factory.ts:284 + anthropic-ai.ts:167. Not live in this dev env (no Anthropic key) but likely live on prod | Task 1 (backoff treats the masked message as transient) |
| G7 | `pickCandidateSkills` was duplicated verbatim between the handler and the bulk script — guaranteed to drift | Moderate | Draft explicitly rationalised the duplication | Task 1 (single shared module) |
| G8 | No precondition guard: running extraction before embeddings exist silently falls through to the recency-ordered sample — producing exactly the bad data this project exists to eliminate, with no warning | Moderate | Draft's fallback path is silent by design | Task 9 (preflight abort) |
| G9 | `namesFilledFromCode` incremented twice for a single course when both TH and EN names were missing | Minor | Read the draft's counter logic | Task 5 |
| G10 | Wall-clock and resumability never stated for a 2,638-call sequential run | Minor | — | Task 10 |

**Two corrections to the spec itself** (carried over from the first draft, still valid):

1. **Description matching is deterministic, not fuzzy.** `ProgramCourse` rows are themselves materialised from `PROGRAM_DIGEST.payloadJson.courses[]` by `apps/ingestion/src/scripts/materialise-program-courses.ts`, using the same `normaliseCourseCode()` this plan reuses. So a course's originating digest entry is found by exact normalised-code lookup — the spec's "code-then-name-similarity" fallback is unnecessary. The no-match case is still handled and counted.
2. **The 0.85 auto-approve threshold is not this project's current default.** The live default is `AI_AUTO_APPROVE_THRESHOLD ?? 0` (auto-approve everything, per a 2026-05-13 operator policy). The user's 0.85 choice is implemented as a dedicated `COURSE_SKILLS_AUTO_APPROVE_THRESHOLD` env var so the global-default-0 policy can't silently override it.

---

### Task 1: Shared embedding + candidate-search library

**Files:**
- Create: `apps/ingestion/src/lib/skill-embeddings.ts`
- Test: `apps/ingestion/src/lib/skill-embeddings.test.ts`

This module is the single owner of every embedding concern and fixes G2, G3, G4, G6 and G7 in one place. Everything downstream imports from here — no duplicated embed logic anywhere.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ingestion/src/lib/skill-embeddings.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  normaliseVector,
  toVectorLiteral,
  skillEmbeddingText,
  embedWithBackoff,
} from './skill-embeddings';

describe('EMBEDDING_DIMENSIONS', () => {
  it('matches the pgvector column width declared in schema.prisma', () => {
    // schema.prisma declares Unsupported("vector(1536)"). Writing any
    // other width fails at the Postgres level, and querying with a
    // different width than was written fails too. This constant is the
    // single point of truth for both sides.
    expect(EMBEDDING_DIMENSIONS).toBe(1536);
  });
});

describe('normaliseVector', () => {
  it('scales a vector to unit length', () => {
    const out = normaliseVector([3, 4]);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
    const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('returns a zero vector unchanged rather than dividing by zero', () => {
    expect(normaliseVector([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('leaves an already-unit vector effectively unchanged', () => {
    const out = normaliseVector([1, 0]);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(0, 6);
  });
});

describe('toVectorLiteral', () => {
  it('formats a vector as a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2])).toBe('[0.1,0.2]');
  });
});

describe('skillEmbeddingText', () => {
  it('matches the EMBED_SKILL handler text construction exactly', () => {
    // Must stay byte-identical to the ai-jobs EMBED_SKILL handler so a
    // skill embedded via either path yields the same vector.
    expect(skillEmbeddingText({ nameEn: 'Data', nameTh: 'ข้อมูล', category: 'core' }))
      .toBe('Data | ข้อมูล | core');
  });

  it('renders a null category as an empty segment', () => {
    expect(skillEmbeddingText({ nameEn: 'Data', nameTh: 'ข้อมูล', category: null }))
      .toBe('Data | ข้อมูล | ');
  });
});

describe('embedWithBackoff', () => {
  it('returns normalised vectors of the configured width on success', async () => {
    const ai = { embed: vi.fn().mockResolvedValue({ vectors: [[3, 4]] }) };
    const out = await embedWithBackoff(ai as never, ['x'], { sleepMs: async () => {} });
    expect(ai.embed).toHaveBeenCalledOnce();
    expect(out[0]![0]).toBeCloseTo(0.6, 6);
  });

  it('requests the exact dimensionality the column expects', async () => {
    const ai = { embed: vi.fn().mockResolvedValue({ vectors: [[1, 0]] }) };
    await embedWithBackoff(ai as never, ['x'], { sleepMs: async () => {} });
    expect(ai.embed.mock.calls[0][0].dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('retries a 429 rate-limit error and succeeds', async () => {
    const ai = {
      embed: vi
        .fn()
        .mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED quota exceeded'))
        .mockResolvedValue({ vectors: [[1, 0]] }),
    };
    const slept: number[] = [];
    const out = await embedWithBackoff(ai as never, ['x'], { sleepMs: async (ms) => { slept.push(ms); } });
    expect(ai.embed).toHaveBeenCalledTimes(2);
    expect(slept.length).toBe(1);
    expect(out).toHaveLength(1);
  });

  it('retries the masked Anthropic-fallback error, since its real cause is a Google 429', async () => {
    // factory.ts routes a failed Google embed to the secondary provider.
    // With an Anthropic key present that secondary throws this message,
    // replacing the original 429. Treating it as terminal would abort a
    // backfill over a transient rate limit.
    const ai = {
      embed: vi
        .fn()
        .mockRejectedValueOnce(new Error('AnthropicAiService.embed: Claude has no embeddings API.'))
        .mockResolvedValue({ vectors: [[1, 0]] }),
    };
    const out = await embedWithBackoff(ai as never, ['x'], { sleepMs: async () => {} });
    expect(ai.embed).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1);
  });

  it('gives up after maxAttempts and rethrows', async () => {
    const ai = { embed: vi.fn().mockRejectedValue(new Error('429 quota exceeded')) };
    await expect(
      embedWithBackoff(ai as never, ['x'], { sleepMs: async () => {}, maxAttempts: 3 }),
    ).rejects.toThrow(/quota exceeded/);
    expect(ai.embed).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient error', async () => {
    const ai = { embed: vi.fn().mockRejectedValue(new Error('400 invalid API key')) };
    await expect(
      embedWithBackoff(ai as never, ['x'], { sleepMs: async () => {} }),
    ).rejects.toThrow(/invalid API key/);
    expect(ai.embed).toHaveBeenCalledOnce();
  });

  it('backs off for longer on each successive attempt', async () => {
    const ai = {
      embed: vi
        .fn()
        .mockRejectedValueOnce(new Error('429'))
        .mockRejectedValueOnce(new Error('429'))
        .mockResolvedValue({ vectors: [[1, 0]] }),
    };
    const slept: number[] = [];
    await embedWithBackoff(ai as never, ['x'], { sleepMs: async (ms) => { slept.push(ms); } });
    expect(slept).toHaveLength(2);
    expect(slept[1]).toBeGreaterThan(slept[0]!);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ingestion && npx vitest run src/lib/skill-embeddings.test.ts`
Expected: FAIL with "Cannot find module './skill-embeddings'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/ingestion/src/lib/skill-embeddings.ts
import { prisma } from '@kku/db';
import type { AiService } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Single owner of every skill-embedding concern: dimensionality,
// normalisation, rate-limit backoff, and pgvector candidate search.
//
// Imported by the embedding backfill script, the EXTRACT_* ai-job
// handlers, and the bulk course-skill extraction script — so there is
// exactly one definition of "how we embed a skill" and "how we find
// candidate skills". Do not re-implement any of this at a call site.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MUST equal the pgvector column width in schema.prisma
 * (`Unsupported("vector(1536)")` on Skill.embedding and its siblings).
 *
 * gemini-embedding-001 returns 3072 dimensions BY DEFAULT — writing that
 * into a vector(1536) column fails at the Postgres level, and querying
 * with a different width than was written fails too. Every embed call in
 * this codebase must pass this value, on both the write and the query
 * side. Verified against the live API 2026-09-01: requesting 1536 returns
 * exactly 1536.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Scale a vector to unit length.
 *
 * Google's embeddings are unit-normalised only at their native 3072
 * dimensions; a reduced-dimensionality response is NOT normalised
 * (measured 2026-09-01: a 1536-dim response had L2 norm 0.6958). Google's
 * own guidance is to re-normalise after reducing. We normalise on write
 * so stored vectors are directly comparable, and query with cosine
 * distance (which is scale-invariant anyway) for belt and braces.
 */
export function normaliseVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Format a vector as a pgvector literal: '[0.1,0.2,...]'. */
export function toVectorLiteral(v: number[]): string {
  return '[' + v.join(',') + ']';
}

/**
 * The text we embed for a skill. Byte-identical to the EMBED_SKILL
 * ai-job handler's construction, so a skill embedded through either path
 * produces the same vector for the same input.
 */
export function skillEmbeddingText(skill: {
  nameEn: string;
  nameTh: string;
  category: string | null;
}): string {
  return `${skill.nameEn} | ${skill.nameTh} | ${skill.category ?? ''}`;
}

// Errors worth retrying. The first four are ordinary transient signals.
// The last one is subtle: ai/providers/factory.ts wires
// `embed: (r) => primary.embed(r).catch(() => secondary.embed(r))`, so a
// Google rate-limit gets rerouted to the secondary provider — and when
// that secondary is Anthropic (which has no embeddings API) the thrown
// message REPLACES the original 429. Treating it as terminal would abort
// a whole backfill over a transient rate limit.
const TRANSIENT_EMBED_PATTERNS: RegExp[] = [
  /\b429\b/,
  /RESOURCE_EXHAUSTED/i,
  /quota|rate[_\s-]?limit/i,
  /\b5\d\d\b|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|unavailable|overloaded/i,
  /has no embeddings API/i,
];

function isTransientEmbedError(message: string): boolean {
  return TRANSIENT_EMBED_PATTERNS.some((re) => re.test(message));
}

export interface EmbedWithBackoffOptions {
  /** Injected for tests; defaults to a real timer. */
  sleepMs?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Base delay; grows exponentially per attempt. */
  baseDelayMs?: number;
  ctxKind?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Embed a batch of texts at the correct dimensionality, normalised, with
 * exponential backoff on transient failures.
 *
 * The live gemini-embedding quota is per-minute and shared across the
 * base model — verified 2026-09-01 by hitting 429 on a first call and
 * succeeding ~45s later. Backfilling thousands of skills without this
 * would fail partway through, every time.
 */
export async function embedWithBackoff(
  ai: Pick<AiService, 'embed'>,
  texts: string[],
  opts: EmbedWithBackoffOptions = {},
): Promise<number[][]> {
  const sleep = opts.sleepMs ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 20_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await ai.embed({
        ctx: { module: 'skills', kind: opts.ctxKind ?? 'skill-embedding' },
        texts,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      return (resp.vectors ?? []).map((v) => normaliseVector(v));
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isTransientEmbedError(message) || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      // eslint-disable-next-line no-console
      console.warn(
        `[skill-embeddings] transient embed failure (attempt ${attempt}/${maxAttempts}), ` +
          `waiting ${Math.round(delay / 1000)}s: ${message.slice(0, 160)}`,
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

export interface CandidateSkill {
  id: string;
  nameTh: string;
  nameEn: string;
  category: string | null;
}

/**
 * Find the `limit` skills most semantically similar to `queryText`.
 *
 * Uses COSINE distance (`<=>`), not Euclidean (`<->`). Stored vectors are
 * normalised by embedWithBackoff, but the query vector's scale is
 * irrelevant under cosine, so this stays correct even if a vector was
 * written by some other path without normalisation.
 *
 * Falls back to a recency-ordered sample only when the query text is
 * empty, the embed call fails outright, or NO skill has an embedding yet
 * — every caller needs some candidate list to hand the extraction prompt.
 * The fallback is deliberately loud (see `usedFallback` on the result) so
 * a caller can refuse to run rather than silently produce weak matches.
 */
export async function findCandidateSkills(
  ai: Pick<AiService, 'embed'>,
  queryText: string,
  limit: number,
): Promise<{ candidates: CandidateSkill[]; usedFallback: boolean }> {
  const trimmed = queryText.trim().slice(0, 2000);
  if (trimmed) {
    try {
      const [vector] = await embedWithBackoff(ai, [trimmed], {
        ctxKind: 'candidate-skill-search',
      });
      if (vector && vector.length > 0) {
        const lit = toVectorLiteral(vector);
        const rows = await prisma.$queryRaw<CandidateSkill[]>`
          SELECT id, name_th AS "nameTh", name_en AS "nameEn", category
          FROM skills
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${lit}::vector
          LIMIT ${limit}
        `;
        if (rows.length > 0) return { candidates: rows, usedFallback: false };
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[skill-embeddings] candidate search failed, falling back to recency sample: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const rows = await prisma.skill.findMany({
    select: { id: true, nameTh: true, nameEn: true, category: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return { candidates: rows, usedFallback: true };
}

/** Count skills that already have an embedding. Uses $queryRaw because
 *  Prisma cannot filter on `Unsupported()` columns at all — a
 *  `where: { embedding: ... }` clause is rejected as an unknown argument. */
export async function countSkillsWithEmbedding(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ c: number }>>`
    SELECT COUNT(*)::int AS c FROM skills WHERE embedding IS NOT NULL
  `;
  return rows[0]?.c ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ingestion && npx vitest run src/lib/skill-embeddings.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/lib/skill-embeddings.ts apps/ingestion/src/lib/skill-embeddings.test.ts
git commit -m "feat(skills): shared embedding lib — correct dims, cosine search, rate-limit backoff"
```

---

### Task 2: Deterministic digest-course lookup helper

**Files:**
- Create: `apps/ingestion/src/lib/digest-course-lookup.ts`
- Test: `apps/ingestion/src/lib/digest-course-lookup.test.ts`

Pure function: given a programme's digest payload and a normalised course code, find the digest's matching course entry — using the same `normaliseCourseCode()` that wrote `ProgramCourse.courseCode` in the first place, so the lookup agrees with how that row was created.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/ingestion/src/lib/digest-course-lookup.test.ts
import { describe, it, expect } from 'vitest';
import { findDigestCourseByCode } from './digest-course-lookup';

describe('findDigestCourseByCode', () => {
  const digestCourses = [
    { code: 'EN 241 100', nameTh: 'โครงสร้างข้อมูล', nameEn: 'Data Structures', credits: 3, descriptionTh: 'ศึกษาโครงสร้างข้อมูล', learningOutcomesTh: ['เข้าใจ array และ linked list'] },
    { code: 'en241200', nameTh: 'ระบบปฏิบัติการ', nameEn: 'Operating Systems', credits: 3, descriptionTh: '', learningOutcomesTh: [] },
  ];

  it('finds a match after normalising both sides the same way', () => {
    const found = findDigestCourseByCode(digestCourses, 'EN241100');
    expect(found?.nameEn).toBe('Data Structures');
    expect(found?.descriptionTh).toBe('ศึกษาโครงสร้างข้อมูล');
  });

  it("matches regardless of the digest entry's own casing and spacing", () => {
    expect(findDigestCourseByCode(digestCourses, 'EN241200')?.nameEn).toBe('Operating Systems');
  });

  it('returns undefined when no digest entry has that code', () => {
    expect(findDigestCourseByCode(digestCourses, 'XX999999')).toBeUndefined();
  });

  it('returns undefined for an empty digest course list', () => {
    expect(findDigestCourseByCode([], 'EN241100')).toBeUndefined();
  });

  it('returns undefined for an empty query code rather than matching anything', () => {
    expect(findDigestCourseByCode(digestCourses, '')).toBeUndefined();
  });

  it('treats an entry with no code as unmatchable, not a wildcard', () => {
    const withBlank = [{ code: '', nameTh: 'x', nameEn: '', credits: null, descriptionTh: '', learningOutcomesTh: [] }];
    expect(findDigestCourseByCode(withBlank, 'EN241100')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/ingestion && npx vitest run src/lib/digest-course-lookup.test.ts`
Expected: FAIL with "Cannot find module './digest-course-lookup'"

- [ ] **Step 3: Write the implementation**

```typescript
// apps/ingestion/src/lib/digest-course-lookup.ts
import { normaliseCourseCode } from './course-code';

/**
 * A course entry as it appears inside PROGRAM_DIGEST.payloadJson.courses[]
 * (ProgramCourseExtractionSchema in packages/shared/src/ai/prompts/program-digest.ts).
 * Declared as a plain interface rather than imported from the Zod schema
 * because this helper receives already-parsed JSON, not raw AI output.
 */
export interface DigestCourseEntry {
  code: string;
  nameTh: string;
  nameEn: string;
  credits: number | null;
  descriptionTh: string;
  learningOutcomesTh: string[];
}

/**
 * Find the digest course entry whose normalised code matches the given
 * (already-normalised) course code. Deterministic — no fuzzy matching.
 *
 * Safe because `ProgramCourse.courseCode` is itself produced by
 * normalising a digest entry's code with this same function (see
 * apps/ingestion/src/scripts/materialise-program-courses.ts), so a
 * ProgramCourse row's code and its originating digest entry's normalised
 * code are guaranteed to agree.
 */
export function findDigestCourseByCode(
  digestCourses: DigestCourseEntry[],
  normalisedCode: string,
): DigestCourseEntry | undefined {
  if (!normalisedCode) return undefined;
  return digestCourses.find((c) => {
    const entryCode = normaliseCourseCode(c.code);
    return entryCode !== '' && entryCode === normalisedCode;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/ingestion && npx vitest run src/lib/digest-course-lookup.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/lib/digest-course-lookup.ts apps/ingestion/src/lib/digest-course-lookup.test.ts
git commit -m "feat(curriculum): add deterministic digest-course lookup helper"
```

---

### Task 3: Skill-embedding backfill script

**Files:**
- Create: `apps/ingestion/src/scripts/backfill-skill-embeddings.ts`
- Modify: `package.json` (root scripts block)

Fixes **G1** — the eligibility query must be `$queryRaw`, because Prisma rejects any `where` clause referencing `Skill.embedding` (an `Unsupported()` column). All embedding mechanics come from Task 1's library.

No vitest file — matching this codebase's convention for bulk backfill scripts (`bulk-digest-programs.ts`, `approve-pending-digests.ts`, `materialise-program-courses.ts` all ship without unit tests; the logic they carry now lives in Task 1's tested library). Steps 3–4 are the verification.

- [ ] **Step 1: Write the script**

```typescript
#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Backfill Skill.embedding for every skill that doesn't have one yet.
//
// Confirmed state before this script existed (2026-09-01): 5,152 Skill
// rows, 0 with a non-null embedding.
//
// All embedding mechanics (dimensionality, normalisation, rate-limit
// backoff) come from ../lib/skill-embeddings — do not inline them here.
//
// NOTE on the eligibility query: it is raw SQL, not Prisma. Skill.embedding
// is declared Unsupported("vector(1536)"), and Prisma refuses any `where`
// clause naming it ("Unknown argument `embedding`"). Raw SQL is the only
// way to ask "which skills lack an embedding".
//
// Idempotent — a second run only picks up skills still missing a vector.
//
// Usage:
//   pnpm skills:backfill-embeddings              # everything
//   pnpm skills:backfill-embeddings --limit 25   # smoke-test cap
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
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

import { prisma, PrismaAiInferenceRecorder } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';
import {
  embedWithBackoff,
  skillEmbeddingText,
  toVectorLiteral,
  countSkillsWithEmbedding,
} from '../lib/skill-embeddings';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();

// 25 texts per call — verified against the live API 2026-09-01: returned
// 25 × 1536-dim vectors in ~1.0s.
const BATCH_SIZE = 25;
// Deliberate pacing between batches. The gemini-embedding quota is
// per-minute and shared across the base model; firing 200+ batches
// back-to-back trips it. embedWithBackoff recovers from a trip, but
// pacing avoids most of them.
const INTER_BATCH_DELAY_MS = 1_500;

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `skill-embedding-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

function audit(record: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  audit({ event: 'start', limit: LIMIT });

  // Raw SQL — see the header note on why this cannot be a Prisma query.
  const skills = LIMIT
    ? await prisma.$queryRaw<Array<{ id: string; nameTh: string; nameEn: string; category: string | null }>>`
        SELECT id, name_th AS "nameTh", name_en AS "nameEn", category
        FROM skills WHERE embedding IS NULL ORDER BY created_at ASC LIMIT ${LIMIT}
      `
    : await prisma.$queryRaw<Array<{ id: string; nameTh: string; nameEn: string; category: string | null }>>`
        SELECT id, name_th AS "nameTh", name_en AS "nameEn", category
        FROM skills WHERE embedding IS NULL ORDER BY created_at ASC
      `;

  console.log(`Skills needing embeddings: ${skills.length}`);
  audit({ event: 'eligible', count: skills.length });
  if (skills.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const ai = createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  let embedded = 0;
  let failed = 0;

  for (let i = 0; i < skills.length; i += BATCH_SIZE) {
    const batch = skills.slice(i, i + BATCH_SIZE);
    const batchLabel = `[${i + 1}-${i + batch.length}/${skills.length}]`;
    try {
      const vectors = await embedWithBackoff(ai, batch.map(skillEmbeddingText), {
        ctxKind: 'skill-embedding-backfill',
      });
      for (let j = 0; j < batch.length; j++) {
        const skill = batch[j]!;
        const vector = vectors[j];
        if (!vector || vector.length === 0) {
          failed++;
          audit({ event: 'skill', skillId: skill.id, status: 'failed', error: 'no vector at index' });
          continue;
        }
        await prisma.$executeRaw`
          UPDATE skills SET embedding = ${toVectorLiteral(vector)}::vector WHERE id = ${skill.id}
        `;
        embedded++;
        audit({ event: 'skill', skillId: skill.id, nameEn: skill.nameEn, status: 'embedded' });
      }
      console.log(`${batchLabel} ✓ embedded ${batch.length}`);
    } catch (err) {
      failed += batch.length;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${batchLabel} ✗ batch failed: ${message.slice(0, 200)}`);
      for (const skill of batch) {
        audit({ event: 'skill', skillId: skill.id, status: 'failed', error: message });
      }
    }
    if (i + BATCH_SIZE < skills.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  const coverage = await countSkillsWithEmbedding();
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Summary: ${embedded} embedded / ${failed} failed`);
  console.log(`Total skills with an embedding now: ${coverage}`);
  audit({ event: 'end', embedded, failed, coverage });
}

main()
  .catch((err) => {
    console.error(err);
    audit({ event: 'fatal', error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

The `#!/usr/bin/env tsx` shebang must be the literal first line, before the block comment — matching `bulk-digest-programs.ts`.

- [ ] **Step 2: Register the script**

In the root `package.json` `"scripts"` block, alongside the other pipeline entries:

```json
    "skills:backfill-embeddings": "tsx apps/ingestion/src/scripts/backfill-skill-embeddings.ts",
```

- [ ] **Step 3: Smoke-test with a small limit**

Run: `pnpm skills:backfill-embeddings --limit 25`
Expected: `[1-25/25] ✓ embedded 25`, then `Summary: 25 embedded / 0 failed` and `Total skills with an embedding now: 25`.

- [ ] **Step 4: Verify idempotency — re-run**

Run: `pnpm skills:backfill-embeddings --limit 25`
Expected: 25 *different* skills embedded (the first 25 are now excluded by `WHERE embedding IS NULL`), and `Total skills with an embedding now: 50`. This confirms the raw-SQL eligibility filter actually works — the check that G1 is fixed.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/scripts/backfill-skill-embeddings.ts package.json
git commit -m "feat(skills): add skill-embedding backfill script"
```

---

### Task 4: Point the ai-job handlers at the real candidate search

**Files:**
- Modify: `apps/ingestion/src/ai-jobs/handlers.ts` (`pickCandidateSkills` at ~552-568, and its three call sites at ~94, ~147, ~203)

Replaces the placeholder with a thin delegate to Task 1's library (fixes G3 and G7 — one implementation, cosine distance, correct dimensions).

- [ ] **Step 1: Replace `pickCandidateSkills`**

Delete the existing function (currently lines 552-568):

```typescript
async function pickCandidateSkills(limit: number) {
  // Placeholder candidate strategy: most-recent N skills. Real impl
  // uses vector similarity over the query text once embeddings are
  // populated (see EMBED_SKILL handler). The switch is a single
  // $queryRaw replacement when prompt 04's embedding backfill runs.
  const rows = await prisma.skill.findMany({
    select: { id: true, nameTh: true, nameEn: true, category: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    category: r.category,
  }));
}
```

and replace it with:

```typescript
// Real vector-similarity candidate selection, backed by the embeddings
// populated via `pnpm skills:backfill-embeddings`. The shared library
// owns the query (cosine distance, correct dimensionality) and its own
// recency-ordered fallback for when no embedding exists yet.
async function pickCandidateSkills(queryText: string, limit: number, ai: AiService) {
  const { candidates } = await findCandidateSkills(ai, queryText, limit);
  return candidates;
}
```

Add the import alongside the other relative imports near the top of the file (after the `import type { AiJobKind, ProgramPipelinePhase } from './queue';` line):

```typescript
import { findCandidateSkills } from '../lib/skill-embeddings';
```

`AiService` is already imported as a type from `@kku/shared` in this file's existing import block — confirm it is in that list and add it if not.

- [ ] **Step 2: Update the `EXTRACT_COURSE_SKILLS` call site (~line 94)**

Before:
```typescript
      const candidates = await pickCandidateSkills(30);
```
After:
```typescript
      const queryText = [course.nameEn, course.nameTh, course.descriptionEn ?? '', course.descriptionTh ?? '']
        .filter(Boolean)
        .join(' ');
      const candidates = await pickCandidateSkills(queryText, 30, deps.ai);
```

- [ ] **Step 3: Update the `EXTRACT_JOB_POSTING_SKILLS` call site (~line 147)**

Before:
```typescript
      const candidates = await pickCandidateSkills(30);
```
After:
```typescript
      const queryText = [posting.title, posting.descriptionRaw ?? ''].filter(Boolean).join(' ');
      const candidates = await pickCandidateSkills(queryText, 30, deps.ai);
```

- [ ] **Step 4: Update the `ANALYZE_POLICY_DOC` call site (~line 203)**

Before:
```typescript
      const candidates = await pickCandidateSkills(50);
```
After:
```typescript
      const candidates = await pickCandidateSkills(fullText, 50, deps.ai);
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/ingestion && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/ai-jobs/handlers.ts
git commit -m "fix(ai-jobs): pickCandidateSkills uses real cosine similarity, not recency"
```

---

### Task 5: Course materialisation script

**Files:**
- Create: `apps/ingestion/src/scripts/materialise-courses-from-program-courses.ts`
- Modify: `package.json` (scripts block)

Groups by programme so each programme's digest is fetched once and reused for all its courses. Fixes **G9** (the double-counted name-fallback counter) by counting per course, not per field.

- [ ] **Step 1: Write the script**

```typescript
#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Materialise Course rows from ProgramCourse (2,638 rows across 285
// programmes, confirmed 2026-09-01).
//
// ProgramCourse is the identity source of truth (code / name / credits).
// Course additionally gets a description when the programme's most recent
// approved PROGRAM_DIGEST still holds the matching course entry — an
// exact normalised-code lookup, never fuzzy (see ../lib/digest-course-lookup).
//
// Idempotent — Course has @@unique([programId, code]); existing rows are
// detected with findFirst and skipped rather than relying on a DB error.
//
// Usage:
//   pnpm curriculum:materialise-courses                     # everything
//   pnpm curriculum:materialise-courses --program KKU-SEQ-0123
//   pnpm curriculum:materialise-courses --limit 20          # cap PROGRAMMES
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
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

import { prisma } from '@kku/db';
import { findDigestCourseByCode, type DigestCourseEntry } from '../lib/digest-course-lookup';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}
const PROGRAM_CODE = flag('program');
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `course-materialise-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

function audit(record: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  audit({ event: 'start', programFilter: PROGRAM_CODE, limit: LIMIT });

  const programs = await prisma.program.findMany({
    where: {
      sequenceNoFromSheet: { not: null },
      ...(PROGRAM_CODE ? { code: PROGRAM_CODE } : {}),
      programCourses: { some: {} },
    },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`Programmes with ProgramCourse rows: ${programs.length}`);
  audit({ event: 'eligible', count: programs.length });

  let coursesCreated = 0;
  let coursesSkippedExisting = 0;
  let coursesWithFallbackName = 0;
  let creditsDefaultedToZero = 0;
  let descriptionMatched = 0;
  let descriptionUnmatched = 0;
  let programsFailed = 0;
  let programsWithoutDigest = 0;

  for (const program of programs) {
    try {
      const programCourses = await prisma.programCourse.findMany({
        where: { programId: program.id },
        select: { courseCode: true, courseCodeRaw: true, courseNameTh: true, courseNameEn: true, credits: true },
      });

      const latestDigest = await prisma.aiExtraction.findFirst({
        where: {
          sourceEntityType: 'program',
          sourceEntityId: program.id,
          extractionKind: 'PROGRAM_DIGEST',
          reviewStatus: { in: ['APPROVED', 'AUTO_APPROVED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { payloadJson: true },
      });
      const rawCourses = (latestDigest?.payloadJson as { courses?: unknown } | null)?.courses;
      const digestCourses: DigestCourseEntry[] = Array.isArray(rawCourses)
        ? (rawCourses as DigestCourseEntry[])
        : [];
      if (digestCourses.length === 0) programsWithoutDigest++;

      for (const pc of programCourses) {
        const existing = await prisma.course.findFirst({
          where: { programId: program.id, code: pc.courseCode },
          select: { id: true },
        });
        if (existing) {
          coursesSkippedExisting++;
          continue;
        }

        // ProgramCourse names/credits are nullable; Course's are not.
        // Fall back explicitly and COUNT PER COURSE (not per field — an
        // earlier draft double-counted a course missing both names).
        const codeFallback = pc.courseCodeRaw || pc.courseCode;
        const nameTh = pc.courseNameTh || codeFallback;
        const nameEn = pc.courseNameEn || codeFallback;
        if (!pc.courseNameTh || !pc.courseNameEn) coursesWithFallbackName++;

        let credits = pc.credits;
        if (credits == null) {
          credits = 0;
          creditsDefaultedToZero++;
        }

        const digestEntry = findDigestCourseByCode(digestCourses, pc.courseCode);
        let descriptionTh: string | null = null;
        if (digestEntry?.descriptionTh) {
          descriptionTh = digestEntry.descriptionTh;
          if (Array.isArray(digestEntry.learningOutcomesTh) && digestEntry.learningOutcomesTh.length > 0) {
            descriptionTh +=
              '\n\nLearning outcomes:\n' + digestEntry.learningOutcomesTh.map((o) => `- ${o}`).join('\n');
          }
          descriptionMatched++;
        } else {
          descriptionUnmatched++;
        }

        await prisma.course.create({
          data: {
            programId: program.id,
            code: pc.courseCode,
            nameTh,
            nameEn,
            credits,
            descriptionTh,
            // The digest payload carries no English course description.
            descriptionEn: null,
          },
        });
        coursesCreated++;
        audit({
          event: 'course',
          programCode: program.code,
          courseCode: pc.courseCode,
          status: 'created',
          hasDescription: descriptionTh !== null,
        });
      }
    } catch (err) {
      programsFailed++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ program ${program.code} failed: ${message}`);
      audit({ event: 'program_failed', programCode: program.code, error: message });
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Courses created:                 ${coursesCreated}`);
  console.log(`Courses skipped (existing):      ${coursesSkippedExisting}`);
  console.log(`Courses with a fallback name:    ${coursesWithFallbackName}`);
  console.log(`Credits defaulted to 0:          ${creditsDefaultedToZero}`);
  console.log(`Descriptions matched:            ${descriptionMatched}`);
  console.log(`Descriptions unmatched:          ${descriptionUnmatched}`);
  console.log(`Programmes without a digest:     ${programsWithoutDigest}`);
  console.log(`Programmes failed:               ${programsFailed}`);
  audit({
    event: 'end',
    coursesCreated,
    coursesSkippedExisting,
    coursesWithFallbackName,
    creditsDefaultedToZero,
    descriptionMatched,
    descriptionUnmatched,
    programsWithoutDigest,
    programsFailed,
  });
}

main()
  .catch((err) => {
    console.error(err);
    audit({ event: 'fatal', error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Register the script**

```json
    "curriculum:materialise-courses": "tsx apps/ingestion/src/scripts/materialise-courses-from-program-courses.ts",
```

- [ ] **Step 3: Smoke-test**

Run: `pnpm curriculum:materialise-courses --limit 3`
Expected: `Courses created:` a small positive number, `Programmes failed: 0`.

- [ ] **Step 4: Verify idempotency — re-run the same command**

Run: `pnpm curriculum:materialise-courses --limit 3`
Expected: `Courses created: 0` and `Courses skipped (existing):` equal to Step 3's created count.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/scripts/materialise-courses-from-program-courses.ts package.json
git commit -m "feat(curriculum): materialise Course rows from ProgramCourse"
```

---

### Task 6: `runCourseSkillExtraction()` shared helper + handler refactor

**Files:**
- Create: `apps/ingestion/src/course-skills/run.ts`
- Modify: `apps/ingestion/src/ai-jobs/handlers.ts` (the `EXTRACT_COURSE_SKILLS` case, ~86-141)

Mirrors `apps/ingestion/src/program-digest/run.ts`: one definition of "run the extraction for one course", shared by the live ai-job and the bulk script. Fixes **G5** by routing through `extractStructuredWithParseRetry`.

- [ ] **Step 1: Write `run.ts`**

```typescript
// apps/ingestion/src/course-skills/run.ts
import { prisma, Prisma } from '@kku/db';
import {
  COURSE_SKILL_EXTRACTION_VERSION,
  CourseSkillExtractionSchema,
  buildCourseSkillExtractionMessages,
  extractStructuredWithParseRetry,
  type AiService,
} from '@kku/shared';
import { findCandidateSkills } from '../lib/skill-embeddings';

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the per-course skill-extraction run. Used by:
//   - apps/ingestion/src/ai-jobs/handlers.ts (EXTRACT_COURSE_SKILLS kind,
//     reachable from apps/api/src/skills/skills.controller.ts)
//   - apps/ingestion/src/scripts/extract-course-skills-bulk.ts (CLI bulk)
//
// Mirrors apps/ingestion/src/program-digest/run.ts. Callers own CLI
// logging, queue progress, and materialisation-on-auto-approve.
//
// Uses extractStructuredWithParseRetry rather than a bare
// extractStructured: a prior bulk run in this codebase stalled at a 14%
// parse-failure rate, which that wrapper exists to absorb. Over 2,638
// courses the difference is hundreds of extractions.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunCourseSkillExtractionParams {
  courseId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
  /** Bypass the "already has a COURSE_SKILLS extraction" skip. */
  force?: boolean;
  /** Confidence floor for AUTO_APPROVED — callers own this value. */
  autoApproveThreshold: number;
  /** Refuse to run when candidate selection has to fall back to a
   *  recency-ordered sample (i.e. embeddings aren't populated). Bulk
   *  callers set this so a mis-ordered run can't quietly produce the
   *  weak data this whole project exists to avoid. */
  requireVectorCandidates?: boolean;
}

export type RunCourseSkillExtractionOutcome =
  | {
      status: 'SUCCEEDED';
      aiExtractionId: string;
      aiInferenceId: string | null;
      confidence: number;
      skillsMatched: number;
      skillsProposed: number;
      autoApproved: boolean;
      usedFallbackCandidates: boolean;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runCourseSkillExtraction(
  params: RunCourseSkillExtractionParams,
): Promise<RunCourseSkillExtractionOutcome> {
  const course = await prisma.course.findUnique({ where: { id: params.courseId } });
  if (!course) return { status: 'SKIPPED', reason: `course not found: ${params.courseId}` };

  if (!params.force) {
    const existing = await prisma.aiExtraction.findFirst({
      where: { sourceEntityType: 'course', sourceEntityId: course.id, extractionKind: 'COURSE_SKILLS' },
      select: { id: true },
    });
    if (existing) {
      return { status: 'SKIPPED', reason: 'COURSE_SKILLS extraction already exists; pass force=true to re-run' };
    }
  }

  const queryText = [course.nameEn, course.nameTh, course.descriptionEn ?? '', course.descriptionTh ?? '']
    .filter(Boolean)
    .join(' ');

  let candidates;
  let usedFallback: boolean;
  try {
    const found = await findCandidateSkills(params.ai, queryText, 30);
    candidates = found.candidates;
    usedFallback = found.usedFallback;
  } catch (err) {
    return { status: 'FAILED', reason: `candidate search failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (usedFallback && params.requireVectorCandidates) {
    return {
      status: 'SKIPPED',
      reason:
        'candidate search fell back to a recency sample (no skill embeddings) — ' +
        'run `pnpm skills:backfill-embeddings` first',
    };
  }
  if (candidates.length === 0) {
    return { status: 'SKIPPED', reason: 'no candidate skills available — is the Skill taxonomy seeded?' };
  }

  let resp;
  try {
    resp = await extractStructuredWithParseRetry(
      params.ai,
      {
        ctx: { module: 'curriculum', kind: 'course-skills.extract', userId: params.triggeredByUserId ?? null },
        methodVersion: COURSE_SKILL_EXTRACTION_VERSION,
        messages: buildCourseSkillExtractionMessages({
          course: {
            code: course.code,
            nameTh: course.nameTh,
            nameEn: course.nameEn,
            descriptionTh: course.descriptionTh ?? undefined,
            descriptionEn: course.descriptionEn ?? undefined,
            credits: course.credits,
          },
          candidateSkills: candidates,
        }),
      },
      CourseSkillExtractionSchema,
      `course-skills:${course.code}`,
    );
  } catch (err) {
    return { status: 'FAILED', reason: err instanceof Error ? err.message : String(err) };
  }

  const autoApprove = resp.confidence >= params.autoApproveThreshold;
  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'course',
      sourceEntityId: course.id,
      extractionKind: 'COURSE_SKILLS',
      payloadJson: resp.parsed as unknown as Prisma.InputJsonValue,
      confidence: resp.confidence,
      methodVersion: COURSE_SKILL_EXTRACTION_VERSION,
      aiInferenceId: resp.aiInferenceId,
      reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
      reasoning: resp.reasoning,
    },
    select: { id: true },
  });

  return {
    status: 'SUCCEEDED',
    aiExtractionId: created.id,
    aiInferenceId: resp.aiInferenceId,
    confidence: resp.confidence,
    skillsMatched: resp.parsed.skills.length,
    skillsProposed: resp.parsed.proposedSkills.length,
    autoApproved: autoApprove,
    usedFallbackCandidates: usedFallback,
  };
}
```

- [ ] **Step 2: Confirm `extractStructuredWithParseRetry` is importable from `@kku/shared`**

Run: `grep -rn "extractStructuredWithParseRetry" apps/api/src/gap/gap-insights.service.ts | head -3`
Expected: shows it in that file's import list — confirming the symbol is exported from `@kku/shared` and this import will resolve. (It is re-exported via `packages/shared/src/ai/index.ts`.)

- [ ] **Step 3: Refactor the handler to delegate**

In `apps/ingestion/src/ai-jobs/handlers.ts`, replace the whole `EXTRACT_COURSE_SKILLS` case (from `EXTRACT_COURSE_SKILLS: async ({ entityId, triggeredByUserId }) => {` through its closing `},`) with:

```typescript
    EXTRACT_COURSE_SKILLS: async ({ entityId, triggeredByUserId }) => {
      const outcome = await runCourseSkillExtraction({
        courseId: entityId,
        ai: deps.ai,
        triggeredByUserId,
        // The ai-job is an explicit user-triggered (re-)run: preserve the
        // prior behaviour, which never checked for an existing extraction.
        force: true,
        autoApproveThreshold: deps.autoApproveThreshold,
      });
      if (outcome.status === 'SKIPPED') return { status: 'SKIPPED', message: outcome.reason };
      if (outcome.status === 'FAILED') return { status: 'FAILED', message: outcome.reason };
      logger.log(
        `course-skills for course ${entityId}: ${outcome.skillsMatched} skills, ` +
          `${outcome.skillsProposed} proposed, conf=${outcome.confidence.toFixed(2)} ` +
          `→ ${outcome.autoApproved ? 'AUTO_APPROVED' : 'PENDING_REVIEW'}`,
      );
      return {
        status: 'SUCCEEDED',
        aiExtractionId: outcome.aiExtractionId,
        aiInferenceId: outcome.aiInferenceId ?? undefined,
      };
    },
```

Add the import near the other relative imports:

```typescript
import { runCourseSkillExtraction } from '../course-skills/run';
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/ingestion && npx tsc --noEmit`
Expected: no errors. (If `Prisma` or `CourseSkillExtractionSchema` are now unused in `handlers.ts`, remove them from its imports — `noUnusedLocals` may flag them.)

- [ ] **Step 5: Confirm the live endpoint contract is unchanged**

Run: `grep -n -B3 -A10 "EXTRACT_COURSE_SKILLS" apps/api/src/skills/skills.controller.ts`
Expected: read the enqueue site and confirm it still matches — same job kind name, same `entityId` input, same `{status, aiExtractionId, aiInferenceId}` result shape. Read-only confirmation; no code change here.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/course-skills/run.ts apps/ingestion/src/ai-jobs/handlers.ts
git commit -m "refactor(ai-jobs): extract runCourseSkillExtraction with parse-retry"
```

---

### Task 7: `materialiseCourseSkills()`

**Files:**
- Create: `packages/db/src/course-skill-materialize.ts`
- Modify: `packages/db/src/index.ts` (add export)

Mirrors `materialiseProgramDigest()`, including its actual idempotency approach — natural upsert idempotency plus an existence check before creating `PROPOSED_SKILL` rows. (The spec assumed a timestamp marker; the real function doesn't use one, so this doesn't either.)

No dedicated vitest file — `materialiseProgramDigest` itself has no test coverage in this codebase; this is verified operationally in Task 10.

- [ ] **Step 1: Write the module**

```typescript
// packages/db/src/course-skill-materialize.ts
import { z } from 'zod';
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Post-approval materialisation for `COURSE_SKILLS` extractions. Mirrors
// packages/db/src/program-digest-materialize.ts:
//   1. Resolved skillIds → CourseSkill rows (upsert on courseId+skillId).
//   2. Unmatched proposedSkills[] → sibling AiExtraction rows with
//      extractionKind='PROPOSED_SKILL' — the same analyst-review path the
//      digest pipeline already feeds.
//
// Idempotency: the CourseSkill upsert is naturally safe to re-run;
// PROPOSED_SKILL creation is deduped by checking for an existing row with
// the same (courseId, nameTh), matching how materialiseProgramDigest
// dedupes on (programId, nameTh).
// ─────────────────────────────────────────────────────────────────────────────

const CourseSkillPayloadShapeSchema = z.object({
  skills: z
    .array(
      z.object({
        skillId: z.string(),
        weight: z.number().min(0).max(1),
        evidence: z.string().optional().default(''),
      }),
    )
    .default([]),
  proposedSkills: z
    .array(
      z.object({
        nameTh: z.string(),
        nameEn: z.string().optional().default(''),
        suggestedParentSkillId: z.string().optional().default(''),
        rationale: z.string().optional().default(''),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
});

export interface MaterialiseCourseSkillsResult {
  courseId: string;
  skillsLinked: number;
  skillsProposed: number;
  /** skillIds the model returned that don't exist in the taxonomy. Should
   *  be near-zero now that candidates come from a real similarity search;
   *  a nonzero value is worth investigating, not ignoring. */
  skillIdsUnresolved: number;
}

/**
 * Apply an approved `COURSE_SKILLS` extraction to its target Course.
 *
 * Pre-condition (caller's responsibility): the extraction is APPROVED or
 * AUTO_APPROVED. This function asserts only kind/entity-type.
 */
export async function materialiseCourseSkills(
  extractionId: string,
): Promise<MaterialiseCourseSkillsResult> {
  const extraction = await prisma.aiExtraction.findUniqueOrThrow({
    where: { id: extractionId },
    select: {
      id: true,
      sourceEntityType: true,
      sourceEntityId: true,
      extractionKind: true,
      methodVersion: true,
      payloadJson: true,
    },
  });
  if (extraction.extractionKind !== 'COURSE_SKILLS') {
    throw new Error(
      `materialiseCourseSkills: expected extractionKind=COURSE_SKILLS, got ${extraction.extractionKind}`,
    );
  }
  if (extraction.sourceEntityType !== 'course') {
    throw new Error(
      `materialiseCourseSkills: expected sourceEntityType=course, got ${extraction.sourceEntityType}`,
    );
  }

  const courseId = extraction.sourceEntityId;
  const payload = CourseSkillPayloadShapeSchema.parse(extraction.payloadJson);

  // Resolve every claimed skillId in one query, then write only the real ones.
  const claimedIds = payload.skills.map((s) => s.skillId).filter(Boolean);
  const realSkills = claimedIds.length
    ? await prisma.skill.findMany({ where: { id: { in: claimedIds } }, select: { id: true } })
    : [];
  const realSkillIds = new Set(realSkills.map((s) => s.id));

  let skillsLinked = 0;
  let skillIdsUnresolved = 0;
  for (const s of payload.skills) {
    if (!s.skillId) continue;
    if (!realSkillIds.has(s.skillId)) {
      skillIdsUnresolved++;
      continue;
    }
    await prisma.courseSkill.upsert({
      where: { courseId_skillId: { courseId, skillId: s.skillId } },
      create: {
        courseId,
        skillId: s.skillId,
        weight: s.weight,
        source: 'LLM_EXTRACTED',
        confidence: payload.confidence,
      },
      update: { weight: s.weight, confidence: payload.confidence },
    });
    skillsLinked++;
  }

  // Proposed skills → the shared analyst taxonomy-growth queue.
  const autoApproveThreshold = Number(process.env.AI_AUTO_APPROVE_THRESHOLD ?? 0);
  const proposedConfidence = 0.7;
  let skillsProposed = 0;
  for (const ps of payload.proposedSkills) {
    if (!ps.nameTh) continue;
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'course',
        sourceEntityId: courseId,
        extractionKind: 'PROPOSED_SKILL',
        reviewStatus: { in: ['PENDING_REVIEW', 'AUTO_APPROVED', 'APPROVED'] },
        payloadJson: { path: ['nameTh'], equals: ps.nameTh },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.aiExtraction.create({
      data: {
        sourceEntityType: 'course',
        sourceEntityId: courseId,
        extractionKind: 'PROPOSED_SKILL',
        payloadJson: ps,
        confidence: proposedConfidence,
        methodVersion: extraction.methodVersion,
        reviewStatus: proposedConfidence >= autoApproveThreshold ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
      },
    });
    skillsProposed++;
  }

  return { courseId, skillsLinked, skillsProposed, skillIdsUnresolved };
}
```

- [ ] **Step 2: Export it**

In `packages/db/src/index.ts`, alongside the existing `export * from './program-digest-materialize';` (line 33):

```typescript
export * from './course-skill-materialize';
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/db && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/course-skill-materialize.ts packages/db/src/index.ts
git commit -m "feat(curriculum): add materialiseCourseSkills"
```

---

### Task 8: Wire materialisation into the approve endpoints

**Files:**
- Modify: `apps/api/src/ai-admin/ai-admin.controller.ts`

- [ ] **Step 1: Update the import**

Change:
```typescript
import { Prisma, prisma, materialiseProgramDigest, materialiseImdRankings } from '@kku/db';
```
to:
```typescript
import { Prisma, prisma, materialiseProgramDigest, materialiseImdRankings, materialiseCourseSkills } from '@kku/db';
```

- [ ] **Step 2: Add the branch in `approve()`**

After the existing `IMD_RANKINGS` block and immediately before the final `return updated;`:

```typescript
    if (updated.extractionKind === 'COURSE_SKILLS') {
      try {
        const result = await materialiseCourseSkills(id);
        return { ...updated, materialisation: result };
      } catch (err) {
        // Don't unwind the approval — materialisation can be retried.
        return {
          ...updated,
          materialisationError: err instanceof Error ? err.message : String(err),
        };
      }
    }
```

- [ ] **Step 3: Add the branch in `approveAllPending()`**

Change:
```typescript
        } else if (ext.extractionKind === 'IMD_RANKINGS') {
          await materialiseImdRankings(ext.id);
          materialised += 1;
        }
```
to:
```typescript
        } else if (ext.extractionKind === 'IMD_RANKINGS') {
          await materialiseImdRankings(ext.id);
          materialised += 1;
        } else if (ext.extractionKind === 'COURSE_SKILLS') {
          await materialiseCourseSkills(ext.id);
          materialised += 1;
        }
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-admin/ai-admin.controller.ts
git commit -m "feat(ai-admin): materialise COURSE_SKILLS on approve"
```

---

### Task 9: Bulk course-skill-extraction script

**Files:**
- Create: `apps/ingestion/src/scripts/extract-course-skills-bulk.ts`
- Modify: `package.json` (scripts block)

Fixes **G8** with a hard preflight: if fewer than 90% of skills have embeddings, the script refuses to start rather than silently producing weak matches. Also passes `requireVectorCandidates` so any individual course that would fall back is skipped, not degraded.

- [ ] **Step 1: Write the script**

```typescript
#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Bulk-run course-skills.v2 against every Course row without an existing
// COURSE_SKILLS extraction.
//
// PRECONDITION: `pnpm skills:backfill-embeddings` must have run first.
// Without embeddings the candidate search silently degrades to a
// recency-ordered sample — exactly the weak grounding this project exists
// to remove — so this script refuses to start rather than produce it.
//
// Auto-approve threshold is DEDICATED to this pipeline
// (COURSE_SKILLS_AUTO_APPROVE_THRESHOLD, default 0.85) rather than the
// shared AI_AUTO_APPROVE_THRESHOLD, which defaults to 0 (auto-approve
// everything) under the 2026-05-13 operator policy. AUTO_APPROVED rows
// materialise immediately; PENDING_REVIEW rows wait in
// /admin/extraction-review, where approving one also materialises it.
//
// Resumable: eligibility excludes courses that already have a
// COURSE_SKILLS extraction, so an interrupted run is restarted by simply
// re-issuing the same command.
//
// Usage:
//   pnpm curriculum:extract-course-skills                    # everything
//   pnpm curriculum:extract-course-skills --limit 20         # smoke-test cap
//   pnpm curriculum:extract-course-skills --program KKU-SEQ-0123
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
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

import { prisma, PrismaAiInferenceRecorder, materialiseCourseSkills } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';
import { runCourseSkillExtraction } from '../course-skills/run';
import { countSkillsWithEmbedding } from '../lib/skill-embeddings';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return args[i + 1];
}
const PROGRAM_CODE = flag('program');
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();
const AUTO_APPROVE_THRESHOLD = Number(process.env.COURSE_SKILLS_AUTO_APPROVE_THRESHOLD ?? 0.85);
// Pacing between courses. Each course costs one embed + one extraction
// call; the embedding quota is per-minute and shared across the base model.
const INTER_COURSE_DELAY_MS = 500;
const MIN_EMBEDDING_COVERAGE = 0.9;

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `course-skill-extraction-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);

function audit(record: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  console.log(`Auto-approve threshold: ${AUTO_APPROVE_THRESHOLD}`);

  // ── Preflight: embeddings must exist, or candidate quality collapses ──
  const totalSkills = await prisma.skill.count();
  const embedded = await countSkillsWithEmbedding();
  const coverage = totalSkills === 0 ? 0 : embedded / totalSkills;
  console.log(`Skill embedding coverage: ${embedded}/${totalSkills} (${(coverage * 100).toFixed(1)}%)`);
  if (coverage < MIN_EMBEDDING_COVERAGE) {
    console.error(
      `\nRefusing to run: embedding coverage ${(coverage * 100).toFixed(1)}% is below the ` +
        `${(MIN_EMBEDDING_COVERAGE * 100).toFixed(0)}% floor.\n` +
        `Run \`pnpm skills:backfill-embeddings\` first — without embeddings the candidate\n` +
        `search degrades to an arbitrary recency sample and the extractions would be weak.`,
    );
    audit({ event: 'preflight_failed', embedded, totalSkills, coverage });
    process.exitCode = 1;
    return;
  }
  audit({ event: 'start', programFilter: PROGRAM_CODE, limit: LIMIT, autoApproveThreshold: AUTO_APPROVE_THRESHOLD, coverage });

  const alreadyExtracted = await prisma.aiExtraction.findMany({
    where: { sourceEntityType: 'course', extractionKind: 'COURSE_SKILLS' },
    select: { sourceEntityId: true },
  });
  const excludeIds = alreadyExtracted.map((e) => e.sourceEntityId);

  const courses = await prisma.course.findMany({
    where: {
      ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      ...(PROGRAM_CODE ? { program: { code: PROGRAM_CODE } } : {}),
    },
    select: { id: true, code: true, program: { select: { code: true } } },
    orderBy: { code: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`Eligible courses: ${courses.length}`);
  audit({ event: 'eligible', count: courses.length });
  if (courses.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const ai = createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let autoApproved = 0;
  let materialised = 0;

  for (let i = 0; i < courses.length; i++) {
    const c = courses[i]!;
    const prefix = `[${(i + 1).toString().padStart(4)}/${courses.length}] ${c.program.code} / ${c.code}`;

    const outcome = await runCourseSkillExtraction({
      courseId: c.id,
      ai,
      autoApproveThreshold: AUTO_APPROVE_THRESHOLD,
      requireVectorCandidates: true,
    });

    if (outcome.status === 'SUCCEEDED') {
      succeeded++;
      let materialisedThisRow = false;
      let materialisationError: string | null = null;
      if (outcome.autoApproved) {
        autoApproved++;
        try {
          await materialiseCourseSkills(outcome.aiExtractionId);
          materialised++;
          materialisedThisRow = true;
        } catch (err) {
          materialisationError = err instanceof Error ? err.message : String(err);
        }
      }
      console.log(
        `${prefix}  ✓ conf=${outcome.confidence.toFixed(2)}  ${outcome.skillsMatched} skills  ` +
          `${outcome.skillsProposed} proposed  ${outcome.autoApproved ? 'AUTO_APPROVED' : 'PENDING_REVIEW'}` +
          (materialisedThisRow ? '  materialised' : '') +
          (materialisationError ? `  MATERIALISE-FAILED: ${materialisationError.slice(0, 80)}` : ''),
      );
      audit({
        event: 'course',
        index: i + 1,
        courseId: c.id,
        courseCode: c.code,
        programCode: c.program.code,
        status: 'success',
        confidence: outcome.confidence,
        skillsMatched: outcome.skillsMatched,
        skillsProposed: outcome.skillsProposed,
        autoApproved: outcome.autoApproved,
        materialised: materialisedThisRow,
        materialisationError,
      });
    } else {
      if (outcome.status === 'SKIPPED') skipped++;
      else failed++;
      console.log(`${prefix}  ✗ ${outcome.status}: ${outcome.reason.slice(0, 160)}`);
      audit({
        event: 'course',
        index: i + 1,
        courseId: c.id,
        courseCode: c.code,
        programCode: c.program.code,
        status: outcome.status.toLowerCase(),
        errorMessage: outcome.reason,
      });
    }

    if (i + 1 < courses.length) await sleep(INTER_COURSE_DELAY_MS);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Succeeded:    ${succeeded}`);
  console.log(`Skipped:      ${skipped}`);
  console.log(`Failed:       ${failed}`);
  console.log(`Auto-approved:${autoApproved}`);
  console.log(`Materialised: ${materialised}`);
  audit({ event: 'end', succeeded, skipped, failed, autoApproved, materialised });
}

main()
  .catch((err) => {
    console.error(err);
    audit({ event: 'fatal', error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Register the script**

```json
    "curriculum:extract-course-skills": "tsx apps/ingestion/src/scripts/extract-course-skills-bulk.ts",
```

- [ ] **Step 3: Verify the preflight guard actually fires**

At this point only ~50 of 5,152 skills are embedded (from Task 3's smoke tests), so coverage is ~1% — well under the floor.

Run: `pnpm curriculum:extract-course-skills --limit 5`
Expected: exits with the "Refusing to run: embedding coverage 1.0% is below the 90% floor" message and a non-zero exit code. **This is the check that G8 is fixed** — the script must refuse rather than silently produce weak data.

- [ ] **Step 4: Commit**

```bash
git add apps/ingestion/src/scripts/extract-course-skills-bulk.ts package.json
git commit -m "feat(curriculum): bulk course-skill extraction with embedding preflight"
```

---

### Task 10: Full-scale run + verification

**Files:** none — operational task, running the three scripts in order against the real dev database.

**Wall-clock expectation (G10):** the extraction step makes 2,638 sequential passes, each costing one embedding call plus one extraction call, with 500ms pacing between courses. Budget **several hours**. It is fully resumable — re-issuing the same command picks up where it stopped, because eligibility excludes courses that already have an extraction. Run it under `nohup`/`tmux` rather than a foreground shell.

- [ ] **Step 1: Run the embedding backfill at full scale**

Run: `pnpm skills:backfill-embeddings`
Expected: `Summary: ~5100 embedded / <small> failed`, `Total skills with an embedding now: ~5152`. Transient 429s should be absorbed by the backoff (you'll see `[skill-embeddings] transient embed failure ... waiting Ns` lines — those are normal, not errors). Re-run once to sweep up any stragglers; it's idempotent.

- [ ] **Step 2: Verify embedding coverage and that stored vectors are the right width**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const r = await prisma.\$queryRaw\`
    SELECT COUNT(*)::int AS with_embedding,
           MIN(vector_dims(embedding))::int AS min_dims,
           MAX(vector_dims(embedding))::int AS max_dims
    FROM skills WHERE embedding IS NOT NULL\`;
  const total = await prisma.skill.count();
  console.log({ total, ...(r as any[])[0] });
  await prisma.\$disconnect();
})();
"
```
Expected: `with_embedding` at or near 5,152, and **`min_dims` = `max_dims` = 1536**. A different width means the dimension constant wasn't applied and the candidate query will fail — stop and fix before continuing.

- [ ] **Step 3: Run course materialisation at full scale**

Run: `pnpm curriculum:materialise-courses`
Expected: `Courses created:` close to 2,638 (minus any created during Task 5's smoke test), `Programmes failed: 0`. Note the `Descriptions matched` vs `unmatched` split — it tells you how many courses carry real content into the extraction step.

- [ ] **Step 4: Smoke-test extraction now that the preflight passes**

Run: `pnpm curriculum:extract-course-skills --limit 5`
Expected: the coverage line now reads ~100%, the run proceeds, and 5 courses complete. Confirm at least some report a non-zero `skills` count.

- [ ] **Step 5: Run extraction at full scale**

Run: `nohup pnpm curriculum:extract-course-skills > logs/course-skills-run.out 2>&1 &`
Then follow progress with: `tail -f logs/course-skills-run.out`
Expected: runs to completion over several hours; final summary line reports the succeeded/skipped/failed/materialised split.

- [ ] **Step 6: Verify final counts against the spec's acceptance criteria**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const courses = await prisma.course.count();
  const courseSkills = await prisma.courseSkill.count();
  const coursesWithSkills = (await prisma.courseSkill.groupBy({ by: ['courseId'] })).length;
  const extractions = await prisma.aiExtraction.groupBy({
    by: ['reviewStatus'], where: { extractionKind: 'COURSE_SKILLS' }, _count: true,
  });
  const proposed = await prisma.aiExtraction.count({
    where: { extractionKind: 'PROPOSED_SKILL', sourceEntityType: 'course' },
  });
  const cost = await prisma.aiInference.aggregate({
    where: { kind: { in: ['course-skills.extract', 'candidate-skill-search', 'skill-embedding-backfill'] } },
    _sum: { costEstimateUsd: true },
  });
  console.log(JSON.stringify({ courses, courseSkills, coursesWithSkills, extractions, proposedSkillRows: proposed, totalCostUsd: cost._sum.costEstimateUsd }, null, 2));
  await prisma.\$disconnect();
})();
"
```
Expected: `courses` ≈ 2,638; `courseSkills` > 0; `coursesWithSkills` a large fraction of `courses`; `extractions` split across `AUTO_APPROVED` and `PENDING_REVIEW`; `totalCostUsd` in the $15–30 range from the spec (informational — materially higher is worth investigating, not an automatic failure).

- [ ] **Step 7: Spot-check that candidate quality actually improved**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const sample = await prisma.aiExtraction.findMany({
    where: { extractionKind: 'COURSE_SKILLS' }, take: 5, orderBy: { createdAt: 'desc' },
    select: { sourceEntityId: true, payloadJson: true, confidence: true },
  });
  for (const s of sample) {
    const course = await prisma.course.findUnique({ where: { id: s.sourceEntityId }, select: { code: true, nameEn: true, nameTh: true } });
    const skillIds = ((s.payloadJson as any).skills ?? []).map((x: any) => x.skillId);
    const names = await prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { nameEn: true } });
    console.log(\`\${course?.code} \${course?.nameEn || course?.nameTh} (conf \${s.confidence}) -> \${names.map(n => n.nameEn).join(', ')}\`);
  }
  await prisma.\$disconnect();
})();
"
```
Expected: read by hand. Each course's matched skills should plausibly relate to its subject — a data-structures course matching computing skills, not agriculture. This is the qualitative confirmation that the cosine-similarity fix (Tasks 1 & 4) delivered real candidates. If all five samples look arbitrary, stop and re-investigate before declaring the project done.

- [ ] **Step 8: Confirm the review queue renders `PENDING_REVIEW` rows**

Manual: with the dev stack running (`pnpm dev`), sign in as ADMIN or ANALYST, open `/admin/extraction-review`, filter kind `COURSE_SKILLS`. Expected: pending rows render with their payload, same as `PROGRAM_DIGEST` rows — confirming no new UI was needed, per the spec's non-goals.

No commit — this task verifies work committed in Tasks 1-9.

---

## Self-Review

**Spec coverage:** all five spec components map to tasks — embedding backfill (Task 3), candidate-selection fix (Tasks 1 + 4), course materialisation (Tasks 2 + 5), course-skill extraction (Tasks 6 + 9), materialisation-on-approval and its wiring (Tasks 7 + 8). Spec acceptance criteria are Task 10. Non-goals (no ongoing pipeline hook, no new UI, no Phase 2 feature, no fuzzy name matching) are all respected.

**Placeholder scan:** no TBD/TODO; every code step carries complete file contents or complete before/after diffs.

**Type consistency:** `CandidateSkill` (Task 1) is the single candidate shape, consumed by Task 4's handler delegate and Task 6's `runCourseSkillExtraction`. `EMBEDDING_DIMENSIONS` (Task 1) is the sole dimension authority, used on the write side (Task 3) and query side (Task 1's `findCandidateSkills`) — the two sides cannot drift apart. `DigestCourseEntry` (Task 2) is used only by Task 5. `RunCourseSkillExtractionOutcome`'s `SUCCEEDED` shape is consumed identically in Task 6's handler and Task 9's script (including the added `usedFallbackCandidates` field). `MaterialiseCourseSkillsResult` (Task 7) is returned to Task 8's endpoint and Task 9's script, neither of which destructures its fields.

**Ordering dependency:** Tasks 1 → 3 → 9's preflight form a chain (library → embeddings populated → extraction allowed to run). Task 9 Step 3 deliberately verifies the guard *fires* while coverage is still low, before Task 10 satisfies it — so the safety mechanism is proven, not assumed.

## Execution Handoff

Plan revised and saved to `docs/superpowers/plans/2026-09-01-course-skill-materialisation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

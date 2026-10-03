# Program overlap (`program-overlap.v1`) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure curriculum overlap between same-level KKU programmes (shared courses, equivalent courses, PLO alignment), recommend graded "for review" actions, raise two risk KRIs, and show the results on an Education heatmap, a Risk panel and a Program Deep-Dive section.

**Architecture:**
- **Data prep** fills course categories (existing phase 2b at v4), course descriptions and CLOs, a PLO table and 1536-dimension embeddings.
- **The scoring core** is pure TypeScript in `packages/db/src/program-overlap/`, deterministic and fully unit-tested.
- **An ingestion runner** loads the vectors, scores every same-level pair in memory and writes a `ProgramOverlapRun` with its `ProgramOverlapPair` rows. A pipeline phase `phaseOV` recomputes the pairs that involve the selected programmes.
- **AI** writes only the recommendation wording, for flagged pairs.
- **Risk** reads the latest run into `ProgramRiskInputs` and evaluates two new KRIs.
- **The UI** reads through `packages/db/src/program-overlap/read.ts` via three API endpoints.

**Tech stack:** Prisma + PostgreSQL 16 / pgvector (raw SQL only for vector columns, results Zod-validated), Vitest, NestJS, Next.js 14, inline-SVG viz in `@kku/ui`, `AiService` (`gemini-embedding-001` at 1536 dimensions; `extractStructured`).

**Spec:** `docs/superpowers/specs/2026-10-03-program-overlap-design.md`. Read it first; this plan implements it section by section.

**Ground rules for every task**
- Run tests from the package directory: `cd packages/db && pnpm vitest run <file>`, the same in `apps/ingestion`, `apps/api` and `apps/web`.
- Commit with `git commit -F <msgfile>`. The message file goes in your scratchpad under a unique name; delete only your own file afterwards. End every message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never `git add` `handoff.md` or `presentation_*.md`. Never run `pnpm build:release`. Never push.
- **DB safety:** a PreToolUse guard denies destructive DB commands. Never pass `--shadow-database-url` and never use `migrate diff --from-migrations`. Generate SQL with `--from-schema-datasource`, then apply it with `migrate deploy`. Back up dev before migrating: `bash scripts/dev-guard/dev-backup.sh`.
- **Prisma CLI:** run it from `packages/db` (`pnpm prisma …`). `npx prisma` at the repo root resolves a global v7 that rejects the schema.
- **Code rules:**
  - TypeScript strict, no `any`.
  - Plain Prisma everywhere except vector columns.
  - Never nest `Prisma.sql` fragments, because Next.js server components read these modules.
  - Design tokens only. No hex. `border-border-*` emits nothing, so use `border-subtle`.
- **Pipeline scripts:** any new standalone script the worker spawns, or that operators run on prod, must be added to `apps/ingestion/scripts/bundle-pipeline-scripts.ts` TARGETS.
- **Restart dev servers after editing `packages/*`.** They do not hot-reload packages.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` + migration `20261003120000_program_overlap` | New models and columns (Task 1) |
| `packages/db/src/program-overlap/text.ts` | Pure text helpers: PLO normalisation, market-profile text, hash, language-variant name key |
| `packages/db/src/program-overlap/score.ts` | Pure scoring: constants, major-course filter, layers, matching, index, containment, bands, actions, evidence hash |
| `packages/db/src/program-overlap/cluster.ts` | Pure: average-linkage ordering and overlap groups |
| `packages/db/src/program-overlap/vectors.ts` | Raw-SQL vector reads and writes (Zod-validated), `toVectorLiteral` |
| `packages/db/src/program-overlap/load.ts` | Loads the scoring input for one level |
| `packages/db/src/program-overlap/read.ts` | Read models for the API: matrix, pair detail, programme siblings, self-competition |
| `packages/db/src/program-overlap/index.ts` | Barrel; re-exported from `packages/db/src/index.ts` |
| `apps/ingestion/src/program-overlap/prep.ts` | PLO table, course descriptions, market profiles, embeddings |
| `apps/ingestion/src/program-overlap/run.ts` | `runProgramOverlap` (scoring + storage) and `runOverlapRecommendations` (AI) |
| `apps/ingestion/src/scripts/programs-overlap-prep.ts`, `programs-overlap.ts` | CLIs |
| `packages/shared/src/ai/prompts/program-overlap-recommendation.ts` | Prompt (conformant to the standard from birth) |
| `packages/db/src/risk-scoring.ts`, `risk-measure-rules.ts` | Two KRIs, rules, versions |
| `apps/api/src/education/program-overlap.controller.ts` (+ module wiring) | `/education/program-overlap` endpoints |
| `apps/api/src/programs/deep-dive.controller.ts` | `GET /programs/:id/overlap` |
| `apps/api/src/risks/risks.controller.ts` | `GET /risks/self-competition` |
| `packages/ui/src/viz/overlap-matrix.tsx` | `OverlapMatrix` |
| `apps/web/app/education/program-overlap/*` | Dashboard page |
| `apps/web/app/programs/[id]/overlap-section.tsx` | Deep-Dive section |
| `apps/web/app/risks/self-competition-panel.tsx` | Risk panel |
| `docs/methodologies/program-overlap.md` + docs | Documentation |

---

## Phase A — Data preparation

### Task 1: Schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261003120000_program_overlap/migration.sql`

- [ ] **Step 1: Back up dev**

Run: `bash scripts/dev-guard/dev-backup.sh`
Expected: a new dump under `~/program-landscape-dev-backups`, validated by its own `pg_restore --list` check.

- [ ] **Step 2: Add the columns to `ProgramCourse`** (model at ~line 4680, after `category`):

```prisma
  /// program-overlap.v1: course description + CLOs copied from the latest
  /// approved PROGRAM_DIGEST (matched on normalised code). NULL when the digest
  /// did not list the course (it caps at 80 per programme).
  descriptionTh      String?   @map("description_th") @db.Text
  learningOutcomesTh String[]  @default([]) @map("learning_outcomes_th")
  /// Embedding of name + description + CLOs (major courses only), 1536-d,
  /// L2-normalised. Written via raw SQL only.
  embedding          Unsupported("vector(1536)")?
  /// sha256 of the text that produced `embedding`; re-embed only on change.
  embeddingTextHash  String?   @map("embedding_text_hash")
```

- [ ] **Step 3: Add the new enums and models** (append near the other programme models):

```prisma
enum OverlapAction {
  COORDINATE_SHARED_COURSES
  CONSOLIDATE_EQUIVALENT_COURSES
  SHARE_STAFF_RESOURCES
  DIFFERENTIATE
  CONSIDER_MERGE_OR_TRACK
}

enum OverlapBand {
  HIGH
  MODERATE
  LOW
  NONE
}

enum OverlapRunStatus {
  RUNNING
  SUCCEEDED
  FAILED
}

/// program-overlap.v1 — one PLO of a programme, from the latest
/// PROGRAM_SKILLS_DETAILED extraction.
model ProgramLearningOutcome {
  id                 String           @id @default(cuid())
  programId          String           @map("program_id")
  program            Program          @relation(fields: [programId], references: [id], onDelete: Cascade)
  ordinal            Int
  textTh             String           @map("text_th") @db.Text
  textNormalised     String           @map("text_normalised") @db.Text
  programRevisionId  String?          @map("program_revision_id")
  sourceExtractionId String           @map("source_extraction_id")
  embedding          Unsupported("vector(1536)")?
  embeddingTextHash  String?          @map("embedding_text_hash")
  createdAt          DateTime         @default(now()) @map("created_at")

  @@unique([programId, ordinal])
  @@index([programId])
  @@map("program_learning_outcomes")
}

/// program-overlap.v1 — the programme's market-facing text (degree names,
/// recruitment summary, careers) and its embedding.
model ProgramMarketProfile {
  programId  String   @id @map("program_id")
  program    Program  @relation(fields: [programId], references: [id], onDelete: Cascade)
  text       String   @db.Text
  textHash   String   @map("text_hash")
  embedding  Unsupported("vector(1536)")?
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@map("program_market_profiles")
}

/// One overlap computation. A full run has empty scopeProgramIds; a phaseOV run
/// lists the programmes it recomputed. Readers take the latest SUCCEEDED full
/// run per level and overlay newer scoped runs for the pairs they cover.
model ProgramOverlapRun {
  id                 String               @id @default(cuid())
  methodologyVersion String               @map("methodology_version")
  level              ProgramLevel?
  scopeProgramIds    String[]             @default([]) @map("scope_program_ids")
  status             OverlapRunStatus     @default(RUNNING)
  startedAt          DateTime             @default(now()) @map("started_at")
  completedAt        DateTime?            @map("completed_at")
  pairsScored        Int                  @default(0) @map("pairs_scored")
  pairsStored        Int                  @default(0) @map("pairs_stored")
  thresholdsJson     Json                 @map("thresholds_json")
  coverageJson       Json?                @map("coverage_json")
  errorText          String?              @map("error_text") @db.Text
  pairs              ProgramOverlapPair[]

  @@index([status, level, completedAt])
  @@map("program_overlap_runs")
}

model ProgramOverlapPair {
  id                 String                         @id @default(cuid())
  runId              String                         @map("run_id")
  run                ProgramOverlapRun              @relation(fields: [runId], references: [id], onDelete: Cascade)
  level              ProgramLevel
  programAId         String                         @map("program_a_id")
  programA           Program                        @relation("OverlapPairA", fields: [programAId], references: [id], onDelete: Cascade)
  programBId         String                         @map("program_b_id")
  programB           Program                        @relation("OverlapPairB", fields: [programBId], references: [id], onDelete: Cascade)
  structure          Float?
  content            Float?
  outcome            Float?
  overlapIndex       Float?                         @map("overlap_index")
  containmentAInB    Float?                         @map("containment_a_in_b")
  containmentBInA    Float?                         @map("containment_b_in_a")
  band               OverlapBand
  sharedCredits      Float                          @default(0) @map("shared_credits")
  equivCredits       Float                          @default(0) @map("equiv_credits")
  sharedStaff        Int                            @default(0) @map("shared_staff")
  marketSimilarity   Float?                         @map("market_similarity")
  languageVariant    Boolean                        @default(false) @map("language_variant")
  actions            OverlapAction[]                @default([])
  primaryAction      OverlapAction?                 @map("primary_action")
  evidenceJson       Json                           @map("evidence_json")
  evidenceHash       String                         @map("evidence_hash")
  methodologyVersion String                         @map("methodology_version")
  createdAt          DateTime                       @default(now()) @map("created_at")
  recommendation     ProgramOverlapRecommendation?

  @@unique([runId, programAId, programBId])
  @@index([programAId])
  @@index([programBId])
  @@index([level, overlapIndex])
  @@map("program_overlap_pairs")
}

model ProgramOverlapRecommendation {
  id                  String             @id @default(cuid())
  pairId              String             @unique @map("pair_id")
  pair                ProgramOverlapPair @relation(fields: [pairId], references: [id], onDelete: Cascade)
  rationale           String             @db.Text
  distinctiveA        String             @map("distinctive_a") @db.Text
  distinctiveB        String             @map("distinctive_b") @db.Text
  nextSteps           String[]           @map("next_steps")
  confidence          Float
  disagreesWithAction Boolean            @default(false) @map("disagrees_with_action")
  disagreementReason  String?            @map("disagreement_reason") @db.Text
  promptVersion       String             @map("prompt_version")
  aiInferenceId       String?            @map("ai_inference_id")
  evidenceHash        String             @map("evidence_hash")
  createdAt           DateTime           @default(now()) @map("created_at")

  @@map("program_overlap_recommendations")
}
```

Add the back-relations on `Program`:

```prisma
  learningOutcomes      ProgramLearningOutcome[]
  marketProfile         ProgramMarketProfile?
  overlapPairsA         ProgramOverlapPair[]     @relation("OverlapPairA")
  overlapPairsB         ProgramOverlapPair[]     @relation("OverlapPairB")
```

- [ ] **Step 4: Generate the SQL** (safe form), from `packages/db`:

```bash
cd packages/db
pnpm prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > /tmp/overlap.sql
```

Review `/tmp/overlap.sql`:
- it must contain only CREATE TYPE, CREATE TABLE, ALTER TABLE … ADD COLUMN, CREATE INDEX and ADD CONSTRAINT;
- no DROP;
- the `vector(1536)` columns appear as `vector(1536)`.

If the diff picks up unrelated drift, remove those statements and note them in the report. Strip any Prisma banner lines, then save the file as `prisma/migrations/20261003120000_program_overlap/migration.sql`.

- [ ] **Step 5: Apply and generate**

```bash
cd packages/db && pnpm prisma migrate deploy && pnpm prisma generate
```

Expected: "1 migration applied". Then `pnpm tsc --noEmit -p .` must be clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261003120000_program_overlap
git commit -F <msg>   # feat(db): program-overlap schema (PLOs, market profiles, overlap runs/pairs)
```

---

### Task 2: Pure text helpers

**Files:**
- Create: `packages/db/src/program-overlap/text.ts`, `packages/db/test/program-overlap-text.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildMarketProfileText,
  courseEmbeddingText,
  languageVariantKey,
  normalisePloText,
  sha256,
} from '../src/program-overlap/text';

describe('normalisePloText', () => {
  it('strips leading PLO labels and numbering', () => {
    expect(normalisePloText('PLO 1.1 อธิบายหลักการทางวิศวกรรม')).toBe('อธิบายหลักการทางวิศวกรรม');
    expect(normalisePloText('PLO1: Apply statistics')).toBe('Apply statistics');
    expect(normalisePloText('ELO 2 ประยุกต์ใช้')).toBe('ประยุกต์ใช้');
    expect(normalisePloText('3. วิเคราะห์ข้อมูล')).toBe('วิเคราะห์ข้อมูล');
    expect(normalisePloText('  ใช้เครื่องมือ  ')).toBe('ใช้เครื่องมือ');
  });
  it('keeps text that has no label', () => {
    expect(normalisePloText('สื่อสารได้อย่างมีประสิทธิภาพ')).toBe('สื่อสารได้อย่างมีประสิทธิภาพ');
  });
});

describe('languageVariantKey', () => {
  it('drops international markers and whitespace', () => {
    expect(languageVariantKey('วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ (หลักสูตรนานาชาติ)')).toBe(
      languageVariantKey('วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์'),
    );
    expect(languageVariantKey('ABC (นานาชาติ)')).toBe('abc');
  });
});

describe('buildMarketProfileText', () => {
  it('joins degree names, recruitment summary and careers, skipping blanks', () => {
    expect(
      buildMarketProfileText({
        nameTh: 'ก',
        nameEn: 'A',
        degreeNameTh: 'วท.บ.',
        degreeNameEn: null,
        recruitmentSummaryTh: 'สรุป',
        careers: ['นักวิเคราะห์', 'วิศวกร'],
      }),
    ).toBe('ก / A\nวท.บ.\nสรุป\nCareers: นักวิเคราะห์; วิศวกร');
  });
});

describe('courseEmbeddingText', () => {
  it('uses names, description and CLOs', () => {
    expect(
      courseEmbeddingText({ nameTh: 'สถิติ', nameEn: 'Statistics', descriptionTh: 'ความน่าจะเป็น', learningOutcomesTh: ['คำนวณ'] }),
    ).toBe('สถิติ / Statistics\nความน่าจะเป็น\nCLO: คำนวณ');
  });
});

describe('sha256', () => {
  it('is stable hex', () => {
    expect(sha256('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/db && pnpm vitest run test/program-overlap-text.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement**

```ts
// program-overlap.v1 — pure text helpers. No DB, no AI.
import { createHash } from 'node:crypto';

const PLO_LABEL = /^\s*(?:(?:PLO|ELO|LO|YLO)\s*[\d.]*\s*[:.)\-–]?\s*|\d+(?:\.\d+)*\s*[.)]\s*)/i;

/** Strip "PLO 1.1", "PLO1:", "ELO 2", "3." style prefixes; trim. */
export function normalisePloText(raw: string): string {
  return raw.replace(PLO_LABEL, '').trim();
}

/** Name key that ignores international markers, so Thai and international
 *  versions of the same programme compare equal. */
export function languageVariantKey(name: string): string {
  return name
    .replace(/\(?\s*หลักสูตรนานาชาติ\s*\)?/g, '')
    .replace(/\(\s*นานาชาติ\s*\)/g, '')
    .replace(/\(?\s*international\s+program(me)?\s*\)?/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export interface MarketProfileInput {
  nameTh: string;
  nameEn: string | null;
  degreeNameTh: string | null;
  degreeNameEn: string | null;
  recruitmentSummaryTh: string | null;
  careers: string[];
}

export function buildMarketProfileText(p: MarketProfileInput): string {
  const lines = [
    [p.nameTh, p.nameEn].filter(Boolean).join(' / '),
    [p.degreeNameTh, p.degreeNameEn].filter(Boolean).join(' / '),
    p.recruitmentSummaryTh ?? '',
    p.careers.length ? `Careers: ${p.careers.join('; ')}` : '',
  ];
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

export interface CourseTextInput {
  nameTh: string | null;
  nameEn: string | null;
  descriptionTh: string | null;
  learningOutcomesTh: string[];
}

export function courseEmbeddingText(c: CourseTextInput): string {
  const lines = [
    [c.nameTh, c.nameEn].filter(Boolean).join(' / '),
    c.descriptionTh ?? '',
    c.learningOutcomesTh.length ? `CLO: ${c.learningOutcomesTh.join('; ')}` : '',
  ];
  return lines.filter((l) => l.trim().length > 0).join('\n');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd packages/db && pnpm vitest run test/program-overlap-text.test.ts`
Expected: PASS. If the `normalisePloText` regex misses a label shape, extend the regex, not the test.

- [ ] **Step 5: Commit**

Commit as `feat(db): program-overlap text helpers`.

---

### Task 3: Vector I/O helpers

**Files:**
- Create: `packages/db/src/program-overlap/vectors.ts`, `packages/db/test/program-overlap-vectors.test.ts`

- [ ] **Step 1: Write the failing test** for the pure parts:

```ts
import { describe, expect, it } from 'vitest';
import { l2normalise, parseVectorText, toVectorLiteral } from '../src/program-overlap/vectors';

describe('vector helpers', () => {
  it('normalises to unit length', () => {
    const v = l2normalise([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 10);
    expect(v[1]).toBeCloseTo(0.8, 10);
  });
  it('leaves a zero vector as zeros', () => {
    expect(l2normalise([0, 0])).toEqual([0, 0]);
  });
  it('round-trips the pgvector text form', () => {
    expect(toVectorLiteral([0.5, -1])).toBe('[0.5,-1]');
    expect(parseVectorText('[0.5,-1]')).toEqual([0.5, -1]);
  });
  it('rejects a malformed vector', () => {
    expect(() => parseVectorText('nope')).toThrow();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement**

```ts
// program-overlap.v1 — vector columns are Unsupported("vector(1536)") so they
// go through raw SQL. Every read is Zod-validated (repo rule for $queryRaw).
import { z } from 'zod';
import { prisma } from '../index';

export const EMBED_DIMENSIONS = 1536;

export function l2normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

const VectorText = z.string().regex(/^\[.*\]$/);
export function parseVectorText(text: string): number[] {
  const t = VectorText.parse(text);
  const parts = t.slice(1, -1).split(',').map(Number);
  if (parts.some((x) => !Number.isFinite(x))) throw new Error('malformed vector');
  return parts;
}

const IdVecRow = z.object({ id: z.string(), v: z.string() });

/** PLO vectors for the given programmes: programId → [{ordinal, vector}]. */
export async function readPloVectors(programIds: string[]): Promise<Map<string, Array<{ ordinal: number; text: string; vector: number[] }>>> {
  const out = new Map<string, Array<{ ordinal: number; text: string; vector: number[] }>>();
  if (programIds.length === 0) return out;
  const rows = z
    .array(z.object({ program_id: z.string(), ordinal: z.number(), text: z.string(), v: z.string() }))
    .parse(
      await prisma.$queryRaw`
        SELECT program_id, ordinal, text_normalised AS text, embedding::text AS v
        FROM program_learning_outcomes
        WHERE program_id = ANY(${programIds}) AND embedding IS NOT NULL
        ORDER BY program_id, ordinal`,
    );
  for (const r of rows) {
    const list = out.get(r.program_id) ?? [];
    list.push({ ordinal: r.ordinal, text: r.text, vector: parseVectorText(r.v) });
    out.set(r.program_id, list);
  }
  return out;
}

/** Course vectors keyed by ProgramCourse.id. */
export async function readCourseVectors(courseIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (courseIds.length === 0) return out;
  const rows = z.array(IdVecRow).parse(
    await prisma.$queryRaw`
      SELECT id, embedding::text AS v FROM program_courses
      WHERE id = ANY(${courseIds}) AND embedding IS NOT NULL`,
  );
  for (const r of rows) out.set(r.id, parseVectorText(r.v));
  return out;
}

/** Market-profile vectors keyed by programId. */
export async function readMarketVectors(programIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (programIds.length === 0) return out;
  const rows = z.array(z.object({ program_id: z.string(), v: z.string() })).parse(
    await prisma.$queryRaw`
      SELECT program_id, embedding::text AS v FROM program_market_profiles
      WHERE program_id = ANY(${programIds}) AND embedding IS NOT NULL`,
  );
  for (const r of rows) out.set(r.program_id, parseVectorText(r.v));
  return out;
}

export type VectorTable = 'program_learning_outcomes' | 'program_courses' | 'program_market_profiles';

/** Writes one vector + its text hash. `idColumn` is `id` or `program_id`. */
export async function writeVector(table: VectorTable, idColumn: 'id' | 'program_id', id: string, vector: number[], textHash: string): Promise<void> {
  const hashColumn = table === 'program_market_profiles' ? 'text_hash' : 'embedding_text_hash';
  await prisma.$executeRawUnsafe(
    `UPDATE ${table} SET embedding = $1::vector, ${hashColumn} = $2 WHERE ${idColumn} = $3`,
    toVectorLiteral(l2normalise(vector)),
    textHash,
    id,
  );
}
```

`table`, `idColumn` and `hashColumn` come from closed unions, never from user input. Say so in a comment above `writeVector`.

- [ ] **Step 4: Run the test (PASS), and run `pnpm tsc --noEmit -p .`**

- [ ] **Step 5: Commit**

Commit as `feat(db): program-overlap vector helpers`.

---

### Task 4: Data-prep runner (PLOs, course descriptions, market profiles, embeddings)

**Files:**
- Create: `apps/ingestion/src/program-overlap/prep.ts`, `apps/ingestion/src/scripts/programs-overlap-prep.ts`, `apps/ingestion/test/program-overlap-prep.test.ts`
- Modify: `apps/ingestion/package.json` (script `programs:overlap-prep`), root `package.json` if root aliases exist for other `programs:*` scripts (check with `grep '"programs:' package.json`), `apps/ingestion/scripts/bundle-pipeline-scripts.ts` (add `programs-overlap-prep`)
- Create: `packages/db/src/program-overlap/index.ts` (barrel exporting `text`, `vectors` and the modules added later), and add `export * from './program-overlap';` to `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test** for the pure planning functions (no DB):

```ts
import { describe, expect, it } from 'vitest';
import { planCourseDescriptionUpdates, planPloRows } from '../src/program-overlap/prep';

describe('planPloRows', () => {
  it('numbers PLOs, normalises text and drops blanks', () => {
    expect(planPloRows(['PLO 1 ก', '  ', 'PLO 2: ข'])).toEqual([
      { ordinal: 1, textTh: 'PLO 1 ก', textNormalised: 'ก' },
      { ordinal: 2, textTh: 'PLO 2: ข', textNormalised: 'ข' },
    ]);
  });
});

describe('planCourseDescriptionUpdates', () => {
  it('matches digest courses to programme courses by normalised code', () => {
    const updates = planCourseDescriptionUpdates(
      [
        { id: 'pc1', courseCode: 'EN241100' },
        { id: 'pc2', courseCode: 'SC401201' },
      ],
      [
        { code: 'EN 241 100', descriptionTh: 'คำอธิบาย', learningOutcomesTh: ['ก'] },
        { code: 'XX000000', descriptionTh: 'ไม่ตรง', learningOutcomesTh: [] },
      ],
    );
    expect(updates).toEqual([{ id: 'pc1', descriptionTh: 'คำอธิบาย', learningOutcomesTh: ['ก'] }]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement `prep.ts`**

Use `normaliseCourseCode` from `packages/db/src/course-code-normalise.ts`; check its export name with `grep -n "export function" packages/db/src/course-code-normalise.ts`.

```ts
import { prisma, normalisePloText, sha256, buildMarketProfileText, courseEmbeddingText, writeVector, EMBED_DIMENSIONS, IS_CANONICAL_PROGRAM } from '@kku/db';
import { normaliseCourseCode } from '@kku/db';
import type { AiService } from '@kku/shared';

export interface PloRowPlan { ordinal: number; textTh: string; textNormalised: string }

export function planPloRows(plos: string[]): PloRowPlan[] {
  const out: PloRowPlan[] = [];
  for (const raw of plos) {
    const textNormalised = normalisePloText(raw);
    if (!textNormalised) continue;
    out.push({ ordinal: out.length + 1, textTh: raw.trim(), textNormalised });
  }
  return out;
}

export function planCourseDescriptionUpdates(
  programCourses: Array<{ id: string; courseCode: string }>,
  digestCourses: Array<{ code: string; descriptionTh?: string | null; learningOutcomesTh?: string[] | null }>,
): Array<{ id: string; descriptionTh: string; learningOutcomesTh: string[] }> {
  const byCode = new Map<string, { descriptionTh: string; learningOutcomesTh: string[] }>();
  for (const c of digestCourses) {
    const code = normaliseCourseCode(c.code);
    if (!code || !c.descriptionTh) continue;
    byCode.set(code, { descriptionTh: c.descriptionTh, learningOutcomesTh: c.learningOutcomesTh ?? [] });
  }
  const out: Array<{ id: string; descriptionTh: string; learningOutcomesTh: string[] }> = [];
  for (const pc of programCourses) {
    const hit = byCode.get(pc.courseCode);
    if (hit) out.push({ id: pc.id, ...hit });
  }
  return out;
}
```

Then the IO functions, each taking `{ apply: boolean }` and returning counts. In a dry run they only count:

1. **`loadPlos({ apply })`**
   - For each canonical programme (`where: IS_CANONICAL_PROGRAM`), find the latest `AiExtraction` with `{ sourceEntityType: 'program', sourceEntityId: programId, extractionKind: 'PROGRAM_SKILLS_DETAILED' }`, ordered by `createdAt desc`.
   - Read `payloadJson.programLearningOutcomes` (Zod: `z.object({ programLearningOutcomes: z.array(z.string()).default([]) }).passthrough()`).
   - In a transaction, delete that programme's `ProgramLearningOutcome` rows and `createMany` the planned rows with `sourceExtractionId` and `programRevisionId` from the extraction.
   - Skip the programme when the existing rows already have the same `sourceExtractionId` and the same count. That keeps the step idempotent and preserves embeddings.
2. **`loadCourseDescriptions({ apply })`**
   - Take the latest `PROGRAM_DIGEST` with `reviewStatus: 'APPROVED'` per programme.
   - Parse `payloadJson.courses` with Zod: `code`, `descriptionTh?`, `learningOutcomesTh?`.
   - Run `planCourseDescriptionUpdates` against the programme's `ProgramCourse` rows, then `update` each row.
   - When a description changes, also set `embeddingTextHash: null`, so the course is re-embedded.
3. **`loadMarketProfiles({ apply })`**
   - Per canonical programme, build the text with `buildMarketProfileText`. `careers` comes from `careersThJson` (parse defensively as a `string[]`, or as an array of `{ titleTh }` objects; check one row with `prisma.program.findFirst({ select: { careersThJson: true } })`).
   - Upsert `ProgramMarketProfile` with `textHash = sha256(text)`. When the hash changes, the embedding is cleared by raw SQL: `UPDATE program_market_profiles SET embedding = NULL WHERE program_id = $1`.
4. **`embedPending(ai, { apply })`**
   - Select the rows to embed:
     - PLOs where `embedding IS NULL OR embedding_text_hash IS DISTINCT FROM <hash of text_normalised>`. Compute the hash in TS, by reading the rows with `id`, `text_normalised` and `embedding_text_hash`.
     - Major courses only: categories CORE, MAJOR_REQUIRED, MAJOR_ELECTIVE, UNKNOWN or NULL, and with a description. Their text is `courseEmbeddingText`.
     - Market profiles where the embedding is NULL.
   - Batch 96 texts per call to `ai.embed({ ctx: { module: 'program-overlap', kind: 'embedding.<kind>' }, texts, dimensions: EMBED_DIMENSIONS })`.
   - Write each vector with `writeVector`.
   - Accumulate `res.cost.usd`. Return `{ plos, courses, profiles, costUsd }`.

Export `runOverlapPrep(ai, { apply })`, which runs 1 → 4 and returns all counts.

- [ ] **Step 4: Write the CLI** `apps/ingestion/src/scripts/programs-overlap-prep.ts`. Copy the inline env loader and the `createIngestionAiService` import from `apps/ingestion/src/scripts/jobthai-embed.ts`.
  - `--apply` writes; the default is a dry run that prints the counts.
  - It prints a coverage summary: programmes with PLOs, with described major courses (as a count and the share of their major credits), and with a market profile.

- [ ] **Step 5: Wire the script and test**
  - Add `"programs:overlap-prep": "tsx src/scripts/programs-overlap-prep.ts"` to `apps/ingestion/package.json`, next to the other `programs:*` scripts.
  - Add `programs-overlap-prep` to the TARGETS in `bundle-pipeline-scripts.ts`.
  - Run `cd apps/ingestion && pnpm vitest run test/program-overlap-prep.test.ts && pnpm tsc --noEmit`. Expected: PASS, clean.

- [ ] **Step 6: Commit**

Commit as `feat(ingestion): program-overlap data prep (PLO table, course descriptions, market profiles, embeddings)`.

---

### Task 5: Fix the peer-review PLO input

**Files:**
- Modify: `apps/ingestion/src/program-peers/review.ts` (lines ~163–213)
- Test: extend the existing peer-review test if there is one (`grep -rln "program-peers/review" apps/ingestion/test`); otherwise add `apps/ingestion/test/program-peers-plos.test.ts` asserting the PLO source with a mocked prisma.

- [ ] **Step 1: Write the failing test.** Mock `prisma.programLearningOutcome.findMany` to return two rows. Assert that the PLO list passed to `buildProgramPeerReviewMessages` (spy on it via `vi.mock('@kku/shared', …)` with a pass-through of the other exports) equals the two `textNormalised` strings.

- [ ] **Step 2: Implement.**
  - Replace `const programLearningOutcomes = digestPayload?.programLearningOutcomes ?? [];` with:
    ```ts
    const programLearningOutcomes = (
      await prisma.programLearningOutcome.findMany({
        where: { programId: program.id },
        orderBy: { ordinal: 'asc' },
        select: { textNormalised: true },
      })
    ).map((p) => p.textNormalised);
    ```
  - Remove `programLearningOutcomes?: string[]` from the digest payload type.
  - Update the comment above it, which says PLOs come from the digest.

- [ ] **Step 3: Run the test (PASS) and `pnpm tsc --noEmit`**

- [ ] **Step 4: Commit**

Commit as `fix(ingestion): peer review reads PLOs from the PLO table (the digest never carried them)`.

---

### Task 6: Run the data prep on dev (controller-run, costs money)

This task is run by the controller, not by a subagent. The user approved the about-$5 phase 2b backfill in the design.

- [ ] **Step 1: Measure the phase 2b cost on 5 programmes first.** A comment in `programs-pipeline.ts` says about $0.18 per programme, while the phase metadata says $0.02.

```bash
cd apps/ingestion && pnpm programs:pipeline --all --only=phase2b --limit=5
```

Read the cost from `/admin/ai-cost` or with `SELECT SUM(cost_estimate_usd) FROM ai_inferences WHERE created_at > now() - interval '30 minutes' AND method_version LIKE 'program-courses-extract%';` (read-only). Remember the pricing-store gap means short runs can under-record, so cross-check against tokens × catalogue rate. **If it is over $0.05 per programme, stop and report the projected total to the user before continuing.**

- [ ] **Step 2: Run the rest of the backfill.** Run `pnpm programs:pipeline --all --only=phase2b` in the background, then confirm the category coverage (read-only):

```sql
SELECT category, count(*) FROM program_courses GROUP BY 1 ORDER BY 2 DESC;
```

Expected: NULL falls from about 5,886 to a small residue.

- [ ] **Step 3: Run the prep.** Run `pnpm programs:overlap-prep` (dry run), then `pnpm programs:overlap-prep --apply`. Record the coverage summary and the embedding cost for the calibration notes.

---

## Phase B — Scoring engine

### Task 7: Pure scoring core

**Files:**
- Create: `packages/db/src/program-overlap/score.ts`, `packages/db/test/program-overlap-score.test.ts`

- [ ] **Step 1: Write the failing test**

Use 2-dimensional unit vectors so the cosines are exact.

```ts
import { describe, expect, it } from 'vitest';
import {
  OVERLAP_THRESHOLDS,
  bandFor,
  cosine,
  greedyMatch,
  majorCourses,
  scorePair,
  serviceCourseCodes,
  type OverlapProgramme,
} from '../src/program-overlap/score';

const v = (deg: number): number[] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const course = (code: string, credits: number, opts: Partial<OverlapProgramme['courses'][number]> = {}) => ({
  id: `${code}-id`, code, credits, category: 'MAJOR_REQUIRED' as const, described: true, vector: v(0), nameTh: code, nameEn: null, ...opts,
});
const prog = (id: string, over: Partial<OverlapProgramme> = {}): OverlapProgramme => ({
  id, code: id, level: 'BACHELOR', facultyId: 'f1', nameTh: id, nameEn: id, degreeNameTh: null, language: 'TH',
  courses: [], plos: [], marketVector: null, staffIds: [], ...over,
});
const T = OVERLAP_THRESHOLDS;

describe('cosine', () => {
  it('is 1 for identical and 0 for orthogonal', () => {
    expect(cosine(v(0), v(0))).toBeCloseTo(1, 10);
    expect(cosine(v(0), v(90))).toBeCloseTo(0, 10);
  });
});

describe('greedyMatch', () => {
  it('matches one-to-one, most similar first, above the threshold', () => {
    const left = [{ id: 'a', vec: v(0) }, { id: 'b', vec: v(10) }];
    const right = [{ id: 'x', vec: v(5) }];
    const m = greedyMatch(left, right, (l, r) => cosine(l.vec, r.vec), 0.9);
    expect(m).toHaveLength(1); // x can be used once
    expect(['a', 'b']).toContain(m[0]!.left.id);
  });
  it('drops pairs below the threshold', () => {
    expect(greedyMatch([{ vec: v(0) }], [{ vec: v(60) }], (l, r) => cosine(l.vec, r.vec), 0.9)).toEqual([]);
  });
});

describe('major-course filter', () => {
  it('excludes gen-ed, free elective, thesis and service courses; keeps null/unknown', () => {
    const p = prog('p', {
      courses: [
        course('GE1', 3, { category: 'GENERAL_EDUCATION' }),
        course('FE1', 3, { category: 'FREE_ELECTIVE' }),
        course('TH1', 6, { category: 'THESIS_PROJECT' }),
        course('SV1', 3, { category: null }),
        course('MJ1', 3, { category: null }),
        course('MJ2', 3, { category: 'UNKNOWN' }),
      ],
    });
    expect(majorCourses(p, new Set(['SV1'])).map((c) => c.code)).toEqual(['MJ1', 'MJ2']);
  });
  it('flags a code used by more than 25% of programmes as a service course', () => {
    const progs = ['a', 'b', 'c', 'd'].map((id) => prog(id, { courses: [course(id === 'd' ? 'X' : 'SV', 3)] }));
    expect(serviceCourseCodes(progs, T.serviceCourseShare)).toEqual(new Set(['SV']));
  });
});

describe('scorePair', () => {
  const ctx = { serviceCodes: new Set<string>(), thresholds: T };

  it('structure: credit-weighted Dice over shared major codes', () => {
    const a = prog('a', { courses: [course('C1', 3), course('C2', 3)] });
    const b = prog('b', { courses: [course('C1', 3), course('C3', 6, { vector: v(90) })] });
    const s = scorePair(a, b, ctx);
    expect(s.sharedCredits).toBe(3);
    expect(s.structure).toBeCloseTo((2 * 3) / (6 + 9) * 100, 10);
  });

  it('content: equivalent courses with different codes, excluding code-matched ones', () => {
    const a = prog('a', { courses: [course('A1', 3, { vector: v(0) }), course('A2', 3, { vector: v(90) }), course('A3', 3, { vector: v(45) })] });
    const b = prog('b', { courses: [course('B1', 3, { vector: v(1) }), course('B2', 3, { vector: v(-90) }), course('B3', 3, { vector: v(200) })] });
    const s = scorePair(a, b, ctx);
    expect(s.equivCredits).toBe(3); // only A1~B1 clears 0.85
    expect(s.content).toBeCloseTo((2 * 3) / (9 + 9) * 100, 10);
  });

  it('content counts described courses shared by code as equivalent', () => {
    const same = [course('C1', 3), course('C2', 3), course('C3', 3)];
    const s = scorePair(prog('a', { courses: same }), prog('b', { courses: same }), ctx);
    expect(s.content).toBe(100);
    expect(s.equivCredits).toBe(0); // different-code equivalents only
  });

  it('content is null when either side has fewer than 3 described major courses', () => {
    const a = prog('a', { courses: [course('A1', 3), course('A2', 3)] });
    const b = prog('b', { courses: [course('B1', 3), course('B2', 3), course('B3', 3)] });
    expect(scorePair(a, b, ctx).content).toBeNull();
  });

  it('outcome: share of PLOs covered on both sides', () => {
    const a = prog('a', { plos: [{ ordinal: 1, text: 'x', vector: v(0) }, { ordinal: 2, text: 'y', vector: v(90) }] });
    const b = prog('b', { plos: [{ ordinal: 1, text: 'z', vector: v(2) }] });
    const s = scorePair(a, b, ctx);
    // a: 1 of 2 covered; b: 1 of 1 covered → 2/3
    expect(s.outcome).toBeCloseTo((2 / 3) * 100, 10);
  });

  it('index is the mean of non-null layers and never treats a null as 0', () => {
    const a = prog('a', { plos: [{ ordinal: 1, text: 'x', vector: v(0) }] });
    const b = prog('b', { plos: [{ ordinal: 1, text: 'z', vector: v(0) }] });
    const s = scorePair(a, b, ctx);
    expect(s.structure).toBeNull();
    expect(s.content).toBeNull();
    expect(s.outcome).toBe(100);
    expect(s.overlapIndex).toBe(100);
  });

  it('index is null when every layer is null', () => {
    expect(scorePair(prog('a'), prog('b'), ctx).overlapIndex).toBeNull();
  });

  it('containment is directional', () => {
    const a = prog('a', { courses: [course('C1', 3)] });
    const b = prog('b', { courses: [course('C1', 3), course('C2', 3, { vector: v(90) }), course('C3', 3, { vector: v(180) })] });
    const s = scorePair(a, b, ctx);
    expect(s.containmentAInB).toBe(100);
    expect(s.containmentBInA).toBeCloseTo(100 / 3, 10);
  });

  it('counts shared active staff and flags language variants', () => {
    const a = prog('a', { staffIds: ['s1', 's2'], nameTh: 'วศ.บ. คอม', language: 'TH' });
    const b = prog('b', { staffIds: ['s2', 's3'], nameTh: 'วศ.บ. คอม (หลักสูตรนานาชาติ)', language: 'EN' });
    const s = scorePair(a, b, ctx);
    expect(s.sharedStaff).toBe(1);
    expect(s.languageVariant).toBe(true);
  });

  it('rescales market similarity between floor and ceiling', () => {
    const a = prog('a', { marketVector: v(0) });
    const b = prog('b', { marketVector: v(0) });
    expect(scorePair(a, b, ctx).marketSimilarity).toBe(100);
  });
});

describe('bands and actions', () => {
  it('bands at the edges', () => {
    expect(bandFor(null)).toBe('NONE');
    expect(bandFor(29.99)).toBe('NONE');
    expect(bandFor(30)).toBe('LOW');
    expect(bandFor(50)).toBe('MODERATE');
    expect(bandFor(70)).toBe('HIGH');
  });

  it('consider-merge needs index ≥ 70, containment ≥ 80 and no language variant', () => {
    const same = [course('C1', 3), course('C2', 3), course('C3', 3)];
    const a = prog('a', { courses: same, plos: [{ ordinal: 1, text: 'x', vector: v(0) }] });
    const b = prog('b', { courses: same, plos: [{ ordinal: 1, text: 'x', vector: v(0) }] });
    const s = scorePair(a, b, { serviceCodes: new Set(), thresholds: T });
    expect(s.actions).toContain('CONSIDER_MERGE_OR_TRACK');
    expect(s.actions).toContain('COORDINATE_SHARED_COURSES');
    expect(s.primaryAction).toBe('CONSIDER_MERGE_OR_TRACK');

    const bIntl = { ...b, nameTh: `${b.nameTh} (หลักสูตรนานาชาติ)`, language: 'EN' };
    const aTh = { ...a, nameTh: b.nameTh };
    const s2 = scorePair(aTh, bIntl, { serviceCodes: new Set(), thresholds: T });
    expect(s2.languageVariant).toBe(true);
    expect(s2.actions).not.toContain('CONSIDER_MERGE_OR_TRACK');
  });

  it('differentiate needs index ≥ 50 and market similarity at the threshold', () => {
    const plo = [{ ordinal: 1, text: 'x', vector: v(0) }];
    const s = scorePair(
      prog('a', { plos: plo, marketVector: v(0) }),
      prog('b', { plos: plo, marketVector: v(0) }),
      { serviceCodes: new Set(), thresholds: T },
    );
    expect(s.actions).toContain('DIFFERENTIATE');
  });

  it('evidence hash is stable for equal evidence', () => {
    const a = prog('a', { courses: [course('C1', 3)] });
    const b = prog('b', { courses: [course('C1', 3)] });
    expect(scorePair(a, b, { serviceCodes: new Set(), thresholds: T }).evidenceHash).toBe(
      scorePair(a, b, { serviceCodes: new Set(), thresholds: T }).evidenceHash,
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement `score.ts`**

```ts
// program-overlap.v1 — pure scoring core. Spec:
// docs/superpowers/specs/2026-10-03-program-overlap-design.md §4.5–§6.1.
// Deterministic: same inputs → same scores. No DB, no AI, no clock.
import type { CourseCategory, OverlapAction, OverlapBand, ProgramLevel } from '@prisma/client';
import { createHash } from 'node:crypto';
import { languageVariantKey } from './text';

export const PROGRAM_OVERLAP_VERSION = 'program-overlap.v1';

/** Provisional until calibration (spec §9). Changing any value after release
 *  bumps PROGRAM_OVERLAP_VERSION. */
export interface OverlapThresholds {
  courseEquiv: number;        // cosine for two courses to count as equivalent
  ploMatch: number;           // cosine for a PLO to count as covered
  marketFloor: number;        // cosine mapped to 0
  marketCeiling: number;      // cosine mapped to 100
  marketConfusion: number;    // 0–100 market similarity for DIFFERENTIATE / KRI
  bandLow: number;
  bandModerate: number;
  bandHigh: number;
  serviceCourseShare: number; // share of same-level programmes above which a code is a service course
  minDescribedCourses: number;
  courseActionCredits: number;
  actionIndex: number;
  mergeIndex: number;
  mergeContainment: number;
  storeIndex: number;
}

export const OVERLAP_THRESHOLDS: OverlapThresholds = {
  courseEquiv: 0.85,
  ploMatch: 0.8,
  marketFloor: 0.6,
  marketCeiling: 0.95,
  marketConfusion: 70,
  bandLow: 30,
  bandModerate: 50,
  bandHigh: 70,
  serviceCourseShare: 0.25,
  minDescribedCourses: 3,
  courseActionCredits: 6,
  actionIndex: 50,
  mergeIndex: 70,
  mergeContainment: 80,
  storeIndex: 30,
};

/** A course with no recorded credits is weighted as a typical 3-credit course;
 *  how many were defaulted is reported in the evidence coverage. */
export const DEFAULT_COURSE_CREDITS = 3;

const EXCLUDED_CATEGORIES: ReadonlySet<CourseCategory> = new Set(['GENERAL_EDUCATION', 'FREE_ELECTIVE', 'THESIS_PROJECT']);

export interface OverlapCourse {
  id: string;
  code: string;
  credits: number | null;
  category: CourseCategory | null;
  described: boolean;
  vector: number[] | null;
  nameTh: string | null;
  nameEn: string | null;
}
export interface OverlapPlo { ordinal: number; text: string; vector: number[] }
export interface OverlapProgramme {
  id: string;
  code: string;
  level: ProgramLevel;
  facultyId: string;
  nameTh: string;
  nameEn: string | null;
  degreeNameTh: string | null;
  language: string | null;
  courses: OverlapCourse[];
  plos: OverlapPlo[];
  marketVector: number[] | null;
  staffIds: string[];
}

export interface PairEvidence {
  sharedCourses: Array<{ code: string; credits: number; nameTh: string | null }>;
  equivalentCourses: Array<{ codeA: string; codeB: string; nameA: string | null; nameB: string | null; credits: number; similarity: number }>;
  matchedPlos: Array<{ ordinalA: number; ordinalB: number; textA: string; textB: string; similarity: number }>;
  unmatchedPlosA: string[];
  unmatchedPlosB: string[];
  coverage: {
    majorCoursesA: number; majorCoursesB: number;
    describedA: number; describedB: number;
    plosA: number; plosB: number;
    defaultedCredits: number;
  };
}

export interface PairScore {
  programAId: string;
  programBId: string;
  structure: number | null;
  content: number | null;
  outcome: number | null;
  overlapIndex: number | null;
  containmentAInB: number | null;
  containmentBInA: number | null;
  band: OverlapBand;
  sharedCredits: number;
  equivCredits: number;
  sharedStaff: number;
  marketSimilarity: number | null;
  languageVariant: boolean;
  actions: OverlapAction[];
  primaryAction: OverlapAction | null;
  evidence: PairEvidence;
  evidenceHash: string;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** One-to-one greedy matching: all candidate pairs above `threshold`, most
 *  similar first; each left and right item is used at most once. */
export function greedyMatch<L, R>(
  left: readonly L[],
  right: readonly R[],
  sim: (l: L, r: R) => number,
  threshold: number,
): Array<{ left: L; right: R; similarity: number }> {
  const cands: Array<{ i: number; j: number; s: number }> = [];
  for (let i = 0; i < left.length; i++) {
    for (let j = 0; j < right.length; j++) {
      const s = sim(left[i]!, right[j]!);
      if (s >= threshold) cands.push({ i, j, s });
    }
  }
  cands.sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j);
  const usedL = new Set<number>(), usedR = new Set<number>();
  const out: Array<{ left: L; right: R; similarity: number }> = [];
  for (const c of cands) {
    if (usedL.has(c.i) || usedR.has(c.j)) continue;
    usedL.add(c.i);
    usedR.add(c.j);
    out.push({ left: left[c.i]!, right: right[c.j]!, similarity: c.s });
  }
  return out;
}

/** Codes used by more than `share` of the given (same-level) programmes. */
export function serviceCourseCodes(programmes: readonly OverlapProgramme[], share: number): Set<string> {
  const counts = new Map<string, number>();
  for (const p of programmes) for (const code of new Set(p.courses.map((c) => c.code))) counts.set(code, (counts.get(code) ?? 0) + 1);
  const limit = programmes.length * share;
  return new Set([...counts].filter(([, n]) => n > limit).map(([code]) => code));
}

/** Major courses, de-duplicated by code (first occurrence wins). */
export function majorCourses(p: OverlapProgramme, serviceCodes: ReadonlySet<string>): OverlapCourse[] {
  const seen = new Set<string>();
  const out: OverlapCourse[] = [];
  for (const c of p.courses) {
    if (seen.has(c.code)) continue;
    seen.add(c.code);
    if (c.category && EXCLUDED_CATEGORIES.has(c.category)) continue;
    if (serviceCodes.has(c.code)) continue;
    out.push(c);
  }
  return out;
}

const credits = (c: OverlapCourse): number => c.credits ?? DEFAULT_COURSE_CREDITS;
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: Array<number | null>): number | null => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? sum(ok) / ok.length : null;
};
const clamp = (x: number): number => Math.max(0, Math.min(100, x));

export function bandFor(index: number | null, t: OverlapThresholds = OVERLAP_THRESHOLDS): OverlapBand {
  if (index === null || index < t.bandLow) return 'NONE';
  if (index < t.bandModerate) return 'LOW';
  if (index < t.bandHigh) return 'MODERATE';
  return 'HIGH';
}

/** Weakest → strongest; the last applicable one is the primary action. */
export const ACTION_STRENGTH: readonly OverlapAction[] = [
  'COORDINATE_SHARED_COURSES',
  'CONSOLIDATE_EQUIVALENT_COURSES',
  'SHARE_STAFF_RESOURCES',
  'DIFFERENTIATE',
  'CONSIDER_MERGE_OR_TRACK',
];

export function scorePair(
  a: OverlapProgramme,
  b: OverlapProgramme,
  ctx: { serviceCodes: ReadonlySet<string>; thresholds: OverlapThresholds },
): PairScore {
  const t = ctx.thresholds;
  const majA = majorCourses(a, ctx.serviceCodes);
  const majB = majorCourses(b, ctx.serviceCodes);
  const creditsA = sum(majA.map(credits));
  const creditsB = sum(majB.map(credits));
  const defaultedCredits = [...majA, ...majB].filter((c) => c.credits === null).length;

  // Structure — same code in both.
  const codesB = new Map(majB.map((c) => [c.code, c]));
  const shared = majA.filter((c) => codesB.has(c.code));
  const sharedCredits = sum(shared.map((c) => Math.min(credits(c), credits(codesB.get(c.code)!))));
  const structure = majA.length && majB.length ? clamp(((2 * sharedCredits) / (creditsA + creditsB)) * 100) : null;

  // Content — equivalent courses with different codes.
  const sharedCodes = new Set(shared.map((c) => c.code));
  const descA = majA.filter((c) => c.described && c.vector);
  const descB = majB.filter((c) => c.described && c.vector);
  let content: number | null = null;
  let equivCredits = 0;
  let equivalent: PairEvidence['equivalentCourses'] = [];
  if (descA.length >= t.minDescribedCourses && descB.length >= t.minDescribedCourses) {
    const candA = descA.filter((c) => !sharedCodes.has(c.code));
    const candB = descB.filter((c) => !sharedCodes.has(c.code));
    const matches = greedyMatch(candA, candB, (x, y) => cosine(x.vector!, y.vector!), t.courseEquiv);
    equivalent = matches.map((m) => ({
      codeA: m.left.code, codeB: m.right.code, nameA: m.left.nameTh, nameB: m.right.nameTh,
      credits: Math.min(credits(m.left), credits(m.right)), similarity: m.similarity,
    }));
    equivCredits = sum(equivalent.map((e) => e.credits));
    // A described course both programmes share by code is trivially equivalent:
    // it counts in the content layer too, or two identical programmes would
    // score 0 on content. equivCredits (different codes only) still drives the
    // CONSOLIDATE_EQUIVALENT_COURSES action.
    const descCodesB = new Map(descB.map((c) => [c.code, c]));
    const sharedDescribedCredits = sum(
      descA.filter((c) => descCodesB.has(c.code)).map((c) => Math.min(credits(c), credits(descCodesB.get(c.code)!))),
    );
    const dA = sum(descA.map(credits)), dB = sum(descB.map(credits));
    content = clamp(((2 * (sharedDescribedCredits + equivCredits)) / (dA + dB)) * 100);
  }

  // Outcome — PLO coverage, both directions.
  let outcome: number | null = null;
  let matchedPlos: PairEvidence['matchedPlos'] = [];
  let unmatchedA: string[] = [], unmatchedB: string[] = [];
  let ploShareA: number | null = null, ploShareB: number | null = null;
  if (a.plos.length && b.plos.length) {
    const bestFor = (p: OverlapPlo, others: OverlapPlo[]) =>
      others.reduce<{ o: OverlapPlo | null; s: number }>((best, o) => {
        const s = cosine(p.vector, o.vector);
        return s > best.s ? { o, s } : best;
      }, { o: null, s: -1 });
    const coveredA = a.plos.filter((p) => bestFor(p, b.plos).s >= t.ploMatch);
    const coveredB = b.plos.filter((p) => bestFor(p, a.plos).s >= t.ploMatch);
    outcome = clamp(((coveredA.length + coveredB.length) / (a.plos.length + b.plos.length)) * 100);
    ploShareA = (coveredA.length / a.plos.length) * 100;
    ploShareB = (coveredB.length / b.plos.length) * 100;
    matchedPlos = coveredA.map((p) => {
      const best = bestFor(p, b.plos);
      return { ordinalA: p.ordinal, ordinalB: best.o!.ordinal, textA: p.text, textB: best.o!.text, similarity: best.s };
    });
    unmatchedA = a.plos.filter((p) => !coveredA.includes(p)).map((p) => p.text);
    unmatchedB = b.plos.filter((p) => !coveredB.includes(p)).map((p) => p.text);
  }

  const overlapIndex = mean([structure, content, outcome]);
  const matchedCredits = sharedCredits + (content === null ? 0 : equivCredits);
  const containmentAInB = mean([structure === null ? null : clamp((matchedCredits / creditsA) * 100), ploShareA]);
  const containmentBInA = mean([structure === null ? null : clamp((matchedCredits / creditsB) * 100), ploShareB]);

  const staffB = new Set(b.staffIds);
  const sharedStaff = new Set(a.staffIds.filter((s) => staffB.has(s))).size;
  const marketSimilarity =
    a.marketVector && b.marketVector
      ? clamp(((cosine(a.marketVector, b.marketVector) - t.marketFloor) / (t.marketCeiling - t.marketFloor)) * 100)
      : null;
  const languageVariant = isLanguageVariant(a, b);

  const actions: OverlapAction[] = [];
  if (sharedCredits >= t.courseActionCredits) actions.push('COORDINATE_SHARED_COURSES');
  if (equivCredits >= t.courseActionCredits) actions.push('CONSOLIDATE_EQUIVALENT_COURSES');
  if (overlapIndex !== null && overlapIndex >= t.actionIndex) actions.push('SHARE_STAFF_RESOURCES');
  if (overlapIndex !== null && overlapIndex >= t.actionIndex && marketSimilarity !== null && marketSimilarity >= t.marketConfusion) actions.push('DIFFERENTIATE');
  const maxContainment = Math.max(containmentAInB ?? 0, containmentBInA ?? 0);
  if (overlapIndex !== null && overlapIndex >= t.mergeIndex && maxContainment >= t.mergeContainment && !languageVariant) actions.push('CONSIDER_MERGE_OR_TRACK');
  const primaryAction = [...ACTION_STRENGTH].reverse().find((x) => actions.includes(x)) ?? null;

  const evidence: PairEvidence = {
    sharedCourses: shared.map((c) => ({ code: c.code, credits: Math.min(credits(c), credits(codesB.get(c.code)!)), nameTh: c.nameTh })),
    equivalentCourses: equivalent,
    matchedPlos,
    unmatchedPlosA: unmatchedA,
    unmatchedPlosB: unmatchedB,
    coverage: {
      majorCoursesA: majA.length, majorCoursesB: majB.length,
      describedA: descA.length, describedB: descB.length,
      plosA: a.plos.length, plosB: b.plos.length, defaultedCredits,
    },
  };
  return {
    programAId: a.id, programBId: b.id,
    structure, content, outcome, overlapIndex, containmentAInB, containmentBInA,
    band: bandFor(overlapIndex, t),
    sharedCredits, equivCredits, sharedStaff, marketSimilarity, languageVariant,
    actions, primaryAction, evidence,
    evidenceHash: createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),
  };
}

export function isLanguageVariant(a: OverlapProgramme, b: OverlapProgramme): boolean {
  if (!a.language || !b.language || a.language === b.language) return false;
  if (a.degreeNameTh && b.degreeNameTh && a.degreeNameTh === b.degreeNameTh && languageVariantKey(a.nameTh) === languageVariantKey(b.nameTh)) return true;
  return languageVariantKey(a.nameTh) === languageVariantKey(b.nameTh);
}

/** Store a pair when it scores ≥ storeIndex or shares a major course or staff. */
export function shouldStorePair(s: PairScore, t: OverlapThresholds = OVERLAP_THRESHOLDS): boolean {
  return (s.overlapIndex !== null && s.overlapIndex >= t.storeIndex) || s.sharedCredits > 0 || s.sharedStaff > 0;
}
```

- [ ] **Step 4: Run the tests and fix only real mistakes.** Hand-check the fixture arithmetic first: `v(1)` against `v(0)` gives cosine 0.9998, and `v(45)` gives 0.707.

Run: `cd packages/db && pnpm vitest run test/program-overlap-score.test.ts`. Expected: PASS. Add a test for `shouldStorePair` covering all three branches.

- [ ] **Step 5: Export and commit.** Add the export to the `program-overlap/index.ts` barrel, run `pnpm tsc --noEmit -p .`, and commit as `feat(db): program-overlap pure scoring core`.

---

### Task 8: Clustering and groups

**Files:**
- Create: `packages/db/src/program-overlap/cluster.ts`, `packages/db/test/program-overlap-cluster.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { averageLinkageOrder, overlapGroups } from '../src/program-overlap/cluster';

const sim = (pairs: Array<[string, string, number]>) => {
  const m = new Map<string, number>();
  for (const [a, b, v] of pairs) { m.set(`${a}|${b}`, v); m.set(`${b}|${a}`, v); }
  return (a: string, b: string) => (a === b ? 100 : m.get(`${a}|${b}`) ?? 0);
};

describe('averageLinkageOrder', () => {
  it('places mutually similar programmes next to each other', () => {
    const ids = ['a', 'x', 'b', 'y'];
    const order = averageLinkageOrder(ids, sim([['a', 'b', 90], ['x', 'y', 80], ['a', 'x', 5]]));
    const pos = (id: string) => order.indexOf(id);
    expect(Math.abs(pos('a') - pos('b'))).toBe(1);
    expect(Math.abs(pos('x') - pos('y'))).toBe(1);
    expect(order).toHaveLength(4);
  });
  it('is deterministic for ties (sorted by id)', () => {
    expect(averageLinkageOrder(['c', 'a', 'b'], () => 0)).toEqual(averageLinkageOrder(['b', 'c', 'a'], () => 0));
  });
});

describe('overlapGroups', () => {
  it('builds connected components of edges at or above the threshold', () => {
    const groups = overlapGroups(['a', 'b', 'c', 'd'], [
      { a: 'a', b: 'b', index: 55 },
      { a: 'b', b: 'c', index: 72 },
      { a: 'c', b: 'd', index: 40 },
    ], 50);
    expect(groups).toEqual([{ members: ['a', 'b', 'c'], peakIndex: 72 }]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement**

```ts
// program-overlap.v1 — ordering for the heatmap and the outlined groups.
// Pure. Average-linkage agglomerative clustering on distance = 100 − similarity;
// the leaf order of the merge tree puts overlapping programmes side by side.

type Cluster = { ids: string[] };

export function averageLinkageOrder(ids: readonly string[], similarity: (a: string, b: string) => number): string[] {
  let clusters: Cluster[] = [...ids].sort().map((id) => ({ ids: [id] }));
  const dist = (x: Cluster, y: Cluster): number => {
    let s = 0;
    for (const a of x.ids) for (const b of y.ids) s += 100 - similarity(a, b);
    return s / (x.ids.length * y.ids.length);
  };
  while (clusters.length > 1) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i]!, clusters[j]!);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    const merged: Cluster = { ids: [...clusters[bi]!.ids, ...clusters[bj]!.ids] };
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.splice(bi, 0, merged);
  }
  return clusters[0]?.ids ?? [];
}

export interface OverlapGroup { members: string[]; peakIndex: number }

export function overlapGroups(
  ids: readonly string[],
  edges: ReadonlyArray<{ a: string; b: string; index: number | null }>,
  threshold: number,
): OverlapGroup[] {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const peak = new Map<string, number>();
  for (const e of edges) {
    if (e.index === null || e.index < threshold || !parent.has(e.a) || !parent.has(e.b)) continue;
    parent.set(find(e.a), find(e.b));
  }
  for (const e of edges) {
    if (e.index === null || e.index < threshold || !parent.has(e.a) || !parent.has(e.b)) continue;
    const r = find(e.a);
    peak.set(r, Math.max(peak.get(r) ?? 0, e.index));
  }
  const byRoot = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    byRoot.set(r, [...(byRoot.get(r) ?? []), id]);
  }
  return [...byRoot.entries()]
    .filter(([, m]) => m.length > 1)
    .map(([r, m]) => ({ members: [...m].sort(), peakIndex: peak.get(r) ?? 0 }))
    .sort((x, y) => y.peakIndex - x.peakIndex || x.members[0]!.localeCompare(y.members[0]!));
}
```

The O(n³) cost of naive average linkage is fine at about 110 programmes per level. Say so in a comment.

- [ ] **Step 4: Run the test (PASS), add the barrel export, run `tsc`, then commit** as `feat(db): program-overlap clustering and groups`.

---

### Task 9: Loader and runner (scoring and storage)

**Files:**
- Create: `packages/db/src/program-overlap/load.ts`, `apps/ingestion/src/program-overlap/run.ts`, `apps/ingestion/src/scripts/programs-overlap.ts`, `apps/ingestion/test/program-overlap-run.test.ts`
- Modify: `apps/ingestion/package.json` (`programs:overlap`), `apps/ingestion/scripts/bundle-pipeline-scripts.ts` (add `programs-overlap`)

- [ ] **Step 1: Implement `load.ts`.** `loadOverlapProgrammes(level)` returns `OverlapProgramme[]`:
  - **Programmes:** `prisma.program.findMany({ where: { ...IS_CANONICAL_PROGRAM, level }, select: { id, code, level, facultyId, nameTh, nameEn, degreeNameTh, language } })`.
  - **Courses:** `prisma.programCourse.findMany({ where: { programId: { in: ids } }, select: { id, programId, courseCode, credits, category, descriptionTh, courseNameTh, courseNameEn } })`. Set `described = descriptionTh !== null`. Vectors come from `readCourseVectors` for the courses that have a description.
  - **PLOs:** `readPloVectors(ids)`.
  - **Market profiles:** `readMarketVectors(ids)`.
  - **Staff:** `prisma.programFaculty.findMany({ where: { programId: { in: ids } }, select: { programId: true, facultyMember: { select: { id: true, isActive: true } } } })`, keeping active members only.

  It also returns `coverage`: programme count, the counts with PLOs, described courses and market vectors, and a histogram of the best-match cosines (filled in by the runner).

- [ ] **Step 2: Write the failing runner test** with mocked `@kku/db`. Cover the pure `planRunPairs`:

```ts
import { describe, expect, it } from 'vitest';
import { planRunPairs } from '../src/program-overlap/run';
// Build 3 tiny OverlapProgrammes (same helpers as score test, inline) where
// p1~p2 share 9 credits and p3 shares nothing.
// Assert:
//  - planRunPairs(progs, { scopeProgramIds: [] }) scores 3 pairs and stores only p1~p2;
//  - planRunPairs(progs, { scopeProgramIds: ['p3'] }) scores only pairs involving p3 (2 pairs);
//  - pair ids are ordered programAId < programBId;
//  - the calibration histogram counts every pair's best course and PLO cosines.
```

Write the real fixtures and assertions in full in the test file; mirror the helpers from `program-overlap-score.test.ts`.

- [ ] **Step 3: Implement `run.ts`**

```ts
import { prisma, loadOverlapProgrammes, scorePair, serviceCourseCodes, shouldStorePair, OVERLAP_THRESHOLDS, PROGRAM_OVERLAP_VERSION, type OverlapProgramme, type PairScore } from '@kku/db';
import type { ProgramLevel } from '@prisma/client';

export interface PlannedRun { scored: number; stored: PairScore[]; histogram: { index: number[]; market: number[] } }

/** Pure: score same-level pairs (optionally only those touching scopeProgramIds). */
export function planRunPairs(progs: OverlapProgramme[], opts: { scopeProgramIds: string[] }): PlannedRun {
  const sorted = [...progs].sort((x, y) => x.id.localeCompare(y.id));
  const serviceCodes = serviceCourseCodes(sorted, OVERLAP_THRESHOLDS.serviceCourseShare);
  const scope = new Set(opts.scopeProgramIds);
  const stored: PairScore[] = [];
  const index: number[] = [];
  const market: number[] = [];
  let scored = 0;
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!, b = sorted[j]!;
      if (scope.size && !scope.has(a.id) && !scope.has(b.id)) continue;
      const s = scorePair(a, b, { serviceCodes, thresholds: OVERLAP_THRESHOLDS });
      scored++;
      if (s.overlapIndex !== null) index.push(s.overlapIndex);
      if (s.marketSimilarity !== null) market.push(s.marketSimilarity);
      if (shouldStorePair(s)) stored.push(s);
    }
  }
  return { scored, stored, histogram: { index, market } };
}

export const LEVELS: ProgramLevel[] = ['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA'];

export async function runProgramOverlap(opts: { level?: ProgramLevel; programIds?: string[]; apply: boolean }): Promise<Array<{ level: ProgramLevel; runId: string | null; scored: number; stored: number; distribution: Record<string, number> }>> {
  const levels = opts.level ? [opts.level] : LEVELS;
  const results = [];
  for (const level of levels) {
    const progs = await loadOverlapProgrammes(level);
    const scopeIds = (opts.programIds ?? []).filter((id) => progs.some((p) => p.id === id));
    if (opts.programIds?.length && scopeIds.length === 0) continue; // nothing at this level
    const plan = planRunPairs(progs, { scopeProgramIds: scopeIds });
    const distribution = summarise(plan.histogram.index);
    if (!opts.apply) { results.push({ level, runId: null, scored: plan.scored, stored: plan.stored.length, distribution }); continue; }
    const run = await prisma.programOverlapRun.create({
      data: { methodologyVersion: PROGRAM_OVERLAP_VERSION, level, scopeProgramIds: scopeIds, thresholdsJson: { ...OVERLAP_THRESHOLDS } },
    });
    try {
      for (let k = 0; k < plan.stored.length; k += 500) {
        await prisma.programOverlapPair.createMany({
          data: plan.stored.slice(k, k + 500).map((s) => ({
            runId: run.id, level, programAId: s.programAId, programBId: s.programBId,
            structure: s.structure, content: s.content, outcome: s.outcome, overlapIndex: s.overlapIndex,
            containmentAInB: s.containmentAInB, containmentBInA: s.containmentBInA, band: s.band,
            sharedCredits: s.sharedCredits, equivCredits: s.equivCredits, sharedStaff: s.sharedStaff,
            marketSimilarity: s.marketSimilarity, languageVariant: s.languageVariant,
            actions: s.actions, primaryAction: s.primaryAction,
            evidenceJson: s.evidence as unknown as object, evidenceHash: s.evidenceHash,
            methodologyVersion: PROGRAM_OVERLAP_VERSION,
          })),
        });
      }
      await prisma.programOverlapRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', completedAt: new Date(), pairsScored: plan.scored, pairsStored: plan.stored.length, coverageJson: { distribution } },
      });
    } catch (e) {
      await prisma.programOverlapRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedAt: new Date(), errorText: String(e) } });
      throw e;
    }
    results.push({ level, runId: run.id, scored: plan.scored, stored: plan.stored.length, distribution });
  }
  return results;
}

/** p10/p25/p50/p75/p90/max of a list (empty → {}). */
export function summarise(xs: number[]): Record<string, number> {
  if (!xs.length) return {};
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
  return { n: s.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1]! };
}
```

`evidenceJson` must be cast to `Prisma.InputJsonValue`, not `object`. Import `type Prisma` from `@prisma/client`, and use `as unknown as Prisma.InputJsonValue`.

- [ ] **Step 4: Write the CLI `programs-overlap.ts`.** Copy the env loader and AI service pattern from `jobthai-embed.ts`.
  - **Flags:** `--level=<LEVEL>`, `--apply`, `--no-ai` (consumed in Task 12), and `--calibrate`.
  - **`--calibrate` prints, per level:**
    - the distribution of each layer, the index, containment and market similarity;
    - the best-match cosines for courses and PLOs, from a sample of 200 random pairs with a fixed seed. Compute these by scanning the PLO and course vectors of the sampled pairs directly in the CLI, using the `cosine` export;
    - the 20 highest-index pairs, the 20 pairs at the moderate boundary, and 10 language-variant pairs, each with names and layers, for the hand-check.
  - Add `"programs:overlap": "tsx src/scripts/programs-overlap.ts"` and the bundle TARGET.

- [ ] **Step 5: Run the tests and typecheck, then commit** as `feat(ingestion): program-overlap runner and CLI`.

---

### Task 10: Pipeline phase `phaseOV`

**Files:**
- Modify: `packages/shared/src/pipeline/program-phases.ts`, `packages/shared/test/program-phases.test.ts`, `apps/ingestion/src/scripts/programs-pipeline.ts`

- [ ] **Step 1: Update the test.** In `program-phases.test.ts`, add `'phaseOV'` to the expected phase list between `'phase7'` and `'phase8'`, and assert that its meta exists. Run it and confirm it fails.

- [ ] **Step 2: Add the phase.** Insert `'phaseOV'` after `'phase7'` in `PROGRAM_PIPELINE_PHASES`, and add its meta:

```ts
  phaseOV: {
    label: 'Phase OV · Programme overlap (same-level comparison)',
    shortLabel: 'Programme overlap',
    detail: 'deterministic + Flash wording for flagged pairs — needs overlap prep',
    dependencyHint: 'needs PLOs, course descriptions and embeddings (pnpm programs:overlap-prep)',
    approxCostUsd: 0.02,
  },
```

Check the `PROGRAM_PHASE_META` type for which fields are optional, and match the neighbouring entries.

- [ ] **Step 3: Wire it into the runner.** In `programs-pipeline.ts`, before the `if (shouldRun('phase8'))` block (around line 738), add:

```ts
  if (shouldRun('phaseOV')) {
    const t = Date.now();
    const r = await runProgramOverlap({ level: program.level, programIds: [program.id], apply: true })
      .then(async (res) => {
        await runOverlapRecommendations({ ai, runIds: res.map((x) => x.runId).filter((x): x is string => x !== null) });
        return { status: 'SUCCEEDED' as const, reason: `${res.reduce((s, x) => s + x.stored, 0)} pairs stored` };
      })
      .catch((e) => ({ status: 'FAILED' as const, reason: String(e?.message ?? e) }));
    phases.push({ name: 'phaseOV programme overlap', durationMs: Date.now() - t, costUsd: 0, status: r.status, note: r.reason });
  }
```

Match the exact `phases.push` shape used by the phase7 block (read it). `runOverlapRecommendations` arrives in Task 12; until then, import it from `../program-overlap/run` as a stub that returns `{ written: 0 }`. Task 12 replaces the stub body.

- [ ] **Step 4: Check the pickers and run the tests.** The pickers (`apps/web/app/admin/programs/list-client.tsx`, `apps/web/app/admin/data-setup/programs-pipeline-launcher.tsx`) read the shared list, so confirm with grep that they don't hard-code phases. Then run `cd packages/shared && pnpm vitest run test/program-phases.test.ts`, `cd apps/ingestion && pnpm tsc --noEmit` and `cd apps/web && pnpm tsc --noEmit`.

- [ ] **Step 5: Commit** as `feat(pipeline): phaseOV programme overlap`.

---

### Task 11: Calibration on dev (controller + user checkpoint)

This task is run by the controller and needs user review. Do not freeze thresholds without the user.

- [ ] **Step 1:** Run `cd apps/ingestion && pnpm programs:overlap --calibrate` (dry run, no writes).
- [ ] **Step 2:** Show the user the distributions and the hand-check list: the top 20 pairs, the boundary pairs and the language variants.
- [ ] **Step 3:** With the user, set:
  - `courseEquiv`;
  - `ploMatch`;
  - `marketFloor`, `marketCeiling` and `marketConfusion`;
  - the bands.

  Rules for choosing them:
  - a threshold sits where hand-checked "genuinely equivalent" pairs separate from "adjacent but different" ones (the method used for `JOBTHAI_EMBED_MATCH_FLOOR`);
  - the bands are judged by whether the top-20 pairs read as real overlap.
- [ ] **Step 4:** Update `OVERLAP_THRESHOLDS` and any test fixtures that hard-code the old values. Fill spec §12 with the measured distributions, the hand-check outcome and the chosen values. Commit as `feat(db): calibrate program-overlap.v1 thresholds` together with the spec edit.
- [ ] **Step 5:** Run `pnpm programs:overlap --apply` for all levels, and record the run ids and pair counts.

---

## Phase C — AI recommendations

### Task 12: Prompt and recommendation runner

**Files:**
- Create: `packages/shared/src/ai/prompts/program-overlap-recommendation.ts`, `packages/shared/test/program-overlap-recommendation.test.ts`
- Modify: `packages/shared/src/ai/prompts/index.ts` (add the export), `apps/ingestion/src/program-overlap/run.ts` (`runOverlapRecommendations`), `apps/ingestion/test/program-overlap-run.test.ts`

- [ ] **Step 1: Write the failing prompt test.** It checks that:
  - the version is `'program-overlap-recommendation.v1'`;
  - the schema accepts a valid object and rejects `nextSteps` with 1 item or 5 items, and `confidence` above 1;
  - `buildProgramOverlapRecommendationMessages(input)` returns `[system, user]`;
  - the system prompt contains `CHANNEL MANIFEST`, `CONFIDENCE RUBRIC`, `English` and `BANNED PHRASES`;
  - the user content contains both programme codes and the action list.

  The conformance test (`prompt-standard-conformance.test.ts`) also runs over the file automatically. **Do not add it to the allowlist.**

- [ ] **Step 2: Implement the prompt.** Read `docs/prompt-standard.md` in full, and copy the structure of an already conformant prompt (`grep -L` the allowlist; for example `program-curriculum-revision.ts`).

```ts
import { z } from 'zod';
import type { AiMessage } from '../types';

export const PROGRAM_OVERLAP_RECOMMENDATION_VERSION = 'program-overlap-recommendation.v1';

export const ProgramOverlapRecommendationSchema = z.object({
  rationale: z.string().min(80).max(1800),
  distinctiveA: z.string().min(20).max(700),
  distinctiveB: z.string().min(20).max(700),
  nextSteps: z.array(z.string().min(10).max(300)).min(2).max(4),
  confidence: z.number().min(0).max(1),
  disagreesWithAction: z.boolean(),
  disagreementReason: z.string().max(600).nullable(),
});
export type ProgramOverlapRecommendation = z.infer<typeof ProgramOverlapRecommendationSchema>;

export interface ProgramOverlapRecommendationInput {
  programA: { code: string; nameTh: string; nameEn: string | null; faculty: string; latestIntake: number | null };
  programB: { code: string; nameTh: string; nameEn: string | null; faculty: string; latestIntake: number | null };
  level: string;
  scores: { structure: number | null; content: number | null; outcome: number | null; overlapIndex: number; containmentAInB: number | null; containmentBInA: number | null; marketSimilarity: number | null };
  sharedStaff: number;
  languageVariant: boolean;
  actions: string[];
  evidence: {
    sharedCourses: Array<{ code: string; credits: number; nameTh: string | null }>;
    equivalentCourses: Array<{ codeA: string; codeB: string; nameA: string | null; nameB: string | null; similarity: number }>;
    matchedPlos: Array<{ textA: string; textB: string; similarity: number }>;
    unmatchedPlosA: string[];
    unmatchedPlosB: string[];
  };
  marketTextA: string;
  marketTextB: string;
}
```

The system prompt (a template literal) must contain:
- the role ("you draft the reasoning for a rule-chosen action; you never change the action");
- a **CHANNEL MANIFEST** listing every input field and saying what absence means (null means "data not available");
- the grounding rules (numbers only from the input; causal claims hedged);
- the meaning of each action and that every action is "for review";
- that language-variant pairs overlap by design;
- the **CONFIDENCE RUBRIC**, copied from the standard's rubric with this prompt's anchors;
- "Write all output in English; quote Thai course and programme names verbatim as data";
- the **BANNED PHRASES** block, copied from the standard;
- that `disagreesWithAction` is used only when the evidence contradicts the rule, with a reason.

`buildProgramOverlapRecommendationMessages(input)` returns `[{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(input, null, 2) }]`.

- [ ] **Step 3: Write the failing test for `runOverlapRecommendations`** (mocked prisma and AI). It checks that:
  - only pairs with actions and `overlapIndex ≥ actionIndex` are sent;
  - a pair whose existing recommendation has the same `evidenceHash` and `promptVersion` is skipped;
  - the output is upserted with the `aiInferenceId`;
  - an AI failure on one pair is logged and counted, and the loop continues.

- [ ] **Step 4: Implement `runOverlapRecommendations({ ai, runIds })`.**
  - Load the pairs of those runs with `include: { programA: { select: … faculty }, programB: …, recommendation: true }`.
  - Load the latest intake per programme: the newest `EnrollmentMetric.enrolled` with `realDataWhere()`, or null.
  - Load both market texts from `ProgramMarketProfile.text`.
  - Call `ai.extractStructured({ ctx: { module: 'program-overlap', kind: 'recommendation' }, messages, methodVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION, maxOutputTokens: 2000 }, ProgramOverlapRecommendationSchema)`.
  - Upsert `ProgramOverlapRecommendation` by `pairId`.
  - Return `{ written, skipped, failed, costUsd }`.

  Also replace the Task 10 stub. In the CLI, run it after `runProgramOverlap` unless `--no-ai` is passed.

- [ ] **Step 5: Run the shared tests (conformance included) and the ingestion tests, plus `tsc`. Commit** as `feat(overlap): AI recommendation prompt and runner`.

- [ ] **Step 6 (controller, dev):** run `pnpm programs:overlap --apply` once more, now with AI. Report the pairs sent, the cost, and three sample recommendations to the user.

---

## Phase D — Risk Management

### Task 13: Two KRIs, measure rules and versions

**Files:**
- Modify: `packages/db/src/risk-scoring.ts` (`ProgramRiskInputs` ~l.229, `loadProgramRiskInputs` ~l.898, `evaluateKris` ~l.1408, `RISK_INDICATOR_CATALOG` ~l.1499, `RISK_SCORING_VERSION` l.30)
- Modify: `packages/db/src/risk-measure-rules.ts`
- Create: `packages/db/src/program-overlap/risk.ts` (`loadOverlapRiskSignal(programId)`)
- Tests: `packages/db/test/risk-overlap-kris.test.ts`, plus updates to existing tests that pin the catalogue length, the rule count or the version (`grep -rln "RISK_SCORING_VERSION\|RISK_INDICATOR_CATALOG\|RISK_MEASURE_RULES" packages/db/test apps/*/test`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { evaluateKris, RISK_INDICATOR_CATALOG, RISK_SCORING_VERSION } from '../src/risk-scoring';
import { deriveRuleMeasures } from '../src/risk-measure-rules';

const base = { programId: 'p', level: 'BACHELOR', status: 'ACTIVE', tcasFunnel: [], enrollment: [], skills: [] } as never;
const withOverlap = (o: object) => ({ ...(base as object), overlap: o }) as never;
const thresholds = Object.fromEntries(RISK_INDICATOR_CATALOG.map((c) => [c.slug, c]));

describe('overlap KRIs', () => {
  it('version is v1.14 and the catalogue has both slugs', () => {
    expect(RISK_SCORING_VERSION).toBe('risk-scoring.v1.14');
    expect(RISK_INDICATOR_CATALOG.map((c) => c.slug)).toEqual(expect.arrayContaining(['curriculum_overlap_max', 'market_confusion_max']));
  });
  it('null without an overlap run', () => {
    const out = evaluateKris(base, new Date('2026-10-03'));
    expect(out.find((b) => b.indicatorSlug === 'curriculum_overlap_max')).toBeUndefined();
  });
  it('WARN at 50, CRITICAL at 70', () => {
    const at = (v: number) => evaluateKris(withOverlap({ curriculumOverlapMax: v, marketConfusionMax: null, mergeCandidate: false, curriculumSiblingId: 'q', marketSiblingId: null }), new Date('2026-10-03'))
      .find((b) => b.indicatorSlug === 'curriculum_overlap_max')!.severity;
    expect(at(49.9)).toBe('OK');
    expect(at(50)).toBe('WARN');
    expect(at(70)).toBe('CRITICAL');
  });
  it('CRITICAL overlap → differentiate; plus merge only for a merge candidate', () => {
    const kinds = (merge: boolean) => deriveRuleMeasures(
      [{ indicatorSlug: 'curriculum_overlap_max', severity: 'CRITICAL', value: 75, flags: merge ? ['merge-candidate'] : [] }],
      thresholds,
    ).map((m) => m.measure.kind);
    expect(kinds(false)).toEqual(['CURRICULUM_DIFFERENTIATE']);
    expect(kinds(true)).toEqual(expect.arrayContaining(['CURRICULUM_DIFFERENTIATE', 'PROGRAM_MERGE']));
  });
  it('CRITICAL market confusion → differentiate (marketing wording)', () => {
    const m = deriveRuleMeasures([{ indicatorSlug: 'market_confusion_max', severity: 'CRITICAL', value: 85 }], thresholds);
    expect(m.map((x) => x.measure.kind)).toEqual(['CURRICULUM_DIFFERENTIATE']);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

- [ ] **Step 3: Implement the risk-scoring changes.**
  - Add `overlap?: OverlapRiskSignal | null` to `ProgramRiskInputs`, where

    ```ts
    export interface OverlapRiskSignal {
      curriculumOverlapMax: number | null;
      curriculumSiblingId: string | null;
      mergeCandidate: boolean;
      marketConfusionMax: number | null;
      marketSiblingId: string | null;
      runId: string;
    }
    ```

  - In `program-overlap/risk.ts`, implement `loadOverlapRiskSignal(programId, level)`:
    - find the latest SUCCEEDED full run for the level (`scopeProgramIds` empty), plus newer SUCCEEDED scoped runs that include the programme;
    - among this programme's pairs, excluding `languageVariant`, take the newest row per pair across those runs;
    - return the max `overlapIndex` and its sibling, `mergeCandidate` (that pair's actions include `CONSIDER_MERGE_OR_TRACK`), and the max `marketSimilarity` and its sibling;
    - return null when no run exists.
  - Call it in `loadProgramRiskInputs`.
  - Add the two KRI blocks at the end of `evaluateKris`:

    ```ts
    // KRIs 6–7: programme overlap (program-overlap.v1). Null — no breach row —
    // until an overlap run exists.
    if (inputs.overlap?.curriculumOverlapMax != null) {
      const v = inputs.overlap.curriculumOverlapMax;
      out.push({ programId: inputs.programId, indicatorSlug: 'curriculum_overlap_max', value: v,
        severity: v >= 70 ? 'CRITICAL' : v >= 50 ? 'WARN' : 'OK', freshnessDate });
    }
    if (inputs.overlap?.marketConfusionMax != null) {
      const v = inputs.overlap.marketConfusionMax;
      out.push({ programId: inputs.programId, indicatorSlug: 'market_confusion_max', value: v,
        severity: v >= MARKET_CONFUSION_CRITICAL ? 'CRITICAL' : v >= MARKET_CONFUSION_WARN ? 'WARN' : 'OK', freshnessDate });
    }
    ```

    `MARKET_CONFUSION_WARN` and `MARKET_CONFUSION_CRITICAL` are the values calibrated in Task 11. Define them next to the catalogue, and make the catalogue entry read the same constants.
  - Add the two catalogue entries in the existing shape:
    - `labelEn`: 'Curriculum overlap with a sibling programme' and 'Market confusion with a sibling programme';
    - `labelTh`: 'ความซ้ำซ้อนของหลักสูตรกับหลักสูตรอื่นระดับเดียวกัน' and 'ความสับสนทางการตลาดกับหลักสูตรอื่นระดับเดียวกัน';
    - descriptions and formulas;
    - `alarmDirection: 'high'`.
  - Bump `RISK_SCORING_VERSION` to `'risk-scoring.v1.14'` with a dated comment line in the version history above it.
  - Make the breach's flags reach the rule engine. In `risks-assess.ts`, where the breaches are mapped into `deriveRuleMeasures` (lines ~358 and ~494), pass `flags: b.indicatorSlug === 'curriculum_overlap_max' && inputs.overlap?.mergeCandidate ? ['merge-candidate'] : []`.

- [ ] **Step 4: Implement the rule changes.**
  - Add `flags?: string[]` to `DerivationBreach`, and `requiresFlag?: string` to `RiskMeasureRule`. In `deriveRuleMeasures`, skip a rule whose `requiresFlag` is not among `breach.flags`.
  - Make `formatValue` return `Math.round(n)` for the two overlap slugs.
  - Add three rules:
    1. `curriculum_overlap_max`, CRITICAL, `CURRICULUM_DIFFERENTIATE`:
       - titleEn 'Differentiate the curriculum from its closest sibling programme', with a Thai title;
       - rationaleTemplateEn 'Curriculum overlap with a same-level sibling is {value}/100 (critical at {threshold}). Review shared and equivalent courses and sharpen the programme learning outcomes.', with Thai;
       - MEDIUM_TERM, MEDIUM, priority 2.
    2. `curriculum_overlap_max`, CRITICAL, `requiresFlag: 'merge-candidate'`, `PROGRAM_MERGE`:
       - titleEn 'Review merging with, or folding in as a track of, the sibling programme';
       - rationaleTemplateEn 'Overlap {value}/100 with high containment — the programme sits largely inside a sibling. For review by the faculty and Council; not a decision.';
       - LONG_TERM, HIGH, priority 1.
    3. `market_confusion_max`, CRITICAL, `CURRICULUM_DIFFERENTIATE`:
       - titleEn 'Differentiate the recruitment message from a similar sibling programme';
       - rationaleTemplateEn 'Market-facing similarity with a same-level sibling is {value}/100 (critical at {threshold}) — prospective students may not tell them apart.';
       - SHORT_TERM, LOW, priority 3.
  - Check the enum values for `RiskMeasureHorizon` in the schema and use the real names.
  - Bump `RISK_MEASURE_RULES_VERSION` to `'risk-measure-rules.v2'`, and update the header comment's rule count.

- [ ] **Step 5: Measure evidence.** Where `risks-assess.ts` persists a rule-derived measure for these slugs, include `{ siblingProgramId, overlapRunId }` in `evidenceJson`. Read the persist block, and add the fields from `inputs.overlap`.

- [ ] **Step 6: Run the tests.** Run `cd packages/db && pnpm vitest run` and `cd apps/ingestion && pnpm vitest run && pnpm tsc --noEmit`. Fix the pinned counts and versions in existing tests.

- [ ] **Step 7: Commit** as `feat(risk): curriculum-overlap and market-confusion KRIs (risk-scoring.v1.14)`.

---

## Phase E — API and UI

### Task 14: Read models and API endpoints

**Files:**
- Create: `packages/db/src/program-overlap/read.ts`, `packages/db/test/program-overlap-read.test.ts`
- Create: `apps/api/src/education/program-overlap.controller.ts`; register it in `apps/api/src/education/education.module.ts`
- Modify: `apps/api/src/programs/deep-dive.controller.ts` (`@Get('overlap')`), `apps/api/src/risks/risks.controller.ts` (`@Get('self-competition')`)
- Tests: `apps/api/test/program-overlap-endpoints.test.ts`

- [ ] **Step 1: Define the read-model types in `read.ts`** (exported, also used by the web types):

```ts
export interface OverlapMatrixResponse {
  methodologyVersion: string;
  runId: string | null;
  completedAt: string | null;
  level: ProgramLevel;
  programmes: Array<{ id: string; code: string; nameTh: string; nameEn: string | null; facultyId: string; facultyCode: string | null; facultyNameEn: string | null }>;
  order: string[];                                  // averageLinkageOrder
  cells: Array<{ a: string; b: string; pairId: string; overlapIndex: number | null; structure: number | null; content: number | null; outcome: number | null; marketSimilarity: number | null; band: OverlapBand; primaryAction: OverlapAction | null; languageVariant: boolean }>;
  groups: OverlapGroup[];                           // threshold = bandModerate
  kpis: { highPairs: number; programmesInGroups: number; mergeCandidates: number; consolidatableCredits: number };
}
export interface OverlapPairDetail { /* pair row + evidence + recommendation + both programmes' names/faculty */ }
export interface ProgramOverlapSection { programId: string; methodologyVersion: string; completedAt: string | null; siblings: Array<OverlapSibling> } // siblings with index ≥ bandLow, sorted desc
export interface SelfCompetitionRow { pairId: string; programA: …; programB: …; overlapIndex: number | null; marketSimilarity: number | null; intakeA: number | null; intakeB: number | null; measureKinds: string[] }
```

Write each interface out in full in the file. `OverlapSibling` = the sibling programme (id, code, names, faculty), the three layers, the index, both containments, `sharedStaff`, `actions`, `primaryAction`, `languageVariant`, the evidence and the recommendation (or null).

- [ ] **Step 2: Write the failing tests.** With mocked prisma:
  - `latestPairsFor(level)` takes the latest full run and overlays newer scoped runs per pair;
  - `programOverlapSection(programId)` returns `null` when no run exists, and `siblings: []` when none reaches 30;
  - `overlapMatrix` excludes programmes outside the faculty scope unless they pair with an in-scope programme;
  - the KPIs are computed correctly.

- [ ] **Step 3: Implement `read.ts`.**
  - Use plain Prisma throughout.
  - Build the `similarity` callback for `averageLinkageOrder` from the stored cells, using the selected layer, `overlapIndex` by default.
  - `consolidatableCredits` = the sum of `equivCredits` over pairs that have the `CONSOLIDATE_EQUIVALENT_COURSES` action.

- [ ] **Step 4: Add the endpoints.**
  - **`ProgramOverlapController` (`@Controller('/education/program-overlap')`):**
    - `@Get()` takes the query `level` (default BACHELOR), `layer` and `facultyId?`. Validate it with Zod through `ZodValidationPipe`, following `education.controller.ts`.
    - Use the same `@Authorized(...)` permission and scope guard as the other university/faculty education dashboards; read `education.controller.ts` for the class used on a non-program-aware tile. Clamp to the user's faculty scope the same way.
    - `@Provenance({ sources: [{ id: 'program-overlap', name: 'Programme overlap (program-overlap.v1)' }, { id: 'program-courses-extract', name: 'Curriculum course extraction' }, { id: 'program-skills-detailed', name: 'PLO extraction' }], methodologyVersion: PROGRAM_OVERLAP_VERSION, caveats: [...] })`. The caveats: curriculum overlap is not market cannibalisation; descriptions are capped at 80 courses per programme; every action is for review.
    - `@Get('pairs/:pairId')` returns `OverlapPairDetail`, after the same access check on both programmes.
  - **`deep-dive.controller.ts`:** `@Get('overlap')`, with `@Authorized('programs:read:all')`, `assertProgramAccessible` and the provenance above, returning `programOverlapSection(programId)`.
  - **`risks.controller.ts`:** `@Get('self-competition')`. Mirror the authorization of `@Get('portfolio')` and return `SelfCompetitionRow[]`, meaning the pairs whose programmes have a WARN or CRITICAL breach on either new KRI in the latest assessment.

- [ ] **Step 5: Run the api tests and `pnpm tsc --noEmit`. Commit** as `feat(api): programme overlap read endpoints`.

---

### Task 15: `OverlapMatrix` viz primitive

**Files:**
- Create: `packages/ui/src/viz/overlap-matrix.tsx`; export it from `packages/ui/src/viz/index.ts`
- Test: `packages/ui` has no test runner (confirmed during the grant-award work), so cover rendering in the web test of Task 16.

- [ ] **Step 1: Implement**, following `coverage-matrix.tsx` (inline SVG, `'use client'`, `useChartPalette`, `cn`).
  - **Props:**

    ```ts
    export interface OverlapMatrixProgramme { id: string; label: string; sublabel?: string; groupColorIndex?: number }
    export interface OverlapMatrixCell { a: string; b: string; value: number | null; title: string }
    export interface OverlapMatrixProps {
      programmes: OverlapMatrixProgramme[]; // already in display order
      cells: OverlapMatrixCell[];           // one per stored pair (symmetric drawn automatically)
      groups?: Array<{ members: string[] }>;// outlined blocks
      threshold?: number;                   // cells below → not drawn
      selected?: { a: string; b: string } | null;
      onSelect?: (a: string, b: string) => void;
      cellSize?: number;                    // default: fit to 720px, min 5
      className?: string;
    }
    ```

  - **Rendering:**
    - Diagonal cells use `palette.grid`.
    - A pair cell is filled with `palette.series[0]` at opacity `0.15 + 0.85 × value/100`, bucketed by band (30, 50, 70) so the legend is readable. Cells below `threshold` are not drawn.
    - The faculty strip: a 6 px band on the left and top, coloured `palette.series[(groupColorIndex ?? 0) % 12]`.
    - Group outlines: a rect around each group's contiguous span in display order, in `palette.text` with `strokeWidth 1.5`. Skip a group whose members aren't contiguous.
    - Each cell gets a `<title>` with `cell.title` for hover.
    - `onClick` calls `onSelect`. The selected cell gets a thicker stroke.
    - Row labels on the left show only when `cellSize ≥ 10`; otherwise a hover title is enough.
    - Add a legend under the matrix.
    - Empty state: "No programmes to compare at this level."
  - Tokens only; no hex.

- [ ] **Step 2: Typecheck and commit.** Run `cd packages/ui && pnpm tsc --noEmit -p .`, then commit as `feat(ui): OverlapMatrix viz`.

---

### Task 16: Education dashboard page and tile

**Files:**
- Create: `apps/web/app/education/program-overlap/page.tsx`, `client.tsx`, `types.ts`
- Modify: `apps/web/app/education/page.tsx` (TILES), `apps/web/app/education/thumbnails.tsx` (`ProgramOverlapThumb`), plus the wiring files used by other education tiles: `apps/web/src/lib/app-nav.tsx`, `packages/shared/src/auth/permissions.ts` / `roles.ts`, `apps/api/src/common/scope-guards.ts`, `packages/shared/src/analyst/dashboard-tools.ts`, `apps/api/src/analyst/dashboard-tool-executor.service.ts`. **Only touch the files where a non-program-aware education tile such as `/education/satisfaction` appears** (`grep -rn "education/satisfaction" apps packages --include=*.ts --include=*.tsx`); mirror its entries exactly.
- Test: `apps/web/test/program-overlap-ui.test.ts`

- [ ] **Step 1: Write the failing web test** (source-level and pure-helper, like `grant-award-ui.test.ts`). It checks that:
  - the TILES array contains `/education/program-overlap`;
  - the page imports `OverlapMatrix`;
  - the page renders `ProvenanceButton` and `FreshnessBadge`;
  - a pure helper `matrixTitle(cell, names)` in `program-overlap/types.ts` formats "A ↔ B · index 72 (structure 60 · content 75 · outcome 81) · Consider merge or track" and skips null layers.

- [ ] **Step 2: Implement.**
  - **`page.tsx` (server component):**
    - Auth and redirect, following `class-offerings/page.tsx`, but with the university/faculty gate of `satisfaction/page.tsx`.
    - Read `level`, `layer`, `facultyId` and `threshold` from `searchParams`.
    - `apiFetch<OverlapMatrixResponse>('/education/program-overlap?…')`.
    - Render `PageHeader` with `EducationBackLink`, a `FilterRail` (level, layer, faculty, threshold), then the client.
    - Empty state through `DiagnosticEmptyState` when `runId` is null: "No overlap analysis has run yet. Run `pnpm programs:overlap --apply`."
  - **`client.tsx` (`'use client'`):**
    - KPI strip (four `Card`s);
    - `OverlapMatrix`, with the programmes ordered by `order`, the cell value from the selected layer, and the faculty colour index from the faculty order;
    - the groups list;
    - a click opens the side panel (the repo's `RightPanel` from `@kku/ui`), which fetches `/education/program-overlap/pairs/:pairId` through a server action or `fetch` to the api proxy, following how other education clients fetch detail.
    - **Side panel content:**
      - layer bars and containment;
      - the shared-courses table and the equivalent pairs;
      - matched and unmatched PLOs;
      - shared staff;
      - action badges, each with "for review";
      - the recommendation, with `ConfidenceBadge`, sources (links to both Deep-Dives), "show reasoning" (`distinctiveA`/`distinctiveB` and `nextSteps`), the disagree button following `apps/web/app/programs/[id]` usage, and `disagreesWithAction` shown when true.
    - URL state: changing a filter pushes `?level=&layer=&facultyId=&threshold=`.
  - **Tile:** add it with `icon` (pick a lucide icon such as `Network` or `Combine`), title 'Program overlap', and blurb "Same-level programmes compared by shared courses, equivalent course content and PLO alignment. Clustered heatmap of overlapping groups, with graded, for-review suggestions to share courses and staff, differentiate, or consider merging." Use `Thumb: ProgramOverlapThumb` (a small 240×120 SVG of a clustered matrix with two dark diagonal blocks, palette constants only, like the other thumbs).

- [ ] **Step 3: Test and typecheck.** Run `cd apps/web && pnpm vitest run test/program-overlap-ui.test.ts && pnpm tsc --noEmit`, and do the same for `apps/api` and `packages/shared` if those were touched.

- [ ] **Step 4: Commit** as `feat(web): programme overlap dashboard with clustered heatmap`.

---

### Task 17: Deep-Dive "Overlap" section

**Files:**
- Create: `apps/web/app/programs/[id]/overlap-section.tsx`
- Modify: `apps/web/app/programs/[id]/page.tsx` (fetch), `types.ts` (`ProgramOverlapSection` mirror), `client.tsx` (SECTIONS, `railMeta`, render)
- Test: `apps/web/test/program-overlap-section.test.ts`

- [ ] **Step 1: Write the failing test.** Export a pure `shouldShowOverlapSection(section)` from `overlap-section.tsx` and test that:
  - `null` (no run) gives false;
  - `siblings: []` gives false;
  - one sibling at 31 gives true.

  Also check at source level that `client.tsx` adds the `overlap` entry to `SECTIONS` only when `shouldShowOverlapSection(...)` is true, and that the recommendation renders `ConfidenceBadge`.

- [ ] **Step 2: Implement.**
  - **`page.tsx`:** add `apiFetch<ProgramOverlapSection | null>(\`/programs/${id}/overlap\`).catch(() => null)` to the `Promise.all`.
  - **`client.tsx`:**
    - build `SECTIONS` conditionally: insert `{ id: 'overlap', label: 'Overlap', subs: [{ href: '#overlap-siblings', label: 'Overlapping programmes' }] }` right after the curriculum entry when `shouldShowOverlapSection(props.overlap)`;
    - set `railMeta.overlap`, e.g. "2 high-overlap siblings", counting `band === 'HIGH'`, or "N overlapping programmes";
    - render `<OverlapSection data={props.overlap} />` after the curriculum section, under the same condition.
  - **`overlap-section.tsx`:**
    - the sibling table with columns: programme (linked to `/programs/<id>`), faculty, index, the three layer bars, containment arrows ("this ⊂ sibling 84 %" / "sibling ⊂ this 40 %"), shared staff, and the action badge with "for review";
    - an expandable row with the recommendation (`ConfidenceBadge`, reasoning, next steps, disagreement note), shared courses, equivalent pairs and the PLO match table;
    - a `ProvenanceButton` and `FreshnessBadge` (completedAt) on the section header;
    - tokens only.

- [ ] **Step 3: Test and typecheck, then commit** as `feat(web): Deep-Dive overlap section (hidden when no sibling reaches 30)`.

---

### Task 18: Risk "Self-competition" panel

**Files:**
- Create: `apps/web/app/risks/self-competition-panel.tsx`
- Modify: `apps/web/app/risks/page.tsx` (fetch + render), `apps/web/app/risks/types.ts`
- Test: extend `apps/web/test/program-overlap-ui.test.ts` with a source-level check that the panel is rendered and fetched from `/risks/self-competition`.

- [ ] **Step 1: Write the failing test, then implement.**
  - The panel is a table: pair (two links), overlap index, market similarity, both intakes, and measure kinds as badges.
  - Empty state: "No programme is breaching the overlap or market-confusion indicators."
  - Add a `ProvenanceButton`.
  - Place it below the existing portfolio content in `page.tsx`, following the page's card style.

- [ ] **Step 2: Test and typecheck, then commit** as `feat(web): Risk self-competition panel`.

---

## Phase F — Documentation and verification

### Task 19: Documentation

**Files:**
- Create: `docs/methodologies/program-overlap.md`
- Modify:
  - `packages/db/src/methodology-bundle.ts` (register `'program-overlap': PROGRAM_OVERLAP_VERSION` and `'program-overlap-recommendation'`; bump `BUNDLE_CALENDAR_TAG` to the next `landscape-2026-10.vN`)
  - `apps/web/app/docs/methodology/content-en.tsx` and `content-th.tsx` (new section plus a revision row)
  - `docs/evaluation-pipeline.md`
  - the risk methodology doc (`grep -rln "risk-scoring.v1.13" docs`)
  - `apps/web/app/admin/application-topology/topology-data.ts` (nodes for the PLO table, the market profiles, the overlap runs/pairs and the three surfaces, with edges)
  - `CLAUDE.md` (status entry)

- [ ] **Step 1: Write `program-overlap.md`:**
  - the purpose;
  - the practice it is modelled on (credit transfer ≥ 75 %, AUN-QA/TQF curriculum mapping, containment);
  - the data prep;
  - the major-course rule;
  - all formulas exactly as in `score.ts`;
  - the null rules;
  - the thresholds with the calibration evidence from spec §12;
  - the actions;
  - the AI's role and limits;
  - the KRIs;
  - caveats: curriculum, not market, overlap; the 80-course description cap; credits defaulted to 3 when missing; the co-investigator-style lower-bound note does **not** apply here;
  - the prod run order.
- [ ] **Step 2: Do the other documentation edits** in the style of each file. The methodology paper section is a new top-level section, not a subsection, so it shows in the paper's table of contents.
- [ ] **Step 3: Run the methodology-bundle test, and `tsc` for web. Commit** as `docs: program-overlap.v1 methodology, paper, topology, risk docs`.

### Task 20: Full verification

- [ ] **Step 1:** Run `pnpm typecheck`, `pnpm -r --no-bail test`, and `npx eslint <files changed since the plan commit>`. Report the counts. The four `usage-action-coverage` failures that predate this work are the only allowed failures; compare anything else against `git stash`.
- [ ] **Step 2 (controller):** with the dev servers running, open `/education/program-overlap` (Bachelor), one high-overlap programme's Deep-Dive, a low-overlap programme's Deep-Dive (the section must be absent) and `/risks`. Check light and dark mode.
- [ ] **Step 3:** Report the commits, the dev run ids, the pair counts per level, the AI cost, and anything skipped.

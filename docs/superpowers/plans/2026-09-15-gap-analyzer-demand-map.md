# Gap Analyzer Demand Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-lens Gap Analyzer with a demand-first map: one row per field of study that JobThai employers ask for, a share-vs-share verdict per field, KKU's programmes and the occupations inside each row, and one Council brief.

**Architecture:** Two additive tables hold an AI-normalised, admin-reviewed taxonomy of JobThai's free-text fields of study and the programme ↔ field assignments. A bundled ingestion step builds them (and runs at the end of every JobThai batch refresh). One pure-ish function `computeGapMap` in `packages/db` produces everything the page shows; the API caches it; the page is server-rendered with URL-only controls. The old lenses, endpoints, insight modes and sub-pages are removed; redirects remain.

**Tech Stack:** Prisma 5.22 (`$queryRaw` + Zod), NestJS controllers with `@Authorized` / `@Provenance` / `@AuditLog` / `@AiCall`, `CacheService` (Redis), Gemini via `AiService` + `extractStructuredWithParseRetry`, Next.js 14 App Router server pages with route-handler proxies, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-gap-analyzer-demand-map-design.md`. Section numbers below (§3, §4 …) refer to it.

**Conventions that apply (from CLAUDE.md and memory):** no `any`; Zod on every I/O boundary; server components by default; tokens only, no literal colours; client components `import type` only from `@kku/shared`; every new row-writer stamps `ingestionRunId` or the rows are invisible to `realDataWhere()`; every surface showing JobThai-derived data carries `<DataSourceMark source="jobthai">`; never `git add -A` (`handoff.md`, `presentation_en.md`, `presentation_th.md` stay untracked); never build a release unless asked; the dev-safety hook denies any command string mentioning `.env`, `TRUNCATE` or `DROP`, so commit messages go through `git commit -F <file>` and greps are reworded; `pnpm --filter @kku/db exec prisma …` (never bare `npx prisma`, which resolves to a global Prisma 7); `nest start --watch` does not reload `packages/*`, so restart the api after touching `packages/db` or `packages/shared`.

Every commit message ends with:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
```

Write each message to `/tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-<n>.txt` and commit with `git commit -F <that file>`. Subagents delete only their own scratch file, by name.

**Dev environment facts the tasks rely on:**

- Postgres is up (`pnpm db:up`); `DATABASE_URL` is in the root `.env` (never print it). Tests that need it use the `postgresUp` + `describe.skipIf` pattern shown in Task 3.
- Live counts on 2026-09-15: 47,631 JobThai postings; 3,854 distinct field strings, 518 with ≥ 5 mentions; `*ANY*` on 2,566 postings; bachelor-eligible postings 33,307; postgraduate-eligible 41; `UNSPECIFIED` 14,283; `kmitl_skill_growths` 18,789 rows; 94 trend signals, 9 with `affected_programs_json` / `new_initiatives_json`.
- `job_postings` carries `ingestion_run_id` (so `realDataSql('jp')` is valid); `jobthai_occupation_skills` and `job_posting_skills` do NOT (never gate them).
- Sign-in for a manual probe: `POST http://10.101.111.233:3000/api/auth/callback/dev-credentials` with the csrf token from `/api/auth/csrf`, email `denpong@kku.ac.th`, password `kku-dev`.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` (modify) | `JobFieldTaxonomy`, `ProgramJobField`, enum `JobFieldReviewStatus`, back-relations on `Program` and `IngestionRun`. |
| `packages/db/prisma/migrations/20260915100000_job_field_taxonomy/migration.sql` (create) | The two tables, enum, indexes (incl. GIN on `synonyms`). |
| `packages/db/prisma/migrations/20260915100100_job_postings_required_fields_gin/migration.sql` (create) | GIN index on `job_postings.required_fields_raw` for the `&&` overlap join. |
| `packages/db/test/job-field-schema.test.ts` (create) | Structural guard on the two models. |
| `packages/shared/src/ai/prompts/job-field-taxonomy.ts` (create) | `job-field-taxonomy.v1`: cluster raw strings into canonical fields with anchors. |
| `packages/shared/src/ai/prompts/program-job-field.ts` (create) | `program-job-field.v1`: assign ≤ 3 fields per programme. |
| `packages/shared/src/ai/prompts/gap-brief.ts` (create) | `gap-brief.v1`: the Council brief over the rows on screen. |
| `packages/shared/src/ai/prompts/index.ts` (modify) | Export the three; remove `gap-insights`. |
| `packages/db/src/job-fields.ts` (create) | Pure planner (`planTaxonomyBatches`, `applyTaxonomyOutput`, `planRuleAssignments`), raw-string collector, writers, readers and admin mutations. |
| `packages/db/test/job-fields.test.ts` (create) | Planner purity + idempotence; DB-backed writer round-trip. |
| `apps/ingestion/src/jobthai/fields.ts` (create) | `refreshJobFields({ apply, runId, ai, log })` — orchestrates collect → AI → write. |
| `apps/ingestion/src/scripts/jobthai-fields.ts` (create) | Operator CLI, dry-run default, `--apply`, unknown flags rejected. |
| `apps/ingestion/src/jobthai/refresh.ts` (modify) | Call `refreshJobFields` after links; `RefreshSummary.fields`. |
| `apps/ingestion/scripts/bundle-pipeline-scripts.ts`, root `package.json` (modify) | TARGET + `pnpm jobthai:fields`. |
| `apps/api/src/job-fields/{job-fields.controller,job-fields.module}.ts` (create) | `/admin/job-fields` review API, audit-logged, purges the map cache. |
| `apps/api/src/app.module.ts` (modify) | Register `JobFieldsModule`. |
| `packages/shared/test/usage-action-coverage.test.ts` (modify) | New audit actions classified `other`. |
| `apps/web/app/admin/job-fields/{page,client}.tsx`, `apps/web/app/api/admin-job-fields/route.ts`, `apps/web/app/api/admin-job-fields/[...path]/route.ts` (create) | Review page + proxies; tile on `apps/web/app/admin/page.tsx`. |
| `packages/db/src/gap-map-rules.ts` (create) | Pure: `verdictFor`, `pipelineArrow`, `parseThresholds`, `reconcile`. |
| `packages/db/src/gap-map.ts` (create) | `computeGapMap(scope, scopeId, thresholds)`; `scopeProgramIds`. |
| `packages/db/src/gap-map-signals.ts` (create) | Global signal per field + trend signals per field. |
| `packages/db/src/health-score.ts` (modify) | Export `getProgramScoreIndex` with `overall` in each entry. |
| `packages/db/test/gap-map-rules.test.ts`, `packages/db/test/gap-map.test.ts`, `packages/db/test/gap-map-signals.test.ts` (create) | Rules; DB-backed reconciliation; signal mapping. |
| `apps/api/src/gap/{gap.controller,gap.service,gap-brief.service,gap.module}.ts` (rewrite) | `GET /gap/map`, `GET /gap/map/fields/:slug`, `POST /gap/brief`, `POST /gap/brief/disagreements`, `GET /gap/digital-competency`. |
| `apps/api/test/gap-controller.test.ts` (create) | Threshold validation, cache key, brief input. |
| `apps/web/app/gap-analysis/{page,types,sections,controls,row-panels,brief-panel}.tsx` (rewrite) | The one page. |
| `apps/web/app/api/gap-map/fields/[slug]/route.ts`, `apps/web/app/api/gap-brief/route.ts`, `apps/web/app/api/gap-brief/disagreements/route.ts` (create) | Browser proxies. |
| `apps/web/app/gap-analysis/{opportunities,risks,digital-competency}/page.tsx` (rewrite as redirects) | Redirects per §5. |
| `apps/web/app/education/digital-competency/page.tsx` (move from gap-analysis) | Unchanged page, new home. |
| `apps/web/test/gap-map-render.test.tsx` (create) | Chips/strip counts, panels, empty states, provenance. |
| `apps/api/src/analyst/tool-executor.service.ts`, `packages/shared/src/analyst/tools.ts`, `packages/db/src/decisions.ts`, `apps/api/src/decisions/decision-review.service.ts` (modify) | Re-point to the map. |
| `packages/db/src/gap-analysis.ts` (shrink), `packages/db/src/gap-lenses.ts` (delete), `apps/api/src/gap/gap-insights.service.ts` (delete), `packages/shared/src/ai/prompts/gap-insights.ts` (delete), `packages/db/test/gap-analysis.test.ts` (delete), `apps/api/test/gap-insights.test.ts` (delete) | Retirement per §7. |
| `packages/db/src/methodology-bundle.ts`, `packages/db/test/methodology-bundle.test.ts` (modify) | `gap-map`, `gap-brief`, `job-field-taxonomy` in the manifest; calendar tag bump. |
| `docs/methodologies/gap-map.md` (create); `docs/methodologies/README.md`, `docs/data-sources/jobthai.md`, `docs/evaluation-pipeline.md`, `apps/web/app/docs/methodology/content-{en,th}.tsx`, `apps/web/app/admin/application-topology/topology-data.ts`, `apps/web/app/changelog/page.tsx` (modify) | Documentation per §8. |

---

### Task 1: Taxonomy schema — two additive migrations and a structural test

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (near `model ProgramJobThaiLink`, ~line 2042; back-relations at `Program` ~line 545 and `IngestionRun` ~line 3300)
- Create: `packages/db/prisma/migrations/20260915100000_job_field_taxonomy/migration.sql`
- Create: `packages/db/prisma/migrations/20260915100100_job_postings_required_fields_gin/migration.sql`
- Test: `packages/db/test/job-field-schema.test.ts`

- [ ] **Step 1: Write the failing structural test**

```ts
// packages/db/test/job-field-schema.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The taxonomy rows are Council-facing (every field on /gap-analysis is one).
// They must carry provenance (ingestionRunId) so realDataWhere() admits them,
// a review status so PROPOSED rows can be labelled, and a method version so a
// prompt bump is visible per row. This reads schema.prisma so it holds without
// a database.

const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
const model = (name: string) => {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1]!;
};

describe('JobFieldTaxonomy', () => {
  const body = model('JobFieldTaxonomy');
  it('maps to job_field_taxonomy with a unique slug and a synonyms array', () => {
    expect(body).toContain('@@map("job_field_taxonomy")');
    expect(body).toMatch(/slug\s+String\s+@unique/);
    expect(body).toMatch(/synonyms\s+String\[\]/);
  });
  it('carries review status, method version and provenance', () => {
    expect(body).toMatch(/reviewStatus\s+JobFieldReviewStatus/);
    expect(body).toMatch(/methodVersion\s+String/);
    expect(body).toMatch(/ingestionRunId\s+String\?/);
    expect(body).toContain('@@index([reviewStatus])');
  });
});

describe('ProgramJobField', () => {
  const body = model('ProgramJobField');
  it('is unique per (programId, fieldId) and cascades from both parents', () => {
    expect(body).toContain('@@map("program_job_fields")');
    expect(body).toContain('@@unique([programId, fieldId])');
    expect((body.match(/onDelete: Cascade/g) ?? []).length).toBe(2);
  });
  it('carries source, confidence, review status and provenance', () => {
    expect(body).toMatch(/source\s+String/);
    expect(body).toMatch(/confidence\s+Float\?/);
    expect(body).toMatch(/reviewStatus\s+JobFieldReviewStatus/);
    expect(body).toMatch(/ingestionRunId\s+String\?/);
  });
});

describe('JobFieldReviewStatus', () => {
  it('has exactly PROPOSED, APPROVED, REJECTED', () => {
    const m = schema.match(/enum JobFieldReviewStatus \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const values = m![1]!.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    expect(values).toEqual(['PROPOSED', 'APPROVED', 'REJECTED']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/job-field-schema.test.ts`
Expected: FAIL — `model JobFieldTaxonomy not found`.

- [ ] **Step 3: Add the enum and models to `schema.prisma`**

Insert directly after the `ProgramJobThaiLink` model (after its closing `}` around line 2069):

```prisma
/// Review state shared by the field taxonomy and programme ↔ field assignments.
/// PROPOSED rows are shown on the Gap Analyzer immediately, labelled
/// "unreviewed" in provenance; APPROVED / REJECTED are never downgraded by the
/// build step (docs/methodologies/gap-map.md §taxonomy).
enum JobFieldReviewStatus {
  PROPOSED
  APPROVED
  REJECTED
}

/// One canonical field of study that JobThai employers ask for, absorbing the
/// raw free-text strings in `synonyms`. A raw string belongs to at most one
/// row (enforced in packages/db/src/job-fields.ts, not by the database, since
/// Postgres cannot express uniqueness across array elements of different rows).
model JobFieldTaxonomy {
  id             String               @id @default(cuid())
  slug           String               @unique
  nameTh         String               @map("name_th")
  nameEn         String               @map("name_en")
  /// Raw `job_postings.required_fields_raw` strings this field absorbs.
  synonyms       String[]
  /// Postings naming any synonym, refreshed by the build step. Denormalised
  /// for the review page; the map recomputes it from postings.
  mentionCount   Int                  @default(0) @map("mention_count")
  reviewStatus   JobFieldReviewStatus @default(PROPOSED) @map("review_status")
  methodVersion  String               @map("method_version")
  /// Stamped on write so realDataWhere() admits the row.
  ingestionRunId String?              @map("ingestion_run_id")
  createdAt      DateTime             @default(now()) @map("created_at")
  updatedAt      DateTime             @updatedAt @map("updated_at")

  programs     ProgramJobField[]
  ingestionRun IngestionRun?     @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)

  @@index([reviewStatus])
  @@map("job_field_taxonomy")
}

/// A programme's graduates hold this field of study. `source` is 'rule'
/// (name match via matchFieldToProgramme), 'ai' (program-job-field prompt) or
/// 'manual' (added on /admin/job-fields).
model ProgramJobField {
  id             String               @id @default(cuid())
  programId      String               @map("program_id")
  fieldId        String               @map("field_id")
  source         String
  confidence     Float?
  reviewStatus   JobFieldReviewStatus @default(PROPOSED) @map("review_status")
  methodVersion  String               @map("method_version")
  ingestionRunId String?              @map("ingestion_run_id")
  createdAt      DateTime             @default(now()) @map("created_at")
  updatedAt      DateTime             @updatedAt @map("updated_at")

  program      Program          @relation(fields: [programId], references: [id], onDelete: Cascade)
  field        JobFieldTaxonomy @relation(fields: [fieldId], references: [id], onDelete: Cascade)
  ingestionRun IngestionRun?    @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)

  @@unique([programId, fieldId])
  @@index([fieldId])
  @@map("program_job_fields")
}
```

Add back-relations. In `model Program`, next to `programJobThaiLinks      ProgramJobThaiLink[]` (~line 545):

```prisma
  programJobFields         ProgramJobField[]
```

In `model IngestionRun`, next to `programJobThaiLinks        ProgramJobThaiLink[]` (~line 3300):

```prisma
  jobFieldTaxonomy           JobFieldTaxonomy[]
  programJobFields           ProgramJobField[]
```

- [ ] **Step 4: Write the two migrations by hand**

```sql
-- packages/db/prisma/migrations/20260915100000_job_field_taxonomy/migration.sql
-- Field-of-study taxonomy for the demand-first Gap Analyzer. Additive only.
--
-- Hand-written to match `prisma migrate diff --from-schema-datasource`.
-- job_field_taxonomy: one row per canonical field; synonyms are the raw
-- JobThai strings it absorbs, GIN-indexed because the map joins postings to
-- fields with the array-overlap operator (required_fields_raw && synonyms).
-- program_job_fields: programme <-> field assignments, unique per pair.

CREATE TYPE "JobFieldReviewStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

CREATE TABLE "job_field_taxonomy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "synonyms" TEXT[],
    "mention_count" INTEGER NOT NULL DEFAULT 0,
    "review_status" "JobFieldReviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "method_version" TEXT NOT NULL,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "job_field_taxonomy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_field_taxonomy_slug_key" ON "job_field_taxonomy"("slug");
CREATE INDEX "job_field_taxonomy_review_status_idx" ON "job_field_taxonomy"("review_status");
CREATE INDEX "job_field_taxonomy_synonyms_gin" ON "job_field_taxonomy" USING GIN ("synonyms");
ALTER TABLE "job_field_taxonomy" ADD CONSTRAINT "job_field_taxonomy_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "program_job_fields" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "review_status" "JobFieldReviewStatus" NOT NULL DEFAULT 'PROPOSED',
    "method_version" TEXT NOT NULL,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "program_job_fields_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "program_job_fields_program_id_field_id_key" ON "program_job_fields"("program_id", "field_id");
CREATE INDEX "program_job_fields_field_id_idx" ON "program_job_fields"("field_id");
ALTER TABLE "program_job_fields" ADD CONSTRAINT "program_job_fields_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_job_fields" ADD CONSTRAINT "program_job_fields_field_id_fkey"
  FOREIGN KEY ("field_id") REFERENCES "job_field_taxonomy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_job_fields" ADD CONSTRAINT "program_job_fields_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

```sql
-- packages/db/prisma/migrations/20260915100100_job_postings_required_fields_gin/migration.sql
-- GIN index for the Gap Analyzer's postings <-> field join
-- (job_postings.required_fields_raw && job_field_taxonomy.synonyms).
-- Additive; Prisma has no GIN attribute for String[] so a future
-- `prisma migrate diff` will report this index as drift — expected.

CREATE INDEX "job_postings_required_fields_raw_gin" ON "job_postings" USING GIN ("required_fields_raw");
```

- [ ] **Step 5: Apply, regenerate, run the tests**

```bash
pnpm --filter @kku/db exec prisma migrate deploy
pnpm --filter @kku/db exec prisma generate
pnpm --filter @kku/db exec vitest run test/job-field-schema.test.ts test/migration-linter.test.ts
pnpm --filter @kku/db typecheck
```

Expected: both migrations applied; the four schema tests PASS; the linter test still PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260915100000_job_field_taxonomy packages/db/prisma/migrations/20260915100100_job_postings_required_fields_gin packages/db/test/job-field-schema.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-1.txt
```

Message: `feat(db): job-field taxonomy and programme assignments — two additive migrations` + body: what the two tables are, the GIN indexes and why, the array-uniqueness rule enforced in code, plus the attribution lines.

---

### Task 2: The two taxonomy prompts

**Files:**
- Create: `packages/shared/src/ai/prompts/job-field-taxonomy.ts`
- Create: `packages/shared/src/ai/prompts/program-job-field.ts`
- Modify: `packages/shared/src/ai/prompts/index.ts` (add two `export *` lines)
- Test: `packages/shared/test/job-field-prompts.test.ts`

Both prompts must carry the markers `packages/shared/test/prompt-standard-conformance.test.ts` requires of every new file: `CHANNEL MANIFEST`, `CONFIDENCE RUBRIC`, the word `English`, and `BANNED PHRASES`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/job-field-prompts.test.ts
import { describe, expect, it } from 'vitest';
import {
  JOB_FIELD_TAXONOMY_VERSION,
  JobFieldTaxonomyOutputSchema,
  buildJobFieldTaxonomyMessages,
} from '../src/ai/prompts/job-field-taxonomy';
import {
  PROGRAM_JOB_FIELD_VERSION,
  ProgramJobFieldOutputSchema,
  buildProgramJobFieldMessages,
} from '../src/ai/prompts/program-job-field';

describe('job-field-taxonomy.v1', () => {
  it('is versioned and puts every raw string and every anchor in the user turn', () => {
    expect(JOB_FIELD_TAXONOMY_VERSION).toBe('job-field-taxonomy.v1');
    const msgs = buildJobFieldTaxonomyMessages({
      rawStrings: [{ raw: 'บัญชี', mentions: 812 }, { raw: 'Accounting', mentions: 40 }],
      anchors: [{ slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า'] }],
    });
    const user = msgs.find((m) => m.role === 'user')!.content;
    expect(user).toContain('บัญชี');
    expect(user).toContain('812');
    expect(user).toContain('electrical-engineering');
    expect(user).toContain('ไฟฟ้า');
  });
  it('refuses an empty or oversized batch', () => {
    expect(() => buildJobFieldTaxonomyMessages({ rawStrings: [], anchors: [] })).toThrow();
    const big = Array.from({ length: 201 }, (_, i) => ({ raw: `f${i}`, mentions: 5 }));
    expect(() => buildJobFieldTaxonomyMessages({ rawStrings: big, anchors: [] })).toThrow(/200/);
  });
  it('validates the output shape', () => {
    const ok = JobFieldTaxonomyOutputSchema.safeParse({
      newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
      assignments: [{ raw: 'บัญชี', fieldSlug: 'accounting' }, { raw: 'Accounting', fieldSlug: 'accounting' }],
      confidence: 0.8,
      reasoning: 'Both strings name the accounting discipline.',
    });
    expect(ok.success).toBe(true);
    expect(JobFieldTaxonomyOutputSchema.safeParse({ newFields: [], assignments: [], confidence: 2, reasoning: '' }).success).toBe(false);
  });
});

describe('program-job-field.v1', () => {
  it('is versioned and lists the closed field vocabulary', () => {
    expect(PROGRAM_JOB_FIELD_VERSION).toBe('program-job-field.v1');
    const msgs = buildProgramJobFieldMessages({
      programs: [{ id: 'p1', code: 'KKU-SEQ-0001', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical Engineering', level: 'BACHELOR', skills: ['Circuit design'] }],
      fields: [{ slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering' }],
    });
    const user = msgs.find((m) => m.role === 'user')!.content;
    expect(user).toContain('KKU-SEQ-0001');
    expect(user).toContain('electrical-engineering');
    expect(user).toContain('Circuit design');
  });
  it('caps a programme at three fields and refuses more than 50 programmes', () => {
    const four = { programs: [{ programId: 'p1', fields: [1, 2, 3, 4].map((n) => ({ slug: `f${n}`, confidence: 0.5 })) }], confidence: 0.5, reasoning: 'x' };
    expect(ProgramJobFieldOutputSchema.safeParse(four).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, code: `c${i}`, nameTh: 'x', nameEn: 'x', level: 'BACHELOR', skills: [] }));
    expect(() => buildProgramJobFieldMessages({ programs: many, fields: [] })).toThrow(/50/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kku/shared exec vitest run test/job-field-prompts.test.ts`
Expected: FAIL — cannot resolve `../src/ai/prompts/job-field-taxonomy`.

- [ ] **Step 3: Write `job-field-taxonomy.ts`**

```ts
// packages/shared/src/ai/prompts/job-field-taxonomy.ts
import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Job-field taxonomy — clusters the free-text "field of study" strings JobThai
// employers write ("วุฒิปริญญาตรี สาขาบัญชี", "Accounting", "บัญชี/การเงิน")
// into canonical fields with Thai + English names, each absorbing its raw
// strings as synonyms. Existing APPROVED fields are passed as ANCHORS so new
// strings attach to them instead of duplicating.
//
// Used by apps/ingestion/src/jobthai/fields.ts (pnpm jobthai:fields, and the
// end of every JobThai batch refresh). Rows land in job_field_taxonomy with
// reviewStatus PROPOSED and are reviewed at /admin/job-fields.
//
// Batched at 200 raw strings per call (518 strings cleared the 5-mention floor
// on 2026-09-15, so the first run is three calls; later runs see only strings
// no synonym list absorbs, usually zero). New fields from one batch become
// anchors for the next, which is what keeps a discipline from being created
// twice across batches.
//
// Version-bumping rule: any change to the system prompt, output schema or
// clustering rules = bump VERSION. JobFieldTaxonomy.methodVersion records it.
// ─────────────────────────────────────────────────────────────────────────────

export const JOB_FIELD_TAXONOMY_VERSION = 'job-field-taxonomy.v1';
export const JOB_FIELD_TAXONOMY_BATCH_MAX = 200;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const JobFieldTaxonomyOutputSchema = z.object({
  newFields: z.array(
    z.object({
      slug: z.string().regex(SLUG),
      nameTh: z.string().min(1),
      nameEn: z.string().min(1),
    }),
  ),
  /** Every raw string in the input, exactly once, attached to an anchor slug or a new slug. */
  assignments: z.array(z.object({ raw: z.string().min(1), fieldSlug: z.string().regex(SLUG) })),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});
export type JobFieldTaxonomyOutput = z.infer<typeof JobFieldTaxonomyOutputSchema>;

export interface JobFieldTaxonomyInput {
  rawStrings: Array<{ raw: string; mentions: number }>;
  anchors: Array<{ slug: string; nameTh: string; nameEn: string; synonyms: string[] }>;
}

export function buildJobFieldTaxonomyMessages(input: JobFieldTaxonomyInput): AiMessage[] {
  if (input.rawStrings.length === 0) throw new Error('Empty rawStrings batch');
  if (input.rawStrings.length > JOB_FIELD_TAXONOMY_BATCH_MAX) {
    throw new Error(`Batch too large: ${input.rawStrings.length} > ${JOB_FIELD_TAXONOMY_BATCH_MAX} (split before calling)`);
  }

  const system = `You organise the "field of study" strings that Thai employers write in job adverts into a taxonomy of canonical fields of study, the way a university registrar would name disciplines.

Input: raw strings with how many adverts mention each, plus ANCHORS — canonical fields that already exist, with the strings they already absorb.

For EACH raw string, attach it to exactly one field: an anchor slug, or a slug you create in newFields. Create a new field only when no anchor names the same discipline.

Output STRICT JSON (no prose, no markdown fences):
{
  "newFields": [ { "slug": "kebab-case-english", "nameTh": "<Thai discipline name>", "nameEn": "<English discipline name>" } ],
  "assignments": [ { "raw": "<raw string verbatim>", "fieldSlug": "<anchor slug or new slug>" } ],
  "confidence": 0.0-1.0,
  "reasoning": "<≤600 chars, English>"
}

Rules:
1. EVERY raw string in the input MUST appear in assignments exactly once, verbatim.
2. A field is a DISCIPLINE a graduate holds (Accounting, Electrical engineering, Nursing, Logistics), not a job title and not a skill. "บัญชี", "การบัญชี", "Accounting", "บัญชี/การเงิน" are ONE field; "การเงิน" alone is Finance, a different field.
3. Prefer anchors. Attach to an anchor whenever the raw string names the same discipline or a sub-discipline of it; create a new field only for a discipline no anchor covers.
4. Granularity: a field should be recognisable as a degree major. Do not split Electrical engineering into power vs electronics; do not merge Marketing into Business administration.
5. Slugs: lowercase English kebab-case, stable and readable ("mechanical-engineering", "public-health"). Never reuse an anchor slug in newFields.
6. nameTh and nameEn are data labels: nameTh in Thai, nameEn in English. Thai strings with no natural English name get a transliteration in nameEn.
7. LANGUAGE RULE (English-only free text): \`reasoning\` MUST be written in English. \`nameTh\` stays Thai; \`raw\` is preserved verbatim regardless of language.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const anchorsBlock =
    input.anchors.length === 0
      ? '(none yet — this is the first batch)'
      : input.anchors
          .map((a) => `${a.slug}: ${a.nameEn} / ${a.nameTh} — absorbs: ${a.synonyms.join(' | ')}`)
          .join('\n');
  const rawBlock = input.rawStrings.map((r, i) => `${i + 1}. ${r.raw}  (${r.mentions} adverts)`).join('\n');

  const user = `[Anchors] (slug: nameEn / nameTh — absorbs: raw strings)
${anchorsBlock}

[Raw strings to attach] (${input.rawStrings.length} strings)
${rawBlock}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - rawStrings — job_postings.required_fields_raw values with ≥ 5 mentions
//     that no existing synonym list absorbs, with mention counts so the model
//     weighs a common string more carefully than a rare one.
//   - anchors — every non-REJECTED job_field_taxonomy row (slug, names,
//     synonyms). THE closed-world set the model attaches to before creating.
//
// Deliberately omitted, with reason:
//   - strings below the 5-mention floor — the "other" bucket; counted in
//     denominators, never assigned, so never sent.
//   - the '*ANY*' sentinel — "any field" is its own line on the map, not a
//     discipline.
//   - programme names — the taxonomy describes demand; programme assignment
//     is a separate prompt (program-job-field) so demand vocabulary is not
//     bent toward what KKU happens to teach.
// ─────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Write `program-job-field.ts`**

```ts
// packages/shared/src/ai/prompts/program-job-field.ts
import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Programme → job-field assignment. Given the canonical field vocabulary
// (job-field-taxonomy) and a programme's names, level and taught skills,
// returns up to three fields whose graduates this programme produces.
//
// Runs AFTER the name-match rule (matchFieldToProgramme in jobthai-bridge):
// programmes the rule already assigned are not sent, so the model only
// decides the remainder. Batched at 50 programmes per call.
//
// Version-bumping rule: any change here = bump VERSION;
// ProgramJobField.methodVersion records it.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_JOB_FIELD_VERSION = 'program-job-field.v1';
export const PROGRAM_JOB_FIELD_BATCH_MAX = 50;
export const PROGRAM_JOB_FIELD_MAX_FIELDS = 3;

export const ProgramJobFieldOutputSchema = z.object({
  programs: z.array(
    z.object({
      programId: z.string().min(1),
      fields: z
        .array(z.object({ slug: z.string().min(1), confidence: z.number().min(0).max(1) }))
        .max(PROGRAM_JOB_FIELD_MAX_FIELDS),
    }),
  ),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});
export type ProgramJobFieldOutput = z.infer<typeof ProgramJobFieldOutputSchema>;

export interface ProgramJobFieldInput {
  programs: Array<{
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    level: string;
    skills: string[];
  }>;
  fields: Array<{ slug: string; nameTh: string; nameEn: string }>;
}

export function buildProgramJobFieldMessages(input: ProgramJobFieldInput): AiMessage[] {
  if (input.programs.length === 0) throw new Error('Empty programs batch');
  if (input.programs.length > PROGRAM_JOB_FIELD_BATCH_MAX) {
    throw new Error(`Batch too large: ${input.programs.length} > ${PROGRAM_JOB_FIELD_BATCH_MAX} (split before calling)`);
  }

  const system = `You decide which fields of study a university programme's graduates hold, using a closed vocabulary of fields taken from employer job adverts.

For EACH programme, return up to ${PROGRAM_JOB_FIELD_MAX_FIELDS} field slugs from the vocabulary, with a confidence each. Return an empty list when no field in the vocabulary fits — an empty list is a valid, honest answer.

Output STRICT JSON (no prose, no markdown fences):
{
  "programs": [ { "programId": "<id>", "fields": [ { "slug": "<vocabulary slug>", "confidence": 0.0-1.0 } ] } ],
  "confidence": 0.0-1.0,
  "reasoning": "<≤600 chars, English>"
}

Rules:
1. EVERY programme in the input MUST appear in programs exactly once, by its id.
2. Only slugs from the vocabulary. Never invent a slug.
3. The FIRST field is the programme's own discipline (its degree name). Add a second or third only when employers would genuinely accept this graduate as holding that field too (a Mechatronics graduate holds Mechanical AND Electrical engineering; a Nursing graduate does not hold Public health).
4. Level matters only for naming: a Master's in Accounting still holds Accounting. Do not withhold a field because the programme is postgraduate.
5. Skills are a hint, not the decision: a programme teaching Python is not thereby Computer science.
6. LANGUAGE RULE (English-only free text): \`reasoning\` MUST be written in English; ids and slugs are preserved verbatim.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const fieldsBlock = input.fields.map((f) => `${f.slug}: ${f.nameEn} / ${f.nameTh}`).join('\n');
  const programsBlock = input.programs
    .map(
      (p) =>
        `- id=${p.id} code=${p.code} level=${p.level}\n  ${p.nameEn} / ${p.nameTh}\n  skills: ${p.skills.length ? p.skills.join(', ') : '(none extracted)'}`,
    )
    .join('\n');

  const user = `[Field vocabulary] (slug: nameEn / nameTh)
${fieldsBlock || '(empty)'}

[Programmes] (${input.programs.length})
${programsBlock}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - fields — every non-REJECTED job_field_taxonomy row. THE closed-world
//     label set (a slug outside it is dropped by the caller).
//   - programs — id, code, nameTh, nameEn, level, and the programme's
//     ProgramSkill names (hint only, rule 5).
//
// Deliberately omitted, with reason:
//   - programmes already assigned by the name-match rule or APPROVED by an
//     admin — decided; not re-sent.
//   - graduates / enrolment / health — supply and health are computed by the
//     map, and the assignment must not depend on how big a programme is.
// ─────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 5: Export from the barrel**

In `packages/shared/src/ai/prompts/index.ts` add, in alphabetical position:

```ts
export * from './job-field-taxonomy';
export * from './program-job-field';
```

(`export * from './gap-insights';` stays until Task 11 removes the file.)

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @kku/shared exec vitest run test/job-field-prompts.test.ts test/prompt-standard-conformance.test.ts
pnpm --filter @kku/shared typecheck
```

Expected: PASS (the conformance test now lists the two new files as meeting the standard); typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ai/prompts/job-field-taxonomy.ts packages/shared/src/ai/prompts/program-job-field.ts packages/shared/src/ai/prompts/index.ts packages/shared/test/job-field-prompts.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-2.txt
```

Message: `feat(ai): job-field-taxonomy.v1 and program-job-field.v1 prompts` + attribution.

---

### Task 3: `packages/db/src/job-fields.ts` — planner, writers, readers, mutations

**Files:**
- Create: `packages/db/src/job-fields.ts`
- Modify: `packages/db/src/index.ts` (add `export * from './job-fields';`)
- Test: `packages/db/test/job-fields.test.ts`

The pure parts (`planTaxonomyBatches`, `applyTaxonomyOutput`, `planRuleAssignments`) take plain data and return plain data so they are tested without a database; the writers are tested inside a rolled-back transaction when Postgres is up.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/job-fields.test.ts
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/index';
import {
  JOB_FIELD_MENTION_FLOOR,
  applyTaxonomyOutput,
  planRuleAssignments,
  planTaxonomyBatches,
  writeTaxonomy,
  type ExistingField,
} from '../src/job-fields';

const existing: ExistingField[] = [
  { id: 'f1', slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า', 'วิศวกรรมไฟฟ้า'], reviewStatus: 'APPROVED' },
  { id: 'f2', slug: 'old-rejected', nameTh: 'x', nameEn: 'x', synonyms: ['ขยะ'], reviewStatus: 'REJECTED' },
];

describe('planTaxonomyBatches', () => {
  it('sends only strings above the floor that no synonym list absorbs, in batches', () => {
    const raw = [
      { raw: 'ไฟฟ้า', mentions: 900 },       // absorbed by f1
      { raw: 'ขยะ', mentions: 30 },          // absorbed by the REJECTED row — still absorbed, never re-proposed
      { raw: 'บัญชี', mentions: 812 },
      { raw: 'Accounting', mentions: 40 },
      { raw: 'rare', mentions: JOB_FIELD_MENTION_FLOOR - 1 },
    ];
    const plan = planTaxonomyBatches(raw, existing, 200);
    expect(plan.batches.flat().map((r) => r.raw)).toEqual(['บัญชี', 'Accounting']);
    expect(plan.other).toEqual({ kinds: 1, mentions: JOB_FIELD_MENTION_FLOOR - 1 });
    expect(plan.absorbed).toBe(2);
  });
  it('splits at the batch size, biggest mentions first', () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({ raw: `s${i}`, mentions: 10 + i }));
    const plan = planTaxonomyBatches(raw, [], 2);
    expect(plan.batches.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(plan.batches[0]![0]!.raw).toBe('s4');
  });
});

describe('applyTaxonomyOutput', () => {
  const output = {
    newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
    assignments: [
      { raw: 'บัญชี', fieldSlug: 'accounting' },
      { raw: 'Accounting', fieldSlug: 'accounting' },
      { raw: 'ไฟฟ้ากำลัง', fieldSlug: 'electrical-engineering' },
      { raw: 'ghost', fieldSlug: 'no-such-field' },
    ],
    confidence: 0.8,
    reasoning: 'ok',
  };
  it('creates new fields, attaches synonyms to anchors, drops unknown slugs', () => {
    const r = applyTaxonomyOutput(output, existing, ['บัญชี', 'Accounting', 'ไฟฟ้ากำลัง', 'ghost']);
    expect(r.creates).toEqual([{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting', synonyms: ['บัญชี', 'Accounting'] }]);
    expect(r.synonymAdds).toEqual([{ slug: 'electrical-engineering', synonyms: ['ไฟฟ้ากำลัง'] }]);
    expect(r.dropped).toEqual([{ raw: 'ghost', reason: 'unknown-slug' }]);
  });
  it('never attaches a string that another row already absorbs, and never names an existing slug as new', () => {
    const dup = {
      ...output,
      newFields: [{ slug: 'electrical-engineering', nameTh: 'y', nameEn: 'y' }],
      assignments: [{ raw: 'ไฟฟ้า', fieldSlug: 'accounting' }],
    };
    const r = applyTaxonomyOutput(dup, existing, ['ไฟฟ้า']);
    expect(r.creates).toEqual([]);
    expect(r.synonymAdds).toEqual([]);
    expect(r.dropped).toEqual([
      { raw: 'ไฟฟ้า', reason: 'already-absorbed' },
    ]);
  });
  it('ignores assignments for strings that were not in the batch', () => {
    const r = applyTaxonomyOutput(output, existing, ['บัญชี']);
    expect(r.creates[0]!.synonyms).toEqual(['บัญชี']);
    expect(r.dropped.map((d) => d.raw)).toEqual(['Accounting', 'ไฟฟ้ากำลัง', 'ghost']);
  });
  it('is idempotent: applying the same output to the resulting state produces nothing', () => {
    const first = applyTaxonomyOutput(output, existing, ['บัญชี', 'Accounting', 'ไฟฟ้ากำลัง']);
    const after: ExistingField[] = [
      { ...existing[0]!, synonyms: [...existing[0]!.synonyms, 'ไฟฟ้ากำลัง'] },
      existing[1]!,
      { id: 'f3', reviewStatus: 'PROPOSED', ...first.creates[0]! },
    ];
    const second = applyTaxonomyOutput(output, after, ['บัญชี', 'Accounting', 'ไฟฟ้ากำลัง']);
    expect(second.creates).toEqual([]);
    expect(second.synonymAdds).toEqual([]);
  });
});

describe('planRuleAssignments', () => {
  const fields = [
    { id: 'f1', slug: 'electrical-engineering', synonyms: ['ไฟฟ้า', 'วิศวกรรมไฟฟ้า'] },
    { id: 'f9', slug: 'science', synonyms: ['วิทยาศาสตร์'] },
  ];
  const programmes = [
    { id: 'p1', nameTh: 'วิศวกรรมศาสตรบัณฑิต สาขาวิศวกรรมไฟฟ้า', nameEn: 'Electrical Engineering' },
    { id: 'p2', nameTh: 'พยาบาลศาสตรบัณฑิต', nameEn: 'Nursing' },
    ...Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, nameTh: `วิทยาศาสตร์ ${i}`, nameEn: `Science ${i}` })),
  ];
  it('assigns by name match and skips synonyms that match too many programmes', () => {
    const r = planRuleAssignments(programmes, fields);
    expect(r.assignments).toEqual([{ programId: 'p1', fieldId: 'f1', synonym: 'ไฟฟ้า' }]);
    expect(r.promiscuousSynonyms).toEqual(['วิทยาศาสตร์']);
    expect(r.unassignedProgramIds).toContain('p2');
  });
});

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!postgresUp)('writeTaxonomy against postgres', () => {
  it('upserts by slug, appends synonyms, never renames a non-PROPOSED row, and stamps the run', async () => {
    const run = await prisma.ingestionRun.findFirst({ where: { status: 'SUCCEEDED' }, select: { id: true } });
    if (!run) return; // fresh database: nothing to attribute to; the guard in the script refuses too
    await prisma
      .$transaction(async (tx) => {
        await tx.jobFieldTaxonomy.create({
          data: { slug: 'zz-test-approved', nameTh: 'เดิม', nameEn: 'Original', synonyms: ['a'], reviewStatus: 'APPROVED', methodVersion: 't' },
        });
        await writeTaxonomy(
          {
            creates: [{ slug: 'zz-test-new', nameTh: 'ใหม่', nameEn: 'New', synonyms: ['b'] }],
            synonymAdds: [{ slug: 'zz-test-approved', synonyms: ['c'] }],
            dropped: [],
          },
          run.id,
          tx,
        );
        const rows = await tx.jobFieldTaxonomy.findMany({ where: { slug: { startsWith: 'zz-test-' } }, orderBy: { slug: 'asc' } });
        expect(rows.map((r) => [r.slug, r.nameEn, r.synonyms, r.reviewStatus, r.ingestionRunId])).toEqual([
          ['zz-test-approved', 'Original', ['a', 'c'], 'APPROVED', null],
          ['zz-test-new', 'New', ['b'], 'PROPOSED', run.id],
        ]);
        throw new Prisma.PrismaClientKnownRequestError('rollback', { code: 'P0000', clientVersion: 'test' });
      })
      .catch((e: unknown) => {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.message === 'rollback')) throw e;
      });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/job-fields.test.ts`
Expected: FAIL — cannot resolve `../src/job-fields`.

- [ ] **Step 3: Write `job-fields.ts`**

```ts
// packages/db/src/job-fields.ts
import { Prisma, type JobFieldReviewStatus } from '@prisma/client';
import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';
import { prisma } from './index';
import { realDataSql } from './data-quality';
import { MAX_PROGRAMMES_PER_FIELD, matchFieldToProgramme } from './jobthai-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Job-field taxonomy — the rows of the demand-first Gap Analyzer.
//
// Raw `job_postings.required_fields_raw` strings ("บัญชี", "Accounting",
// "บัญชี/การเงิน") are clustered into canonical fields by the
// job-field-taxonomy prompt; each field absorbs its raw strings as synonyms.
// Programmes are assigned to fields first by the name-match rule the JobThai
// bridge already uses (source 'rule'), then by the program-job-field prompt
// (source 'ai'), then by hand on /admin/job-fields (source 'manual').
//
// Invariants enforced HERE, because Postgres cannot express them:
//   - a raw string belongs to at most one field's synonyms;
//   - APPROVED / REJECTED rows are never renamed, never downgraded, and their
//     synonyms are never removed by the build step;
//   - every write stamps ingestionRunId (realDataWhere()).
// ─────────────────────────────────────────────────────────────────────────────

/** Strings mentioned by fewer postings form the "other" bucket: counted in
 *  denominators, never assigned. 518 of 3,854 strings cleared it on 2026-09-15. */
export const JOB_FIELD_MENTION_FLOOR = 5;

export type JobFieldSource = 'ai' | 'rule' | 'manual';

export interface RawFieldString {
  raw: string;
  mentions: number;
}

export interface ExistingField {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  reviewStatus: JobFieldReviewStatus;
}

/** Every distinct field string on JobThai postings with its mention count,
 *  excluding the any-field sentinel. Gated by realDataSql so a mocked or
 *  untagged batch cannot seed the taxonomy. */
export async function collectRawFieldStrings(): Promise<RawFieldString[]> {
  const rows = await prisma.$queryRaw<Array<{ raw: string; mentions: number }>>(Prisma.sql`
    SELECT s AS raw, COUNT(*)::int AS mentions
    FROM job_postings jp, unnest(jp.required_fields_raw) AS s
    WHERE jp.source = 'jobthai'
      AND s <> ${JOBTHAI_ANY_FIELD}
      AND ${realDataSql('jp')}
    GROUP BY s
    ORDER BY mentions DESC, s ASC
  `);
  return rows;
}

export async function listExistingFields(): Promise<ExistingField[]> {
  return prisma.jobFieldTaxonomy.findMany({
    select: { id: true, slug: true, nameTh: true, nameEn: true, synonyms: true, reviewStatus: true },
    orderBy: { slug: 'asc' },
  });
}

export interface TaxonomyPlan {
  /** Strings to send to the model, batched, most-mentioned first. */
  batches: RawFieldString[][];
  /** Strings below the floor: counted, never assigned. */
  other: { kinds: number; mentions: number };
  /** Strings above the floor already in some synonym list (any status). */
  absorbed: number;
}

export function planTaxonomyBatches(
  raw: RawFieldString[],
  existing: ExistingField[],
  batchSize: number,
): TaxonomyPlan {
  const absorbedSet = new Set(existing.flatMap((f) => f.synonyms));
  let otherKinds = 0;
  let otherMentions = 0;
  let absorbed = 0;
  const pending: RawFieldString[] = [];
  for (const r of raw) {
    if (r.raw === JOBTHAI_ANY_FIELD) continue;
    if (r.mentions < JOB_FIELD_MENTION_FLOOR) {
      otherKinds += 1;
      otherMentions += r.mentions;
      continue;
    }
    if (absorbedSet.has(r.raw)) {
      absorbed += 1;
      continue;
    }
    pending.push(r);
  }
  pending.sort((a, b) => b.mentions - a.mentions || a.raw.localeCompare(b.raw));
  const batches: RawFieldString[][] = [];
  for (let i = 0; i < pending.length; i += batchSize) batches.push(pending.slice(i, i + batchSize));
  return { batches, other: { kinds: otherKinds, mentions: otherMentions }, absorbed };
}

export interface TaxonomyOutputLike {
  newFields: Array<{ slug: string; nameTh: string; nameEn: string }>;
  assignments: Array<{ raw: string; fieldSlug: string }>;
}

export interface TaxonomyWrite {
  creates: Array<{ slug: string; nameTh: string; nameEn: string; synonyms: string[] }>;
  synonymAdds: Array<{ slug: string; synonyms: string[] }>;
  dropped: Array<{ raw: string; reason: 'unknown-slug' | 'already-absorbed' | 'not-in-batch' | 'duplicate' }>;
}

/** Turns one model response into writes, enforcing the invariants. Pure. */
export function applyTaxonomyOutput(
  output: TaxonomyOutputLike,
  existing: ExistingField[],
  batchRaw: string[],
): TaxonomyWrite {
  const existingBySlug = new Map(existing.map((f) => [f.slug, f]));
  const absorbed = new Set(existing.flatMap((f) => f.synonyms));
  const inBatch = new Set(batchRaw);
  const newBySlug = new Map<string, { slug: string; nameTh: string; nameEn: string; synonyms: string[] }>();
  for (const nf of output.newFields) {
    if (existingBySlug.has(nf.slug) || newBySlug.has(nf.slug)) continue; // never re-create an existing slug
    newBySlug.set(nf.slug, { ...nf, synonyms: [] });
  }
  const addsBySlug = new Map<string, string[]>();
  const dropped: TaxonomyWrite['dropped'] = [];
  const seen = new Set<string>();
  for (const a of output.assignments) {
    if (!inBatch.has(a.raw)) { dropped.push({ raw: a.raw, reason: 'not-in-batch' }); continue; }
    if (seen.has(a.raw)) { dropped.push({ raw: a.raw, reason: 'duplicate' }); continue; }
    seen.add(a.raw);
    if (absorbed.has(a.raw)) { dropped.push({ raw: a.raw, reason: 'already-absorbed' }); continue; }
    const created = newBySlug.get(a.fieldSlug);
    if (created) { created.synonyms.push(a.raw); continue; }
    if (existingBySlug.has(a.fieldSlug)) {
      const list = addsBySlug.get(a.fieldSlug) ?? [];
      list.push(a.raw);
      addsBySlug.set(a.fieldSlug, list);
      continue;
    }
    dropped.push({ raw: a.raw, reason: 'unknown-slug' });
  }
  return {
    creates: [...newBySlug.values()].filter((c) => c.synonyms.length > 0),
    synonymAdds: [...addsBySlug.entries()].map(([slug, synonyms]) => ({ slug, synonyms })),
    dropped,
  };
}

type Tx = Prisma.TransactionClient | typeof prisma;

/** Applies a TaxonomyWrite. New rows are PROPOSED and stamped with the run;
 *  synonym additions touch only the array (names and status untouched). */
export async function writeTaxonomy(write: TaxonomyWrite, runId: string, tx: Tx = prisma): Promise<{ created: number; extended: number }> {
  for (const c of write.creates) {
    await tx.jobFieldTaxonomy.create({
      data: {
        slug: c.slug,
        nameTh: c.nameTh,
        nameEn: c.nameEn,
        synonyms: c.synonyms,
        reviewStatus: 'PROPOSED',
        methodVersion: 'job-field-taxonomy.v1',
        ingestionRunId: runId,
      },
    });
  }
  for (const s of write.synonymAdds) {
    await tx.jobFieldTaxonomy.update({
      where: { slug: s.slug },
      data: { synonyms: { push: s.synonyms } },
    });
  }
  return { created: write.creates.length, extended: write.synonymAdds.length };
}

/** mention_count = postings naming any synonym (bachelor and postgraduate
 *  alike — this is the review page's size hint, not the map's demand). */
export async function refreshMentionCounts(tx: Tx = prisma): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE job_field_taxonomy f SET mention_count = sub.n
    FROM (
      SELECT f2.id, COUNT(DISTINCT jp.id)::int AS n
      FROM job_field_taxonomy f2
      LEFT JOIN job_postings jp ON jp.source = 'jobthai' AND jp.required_fields_raw && f2.synonyms
      GROUP BY f2.id
    ) sub
    WHERE sub.id = f.id
  `);
}

// ── Programme assignment ────────────────────────────────────────────────────

export interface RuleAssignment {
  programId: string;
  fieldId: string;
  synonym: string;
}

/** Name-match rule (matchFieldToProgramme) over every synonym. A synonym that
 *  matches more than MAX_PROGRAMMES_PER_FIELD programmes is generic vocabulary
 *  ("วิทยาศาสตร์") and is skipped, as the JobThai bridge skips it. Pure. */
export function planRuleAssignments(
  programmes: Array<{ id: string; nameTh: string; nameEn: string }>,
  fields: Array<{ id: string; slug: string; synonyms: string[] }>,
): { assignments: RuleAssignment[]; promiscuousSynonyms: string[]; unassignedProgramIds: string[] } {
  const assignments: RuleAssignment[] = [];
  const promiscuous: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    for (const syn of f.synonyms) {
      const hits = programmes.filter(
        (p) => matchFieldToProgramme(syn, p.nameTh) || matchFieldToProgramme(syn, p.nameEn),
      );
      if (hits.length > MAX_PROGRAMMES_PER_FIELD) { promiscuous.push(syn); continue; }
      for (const p of hits) {
        const key = `${p.id}:${f.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assignments.push({ programId: p.id, fieldId: f.id, synonym: syn });
      }
    }
  }
  const assigned = new Set(assignments.map((a) => a.programId));
  return {
    assignments,
    promiscuousSynonyms: promiscuous,
    unassignedProgramIds: programmes.filter((p) => !assigned.has(p.id)).map((p) => p.id),
  };
}

export interface AssignmentWrite {
  programId: string;
  fieldId: string;
  source: JobFieldSource;
  confidence: number | null;
  methodVersion: string;
}

/** Upserts on (programId, fieldId). An existing APPROVED or REJECTED row is
 *  left exactly as it is; a PROPOSED row is refreshed. */
export async function writeAssignments(rows: AssignmentWrite[], runId: string, tx: Tx = prisma): Promise<{ created: number; refreshed: number; kept: number }> {
  let created = 0;
  let refreshed = 0;
  let kept = 0;
  for (const r of rows) {
    const existing = await tx.programJobField.findUnique({
      where: { programId_fieldId: { programId: r.programId, fieldId: r.fieldId } },
      select: { id: true, reviewStatus: true },
    });
    if (!existing) {
      await tx.programJobField.create({
        data: { ...r, reviewStatus: 'PROPOSED', ingestionRunId: runId },
      });
      created += 1;
    } else if (existing.reviewStatus === 'PROPOSED') {
      await tx.programJobField.update({
        where: { id: existing.id },
        data: { source: r.source, confidence: r.confidence, methodVersion: r.methodVersion, ingestionRunId: runId },
      });
      refreshed += 1;
    } else {
      kept += 1;
    }
  }
  return { created, refreshed, kept };
}

// ── Review page readers + mutations (used by /admin/job-fields) ─────────────

export interface JobFieldRow {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  mentionCount: number;
  reviewStatus: JobFieldReviewStatus;
  methodVersion: string;
  programmeCount: number;
  updatedAt: string;
}

export async function listJobFields(): Promise<JobFieldRow[]> {
  const rows = await prisma.jobFieldTaxonomy.findMany({
    orderBy: [{ reviewStatus: 'asc' }, { mentionCount: 'desc' }],
    include: { _count: { select: { programs: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    nameTh: r.nameTh,
    nameEn: r.nameEn,
    synonyms: r.synonyms,
    mentionCount: r.mentionCount,
    reviewStatus: r.reviewStatus,
    methodVersion: r.methodVersion,
    programmeCount: r._count.programs,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export interface ProgramJobFieldRow {
  id: string;
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: string;
  fieldId: string;
  fieldSlug: string;
  source: string;
  confidence: number | null;
  reviewStatus: JobFieldReviewStatus;
}

export async function listProgramJobFields(fieldId?: string): Promise<ProgramJobFieldRow[]> {
  const rows = await prisma.programJobField.findMany({
    where: fieldId ? { fieldId } : undefined,
    include: {
      program: { select: { code: true, nameTh: true, nameEn: true, level: true } },
      field: { select: { slug: true } },
    },
    orderBy: [{ reviewStatus: 'asc' }, { confidence: 'desc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    programId: r.programId,
    programCode: r.program.code,
    programNameTh: r.program.nameTh,
    programNameEn: r.program.nameEn,
    programLevel: r.program.level,
    fieldId: r.fieldId,
    fieldSlug: r.field.slug,
    source: r.source,
    confidence: r.confidence,
    reviewStatus: r.reviewStatus,
  }));
}

export async function setJobFieldStatus(id: string, reviewStatus: JobFieldReviewStatus): Promise<void> {
  await prisma.jobFieldTaxonomy.update({ where: { id }, data: { reviewStatus } });
}

export async function renameJobField(id: string, names: { nameTh: string; nameEn: string }): Promise<void> {
  await prisma.jobFieldTaxonomy.update({ where: { id }, data: names });
}

/** Moves synonyms and assignments from `fromId` into `intoId`, then deletes
 *  `fromId`. Assignments that already exist on the target are dropped by
 *  the unique key, never duplicated. One transaction. */
export async function mergeJobFields(fromId: string, intoId: string): Promise<{ synonymsMoved: number; assignmentsMoved: number }> {
  if (fromId === intoId) throw new Error('cannot merge a field into itself');
  return prisma.$transaction(async (tx) => {
    const from = await tx.jobFieldTaxonomy.findUniqueOrThrow({ where: { id: fromId }, select: { synonyms: true } });
    const into = await tx.jobFieldTaxonomy.findUniqueOrThrow({ where: { id: intoId }, select: { synonyms: true } });
    const merged = [...new Set([...into.synonyms, ...from.synonyms])];
    await tx.jobFieldTaxonomy.update({ where: { id: intoId }, data: { synonyms: merged } });
    const assignments = await tx.programJobField.findMany({ where: { fieldId: fromId } });
    let moved = 0;
    for (const a of assignments) {
      const clash = await tx.programJobField.findUnique({
        where: { programId_fieldId: { programId: a.programId, fieldId: intoId } },
        select: { id: true },
      });
      if (clash) continue;
      await tx.programJobField.update({ where: { id: a.id }, data: { fieldId: intoId } });
      moved += 1;
    }
    await tx.jobFieldTaxonomy.delete({ where: { id: fromId } }); // cascades the un-moved clashes
    return { synonymsMoved: merged.length - into.synonyms.length, assignmentsMoved: moved };
  });
}

export async function setProgramJobFieldStatus(id: string, reviewStatus: JobFieldReviewStatus): Promise<void> {
  await prisma.programJobField.update({ where: { id }, data: { reviewStatus } });
}

/** Manual add from the review page: APPROVED at once (an admin said so). */
export async function addProgramJobField(programId: string, fieldId: string, runId: string | null): Promise<string> {
  const row = await prisma.programJobField.upsert({
    where: { programId_fieldId: { programId, fieldId } },
    create: { programId, fieldId, source: 'manual', confidence: null, reviewStatus: 'APPROVED', methodVersion: 'manual', ingestionRunId: runId },
    update: { source: 'manual', reviewStatus: 'APPROVED' },
    select: { id: true },
  });
  return row.id;
}

/** The run every taxonomy write is attributed to: the latest SUCCEEDED
 *  JobThai run. Null on a database that has never ingested JobThai. */
export async function latestJobThaiRunId(): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: 'jobthai' } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
}
```

Add to `packages/db/src/index.ts`, next to the other `export *` lines:

```ts
export * from './job-fields';
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
pnpm --filter @kku/db exec vitest run test/job-fields.test.ts
pnpm --filter @kku/db typecheck
```

Expected: PASS (the postgres block passes or is skipped); typecheck clean. If `programId_fieldId` is rejected, run `pnpm --filter @kku/db exec prisma generate` — the compound-unique accessor name comes from Task 1's `@@unique([programId, fieldId])`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/job-fields.ts packages/db/src/index.ts packages/db/test/job-fields.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-3.txt
```

Message: `feat(db): job-field taxonomy planner, writers and review mutations` + attribution.

---

### Task 4: The build step — `pnpm jobthai:fields` and the batch-refresh hook

**Files:**
- Create: `apps/ingestion/src/jobthai/fields.ts`
- Create: `apps/ingestion/src/scripts/jobthai-fields.ts`
- Modify: `apps/ingestion/src/jobthai/refresh.ts:337-353` (`RefreshSummary`, `refreshJobThaiDerived`)
- Modify: `apps/ingestion/scripts/bundle-pipeline-scripts.ts:46-73` (TARGETS)
- Modify: root `package.json` scripts (after `"jobthai:link-programs"`)
- Test: `apps/ingestion/test/jobthai/fields.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/ingestion/test/jobthai/fields.test.ts
import { describe, expect, it, vi } from 'vitest';
import { parseFieldsArgs, refreshJobFields, type FieldsDeps } from '../../src/jobthai/fields';

describe('parseFieldsArgs', () => {
  it('is a dry run by default and accepts only --apply', () => {
    expect(parseFieldsArgs([])).toEqual({ apply: false });
    expect(parseFieldsArgs(['--apply'])).toEqual({ apply: true });
    expect(() => parseFieldsArgs(['--dryrun'])).toThrow(/unknown flag/);
    expect(() => parseFieldsArgs(['--apply', '--force'])).toThrow(/unknown flag/);
  });
});

function deps(overrides: Partial<FieldsDeps> = {}): FieldsDeps {
  return {
    collectRaw: vi.fn(async () => [
      { raw: 'บัญชี', mentions: 812 },
      { raw: 'ไฟฟ้า', mentions: 900 },
      { raw: 'rare', mentions: 2 },
    ]),
    listExisting: vi.fn(async () => [
      { id: 'f1', slug: 'electrical-engineering', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical engineering', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' as const },
    ]),
    clusterBatch: vi.fn(async () => ({
      newFields: [{ slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting' }],
      assignments: [{ raw: 'บัญชี', fieldSlug: 'accounting' }],
      confidence: 0.8,
      reasoning: 'ok',
    })),
    listProgrammes: vi.fn(async () => [
      { id: 'p1', code: 'KKU-SEQ-0001', nameTh: 'วิศวกรรมไฟฟ้า', nameEn: 'Electrical Engineering', level: 'BACHELOR', skills: [] },
      // No synonym matches this name, so the rule leaves it to the model.
      { id: 'p2', code: 'KKU-SEQ-0002', nameTh: 'ศิลปศาสตรบัณฑิต สาขาการเงิน', nameEn: 'Finance', level: 'BACHELOR', skills: ['Auditing'] },
    ]),
    listApprovedAssignmentProgramIds: vi.fn(async () => []),
    assignBatch: vi.fn(async () => ({
      programs: [{ programId: 'p2', fields: [{ slug: 'accounting', confidence: 0.9 }] }],
      confidence: 0.9,
      reasoning: 'ok',
    })),
    writeTaxonomy: vi.fn(async () => ({ created: 1, extended: 0 })),
    writeAssignments: vi.fn(async () => ({ created: 2, refreshed: 0, kept: 0 })),
    refreshMentionCounts: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('refreshJobFields', () => {
  it('dry run: plans everything, calls the model, writes nothing', async () => {
    const d = deps();
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(d.clusterBatch).toHaveBeenCalledTimes(1);
    expect(d.writeTaxonomy).not.toHaveBeenCalled();
    expect(d.writeAssignments).not.toHaveBeenCalled();
    expect(s.taxonomy.creates).toBe(1);
    expect(s.taxonomy.other).toEqual({ kinds: 1, mentions: 2 });
    // p1 matched by the rule (synonym 'ไฟฟ้า' inside its Thai name); only p2 went to the model.
    expect(s.assignments.rule).toBe(1);
    expect((d.assignBatch as ReturnType<typeof vi.fn>).mock.calls[0]![0].programs.map((p: { id: string }) => p.id)).toEqual(['p2']);
    expect(s.assignments.ai).toBe(1);
  });
  it('apply: writes taxonomy, assignments and mention counts, stamped with the run', async () => {
    const d = deps();
    await refreshJobFields({ apply: true, runId: 'run1', log: () => undefined }, d);
    expect(d.writeTaxonomy).toHaveBeenCalledWith(expect.objectContaining({ creates: [expect.objectContaining({ slug: 'accounting' })] }), 'run1');
    expect(d.writeAssignments).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ programId: 'p1', source: 'rule' }),
        expect.objectContaining({ programId: 'p2', source: 'ai', confidence: 0.9 }),
      ]),
      'run1',
    );
    expect(d.refreshMentionCounts).toHaveBeenCalled();
  });
  it('a second run with nothing new makes no model call for the taxonomy', async () => {
    const d = deps({
      listExisting: vi.fn(async () => [
        { id: 'f1', slug: 'electrical-engineering', nameTh: 'x', nameEn: 'x', synonyms: ['ไฟฟ้า'], reviewStatus: 'APPROVED' as const },
        { id: 'f2', slug: 'accounting', nameTh: 'x', nameEn: 'x', synonyms: ['บัญชี'], reviewStatus: 'PROPOSED' as const },
      ]),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(d.clusterBatch).not.toHaveBeenCalled();
    expect(s.taxonomy.creates).toBe(0);
  });
  it('drops AI slugs outside the vocabulary and caps at three fields per programme', async () => {
    const d = deps({
      assignBatch: vi.fn(async () => ({
        programs: [{ programId: 'p2', fields: [{ slug: 'no-such', confidence: 0.9 }, { slug: 'accounting', confidence: 0.7 }] }],
        confidence: 0.5,
        reasoning: 'ok',
      })),
    });
    const s = await refreshJobFields({ apply: false, runId: 'run1', log: () => undefined }, d);
    expect(s.assignments.ai).toBe(1);
    expect(s.assignments.droppedUnknownSlug).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter ingestion exec vitest run test/jobthai/fields.test.ts`
Expected: FAIL — cannot resolve `../../src/jobthai/fields`.

- [ ] **Step 3: Write `apps/ingestion/src/jobthai/fields.ts`**

```ts
// apps/ingestion/src/jobthai/fields.ts
import {
  prisma,
  applyTaxonomyOutput,
  collectRawFieldStrings,
  listExistingFields,
  planRuleAssignments,
  planTaxonomyBatches,
  refreshMentionCounts,
  writeAssignments,
  writeTaxonomy,
  type AssignmentWrite,
  type ExistingField,
  type RawFieldString,
  type TaxonomyWrite,
} from '@kku/db';
import {
  JOB_FIELD_TAXONOMY_BATCH_MAX,
  JOB_FIELD_TAXONOMY_VERSION,
  JobFieldTaxonomyOutputSchema,
  PROGRAM_JOB_FIELD_BATCH_MAX,
  PROGRAM_JOB_FIELD_MAX_FIELDS,
  PROGRAM_JOB_FIELD_VERSION,
  ProgramJobFieldOutputSchema,
  buildJobFieldTaxonomyMessages,
  buildProgramJobFieldMessages,
  extractStructuredWithParseRetry,
  type AiService,
  type JobFieldTaxonomyInput,
  type JobFieldTaxonomyOutput,
  type ProgramJobFieldInput,
  type ProgramJobFieldOutput,
} from '@kku/shared';

import type { RefreshLog } from './refresh';

// ─────────────────────────────────────────────────────────────────────────────
// Field-of-study taxonomy build step (spec §3.2).
//
//   collect raw strings → plan batches (floor, absorbed) → cluster with the
//   model (anchors accumulate) → rule-assign programmes → AI-assign the rest
//   → write, all stamped with the JobThai run.
//
// Dry run by default: everything up to and including the model calls runs, so
// an operator sees what WOULD be written (and pays for the calls — that is the
// price of a truthful dry run). Only --apply writes.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldsArgs {
  apply: boolean;
}

/** Only --apply is accepted. Anything else is a typo we refuse to guess at:
 *  `--dryrun` once meant "delete" on another script in this repo. */
export function parseFieldsArgs(argv: string[]): FieldsArgs {
  let apply = false;
  for (const a of argv) {
    if (a === '--apply') apply = true;
    else throw new Error(`unknown flag ${a} (only --apply is accepted)`);
  }
  return { apply };
}

export interface ProgrammeForAssignment {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  skills: string[];
}

/** Everything with a side effect or a price, injectable for tests. */
export interface FieldsDeps {
  collectRaw: () => Promise<RawFieldString[]>;
  listExisting: () => Promise<ExistingField[]>;
  clusterBatch: (input: JobFieldTaxonomyInput) => Promise<JobFieldTaxonomyOutput>;
  listProgrammes: () => Promise<ProgrammeForAssignment[]>;
  listApprovedAssignmentProgramIds: () => Promise<string[]>;
  assignBatch: (input: ProgramJobFieldInput) => Promise<ProgramJobFieldOutput>;
  writeTaxonomy: (write: TaxonomyWrite, runId: string) => Promise<{ created: number; extended: number }>;
  writeAssignments: (rows: AssignmentWrite[], runId: string) => Promise<{ created: number; refreshed: number; kept: number }>;
  refreshMentionCounts: () => Promise<void>;
}

export interface FieldsSummary {
  taxonomy: { batches: number; creates: number; synonymAdds: number; dropped: number; absorbed: number; other: { kinds: number; mentions: number } };
  assignments: { rule: number; ai: number; droppedUnknownSlug: number; promiscuousSynonyms: number; aiBatches: number };
  applied: boolean;
}

export function defaultFieldsDeps(ai: AiService): FieldsDeps {
  return {
    collectRaw: collectRawFieldStrings,
    listExisting: listExistingFields,
    clusterBatch: async (input) => {
      const r = await extractStructuredWithParseRetry(
        ai,
        { ctx: { module: 'gap-analysis', kind: 'job-field-taxonomy' }, methodVersion: JOB_FIELD_TAXONOMY_VERSION, messages: buildJobFieldTaxonomyMessages(input), maxOutputTokens: 8000 },
        JobFieldTaxonomyOutputSchema,
        'job-field-taxonomy',
      );
      return r.parsed;
    },
    listProgrammes: async () => {
      const rows = await prisma.program.findMany({
        where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
        select: { id: true, code: true, nameTh: true, nameEn: true, level: true, programSkills: { select: { skill: { select: { nameEn: true } } } } },
        orderBy: { code: 'asc' },
      });
      return rows.map((p) => ({ id: p.id, code: p.code, nameTh: p.nameTh, nameEn: p.nameEn, level: p.level, skills: p.programSkills.map((s) => s.skill.nameEn) }));
    },
    listApprovedAssignmentProgramIds: async () => {
      const rows = await prisma.programJobField.findMany({ where: { reviewStatus: 'APPROVED' }, select: { programId: true }, distinct: ['programId'] });
      return rows.map((r) => r.programId);
    },
    assignBatch: async (input) => {
      const r = await extractStructuredWithParseRetry(
        ai,
        { ctx: { module: 'gap-analysis', kind: 'program-job-field' }, methodVersion: PROGRAM_JOB_FIELD_VERSION, messages: buildProgramJobFieldMessages(input), maxOutputTokens: 6000 },
        ProgramJobFieldOutputSchema,
        'program-job-field',
      );
      return r.parsed;
    },
    writeTaxonomy: (write, runId) => writeTaxonomy(write, runId),
    writeAssignments: (rows, runId) => writeAssignments(rows, runId),
    refreshMentionCounts: () => refreshMentionCounts(),
  };
}

export async function refreshJobFields(
  opts: { apply: boolean; runId: string; log?: RefreshLog },
  deps: FieldsDeps,
): Promise<FieldsSummary> {
  const log = opts.log ?? (() => undefined);

  // 1. Taxonomy.
  const raw = await deps.collectRaw();
  let existing = await deps.listExisting();
  const plan = planTaxonomyBatches(raw, existing, JOB_FIELD_TAXONOMY_BATCH_MAX);
  log(`fields: ${raw.length} raw strings, ${plan.absorbed} absorbed, ${plan.other.kinds} below the mention floor, ${plan.batches.length} batch(es) to cluster`);

  const writes: TaxonomyWrite[] = [];
  for (const batch of plan.batches) {
    const anchors = existing.filter((f) => f.reviewStatus !== 'REJECTED').map((f) => ({ slug: f.slug, nameTh: f.nameTh, nameEn: f.nameEn, synonyms: f.synonyms }));
    const output = await deps.clusterBatch({ rawStrings: batch, anchors });
    const write = applyTaxonomyOutput(output, existing, batch.map((r) => r.raw));
    writes.push(write);
    // New fields become anchors for the next batch even in a dry run.
    existing = [
      ...existing.map((f) => {
        const add = write.synonymAdds.find((s) => s.slug === f.slug);
        return add ? { ...f, synonyms: [...f.synonyms, ...add.synonyms] } : f;
      }),
      ...write.creates.map((c) => ({ id: `pending-${c.slug}`, reviewStatus: 'PROPOSED' as const, ...c })),
    ];
    if (opts.apply) await deps.writeTaxonomy(write, opts.runId);
  }
  if (opts.apply) {
    await deps.refreshMentionCounts();
    existing = await deps.listExisting(); // real ids for the assignment step
  }

  // 2. Programme assignment.
  const programmes = await deps.listProgrammes();
  const approved = new Set(await deps.listApprovedAssignmentProgramIds());
  const vocabulary = existing.filter((f) => f.reviewStatus !== 'REJECTED');
  const candidates = programmes.filter((p) => !approved.has(p.id));
  const rule = planRuleAssignments(candidates, vocabulary.map((f) => ({ id: f.id, slug: f.slug, synonyms: f.synonyms })));
  const rows: AssignmentWrite[] = rule.assignments.map((a) => ({
    programId: a.programId, fieldId: a.fieldId, source: 'rule', confidence: null, methodVersion: PROGRAM_JOB_FIELD_VERSION,
  }));

  const forAi = candidates.filter((p) => rule.unassignedProgramIds.includes(p.id));
  const slugToId = new Map(vocabulary.map((f) => [f.slug, f.id]));
  let ai = 0;
  let droppedUnknownSlug = 0;
  let aiBatches = 0;
  for (let i = 0; i < forAi.length; i += PROGRAM_JOB_FIELD_BATCH_MAX) {
    const batch = forAi.slice(i, i + PROGRAM_JOB_FIELD_BATCH_MAX);
    aiBatches += 1;
    const output = await deps.assignBatch({
      programs: batch,
      fields: vocabulary.map((f) => ({ slug: f.slug, nameTh: f.nameTh, nameEn: f.nameEn })),
    });
    const batchIds = new Set(batch.map((p) => p.id));
    for (const p of output.programs) {
      if (!batchIds.has(p.programId)) continue;
      for (const f of p.fields.slice(0, PROGRAM_JOB_FIELD_MAX_FIELDS)) {
        const fieldId = slugToId.get(f.slug);
        if (!fieldId) { droppedUnknownSlug += 1; continue; }
        rows.push({ programId: p.programId, fieldId, source: 'ai', confidence: f.confidence, methodVersion: PROGRAM_JOB_FIELD_VERSION });
        ai += 1;
      }
    }
  }
  log(`fields: ${rule.assignments.length} rule assignment(s), ${ai} AI assignment(s) over ${aiBatches} batch(es), ${droppedUnknownSlug} dropped (unknown slug)`);

  if (opts.apply) await deps.writeAssignments(rows, opts.runId);

  return {
    taxonomy: {
      batches: plan.batches.length,
      creates: writes.reduce((n, w) => n + w.creates.length, 0),
      synonymAdds: writes.reduce((n, w) => n + w.synonymAdds.length, 0),
      dropped: writes.reduce((n, w) => n + w.dropped.length, 0),
      absorbed: plan.absorbed,
      other: plan.other,
    },
    assignments: { rule: rule.assignments.length, ai, droppedUnknownSlug, promiscuousSynonyms: rule.promiscuousSynonyms.length, aiBatches },
    applied: opts.apply,
  };
}
```

Note for the implementer: in the dry-run path the AI step assigns against a vocabulary whose new fields carry `pending-<n>` ids; those rows are never written (apply is false), so the placeholder ids never reach the database. In the apply path `existing` is re-read after the taxonomy write so real ids are used.

- [ ] **Step 4: Write the CLI `apps/ingestion/src/scripts/jobthai-fields.ts`**

```ts
// apps/ingestion/src/scripts/jobthai-fields.ts
// ─────────────────────────────────────────────────────────────────────────────
// jobthai:fields — the field-of-study taxonomy and programme assignments.
//
//   pnpm jobthai:fields            # dry run: plans + model calls, writes nothing
//   pnpm jobthai:fields --apply    # write job_field_taxonomy + program_job_fields
//
// Normally you do not run this: the jobthai connector runs it at the end of
// each batch refresh (apps/ingestion/src/jobthai/refresh.ts). Kept for the
// first population on a deployment and for repair. Any flag other than
// --apply is refused.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Inline env-file loader rather than `dotenv/config`: dotenv is not a
// dependency, and this script is esbuild-bundled for the prod ingestion image,
// where the environment comes from the container and this is a no-op.
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

import { prisma, latestJobThaiRunId } from '@kku/db';

import { createIngestionAiService } from '../lib/ai-service';
import { defaultFieldsDeps, parseFieldsArgs, refreshJobFields } from '../jobthai/fields';

async function main(): Promise<void> {
  const args = parseFieldsArgs(process.argv.slice(2));
  const runId = await latestJobThaiRunId();
  if (!runId) {
    console.error('No SUCCEEDED jobthai ingestion run to attribute the taxonomy to. Upload a JobThai batch first.');
    process.exit(1);
  }
  console.log(`=== jobthai:fields (${args.apply ? 'APPLY' : 'DRY RUN'}) run ${runId} ===`);
  const summary = await refreshJobFields(
    { apply: args.apply, runId, log: (l) => console.log(l) },
    defaultFieldsDeps(createIngestionAiService()),
  );
  console.log(JSON.stringify(summary, null, 2));
  if (!args.apply) console.log('\nDRY RUN — pass --apply to write.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Hook the batch refresh, register the bundle target and the pnpm script**

In `apps/ingestion/src/jobthai/refresh.ts`, add the import at the top (after the `match-skills` import):

```ts
import { createIngestionAiService } from '../lib/ai-service';
import { defaultFieldsDeps, refreshJobFields, type FieldsSummary } from './fields';
```

Replace lines 337–353 (`RefreshSummary` + `refreshJobThaiDerived`) with:

```ts
export interface RefreshSummary {
  derive: DeriveSummary;
  linksWritten: number;
  linkedProgrammes: number;
  clearingFloor: number;
  /** Null when the taxonomy step failed (logged, never fatal to the batch). */
  fields: FieldsSummary | null;
  durationMs: number;
}

/** Rebuilds every JobThai derived layer from the postings that exist now. */
export async function refreshJobThaiDerived(opts: { runId: string; log?: RefreshLog }): Promise<RefreshSummary> {
  const t0 = Date.now();
  const derive = await deriveJobThai({ apply: true, log: opts.log });
  const plan = await planJobThaiLinks();
  const linksWritten = await writeJobThaiLinks(plan.planned, opts.runId);
  opts.log?.(`links: ${linksWritten} across ${plan.linkedProgrammes} programme(s), ${plan.clearingFloor} clearing the posting floor`);
  // The field taxonomy costs model calls; a provider outage must not fail a
  // batch whose postings, occupations and links already landed.
  let fields: FieldsSummary | null = null;
  try {
    fields = await refreshJobFields({ apply: true, runId: opts.runId, log: opts.log }, defaultFieldsDeps(createIngestionAiService()));
  } catch (err: unknown) {
    opts.log?.(`fields: FAILED — ${err instanceof Error ? err.message : String(err)} (run pnpm jobthai:fields --apply to retry)`);
  }
  return { derive, linksWritten, linkedProgrammes: plan.linkedProgrammes, clearingFloor: plan.clearingFloor, fields, durationMs: Date.now() - t0 };
}
```

Check the connector's own test stubs `refresh` (`apps/ingestion/test/**/jobthai*connector*.test.ts`): if a stub returns a `RefreshSummary` literal, add `fields: null` to it.

In `apps/ingestion/scripts/bundle-pipeline-scripts.ts`, after `'match-program-demand.ts',`:

```ts
  // Field-of-study taxonomy for the demand-first Gap Analyzer (v1.9.7). Runs
  // at the end of each batch refresh; the script is the first-population and
  // repair path on prod.
  'jobthai-fields.ts',
```

In root `package.json`, after `"jobthai:link-programs": …`:

```json
    "jobthai:fields": "tsx apps/ingestion/src/scripts/jobthai-fields.ts"
```

- [ ] **Step 6: Run the tests, typecheck, then a real dry run**

```bash
pnpm --filter ingestion exec vitest run test/jobthai
pnpm --filter ingestion typecheck
pnpm jobthai:fields
```

Expected: tests PASS; typecheck clean; the dry run prints ~3 taxonomy batches and a summary with `creates` in the tens (the 518 strings collapse to roughly 40–80 fields), `applied: false`, and writes nothing (`SELECT COUNT(*) FROM job_field_taxonomy` is still 0). Note the AiInference cost printed in the api log; record it in the commit body.

Then populate dev:

```bash
pnpm jobthai:fields --apply
```

Expected: `applied: true`; rows in both tables; every row has `ingestion_run_id` set. Verify with:

```bash
pnpm --filter @kku/db exec tsx -e "import('./src/index').then(async ({prisma})=>{console.log(await prisma.jobFieldTaxonomy.count(), await prisma.jobFieldTaxonomy.count({where:{ingestionRunId:null}}), await prisma.programJobField.count());await prisma.\$disconnect()})"
```

Expected: `<n> 0 <m>` — the middle number must be 0.

- [ ] **Step 7: Commit**

```bash
git add apps/ingestion/src/jobthai/fields.ts apps/ingestion/src/scripts/jobthai-fields.ts apps/ingestion/src/jobthai/refresh.ts apps/ingestion/scripts/bundle-pipeline-scripts.ts package.json apps/ingestion/test/jobthai/fields.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-4.txt
```

Message: `feat(ingestion): jobthai:fields builds the field taxonomy; runs after every batch refresh` + body with the dry-run counts and cost + attribution.

---

### Task 5: Review API — `JobFieldsController`

**Files:**
- Create: `apps/api/src/job-fields/job-fields.controller.ts`
- Create: `apps/api/src/job-fields/job-fields.module.ts`
- Modify: `apps/api/src/app.module.ts` (import + register `JobFieldsModule`, next to `JobThaiModule`)
- Modify: `packages/shared/test/usage-action-coverage.test.ts:22` (`DELIBERATELY_OTHER`)
- Test: `apps/api/test/job-fields.controller.test.ts`

Permissions: reads `data_sources:read`, mutations `data_sources:configure` (the JobThai admin's own gate). Every mutation is `@AuditLog`'d and purges the map cache (`gap:map:*`) so an approval reaches the page within one request, not one TTL. `CacheService` is exported by `AppModule`'s common providers (`app.module.ts:131`), so the controller can inject it.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/job-fields.controller.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AUDIT_LOG_META, PERMISSION_META } from '../src/common/decorators';
import { JobFieldsController, MergeBody, RenameBody } from '../src/job-fields/job-fields.controller';
import type { CacheService } from '../src/common/cache.service';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

// Mutations must be audit-logged, gated on data_sources:configure, and must
// purge the gap-map cache; the review page is what makes a PROPOSED field
// Council-grade, so an approval that stays invisible for five minutes reads
// as "the button did nothing".

const meta = <T,>(key: string, method: (...args: never[]) => unknown): T | undefined =>
  Reflect.getMetadata(key, method) as T | undefined;

describe('JobFieldsController decorators', () => {
  const mutations: Array<keyof JobFieldsController> = ['approve', 'reject', 'rename', 'merge', 'addAssignment', 'approveAssignment', 'rejectAssignment'];
  for (const name of mutations) {
    it(`${name} is audit-logged and gated on data_sources:configure`, () => {
      const method = JobFieldsController.prototype[name] as (...args: never[]) => unknown;
      expect(meta<{ action: string }>(AUDIT_LOG_META, method)?.action).toMatch(/^(job_field|program_job_field)\./);
      expect(meta<string>(PERMISSION_META, method)).toBe('data_sources:configure');
    });
  }
  it('list is gated on data_sources:read', () => {
    expect(meta<string>(PERMISSION_META, JobFieldsController.prototype.list)).toBe('data_sources:read');
  });
});

describe('JobFieldsController cache purge', () => {
  it('purges gap:map:* after an approval', async () => {
    const purge = vi.fn(async () => 1);
    const c = new JobFieldsController({ purge } as unknown as CacheService);
    vi.spyOn(c as unknown as { setStatus: (id: string, s: string) => Promise<void> }, 'setStatus').mockResolvedValue(undefined);
    await c.approve('f1');
    expect(purge).toHaveBeenCalledWith('gap:map:*');
  });
});

describe('bodies', () => {
  it('rename requires both names', () => {
    expect(() => new ZodValidationPipe(RenameBody).transform({ nameTh: 'x' }, {} as never)).toThrow();
  });
  it('merge requires intoId (a self-merge is refused by mergeJobFields itself)', () => {
    expect(() => new ZodValidationPipe(MergeBody).transform({}, {} as never)).toThrow();
    expect(() => new ZodValidationPipe(MergeBody).transform({ intoId: 'f1' }, {} as never)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter api exec vitest run test/job-fields.controller.test.ts`
Expected: FAIL — cannot resolve `../src/job-fields/job-fields.controller`.

- [ ] **Step 3: Write the controller and module**

```ts
// apps/api/src/job-fields/job-fields.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  addProgramJobField,
  latestJobThaiRunId,
  listJobFields,
  listProgramJobFields,
  mergeJobFields,
  renameJobField,
  setJobFieldStatus,
  setProgramJobFieldStatus,
} from '@kku/db';
import { AuditLog, Authorized, ZodValidationPipe } from '../common';
import { CacheService } from '../common/cache.service';

// Review API for the field-of-study taxonomy (spec §3.3). Every mutation is
// audit-logged and purges the Gap Analyzer's map cache.

export const GAP_MAP_CACHE_PATTERN = 'gap:map:*';

export const RenameBody = z.object({ nameTh: z.string().min(1).max(200), nameEn: z.string().min(1).max(200) });
export const MergeBody = z.object({ intoId: z.string().min(1) });
export const AddAssignmentBody = z.object({ programId: z.string().min(1), fieldId: z.string().min(1) });
const AssignmentsQuery = z.object({ fieldId: z.string().optional() });

@Controller('/admin/job-fields')
export class JobFieldsController {
  constructor(private readonly cache: CacheService) {}

  private async invalidate(): Promise<void> {
    await this.cache.purge(GAP_MAP_CACHE_PATTERN);
  }

  // Seam for the unit test; the real call is one line.
  private setStatus(id: string, reviewStatus: 'APPROVED' | 'REJECTED'): Promise<void> {
    return setJobFieldStatus(id, reviewStatus);
  }

  @Get()
  @Authorized('data_sources:read')
  async list() {
    return listJobFields();
  }

  @Get('assignments')
  @Authorized('data_sources:read')
  async assignments(@Query(new ZodValidationPipe(AssignmentsQuery)) q: z.infer<typeof AssignmentsQuery>) {
    return listProgramJobFields(q.fieldId);
  }

  @Post(':id/approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.approve', entityType: 'JobFieldTaxonomy' })
  async approve(@Param('id') id: string) {
    await this.setStatus(id, 'APPROVED');
    await this.invalidate();
    return { id, reviewStatus: 'APPROVED' };
  }

  @Post(':id/reject')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.reject', entityType: 'JobFieldTaxonomy' })
  async reject(@Param('id') id: string) {
    await this.setStatus(id, 'REJECTED');
    await this.invalidate();
    return { id, reviewStatus: 'REJECTED' };
  }

  @Patch(':id')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.rename', entityType: 'JobFieldTaxonomy' })
  async rename(@Param('id') id: string, @Body(new ZodValidationPipe(RenameBody)) body: z.infer<typeof RenameBody>) {
    await renameJobField(id, body);
    await this.invalidate();
    return { id, ...body };
  }

  @Post(':id/merge')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.merge', entityType: 'JobFieldTaxonomy' })
  async merge(@Param('id') id: string, @Body(new ZodValidationPipe(MergeBody)) body: z.infer<typeof MergeBody>) {
    const result = await mergeJobFields(id, body.intoId);
    await this.invalidate();
    return { from: id, into: body.intoId, ...result };
  }

  @Post('assignments')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.add', entityType: 'ProgramJobField' })
  async addAssignment(@Body(new ZodValidationPipe(AddAssignmentBody)) body: z.infer<typeof AddAssignmentBody>) {
    const id = await addProgramJobField(body.programId, body.fieldId, await latestJobThaiRunId());
    await this.invalidate();
    return { id, ...body, reviewStatus: 'APPROVED' };
  }

  @Post('assignments/:id/approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.approve', entityType: 'ProgramJobField' })
  async approveAssignment(@Param('id') id: string) {
    await setProgramJobFieldStatus(id, 'APPROVED');
    await this.invalidate();
    return { id, reviewStatus: 'APPROVED' };
  }

  @Post('assignments/:id/reject')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.reject', entityType: 'ProgramJobField' })
  async rejectAssignment(@Param('id') id: string) {
    await setProgramJobFieldStatus(id, 'REJECTED');
    await this.invalidate();
    return { id, reviewStatus: 'REJECTED' };
  }
}
```

```ts
// apps/api/src/job-fields/job-fields.module.ts
import { Module } from '@nestjs/common';
import { JobFieldsController } from './job-fields.controller';

@Module({ controllers: [JobFieldsController] })
export class JobFieldsModule {}
```

In `apps/api/src/app.module.ts`: add `import { JobFieldsModule } from './job-fields/job-fields.module';` next to the `JobThaiModule` import and `JobFieldsModule,` in the `imports` array next to `JobThaiModule,`.

Check that `AUDIT_LOG_META` is exported from `apps/api/src/common/decorators.ts` (it is defined there at ~line 49; if not exported, export it). Also confirm `mergeJobFields` throws on `fromId === intoId` — the API relies on that, which is why `MergeBody` does not repeat the check.

- [ ] **Step 4: Classify the new audit actions**

In `packages/shared/test/usage-action-coverage.test.ts`, add to `DELIBERATELY_OTHER` in alphabetical position:

```ts
  'job_field.approve',
  'job_field.merge',
  'job_field.reject',
  'job_field.rename',
  'program_job_field.add',
  'program_job_field.approve',
  'program_job_field.reject',
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter api exec vitest run test/job-fields.controller.test.ts
pnpm --filter @kku/shared exec vitest run test/usage-action-coverage.test.ts
pnpm --filter api typecheck
```

Expected: PASS ×2; typecheck clean. Restart the api dev process (it does not reload `packages/db`), then check `curl -s http://localhost:4000/api/v1/admin/job-fields` returns 401 without a bearer (the route exists).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/job-fields apps/api/src/app.module.ts apps/api/test/job-fields.controller.test.ts packages/shared/test/usage-action-coverage.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-5.txt
```

Message: `feat(api): job-field review endpoints, audit-logged, purge the gap-map cache` + attribution.

---

### Task 6: `/admin/job-fields` review page

**Files:**
- Create: `apps/web/app/admin/job-fields/page.tsx`
- Create: `apps/web/app/admin/job-fields/client.tsx`
- Create: `apps/web/app/api/admin-job-fields/route.ts` (GET list + assignments)
- Create: `apps/web/app/api/admin-job-fields/[...path]/route.ts` (POST/PATCH passthrough)
- Modify: `apps/web/app/admin/page.tsx` (tile after the `/admin/jobthai` tile, ~line 718)
- Test: `apps/web/test/job-fields-admin-render.test.tsx`

The browser never calls `/api/v1` (there is no dev proxy for it, and the spec forbids it); the two route handlers carry the session. UI labels English-only; field names are data labels shown TH · EN. The spec's "reassign" is reject-then-add on this page: reject the assignment under one field, select the right field, add the programme — two audit rows, which is the honest record of what happened.

- [ ] **Step 1: Write the failing render test**

```tsx
// apps/web/test/job-fields-admin-render.test.tsx
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';
import { JobFieldsReview } from '../app/admin/job-fields/client';
import type { JobFieldRowDto, ProgramJobFieldRowDto } from '../app/admin/job-fields/client';

const fields: JobFieldRowDto[] = [
  { id: 'f1', slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting', synonyms: ['บัญชี', 'Accounting'], mentionCount: 852, reviewStatus: 'PROPOSED', methodVersion: 'job-field-taxonomy.v1', programmeCount: 2, updatedAt: '2026-09-15T00:00:00Z' },
  { id: 'f2', slug: 'nursing', nameTh: 'พยาบาลศาสตร์', nameEn: 'Nursing', synonyms: ['พยาบาล'], mentionCount: 310, reviewStatus: 'APPROVED', methodVersion: 'job-field-taxonomy.v1', programmeCount: 1, updatedAt: '2026-09-15T00:00:00Z' },
];
const assignments: ProgramJobFieldRowDto[] = [
  { id: 'a1', programId: 'p1', programCode: 'KKU-SEQ-0245', programNameTh: 'บัญชีบัณฑิต', programNameEn: 'Accountancy', programLevel: 'BACHELOR', fieldId: 'f1', fieldSlug: 'accounting', source: 'rule', confidence: null, reviewStatus: 'PROPOSED' },
];

const html = renderToStaticMarkup(
  <TooltipProvider>
    <JobFieldsReview fields={fields} assignments={assignments} />
  </TooltipProvider>,
);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('JobFieldsReview', () => {
  it('lists every field with both names, synonyms, mention count and status', () => {
    expect(text).toContain('การบัญชี');
    expect(text).toContain('Accounting');
    expect(text).toContain('852');
    expect(text).toContain('Proposed');
    expect(text).toContain('Approved');
  });
  it('shows review counts in the header', () => {
    expect(text).toMatch(/1 approved/);
    expect(text).toMatch(/1 proposed/);
  });
  it('lists assignments with programme code, source and status', () => {
    expect(text).toContain('KKU-SEQ-0245');
    expect(text).toContain('rule');
  });
  it('offers approve and reject on a proposed field, and merge on every field', () => {
    expect(html).toContain('data-action="approve-field"');
    expect(html).toContain('data-action="reject-field"');
    expect(html).toContain('data-action="merge-field"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run test/job-fields-admin-render.test.tsx`
Expected: FAIL — cannot resolve `../app/admin/job-fields/client`.

- [ ] **Step 3: Write the proxies**

```ts
// apps/web/app/api/admin-job-fields/route.ts
import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy for the /admin/job-fields client refresh. apiFetch is server-only;
// the browser cannot carry the session bearer.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const [fields, assignments] = await Promise.all([
    apiFetch('/admin/job-fields'),
    apiFetch('/admin/job-fields/assignments'),
  ]);
  return NextResponse.json({ data: { fields, assignments } });
}
```

```ts
// apps/web/app/api/admin-job-fields/[...path]/route.ts
import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Mutation passthrough: POST /api/admin-job-fields/<id>/approve etc. maps
// 1:1 onto POST /api/v1/admin/job-fields/<id>/approve. The path is a
// closed set so a stray segment cannot reach an unrelated api route.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = /^(?:[A-Za-z0-9_-]+\/(?:approve|reject|merge)|assignments|assignments\/[A-Za-z0-9_-]+\/(?:approve|reject)|[A-Za-z0-9_-]+)$/;

async function forward(req: Request, method: 'POST' | 'PATCH', path: string[]) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const joined = path.join('/');
  if (!ALLOWED.test(joined)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await apiFetch(`/admin/job-fields/${joined}`, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, 'POST', (await params).path);
}
export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, 'PATCH', (await params).path);
}
```

- [ ] **Step 4: Write the page and client**

```tsx
// apps/web/app/admin/job-fields/page.tsx
import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { DataSourceMark, acknowledgementHref } from '@/components/data-source-mark';
import { PageHeader } from '@kku/ui';
import { JobFieldsReview, type JobFieldRowDto, type ProgramJobFieldRowDto } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job fields — Admin' };

export default async function AdminJobFieldsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  const [fields, assignments] = await Promise.all([
    apiFetchSafe<JobFieldRowDto[]>('/admin/job-fields'),
    apiFetchSafe<ProgramJobFieldRowDto[]>('/admin/job-fields/assignments'),
  ]);

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="Job fields" />
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <DataSourceMark source="jobthai" size={24} href={acknowledgementHref('jobthai')} />
            Job fields
          </span>
        }
        subtitle="The fields of study JobThai employers ask for, clustered from the free-text strings on postings, and the programmes assigned to each. Proposed rows already appear on the Gap Analyzer, labelled unreviewed; approving one makes it Council-grade. Rebuilt after every JobThai upload (pnpm jobthai:fields for a dry run)."
      />
      <JobFieldsReview fields={fields.ok ? fields.data : []} assignments={assignments.ok ? assignments.data : []} />
    </AuthedAppShell>
  );
}
```

```tsx
// apps/web/app/admin/job-fields/client.tsx
'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import { Check, GitMerge, Loader2, Pencil, X } from 'lucide-react';

// @kku/ui has no text-input primitive; the /usage search box uses a plain
// <input> with token classes, and so does this page.
const INPUT = 'rounded border border-default bg-surface-1 px-2 py-1 text-xs text-text-primary';

export interface JobFieldRowDto {
  id: string;
  slug: string;
  nameTh: string;
  nameEn: string;
  synonyms: string[];
  mentionCount: number;
  reviewStatus: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  methodVersion: string;
  programmeCount: number;
  updatedAt: string;
}

export interface ProgramJobFieldRowDto {
  id: string;
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: string;
  fieldId: string;
  fieldSlug: string;
  source: string;
  confidence: number | null;
  reviewStatus: 'PROPOSED' | 'APPROVED' | 'REJECTED';
}

const STATUS_LABEL: Record<JobFieldRowDto['reviewStatus'], { label: string; tone: 'warning' | 'success' | 'outline' }> = {
  PROPOSED: { label: 'Proposed', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'outline' },
};

async function call(path: string, method: 'POST' | 'PATCH', body?: unknown): Promise<boolean> {
  const res = await fetch(`/api/admin-job-fields/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    toast.error(j.error?.message ?? `${method} ${path} failed`);
    return false;
  }
  return true;
}

export function JobFieldsReview({ fields: initialFields, assignments: initialAssignments }: { fields: JobFieldRowDto[]; assignments: ProgramJobFieldRowDto[] }): React.JSX.Element {
  const [fields, setFields] = React.useState(initialFields);
  const [assignments, setAssignments] = React.useState(initialAssignments);
  const [selected, setSelected] = React.useState<string | null>(initialFields[0]?.id ?? null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; nameTh: string; nameEn: string } | null>(null);
  const [merging, setMerging] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const res = await fetch('/api/admin-job-fields');
    if (!res.ok) return;
    const body = (await res.json()) as { data: { fields: JobFieldRowDto[]; assignments: ProgramJobFieldRowDto[] } };
    setFields(body.data.fields);
    setAssignments(body.data.assignments);
  }, []);

  async function act(key: string, path: string, method: 'POST' | 'PATCH', body?: unknown, done?: string): Promise<void> {
    setBusy(key);
    try {
      if (await call(path, method, body)) {
        if (done) toast.success(done);
        await refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const approved = fields.filter((f) => f.reviewStatus === 'APPROVED').length;
  const proposed = fields.filter((f) => f.reviewStatus === 'PROPOSED').length;
  const selectedField = fields.find((f) => f.id === selected) ?? null;
  const selectedAssignments = assignments.filter((a) => a.fieldId === selected);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-default px-4 py-3">
          <div className="text-sm font-medium">Fields · {fields.length}</div>
          <div className="text-xs text-text-tertiary">{approved} approved · {proposed} proposed · {fields.length - approved - proposed} rejected</div>
        </div>
        <ul className="divide-y divide-border-default">
          {fields.map((f) => (
            <li key={f.id} className={`px-4 py-3 ${selected === f.id ? 'bg-surface-2' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(f.id)}>
                  <div className="truncate text-sm font-medium">{f.nameTh} <span className="text-text-secondary">· {f.nameEn}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {f.synonyms.map((s) => (
                      <span key={s} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-secondary">{s}</span>
                    ))}
                  </div>
                  <div className="mt-1 text-xs text-text-tertiary">{f.mentionCount.toLocaleString()} postings · {f.programmeCount} programmes</div>
                </button>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={STATUS_LABEL[f.reviewStatus].tone}>{STATUS_LABEL[f.reviewStatus].label}</Badge>
                  <div className="flex gap-1">
                    {f.reviewStatus !== 'APPROVED' && (
                      <Button size="sm" variant="ghost" data-action="approve-field" disabled={busy !== null} onClick={() => act(f.id, `${f.id}/approve`, 'POST', undefined, `Approved ${f.nameEn}`)}>
                        {busy === f.id ? <Loader2 className="h-[14px] w-[14px] animate-spin" /> : <Check className="h-[14px] w-[14px]" />}
                      </Button>
                    )}
                    {f.reviewStatus !== 'REJECTED' && (
                      <Button size="sm" variant="ghost" data-action="reject-field" disabled={busy !== null} onClick={() => act(f.id, `${f.id}/reject`, 'POST', undefined, `Rejected ${f.nameEn}`)}>
                        <X className="h-[14px] w-[14px]" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" data-action="rename-field" disabled={busy !== null} onClick={() => setRenaming({ id: f.id, nameTh: f.nameTh, nameEn: f.nameEn })}>
                      <Pencil className="h-[14px] w-[14px]" />
                    </Button>
                    <Button size="sm" variant="ghost" data-action="merge-field" disabled={busy !== null} onClick={() => setMerging(f.id)}>
                      <GitMerge className="h-[14px] w-[14px]" />
                    </Button>
                  </div>
                </div>
              </div>
              {renaming?.id === f.id && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(f.id, f.id, 'PATCH', { nameTh: renaming.nameTh, nameEn: renaming.nameEn }, 'Renamed').then(() => setRenaming(null));
                  }}
                >
                  <input className={`${INPUT} w-56`} value={renaming.nameTh} onChange={(e) => setRenaming({ ...renaming, nameTh: e.target.value })} placeholder="Thai name" />
                  <input className={`${INPUT} w-56`} value={renaming.nameEn} onChange={(e) => setRenaming({ ...renaming, nameEn: e.target.value })} placeholder="English name" />
                  <Button size="sm" type="submit">Save</Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
                </form>
              )}
              {merging === f.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span>Merge into</span>
                  <select
                    className="rounded border border-default bg-surface-1 px-2 py-1 text-xs"
                    defaultValue=""
                    onChange={(e) => {
                      const into = e.target.value;
                      if (!into) return;
                      void act(f.id, `${f.id}/merge`, 'POST', { intoId: into }, `Merged ${f.nameEn}`).then(() => setMerging(null));
                    }}
                  >
                    <option value="">Choose a field…</option>
                    {fields.filter((g) => g.id !== f.id && g.reviewStatus !== 'REJECTED').map((g) => (
                      <option key={g.id} value={g.id}>{g.nameEn} · {g.nameTh}</option>
                    ))}
                  </select>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setMerging(null)}>Cancel</Button>
                </div>
              )}
            </li>
          ))}
          {fields.length === 0 && <li className="px-4 py-6 text-sm text-text-tertiary">No fields yet. Run pnpm jobthai:fields --apply after a JobThai upload.</li>}
        </ul>
      </Card>

      <Card className="p-0">
        <div className="border-b border-default px-4 py-3 text-sm font-medium">
          Programmes{selectedField ? ` · ${selectedField.nameEn}` : ''} · {selectedAssignments.length}
        </div>
        <ul className="divide-y divide-border-default">
          {selectedAssignments.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm">{a.programNameTh} <span className="text-text-secondary">· {a.programNameEn}</span></div>
                <div className="text-xs text-text-tertiary">{a.programCode} · {a.programLevel} · {a.source}{a.confidence != null ? ` · ${(a.confidence * 100).toFixed(0)} %` : ''}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={STATUS_LABEL[a.reviewStatus].tone}>{STATUS_LABEL[a.reviewStatus].label}</Badge>
                <div className="flex gap-1">
                  {a.reviewStatus !== 'APPROVED' && (
                    <Button size="sm" variant="ghost" data-action="approve-assignment" disabled={busy !== null} onClick={() => act(a.id, `assignments/${a.id}/approve`, 'POST', undefined, 'Assignment approved')}>
                      <Check className="h-[14px] w-[14px]" />
                    </Button>
                  )}
                  {a.reviewStatus !== 'REJECTED' && (
                    <Button size="sm" variant="ghost" data-action="reject-assignment" disabled={busy !== null} onClick={() => act(a.id, `assignments/${a.id}/reject`, 'POST', undefined, 'Assignment rejected')}>
                      <X className="h-[14px] w-[14px]" />
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
          {selectedField && selectedAssignments.length === 0 && (
            <li className="px-4 py-6 text-sm text-text-tertiary">No programme assigned. This field is a white space on the map.</li>
          )}
        </ul>
        {selectedField && (
          <form
            className="flex flex-wrap items-center gap-2 border-t border-default px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const input = (e.currentTarget.elements.namedItem('programId') as HTMLInputElement | null);
              const programId = input?.value.trim();
              if (!programId) return;
              void act('add', 'assignments', 'POST', { programId, fieldId: selectedField.id }, 'Programme added').then(() => { if (input) input.value = ''; });
            }}
          >
            <input name="programId" className={`${INPUT} w-72`} placeholder="Programme id (from /admin/programs)" />
            <Button size="sm" type="submit" disabled={busy !== null}>Add programme</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Add the admin console tile**

In `apps/web/app/admin/page.tsx`, directly after the `/admin/jobthai` tile object (ends ~line 717):

```tsx
    {
      href: '/admin/job-fields',
      label: 'Job fields',
      description:
        'Review the fields of study clustered from JobThai postings and the programmes assigned to each. These are the rows of the Gap Analyzer; proposed rows are shown there as unreviewed until approved here.',
      icon: <DataSourceMark source="jobthai" size={28} />,
    },
```

- [ ] **Step 6: Run the tests and a manual check**

```bash
pnpm --filter web exec vitest run test/job-fields-admin-render.test.tsx
pnpm --filter web typecheck
```

Expected: PASS; typecheck clean. Then sign in on dev, open `http://10.101.111.233:3000/admin/job-fields`, approve one PROPOSED field, and confirm the badge flips without a reload error and an `audit_logs` row with action `job_field.approve` appears.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/admin/job-fields apps/web/app/api/admin-job-fields apps/web/app/admin/page.tsx apps/web/test/job-fields-admin-render.test.tsx
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-6.txt
```

Message: `feat(web): /admin/job-fields review page` + attribution.

---

### Task 7: `computeGapMap` — the rules and the map (`gap-map.v1`)

**Files:**
- Create: `packages/db/src/gap-map-rules.ts` (pure)
- Create: `packages/db/src/gap-map.ts`
- Modify: `packages/db/src/health-score.ts:606-641` (export `getProgramScoreIndex`, add `overall` to the entry)
- Modify: `packages/db/src/index.ts` (add the two exports)
- Test: `packages/db/test/gap-map-rules.test.ts`, `packages/db/test/gap-map.test.ts`

- [ ] **Step 1: Write the failing rules test**

```ts
// packages/db/test/gap-map-rules.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAP_THRESHOLDS,
  parseThresholds,
  pipelineArrow,
  reconcile,
  verdictFor,
} from '../src/gap-map-rules';
import { JOBTHAI_MIN_POSTINGS_FOR_SIGNAL } from '../src/jobthai-bridge';

// Decision 3 of the spec: ratio = KKU supply share ÷ demand share. White
// space = no programme; < under = under-served; between = served;
// > over = over-served; below the posting floor = no verdict.

const t = DEFAULT_GAP_THRESHOLDS;
const base = { postings: 100, programmes: 1, demandShare: 0.1, supplyShare: 0.1, thresholds: t };

describe('verdictFor', () => {
  it('white space when no programme is assigned, whatever the supply share', () => {
    expect(verdictFor({ ...base, programmes: 0, supplyShare: 0 })).toEqual({ ratio: null, verdict: 'white-space' });
  });
  it('under-served strictly below `under`, served at the boundary', () => {
    expect(verdictFor({ ...base, supplyShare: 0.049 }).verdict).toBe('under-served');
    expect(verdictFor({ ...base, supplyShare: 0.05 }).verdict).toBe('served');
  });
  it('over-served strictly above `over`, served at the boundary', () => {
    expect(verdictFor({ ...base, supplyShare: 0.2 }).verdict).toBe('served');
    expect(verdictFor({ ...base, supplyShare: 0.2001 }).verdict).toBe('over-served');
  });
  it('reports the ratio rounded to two decimals', () => {
    expect(verdictFor({ ...base, supplyShare: 0.0333 }).ratio).toBe(0.33);
  });
  it('no verdict below the posting floor, ratio still reported', () => {
    const r = verdictFor({ ...base, postings: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL - 1 });
    expect(r).toEqual({ ratio: 1, verdict: 'too-few-postings' });
    expect(verdictFor({ ...base, postings: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL }).verdict).toBe('served');
  });
  it('a programme with zero graduates is under-served, not a white space', () => {
    expect(verdictFor({ ...base, supplyShare: 0 })).toEqual({ ratio: 0, verdict: 'under-served' });
  });
  it('honours custom thresholds', () => {
    expect(verdictFor({ ...base, supplyShare: 0.06, thresholds: { under: 0.7, over: 3 } }).verdict).toBe('under-served');
  });
});

describe('parseThresholds', () => {
  it('defaults, accepts 0 < under < over, rejects anything else', () => {
    expect(parseThresholds({})).toEqual(t);
    expect(parseThresholds({ under: '0.7', over: '3' })).toEqual({ under: 0.7, over: 3 });
    expect(() => parseThresholds({ under: '2', over: '1' })).toThrow();
    expect(() => parseThresholds({ under: '0', over: '1' })).toThrow();
    expect(() => parseThresholds({ under: 'x' })).toThrow();
  });
});

describe('pipelineArrow', () => {
  it('compares pipeline ÷ 4 with graduates per year at 1.25× and 0.75×', () => {
    expect(pipelineArrow(100, 600)).toBe('up');     // 150 > 125
    expect(pipelineArrow(100, 400)).toBe('flat');   // 100
    expect(pipelineArrow(100, 280)).toBe('down');   // 70 < 75
    expect(pipelineArrow(100, 500)).toBe('flat');   // 125 is not > 125
  });
  it('is null when either side is missing or graduates are zero', () => {
    expect(pipelineArrow(null, 400)).toBeNull();
    expect(pipelineArrow(100, null)).toBeNull();
    expect(pipelineArrow(0, 400)).toBeNull();
  });
});

describe('reconcile', () => {
  it('demand shares sum to 1 over field-naming postings; supply may exceed 1 with multi-field programmes', () => {
    const rows = [
      { postings: 60, programmeIds: ['p1', 'p2'], gradsPerYear: 100 },
      { postings: 40, programmeIds: ['p2'], gradsPerYear: 50 },
    ];
    const r = reconcile(rows, { fieldPostings: 100, gradsByProgramme: new Map([['p1', 50], ['p2', 50]]) });
    expect(r.demandShareSum).toBeCloseTo(1, 6);
    expect(r.supplyShareSum).toBeCloseTo(1.5, 6);
    expect(r.multiFieldProgrammes).toBe(1);
    expect(r.gradsTotal).toBe(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/gap-map-rules.test.ts`
Expected: FAIL — cannot resolve `../src/gap-map-rules`.

- [ ] **Step 3: Write `gap-map-rules.ts`**

```ts
// packages/db/src/gap-map-rules.ts
import { z } from 'zod';
import { JOBTHAI_MIN_POSTINGS_FOR_SIGNAL } from './jobthai-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Gap-map rules — pure functions behind `gap-map.v1` (docs/methodologies/
// gap-map.md). No database, no Date.now: every input is explicit so the
// verdict on a row is reproducible from the numbers shown beside it.
// ─────────────────────────────────────────────────────────────────────────────

export const GAP_MAP_VERSION = 'gap-map.v1';

export type GapVerdict = 'white-space' | 'under-served' | 'served' | 'over-served' | 'too-few-postings';
export const GAP_VERDICTS: readonly GapVerdict[] = ['white-space', 'under-served', 'served', 'over-served', 'too-few-postings'];

export interface GapThresholds {
  /** ratio strictly below this → under-served */
  under: number;
  /** ratio strictly above this → over-served */
  over: number;
}
export const DEFAULT_GAP_THRESHOLDS: GapThresholds = { under: 0.5, over: 2 };

export const ThresholdsSchema = z
  .object({
    under: z.coerce.number().positive().default(DEFAULT_GAP_THRESHOLDS.under),
    over: z.coerce.number().positive().default(DEFAULT_GAP_THRESHOLDS.over),
  })
  .refine((t) => t.under < t.over, { message: 'under must be less than over' });

/** From URL / query strings. Throws on 0 < under < over violations. */
export function parseThresholds(q: { under?: string | number; over?: string | number }): GapThresholds {
  return ThresholdsSchema.parse(q);
}

/** Share-vs-share rule (spec §2 decision 3). Shares are fractions (0..1). */
export function verdictFor(args: {
  postings: number;
  programmes: number;
  demandShare: number;
  supplyShare: number;
  thresholds: GapThresholds;
}): { ratio: number | null; verdict: GapVerdict } {
  if (args.programmes === 0) return { ratio: null, verdict: 'white-space' };
  const raw = args.demandShare > 0 ? args.supplyShare / args.demandShare : null;
  const ratio = raw == null ? null : Math.round(raw * 100) / 100;
  if (args.postings < JOBTHAI_MIN_POSTINGS_FOR_SIGNAL) return { ratio, verdict: 'too-few-postings' };
  if (raw == null) return { ratio, verdict: 'too-few-postings' };
  if (raw < args.thresholds.under) return { ratio, verdict: 'under-served' };
  if (raw > args.thresholds.over) return { ratio, verdict: 'over-served' };
  return { ratio, verdict: 'served' };
}

export type PipelineArrow = 'up' | 'down' | 'flat';

/** Pipeline ÷ 4 (a nominal four-year intake) against graduates per year. */
export function pipelineArrow(gradsPerYear: number | null, pipeline: number | null): PipelineArrow | null {
  if (gradsPerYear == null || pipeline == null || gradsPerYear <= 0) return null;
  const perYear = pipeline / 4;
  if (perYear > 1.25 * gradsPerYear) return 'up';
  if (perYear < 0.75 * gradsPerYear) return 'down';
  return 'flat';
}

export interface Reconciliation {
  demandShareSum: number;
  supplyShareSum: number;
  multiFieldProgrammes: number;
  gradsTotal: number;
}

/** The line under the table. Supply shares are per field over the SAME
 *  denominator (every assigned programme once), so a programme in two fields
 *  is counted in both numerators and the sum may exceed 1. */
export function reconcile(
  rows: Array<{ postings: number; programmeIds: string[]; gradsPerYear: number }>,
  totals: { fieldPostings: number; gradsByProgramme: Map<string, number> },
): Reconciliation {
  const gradsTotal = [...totals.gradsByProgramme.values()].reduce((a, b) => a + b, 0);
  const seen = new Map<string, number>();
  for (const r of rows) for (const id of r.programmeIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  return {
    demandShareSum: totals.fieldPostings > 0 ? rows.reduce((a, r) => a + r.postings, 0) / totals.fieldPostings : 0,
    supplyShareSum: gradsTotal > 0 ? rows.reduce((a, r) => a + r.gradsPerYear, 0) / gradsTotal : 0,
    multiFieldProgrammes: [...seen.values()].filter((n) => n > 1).length,
    gradsTotal,
  };
}
```

- [ ] **Step 4: Run the rules test**

Run: `pnpm --filter @kku/db exec vitest run test/gap-map-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Export the programme health index**

In `packages/db/src/health-score.ts` change lines 606–641:

```ts
export interface ProgramScoreIndexEntry {
  programId: string;
  facultyId: string | null;
  dimensions: HealthScoreRow['dimensions'];
  /** Overall composite, null when every dimension was null. */
  overall: number | null;
}
export type ProgramScoreIndex = Map<string, ProgramScoreIndexEntry>;

let _programIndexCache: { at: number; index: ProgramScoreIndex } | null = null;

/** Every ACTIVE programme's health, memoised for PROGRAM_AVG_TTL_MS. Exported
 *  for the gap map, which needs one number per programme without 297 calls. */
export async function getProgramScoreIndex(): Promise<ProgramScoreIndex> {
  const now = Date.now();
  if (_programIndexCache && now - _programIndexCache.at < PROGRAM_AVG_TTL_MS) {
    return _programIndexCache.index;
  }
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, facultyId: true },
  });
  const index: ProgramScoreIndex = new Map();
  for (let i = 0; i < programs.length; i += PROGRAM_AVG_CONCURRENCY) {
    const slice = programs.slice(i, i + PROGRAM_AVG_CONCURRENCY);
    const scored = await Promise.all(
      slice.map((p) =>
        computeHealthScores('program', p.id)
          .then((rows) => ({ p, row: rows[0] ?? null }))
          .catch(() => ({ p, row: null as HealthScoreRow | null })),
      ),
    );
    for (const { p, row } of scored) {
      if (!row) continue;
      index.set(p.id, { programId: p.id, facultyId: p.facultyId, dimensions: row.dimensions, overall: row.overall.score });
    }
  }
  _programIndexCache = { at: now, index };
  return index;
}
```

(Only `export` on the function and the `overall` field are new. Run `pnpm --filter @kku/db exec vitest run test/health-score-driver-parity.test.ts test/health-score.test.ts` afterwards — expected PASS.)

- [ ] **Step 6: Write the failing map test**

```ts
// packages/db/test/gap-map.test.ts
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/index';
import { computeGapMap, scopeProgramIds } from '../src/gap-map';
import { GAP_MAP_VERSION, GAP_VERDICTS } from '../src/gap-map-rules';

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

// These run against whatever dev holds after Task 4 populated the taxonomy.
// They assert invariants, not particular numbers.

describe.skipIf(!postgresUp)('computeGapMap at university scope', () => {
  it('reconciles: verdict counts sum to rows, faculty strip matches, demand shares sum to 1, every row stamped', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    expect(map.methodologyVersion).toBe(GAP_MAP_VERSION);
    const total = GAP_VERDICTS.reduce((n, v) => n + map.verdictCounts[v], 0);
    expect(total).toBe(map.rows.length);
    if (map.rows.length > 0) {
      expect(map.reconciliation.demandShareSum).toBeCloseTo(1, 3);
      for (const f of map.facultyStrip) {
        const inStrip = GAP_VERDICTS.reduce((n, v) => n + f.counts[v], 0);
        const fromRows = map.rows.filter((r) => r.facultyIds.includes(f.facultyId)).length;
        expect(inStrip).toBe(fromRows);
      }
      for (const r of map.rows) {
        // White space = no SCORED programme; a row holding only postgraduate
        // programmes is still a white space and still lists them.
        expect(r.programmes.filter((p) => p.scored).length === 0).toBe(r.verdict === 'white-space');
        if (r.verdict === 'too-few-postings') expect(r.postings).toBeLessThan(20);
      }
    }
    expect(map.reconciliation.anyFieldPostings).toBeGreaterThanOrEqual(0);
    expect(map.taxonomy.approved + map.taxonomy.proposed).toBe(map.rows.length);
  });

  it('postgraduate programmes are listed but never scored', async () => {
    const map = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    for (const r of map.rows) for (const p of r.programmes) {
      if (p.level !== 'BACHELOR') expect(p.scored).toBe(false);
    }
  });

  it('faculty scope never yields a white space that university scope does not', async () => {
    const uni = await computeGapMap({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    const faculty = await prisma.faculty.findFirst({ where: { programs: { some: { programJobFields: { some: {} } } } }, select: { id: true } });
    if (!faculty) return;
    const fac = await computeGapMap({ scope: 'faculty', scopeId: faculty.id, thresholds: { under: 0.5, over: 2 } });
    for (const r of fac.rows) {
      expect(r.kkuTotal).not.toBeNull();
      const uniRow = uni.rows.find((u) => u.slug === r.slug)!;
      expect(r.kkuTotal!.verdict).toBe(uniRow.verdict);
      if (r.verdict === 'white-space') expect(['white-space', 'under-served', 'served', 'over-served', 'too-few-postings']).toContain(uniRow.verdict);
    }
  });

  it('scopeProgramIds returns null for university and ids for a faculty', async () => {
    expect(await scopeProgramIds('university', null)).toBeNull();
    const f = await prisma.faculty.findFirst({ select: { id: true } });
    if (f) expect(Array.isArray(await scopeProgramIds('faculty', f.id))).toBe(true);
  });
});

// Provenance gating is structural: every demand query must gate postings with
// realDataSql('jp'), and every supply read must gate with realDataWhere() /
// realDataSql(). An untagged batch is then invisible by construction (spec §9).
// Reading the source beats inserting a fake posting, which the no-mock-data
// rule forbids even inside a rolled-back transaction.
describe('computeGapMap provenance gating', () => {
  const src = readFileSync(path.join(__dirname, '..', 'src', 'gap-map.ts'), 'utf8');
  it('gates every job_postings read', () => {
    const joins = (src.match(/JOIN job_postings jp|FROM job_postings jp/g) ?? []).length;
    const gates = (src.match(/realDataSql\('jp'\)/g) ?? []).length;
    expect(joins).toBeGreaterThan(0);
    expect(gates).toBeGreaterThanOrEqual(joins);
  });
  it('gates alumni, enrolment, cohort and link reads', () => {
    expect(src).toContain("realDataSql('acs')");
    expect(src).toContain("realDataSql('em')");
    expect(src).toMatch(/studentCohortDistribution\.groupBy\([\s\S]*?realDataWhere\(\)/);
    expect(src).toMatch(/programJobThaiLink\.findMany\(\{\s*where: realDataWhere\(\)/);
  });
});
```

(Add `import { readFileSync } from 'node:fs';` and `import path from 'node:path';` at the top of the test.)

- [ ] **Step 7: Write `gap-map.ts`**

```ts
// packages/db/src/gap-map.ts
import { Prisma } from '@prisma/client';
import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';
import { prisma } from './index';
import { realDataSql, realDataWhere } from './data-quality';
import { getProgramScoreIndex } from './health-score';
import { eligiblePostingLevels } from './jobthai-bridge';
import {
  GAP_MAP_VERSION,
  GAP_VERDICTS,
  pipelineArrow,
  reconcile,
  verdictFor,
  type GapThresholds,
  type GapVerdict,
  type PipelineArrow,
} from './gap-map-rules';
import { globalSignalForFields, trendSignalsForFields, type FieldGlobalSignal, type FieldTrendSignal } from './gap-map-signals';

// ─────────────────────────────────────────────────────────────────────────────
// The demand-first gap map — `gap-map.v1` (spec §4).
//
// One row per canonical field of study. Demand share = eligible postings
// naming any synonym ÷ eligible postings naming any canonical field. Supply
// share = graduates/yr of the field's programmes ÷ graduates/yr of every
// programme assigned to any field. Verdict = share vs share (gap-map-rules).
//
// "Eligible" is the bachelor universe: postings whose minimum education
// level admits a bachelor's graduate (eligiblePostingLevels('BACHELOR')).
// Postgraduate programmes are LISTED inside rows with their graduates, but
// never scored — only 41 of 47,631 postings state a postgraduate minimum,
// so any verdict on them would be built from undergraduate adverts (the
// honest-signal gate the JobThai bridge already applies).
// ─────────────────────────────────────────────────────────────────────────────

export type GapMapScope = 'university' | 'faculty' | 'department';

export interface GapMapOccupation {
  occupationId: string;
  code: string;
  category: string;
  subcategory: string;
  postings: number;
  linkedProgramIds: string[];
}

export interface GapMapProgramme {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyId: string | null;
  facultyNameEn: string | null;
  gradsPerYear: number | null;
  supplySource: 'alumni' | 'enrolment-proxy' | null;
  pipeline: number | null;
  healthScore: number | null;
  /** false for postgraduate programmes and for programmes outside the scope. */
  scored: boolean;
  /** Assignment review state — the row's provenance says "unreviewed" when any is PROPOSED. */
  reviewStatus: 'PROPOSED' | 'APPROVED';
}

export interface GapMapRow {
  slug: string;
  nameTh: string;
  nameEn: string;
  reviewStatus: 'PROPOSED' | 'APPROVED';
  postings: number;
  demandShare: number;
  supplyShare: number;
  ratio: number | null;
  verdict: GapVerdict;
  gradsPerYear: number | null;
  pipeline: number | null;
  pipelineArrow: PipelineArrow | null;
  programmeCount: number;
  signalCount: number;
  /** Present only when scope ≠ university: the same field scored over all of KKU. */
  kkuTotal: { supplyShare: number; ratio: number | null; verdict: GapVerdict } | null;
  provinces: Array<{ province: string; share: number }>;
  occupations: GapMapOccupation[];
  programmes: GapMapProgramme[];
  facultyIds: string[];
  globalSignal: FieldGlobalSignal;
  trendSignals: FieldTrendSignal[];
}

export interface GapMapResult {
  methodologyVersion: typeof GAP_MAP_VERSION;
  computedAt: string;
  scope: { level: GapMapScope; id: string | null; label: string | null };
  thresholds: GapThresholds;
  rows: GapMapRow[];
  verdictCounts: Record<GapVerdict, number>;
  facultyStrip: Array<{ facultyId: string; nameTh: string; nameEn: string; counts: Record<GapVerdict, number> }>;
  reconciliation: {
    eligiblePostings: number;
    fieldPostings: number;
    anyFieldPostings: number;
    otherKinds: number;
    otherMentions: number;
    postgraduatePostings: number;
    demandShareSum: number;
    supplyShareSum: number;
    multiFieldProgrammes: number;
    gradsTotal: number;
  };
  taxonomy: { approved: number; proposed: number };
  freshness: { postingsAsOf: string | null; taxonomyAsOf: string | null };
}

const BACHELOR_LEVELS = eligiblePostingLevels('BACHELOR');
const POSTGRAD_LEVELS = eligiblePostingLevels('MASTER');

export async function scopeProgramIds(scope: GapMapScope, scopeId: string | null): Promise<string[] | null> {
  if (scope === 'university' || !scopeId) return null;
  const rows = await prisma.program.findMany({
    where: scope === 'faculty' ? { facultyId: scopeId } : { departmentId: scopeId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function emptyCounts(): Record<GapVerdict, number> {
  return Object.fromEntries(GAP_VERDICTS.map((v) => [v, 0])) as Record<GapVerdict, number>;
}

export async function computeGapMap(args: {
  scope: GapMapScope;
  scopeId: string | null;
  thresholds: GapThresholds;
  now?: Date;
}): Promise<GapMapResult> {
  const now = args.now ?? new Date();
  const inScope = await scopeProgramIds(args.scope, args.scopeId);
  const inScopeSet = inScope ? new Set(inScope) : null;

  // ── Demand ────────────────────────────────────────────────────────────────
  const fields = await prisma.jobFieldTaxonomy.findMany({
    where: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] } },
    select: { id: true, slug: true, nameTh: true, nameEn: true, reviewStatus: true, updatedAt: true },
    orderBy: { slug: 'asc' },
  });
  const [demandRows, universe, provinceRows] = await Promise.all([
    prisma.$queryRaw<Array<{ field_id: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND jp.source = 'jobthai'
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS})
        AND ${realDataSql('jp')}
      GROUP BY f.id
    `),
    prisma.$queryRaw<Array<{ eligible: number; field_naming: number; any_field: number; postgraduate: number; other_kinds: number; other_mentions: number; as_of: Date | null }>>(Prisma.sql`
      WITH eligible AS (
        SELECT jp.id, jp.required_fields_raw, jp.freshness_date
        FROM job_postings jp
        WHERE jp.source = 'jobthai'
          AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS})
          AND ${realDataSql('jp')}
      ),
      field_naming AS (
        SELECT e.id FROM eligible e
        WHERE EXISTS (SELECT 1 FROM job_field_taxonomy f WHERE f.review_status IN ('APPROVED','PROPOSED') AND e.required_fields_raw && f.synonyms)
      ),
      other AS (
        SELECT s FROM eligible e, unnest(e.required_fields_raw) AS s
        WHERE s <> ${JOBTHAI_ANY_FIELD}
          AND NOT EXISTS (SELECT 1 FROM job_field_taxonomy f WHERE f.review_status IN ('APPROVED','PROPOSED') AND s = ANY(f.synonyms))
      )
      SELECT
        (SELECT COUNT(*)::int FROM eligible) AS eligible,
        (SELECT COUNT(*)::int FROM field_naming) AS field_naming,
        (SELECT COUNT(*)::int FROM eligible WHERE ${JOBTHAI_ANY_FIELD} = ANY(required_fields_raw)) AS any_field,
        (SELECT COUNT(*)::int FROM job_postings jp WHERE jp.source = 'jobthai' AND jp.min_education_level::text = ANY(${POSTGRAD_LEVELS}) AND ${realDataSql('jp')}) AS postgraduate,
        (SELECT COUNT(DISTINCT s)::int FROM other) AS other_kinds,
        (SELECT COUNT(*)::int FROM other) AS other_mentions,
        (SELECT MAX(freshness_date) FROM eligible) AS as_of
    `),
    prisma.$queryRaw<Array<{ field_id: string; province: string; postings: number }>>(Prisma.sql`
      SELECT f.id AS field_id, COALESCE(jp.province, '(unknown)') AS province, COUNT(DISTINCT jp.id)::int AS postings
      FROM job_field_taxonomy f
      JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
      WHERE f.review_status IN ('APPROVED', 'PROPOSED')
        AND jp.source = 'jobthai'
        AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS})
        AND ${realDataSql('jp')}
      GROUP BY f.id, COALESCE(jp.province, '(unknown)')
    `),
  ]);
  const u = universe[0] ?? { eligible: 0, field_naming: 0, any_field: 0, postgraduate: 0, other_kinds: 0, other_mentions: 0, as_of: null };
  const postingsByField = new Map(demandRows.map((r) => [r.field_id, r.postings]));
  const provincesByField = new Map<string, Array<{ province: string; share: number }>>();
  for (const r of provinceRows) {
    const total = postingsByField.get(r.field_id) ?? 0;
    const list = provincesByField.get(r.field_id) ?? [];
    list.push({ province: r.province, share: total > 0 ? r.postings / total : 0 });
    provincesByField.set(r.field_id, list);
  }
  for (const list of provincesByField.values()) list.sort((a, b) => b.share - a.share).splice(5);

  // ── Occupations inside a row ──────────────────────────────────────────────
  const occRows = await prisma.$queryRaw<Array<{ field_id: string; occupation_id: string; code: string; category: string; subcategory: string; postings: number }>>(Prisma.sql`
    SELECT f.id AS field_id, o.id AS occupation_id, o.code, o.category, o.subcategory, COUNT(DISTINCT jp.id)::int AS postings
    FROM job_field_taxonomy f
    JOIN job_postings jp ON jp.required_fields_raw && f.synonyms
    JOIN jobthai_occupations o ON o.category = jp.job_category AND o.subcategory = jp.job_subcategory
    WHERE f.review_status IN ('APPROVED', 'PROPOSED')
      AND jp.source = 'jobthai'
      AND jp.min_education_level::text = ANY(${BACHELOR_LEVELS})
      AND ${realDataSql('jp')}
    GROUP BY f.id, o.id, o.code, o.category, o.subcategory
    ORDER BY postings DESC
  `);
  const links = await prisma.programJobThaiLink.findMany({
    where: realDataWhere(),
    select: { programId: true, jobThaiOccupationId: true },
  });
  const linkedByOcc = new Map<string, string[]>();
  for (const l of links) linkedByOcc.set(l.jobThaiOccupationId, [...(linkedByOcc.get(l.jobThaiOccupationId) ?? []), l.programId]);
  const occByField = new Map<string, GapMapOccupation[]>();
  for (const r of occRows) {
    const list = occByField.get(r.field_id) ?? [];
    if (list.length < 12) list.push({ occupationId: r.occupation_id, code: r.code, category: r.category, subcategory: r.subcategory, postings: r.postings, linkedProgramIds: linkedByOcc.get(r.occupation_id) ?? [] });
    occByField.set(r.field_id, list);
  }

  // ── Supply ────────────────────────────────────────────────────────────────
  const assignments = await prisma.programJobField.findMany({
    where: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] }, field: { reviewStatus: { in: ['APPROVED', 'PROPOSED'] } } },
    select: {
      fieldId: true,
      reviewStatus: true,
      program: { select: { id: true, code: true, nameTh: true, nameEn: true, level: true, facultyId: true, faculty: { select: { nameEn: true } } } },
    },
  });
  const assignedProgramIds = [...new Set(assignments.map((a) => a.program.id))];
  const supplyRows = assignedProgramIds.length === 0 ? [] : await prisma.$queryRaw<Array<{ program_id: string; supply: number; source: 'alumni' | 'enrolment-proxy' | null }>>(Prisma.sql`
    WITH latest_be AS (
      SELECT MAX(entry_year_be) AS max_be FROM alumni_cohort_statuses acs0
      WHERE ${realDataSql('acs0')}
    ),
    alumni_per_program AS (
      SELECT program_id, SUM(count)::float / 5.0 AS graduates_per_year
      FROM alumni_cohort_statuses acs, latest_be
      WHERE status_bucket = 'GRADUATED'
        AND entry_year_be >= latest_be.max_be - 5
        AND ${realDataSql('acs')}
      GROUP BY program_id
    ),
    latest_grad AS (
      SELECT DISTINCT ON (program_id) program_id, graduated_on_time
      FROM enrollment_metrics em
      WHERE ${realDataSql('em')}
      ORDER BY program_id, academic_year DESC
    )
    SELECT
      p.id AS program_id,
      COALESCE(a.graduates_per_year, lg.graduated_on_time)::float AS supply,
      CASE WHEN a.graduates_per_year IS NOT NULL THEN 'alumni' WHEN lg.graduated_on_time IS NOT NULL THEN 'enrolment-proxy' ELSE NULL END AS source
    FROM programs p
    LEFT JOIN alumni_per_program a ON a.program_id = p.id
    LEFT JOIN latest_grad lg ON lg.program_id = p.id
    WHERE p.id = ANY(${assignedProgramIds})
  `);
  const supplyById = new Map(supplyRows.map((r) => [r.program_id, { grads: r.supply, source: r.source }]));
  const pipelineRows = assignedProgramIds.length === 0 ? [] : await prisma.studentCohortDistribution.groupBy({
    by: ['programId'],
    where: { programId: { in: assignedProgramIds }, ...realDataWhere() },
    _sum: { studentCount: true },
  });
  const pipelineById = new Map(pipelineRows.map((r) => [r.programId, r._sum.studentCount ?? 0]));
  const health = await getProgramScoreIndex();

  // Denominators: every scored (bachelor, in-scope) programme once.
  const scoredIds = new Set(assignedProgramIds.filter((id) => {
    const p = assignments.find((a) => a.program.id === id)!.program;
    return p.level === 'BACHELOR' && (inScopeSet ? inScopeSet.has(id) : true);
  }));
  const kkuScoredIds = new Set(assignedProgramIds.filter((id) => assignments.find((a) => a.program.id === id)!.program.level === 'BACHELOR'));
  const gradsOf = (id: string) => supplyById.get(id)?.grads ?? 0;
  const gradsTotal = [...scoredIds].reduce((n, id) => n + gradsOf(id), 0);
  const kkuGradsTotal = [...kkuScoredIds].reduce((n, id) => n + gradsOf(id), 0);

  // ── Rows ──────────────────────────────────────────────────────────────────
  const fieldIds = fields.map((f) => f.id);
  const [globalSignals, trendSignals] = await Promise.all([
    globalSignalForFields(fieldIds, new Map(fields.map((f) => [f.id, (occByField.get(f.id) ?? []).map((o) => o.occupationId)]))),
    trendSignalsForFields(fields.map((f) => ({
      fieldId: f.id,
      programIds: assignments.filter((a) => a.fieldId === f.id).map((a) => a.program.id),
      occupationNames: (occByField.get(f.id) ?? []).map((o) => o.subcategory),
    }))),
  ]);

  const rows: GapMapRow[] = fields.map((f) => {
    const postings = postingsByField.get(f.id) ?? 0;
    const demandShare = u.field_naming > 0 ? postings / u.field_naming : 0;
    const mine = assignments.filter((a) => a.fieldId === f.id);
    const programmes: GapMapProgramme[] = mine.map((a) => {
      const s = supplyById.get(a.program.id);
      return {
        programId: a.program.id,
        code: a.program.code,
        nameTh: a.program.nameTh,
        nameEn: a.program.nameEn,
        level: a.program.level,
        facultyId: a.program.facultyId,
        facultyNameEn: a.program.faculty?.nameEn ?? null,
        gradsPerYear: s?.grads ?? null,
        supplySource: s?.source ?? null,
        pipeline: pipelineById.get(a.program.id) ?? null,
        healthScore: health.get(a.program.id)?.overall ?? null,
        scored: scoredIds.has(a.program.id),
        reviewStatus: a.reviewStatus === 'APPROVED' ? 'APPROVED' : 'PROPOSED',
      };
    }).sort((x, y) => (y.gradsPerYear ?? -1) - (x.gradsPerYear ?? -1));
    const scored = programmes.filter((p) => p.scored);
    const grads = scored.reduce((n, p) => n + (p.gradsPerYear ?? 0), 0);
    const pipeline = scored.reduce((n, p) => n + (p.pipeline ?? 0), 0);
    const hasGrads = scored.some((p) => p.gradsPerYear != null);
    const hasPipeline = scored.some((p) => p.pipeline != null);
    const supplyShare = gradsTotal > 0 ? grads / gradsTotal : 0;
    const { ratio, verdict } = verdictFor({ postings, programmes: scored.length, demandShare, supplyShare, thresholds: args.thresholds });

    let kkuTotal: GapMapRow['kkuTotal'] = null;
    if (inScopeSet) {
      const kkuScored = mine.filter((a) => kkuScoredIds.has(a.program.id));
      const kkuGrads = kkuScored.reduce((n, a) => n + gradsOf(a.program.id), 0);
      const kkuShare = kkuGradsTotal > 0 ? kkuGrads / kkuGradsTotal : 0;
      const v = verdictFor({ postings, programmes: kkuScored.length, demandShare, supplyShare: kkuShare, thresholds: args.thresholds });
      kkuTotal = { supplyShare: kkuShare, ratio: v.ratio, verdict: v.verdict };
    }

    const signals = trendSignals.get(f.id) ?? [];
    return {
      slug: f.slug,
      nameTh: f.nameTh,
      nameEn: f.nameEn,
      reviewStatus: f.reviewStatus === 'APPROVED' ? 'APPROVED' : 'PROPOSED',
      postings,
      demandShare,
      supplyShare,
      ratio,
      verdict,
      gradsPerYear: hasGrads ? grads : null,
      pipeline: hasPipeline ? pipeline : null,
      pipelineArrow: pipelineArrow(hasGrads ? grads : null, hasPipeline ? pipeline : null),
      programmeCount: scored.length,
      signalCount: signals.length,
      kkuTotal,
      provinces: provincesByField.get(f.id) ?? [],
      occupations: occByField.get(f.id) ?? [],
      programmes,
      facultyIds: [...new Set(programmes.map((p) => p.facultyId).filter((x): x is string => x != null))],
      globalSignal: globalSignals.get(f.id) ?? { skills: [], scope: null },
      trendSignals: signals,
    };
  });

  // ── Aggregates ────────────────────────────────────────────────────────────
  const verdictCounts = emptyCounts();
  for (const r of rows) verdictCounts[r.verdict] += 1;
  const facultyIds = [...new Set(rows.flatMap((r) => r.facultyIds))];
  const faculties = await prisma.faculty.findMany({ where: { id: { in: facultyIds } }, select: { id: true, nameTh: true, nameEn: true }, orderBy: { nameEn: 'asc' } });
  const facultyStrip = faculties.map((fac) => {
    const counts = emptyCounts();
    for (const r of rows) if (r.facultyIds.includes(fac.id)) counts[r.verdict] += 1;
    return { facultyId: fac.id, nameTh: fac.nameTh, nameEn: fac.nameEn, counts };
  });
  const rec = reconcile(
    rows.map((r) => ({ postings: r.postings, programmeIds: r.programmes.filter((p) => p.scored).map((p) => p.programId), gradsPerYear: r.gradsPerYear ?? 0 })),
    { fieldPostings: u.field_naming, gradsByProgramme: new Map([...scoredIds].map((id) => [id, gradsOf(id)])) },
  );
  const scopeLabel = args.scope === 'university' || !args.scopeId
    ? null
    : args.scope === 'faculty'
      ? (await prisma.faculty.findUnique({ where: { id: args.scopeId }, select: { nameEn: true } }))?.nameEn ?? null
      : (await prisma.department.findUnique({ where: { id: args.scopeId }, select: { nameEn: true } }))?.nameEn ?? null;

  return {
    methodologyVersion: GAP_MAP_VERSION,
    computedAt: now.toISOString(),
    scope: { level: args.scope, id: args.scopeId, label: scopeLabel },
    thresholds: args.thresholds,
    rows: rows.sort((a, b) => b.demandShare - a.demandShare),
    verdictCounts,
    facultyStrip,
    reconciliation: {
      eligiblePostings: u.eligible,
      fieldPostings: u.field_naming,
      anyFieldPostings: u.any_field,
      otherKinds: u.other_kinds,
      otherMentions: u.other_mentions,
      postgraduatePostings: u.postgraduate,
      ...rec,
    },
    taxonomy: {
      approved: fields.filter((f) => f.reviewStatus === 'APPROVED').length,
      proposed: fields.filter((f) => f.reviewStatus === 'PROPOSED').length,
    },
    freshness: {
      postingsAsOf: u.as_of ? new Date(u.as_of).toISOString() : null,
      taxonomyAsOf: fields.length ? new Date(Math.max(...fields.map((f) => f.updatedAt.getTime()))).toISOString() : null,
    },
  };
}
```

`gap-map-signals.ts` does not exist until Task 8. To keep this task green on its own, create it now with the two functions returning empty maps and the two types, then Task 8 fills them in:

```ts
// packages/db/src/gap-map-signals.ts  (Task 7 stub — Task 8 replaces the bodies)
export interface FieldGlobalSignal {
  skills: Array<{ skillId: string; nameEn: string; nameTh: string; growthPct: number }>;
  scope: 'THAILAND' | 'GLOBAL' | null;
}
export interface FieldTrendSignal {
  id: string;
  title: string;
  signalType: string;
  impactScore: number;
  detectedDate: string;
  matchedBy: 'programme' | 'initiative';
}
export async function globalSignalForFields(_fieldIds: string[], _occupationIdsByField: Map<string, string[]>): Promise<Map<string, FieldGlobalSignal>> {
  return new Map();
}
export async function trendSignalsForFields(_fields: Array<{ fieldId: string; programIds: string[]; occupationNames: string[] }>): Promise<Map<string, FieldTrendSignal[]>> {
  return new Map();
}
```

Add to `packages/db/src/index.ts`:

```ts
export * from './gap-map-rules';
export * from './gap-map';
export * from './gap-map-signals';
```

- [ ] **Step 8: Run tests and typecheck**

```bash
pnpm --filter @kku/db exec vitest run test/gap-map-rules.test.ts test/gap-map.test.ts test/health-score.test.ts
pnpm --filter @kku/db typecheck
```

Expected: PASS; typecheck clean. If `min_education_level::text = ANY($1)` complains about the parameter type, cast the array: `ANY(${BACHELOR_LEVELS}::text[])`. Time the university call once (`console.time` in a scratch tsx) — expected under 3 s warm; the health index is memoised for 30 min.

- [ ] **Step 9: Commit**

```bash
git add packages/db/src/gap-map-rules.ts packages/db/src/gap-map.ts packages/db/src/gap-map-signals.ts packages/db/src/health-score.ts packages/db/src/index.ts packages/db/test/gap-map-rules.test.ts packages/db/test/gap-map.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-7.txt
```

Message: `feat(db): computeGapMap — demand-first field map, share-vs-share verdicts (gap-map.v1)` + attribution.

---

### Task 8: "What's coming" — global signal and trend signals per field

**Files:**
- Modify: `packages/db/src/gap-map-signals.ts` (replace the Task 7 stub bodies)
- Test: `packages/db/test/gap-map-signals.test.ts`

Global signal (spec §6): the field's occupations → `jobthai_occupation_skills` at or above `OCCUPATION_SKILL_DEMAND_FLOOR`, generic skills removed (`jobThaiGenericSkills()`), intersected with `kmitl_skill_growths` (THAILAND, GLOBAL fallback), top three by growth. Neither table carries provenance, so neither is gated. Trend signals: `affectedProgramIds hasSome` the field's programmes, or a `newInitiativesJson[*].unmetRoleTh/En` naming one of the field's occupation subcategories.

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/gap-map-signals.test.ts
import { describe, expect, it } from 'vitest';
import { matchInitiativeToOccupations, pickGrowth, type GrowthRow } from '../src/gap-map-signals';

describe('pickGrowth', () => {
  const rows: GrowthRow[] = [
    { skillId: 's1', dataScope: 'THAILAND', growthPct: 12 },
    { skillId: 's1', dataScope: 'GLOBAL', growthPct: 40 },
    { skillId: 's2', dataScope: 'GLOBAL', growthPct: 27 },
    { skillId: 's3', dataScope: 'THAILAND', growthPct: -5 },
    { skillId: 's4', dataScope: 'THAILAND', growthPct: 9 },
  ];
  it('prefers THAILAND per skill, falls back to GLOBAL, keeps the top three rising', () => {
    const r = pickGrowth(rows, new Set(['s1', 's2', 's3', 's4']), new Set());
    expect(r.scope).toBe('THAILAND');
    expect(r.picked.map((p) => [p.skillId, p.growthPct])).toEqual([['s2', 27], ['s1', 12], ['s4', 9]]);
  });
  it('drops generic skills and reports GLOBAL when no Thai row survives', () => {
    const r = pickGrowth(rows, new Set(['s1', 's2']), new Set(['s1']));
    expect(r.picked.map((p) => p.skillId)).toEqual(['s2']);
    expect(r.scope).toBe('GLOBAL');
  });
  it('is empty, with null scope, when nothing intersects', () => {
    expect(pickGrowth(rows, new Set(['zz']), new Set())).toEqual({ picked: [], scope: null });
  });
});

describe('matchInitiativeToOccupations', () => {
  it('matches an unmet role against occupation subcategories in either language, case- and space-insensitive', () => {
    const occ = ['Logistics / Supply Chain', 'นักวิเคราะห์ข้อมูล'];
    expect(matchInitiativeToOccupations([{ unmetRoleTh: 'เจ้าหน้าที่โลจิสติกส์', unmetRoleEn: 'logistics coordinator' }], occ)).toBe(true);
    expect(matchInitiativeToOccupations([{ unmetRoleTh: 'นักวิเคราะห์ข้อมูล', unmetRoleEn: 'Data analyst' }], occ)).toBe(true);
    expect(matchInitiativeToOccupations([{ unmetRoleTh: 'พยาบาล', unmetRoleEn: 'Nurse' }], occ)).toBe(false);
    expect(matchInitiativeToOccupations(null, occ)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/gap-map-signals.test.ts`
Expected: FAIL — `pickGrowth` is not exported.

- [ ] **Step 3: Replace `gap-map-signals.ts`**

```ts
// packages/db/src/gap-map-signals.ts
import { Prisma } from '@prisma/client';
import { prisma } from './index';
import { OCCUPATION_SKILL_DEMAND_FLOOR } from './jobthai-bridge';
import { jobThaiGenericSkills } from './jobthai';

// ─────────────────────────────────────────────────────────────────────────────
// "What's coming" for a gap-map row (spec §6): the LinkedIn-via-MHESI growth
// signal reached through the field's occupations' skills (no career→field
// mapping invented), and Trends Radar signals reached through the field's
// programmes or through an initiative that names one of its occupations.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldGlobalSignal {
  skills: Array<{ skillId: string; nameEn: string; nameTh: string; growthPct: number }>;
  /** Which growth series the picks came from; null when nothing intersected. */
  scope: 'THAILAND' | 'GLOBAL' | null;
}

export interface FieldTrendSignal {
  id: string;
  title: string;
  signalType: string;
  impactScore: number;
  detectedDate: string;
  matchedBy: 'programme' | 'initiative';
}

export interface GrowthRow {
  skillId: string;
  dataScope: 'THAILAND' | 'GLOBAL';
  growthPct: number;
}

export const GLOBAL_SIGNAL_TOP_N = 3;

/** Pure: THAILAND per skill, GLOBAL fallback, generic skills out, top N rising. */
export function pickGrowth(
  rows: GrowthRow[],
  fieldSkillIds: Set<string>,
  genericSkillIds: Set<string>,
): { picked: Array<{ skillId: string; growthPct: number }>; scope: 'THAILAND' | 'GLOBAL' | null } {
  const best = new Map<string, { growthPct: number; scope: 'THAILAND' | 'GLOBAL' }>();
  for (const r of rows) {
    if (!fieldSkillIds.has(r.skillId) || genericSkillIds.has(r.skillId)) continue;
    const cur = best.get(r.skillId);
    if (!cur || (cur.scope === 'GLOBAL' && r.dataScope === 'THAILAND') || (cur.scope === r.dataScope && r.growthPct > cur.growthPct)) {
      best.set(r.skillId, { growthPct: r.growthPct, scope: r.dataScope });
    }
  }
  const picked = [...best.entries()]
    .filter(([, v]) => v.growthPct > 0)
    .sort((a, b) => b[1].growthPct - a[1].growthPct)
    .slice(0, GLOBAL_SIGNAL_TOP_N)
    .map(([skillId, v]) => ({ skillId, growthPct: v.growthPct }));
  if (picked.length === 0) return { picked: [], scope: null };
  const scope = picked.some((p) => best.get(p.skillId)!.scope === 'THAILAND') ? 'THAILAND' : 'GLOBAL';
  return { picked, scope };
}

export async function globalSignalForFields(
  fieldIds: string[],
  occupationIdsByField: Map<string, string[]>,
): Promise<Map<string, FieldGlobalSignal>> {
  const result = new Map<string, FieldGlobalSignal>();
  const allOcc = [...new Set([...occupationIdsByField.values()].flat())];
  if (fieldIds.length === 0 || allOcc.length === 0) return result;
  const [occSkills, growth, generic] = await Promise.all([
    prisma.jobThaiOccupationSkill.findMany({
      where: { jobThaiOccupationId: { in: allOcc }, share: { gte: OCCUPATION_SKILL_DEMAND_FLOOR } },
      select: { jobThaiOccupationId: true, skillId: true },
    }),
    prisma.kmitlSkillGrowth.findMany({
      where: { skillId: { not: null } },
      select: { skillId: true, dataScope: true, growthPct: true },
    }),
    jobThaiGenericSkills(),
  ]);
  const skillsByOcc = new Map<string, string[]>();
  for (const r of occSkills) skillsByOcc.set(r.jobThaiOccupationId, [...(skillsByOcc.get(r.jobThaiOccupationId) ?? []), r.skillId]);
  const growthRows: GrowthRow[] = growth.map((g) => ({ skillId: g.skillId!, dataScope: g.dataScope, growthPct: g.growthPct }));
  const pickedIds = new Set<string>();
  const perField = new Map<string, ReturnType<typeof pickGrowth>>();
  for (const fieldId of fieldIds) {
    const fieldSkills = new Set((occupationIdsByField.get(fieldId) ?? []).flatMap((o) => skillsByOcc.get(o) ?? []));
    const r = pickGrowth(growthRows, fieldSkills, generic.generic);
    perField.set(fieldId, r);
    for (const p of r.picked) pickedIds.add(p.skillId);
  }
  const names = await prisma.skill.findMany({ where: { id: { in: [...pickedIds] } }, select: { id: true, nameEn: true, nameTh: true } });
  const nameById = new Map(names.map((n) => [n.id, n]));
  for (const [fieldId, r] of perField) {
    result.set(fieldId, {
      scope: r.scope,
      skills: r.picked.map((p) => ({ skillId: p.skillId, nameEn: nameById.get(p.skillId)?.nameEn ?? p.skillId, nameTh: nameById.get(p.skillId)?.nameTh ?? '', growthPct: p.growthPct })),
    });
  }
  return result;
}

const TOKEN_SPLIT = /[\s/,()·&-]+/;
const norm = (s: string) => s.trim().toLowerCase();
/** Words of at least four characters — the same floor MIN_FIELD_LENGTH uses,
 *  because Thai has no inter-word spaces and short tokens match everywhere. */
const tokens = (s: string) => norm(s).split(TOKEN_SPLIT).filter((t) => t.length >= 4);

/** Pure: does any initiative's unmet role name one of the occupations?
 *  A match is a ≥4-char word of the role contained in the occupation name
 *  or vice versa ("logistics coordinator" ↔ "Logistics / Supply Chain"). */
export function matchInitiativeToOccupations(
  initiatives: Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }> | null | undefined,
  occupationNames: string[],
): boolean {
  if (!initiatives || initiatives.length === 0) return false;
  const occs = occupationNames.map((o) => ({ full: norm(o), words: tokens(o) }));
  for (const i of initiatives) {
    for (const role of [i.unmetRoleTh, i.unmetRoleEn]) {
      if (!role) continue;
      const full = norm(role);
      const words = tokens(role);
      for (const o of occs) {
        if (words.some((w) => o.full.includes(w))) return true;
        if (o.words.some((w) => full.includes(w))) return true;
      }
    }
  }
  return false;
}

export const TREND_SIGNALS_PER_FIELD = 5;

export async function trendSignalsForFields(
  fields: Array<{ fieldId: string; programIds: string[]; occupationNames: string[] }>,
): Promise<Map<string, FieldTrendSignal[]>> {
  const result = new Map<string, FieldTrendSignal[]>();
  if (fields.length === 0) return result;
  const allPrograms = [...new Set(fields.flatMap((f) => f.programIds))];
  const signals = await prisma.trendSignal.findMany({
    where: {
      OR: [
        ...(allPrograms.length ? [{ affectedProgramIds: { hasSome: allPrograms } }] : []),
        { newInitiativesJson: { not: Prisma.DbNull } },
      ],
    },
    select: { id: true, title: true, signalType: true, impactScore: true, detectedDate: true, affectedProgramIds: true, newInitiativesJson: true },
    orderBy: [{ impactScore: 'desc' }, { detectedDate: 'desc' }],
  });
  for (const f of fields) {
    const mine = new Set(f.programIds);
    const list: FieldTrendSignal[] = [];
    for (const s of signals) {
      const byProgramme = s.affectedProgramIds.some((id) => mine.has(id));
      const byInitiative = !byProgramme && matchInitiativeToOccupations(
        Array.isArray(s.newInitiativesJson) ? (s.newInitiativesJson as Array<{ unmetRoleTh?: string | null; unmetRoleEn?: string | null }>) : null,
        f.occupationNames,
      );
      if (!byProgramme && !byInitiative) continue;
      list.push({ id: s.id, title: s.title, signalType: s.signalType, impactScore: s.impactScore, detectedDate: s.detectedDate.toISOString().slice(0, 10), matchedBy: byProgramme ? 'programme' : 'initiative' });
      if (list.length >= TREND_SIGNALS_PER_FIELD) break;
    }
    result.set(f.fieldId, list);
  }
  return result;
}
```

- [ ] **Step 4: Run the tests, then a live check**

```bash
pnpm --filter @kku/db exec vitest run test/gap-map-signals.test.ts test/gap-map.test.ts
pnpm --filter @kku/db typecheck
```

Expected: PASS; typecheck clean. Then in a scratch tsx call `computeGapMap` at university scope and print, for the three rows with the most postings, `globalSignal.skills.map(s => s.nameEn + ' ' + s.growthPct)` and `trendSignals.length`. Expected: at least one field has a non-empty global signal (the 69 LinkedIn skills intersect the JobThai occupation skills), and the white-space fields that match one of the 9 signals carrying `new_initiatives_json` show `matchedBy: 'initiative'`. Record the counts in the commit body.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/gap-map-signals.ts packages/db/test/gap-map-signals.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-8.txt
```

Message: `feat(db): gap-map "what's coming" — LinkedIn growth via occupation skills, trend signals via programmes and initiatives` + attribution.

---

### Task 9: API — `GET /gap/map`, `GET /gap/map/fields/:slug`, `POST /gap/brief`, disagreements

**Files:**
- Create: `packages/shared/src/ai/prompts/gap-brief.ts`; modify `packages/shared/src/ai/prompts/index.ts`
- Create: `apps/api/src/gap/gap.service.ts`, `apps/api/src/gap/gap-brief.service.ts`
- Rewrite: `apps/api/src/gap/gap.controller.ts`, `apps/api/src/gap/gap.module.ts`
- Test: `packages/shared/test/gap-brief-prompt.test.ts`, `apps/api/test/gap-controller.test.ts`

The old endpoints and `GapInsightsService` are deleted in this task (the controller is rewritten wholesale); the `@kku/db` functions they called are removed in Task 11. `GET /gap/digital-competency` stays exactly as it is.

- [ ] **Step 1: Write the failing prompt test**

```ts
// packages/shared/test/gap-brief-prompt.test.ts
import { describe, expect, it } from 'vitest';
import { GAP_BRIEF_VERSION, GapBriefOutputSchema, buildGapBriefMessages } from '../src/ai/prompts/gap-brief';

const input = {
  view: { scopeLabel: 'KKU (all faculties)', verdict: 'all', facultyLabel: null, thresholds: { under: 0.5, over: 2 } },
  rows: [
    { nameEn: 'Logistics', nameTh: 'โลจิสติกส์', verdict: 'white-space', demandSharePct: 4.8, supplySharePct: 0, ratio: null, gradsPerYear: null, pipelineArrow: null, postings: 1610, topOccupations: ['Logistics officer'], risingSkills: ['Supply chain analytics ↑ 31 %'], trendSignalTitles: ['EEC logistics hub'] },
    { nameEn: 'Public health', nameTh: 'สาธารณสุข', verdict: 'over-served', demandSharePct: 0.9, supplySharePct: 4.1, ratio: 4.6, gradsPerYear: 380, pipelineArrow: 'down', postings: 300, topOccupations: [], risingSkills: [], trendSignalTitles: [] },
  ],
  reconciliation: { fieldPostings: 33_000, anyFieldPostings: 2_566, otherMentions: 2_900, proposedFields: 12, approvedFields: 26 },
};

describe('gap-brief.v1', () => {
  it('is versioned and grounds the user turn in every row', () => {
    expect(GAP_BRIEF_VERSION).toBe('gap-brief.v1');
    const user = buildGapBriefMessages(input).find((m) => m.role === 'user')!.content;
    expect(user).toContain('Logistics');
    expect(user).toContain('4.8');
    expect(user).toContain('over-served');
    expect(user).toContain('2,566');
  });
  it('refuses an empty view and more than 60 rows', () => {
    expect(() => buildGapBriefMessages({ ...input, rows: [] })).toThrow();
    expect(() => buildGapBriefMessages({ ...input, rows: Array.from({ length: 61 }, () => input.rows[0]!) })).toThrow(/60/);
  });
  it('validates ≤ 5 findings each naming a row, plus cannotTell', () => {
    const ok = GapBriefOutputSchema.safeParse({
      findings: [{ title: 'Logistics is a white space', fieldNameEn: 'Logistics', verdict: 'white-space', evidence: '4.8 % of adverts, no programme', implication: 'A launch case exists.' }],
      cannotTell: ['Salary levels — JobThai postings carry none.'],
      confidence: 0.7,
      reasoning: 'Grounded on two rows.',
    });
    expect(ok.success).toBe(true);
    const six = { findings: Array.from({ length: 6 }, () => ({ title: 't', fieldNameEn: 'x', verdict: 'served', evidence: 'e', implication: 'i' })), cannotTell: [], confidence: 0.5, reasoning: 'r' };
    expect(GapBriefOutputSchema.safeParse(six).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kku/shared exec vitest run test/gap-brief-prompt.test.ts`
Expected: FAIL — cannot resolve `../src/ai/prompts/gap-brief`.

- [ ] **Step 3: Write `gap-brief.ts`**

```ts
// packages/shared/src/ai/prompts/gap-brief.ts
import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Gap-map Council brief — one call over the rows on screen (spec §6). Up to
// five findings, each citing a row's numbers, plus what the data cannot tell.
// Replaces gap-insights.v2's three modes.
//
// Version-bumping rule: any change here = bump VERSION; AiInference.
// methodVersion records it.
// ─────────────────────────────────────────────────────────────────────────────

export const GAP_BRIEF_VERSION = 'gap-brief.v1';
export const GAP_BRIEF_MAX_ROWS = 60;

export const GapBriefOutputSchema = z.object({
  findings: z
    .array(
      z.object({
        title: z.string().min(1).max(160),
        fieldNameEn: z.string().min(1),
        verdict: z.enum(['white-space', 'under-served', 'served', 'over-served', 'too-few-postings']),
        /** The row's numbers, restated: shares, ratio, graduates, postings. */
        evidence: z.string().min(1).max(400),
        implication: z.string().min(1).max(400),
      }),
    )
    .max(5),
  cannotTell: z.array(z.string().max(300)).max(6),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});
export type GapBriefOutput = z.infer<typeof GapBriefOutputSchema>;

export interface GapBriefRow {
  nameEn: string;
  nameTh: string;
  verdict: string;
  demandSharePct: number;
  supplySharePct: number;
  ratio: number | null;
  gradsPerYear: number | null;
  pipelineArrow: 'up' | 'down' | 'flat' | null;
  postings: number;
  topOccupations: string[];
  risingSkills: string[];
  trendSignalTitles: string[];
}

export interface GapBriefInput {
  view: { scopeLabel: string; verdict: string; facultyLabel: string | null; thresholds: { under: number; over: number } };
  rows: GapBriefRow[];
  reconciliation: { fieldPostings: number; anyFieldPostings: number; otherMentions: number; proposedFields: number; approvedFields: number };
}

const ARROW = { up: 'pipeline growing', down: 'pipeline shrinking', flat: 'pipeline steady' } as const;

export function buildGapBriefMessages(input: GapBriefInput): AiMessage[] {
  if (input.rows.length === 0) throw new Error('Empty view — nothing to brief');
  if (input.rows.length > GAP_BRIEF_MAX_ROWS) throw new Error(`Too many rows: ${input.rows.length} > ${GAP_BRIEF_MAX_ROWS}`);

  const system = `You write a short brief for a university Council from a table that compares the labour market's demand for fields of study with the university's supply of graduates.

Each row is a field of study. Demand share = the share of Thai job adverts (JobThai) that ask for that field. Supply share = the share of the university's graduates per year that hold it. Ratio = supply share ÷ demand share. Verdicts: white-space (no programme), under-served (ratio < ${input.view.thresholds.under}), served, over-served (ratio > ${input.view.thresholds.over}), too-few-postings (no verdict).

Output STRICT JSON (no prose, no markdown fences):
{
  "findings": [ { "title": "<≤160 chars>", "fieldNameEn": "<a row's English name, verbatim>", "verdict": "<that row's verdict>", "evidence": "<the row's numbers restated, ≤400 chars>", "implication": "<what it means for the Council, ≤400 chars>" } ],
  "cannotTell": [ "<a limit of this data, ≤300 chars>" ],
  "confidence": 0.0-1.0,
  "reasoning": "<≤600 chars>"
}

Rules:
1. At most 5 findings. Prefer, in order: white spaces with the strongest demand and any signals; under-served fields whose pipeline is growing; over-served fields whose pipeline is shrinking.
2. Every finding names ONE row by its exact English name and restates its numbers in evidence. Never cite a number that is not in the table.
3. Do not recommend closing, merging or launching a programme. State what the numbers show and what question they raise.
4. cannotTell: at least two entries, drawn from the reconciliation line and the source's limits (national adverts, Bangkok-weighted, no salaries, no dates, postgraduate fields unscored, proposed fields unreviewed).
5. LANGUAGE RULE (English-only free text): every free-text field MUST be written in English. Thai field names appear only inside the table you are given.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const fmt = (n: number) => n.toLocaleString('en-US');
  const rowsBlock = input.rows
    .map(
      (r) =>
        `- ${r.nameEn} (${r.nameTh}) — ${r.verdict}; demand ${r.demandSharePct.toFixed(1)} %, supply ${r.supplySharePct.toFixed(1)} %, ratio ${r.ratio ?? '—'}; graduates/yr ${r.gradsPerYear == null ? '—' : fmt(Math.round(r.gradsPerYear))}${r.pipelineArrow ? ` (${ARROW[r.pipelineArrow]})` : ''}; ${fmt(r.postings)} adverts` +
        (r.topOccupations.length ? `; occupations: ${r.topOccupations.slice(0, 3).join(', ')}` : '') +
        (r.risingSkills.length ? `; rising skills (LinkedIn via MHESI): ${r.risingSkills.join(', ')}` : '') +
        (r.trendSignalTitles.length ? `; trend signals: ${r.trendSignalTitles.slice(0, 3).join(' | ')}` : ''),
    )
    .join('\n');

  const user = `[View] ${input.view.scopeLabel}${input.view.facultyLabel ? ` · faculty ${input.view.facultyLabel}` : ''} · verdict filter: ${input.view.verdict} · thresholds under ${input.view.thresholds.under} / over ${input.view.thresholds.over}

[Rows] (${input.rows.length})
${rowsBlock}

[Reconciliation] ${fmt(input.reconciliation.fieldPostings)} adverts name a canonical field; ${fmt(input.reconciliation.anyFieldPostings)} say "any field"; ${fmt(input.reconciliation.otherMentions)} mentions are long-tail strings below the floor; taxonomy ${input.reconciliation.approvedFields} approved / ${input.reconciliation.proposedFields} proposed.

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - view — scope label, verdict filter, faculty filter, thresholds: the
//     brief describes exactly what the reader has on screen.
//   - rows — every visible gap-map row: names, verdict, shares, ratio,
//     graduates/yr + pipeline arrow, postings, top occupations, rising
//     skills (LinkedIn via MHESI), trend-signal titles.
//   - reconciliation — the line under the table, so the model can state
//     what the shares leave out.
//
// Deliberately omitted, with reason:
//   - per-programme rows — the brief is about fields; programme detail is
//     the Deep-Dive's job and would invite programme-level recommendations
//     (rule 3).
//   - health scores — a different methodology; mixing them here would make
//     the brief's numbers untraceable to the table.
// ─────────────────────────────────────────────────────────────────────────────
```

Add `export * from './gap-brief';` to `packages/shared/src/ai/prompts/index.ts`. Run `pnpm --filter @kku/shared exec vitest run test/gap-brief-prompt.test.ts test/prompt-standard-conformance.test.ts` — expected PASS.

- [ ] **Step 4: Write the failing controller test**

```ts
// apps/api/test/gap-controller.test.ts
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_META, AI_CALL_META, PROVENANCE_META } from '../src/common/decorators';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import { BriefBody, GapController, MapQuery } from '../src/gap/gap.controller';
import { GapService } from '../src/gap/gap.service';
import type { CacheService } from '../src/common/cache.service';
import type { GapBriefService } from '../src/gap/gap-brief.service';

const user = { userId: 'u1', role: 'ADMIN', facultyId: null, departmentId: null, programId: null, email: 'x@kku.ac.th', name: null } as never;
const mapQuery = (q: Record<string, unknown>) => new ZodValidationPipe(MapQuery).transform(q, {} as never);

describe('MapQuery', () => {
  it('defaults thresholds and rejects under ≥ over, non-positive, and program scope', () => {
    expect(mapQuery({})).toMatchObject({ scope: 'university', under: 0.5, over: 2 });
    expect(mapQuery({ under: '0.7', over: '3' })).toMatchObject({ under: 0.7, over: 3 });
    expect(() => mapQuery({ under: '2', over: '1' })).toThrow();
    expect(() => mapQuery({ under: '0' })).toThrow();
    expect(() => mapQuery({ scope: 'program', scopeId: 'p1' })).toThrow();
  });
});

describe('GapService.map cache key', () => {
  it('includes scope, scopeId and both thresholds', async () => {
    const get = vi.fn(async () => undefined);
    const set = vi.fn(async () => undefined);
    const compute = vi.fn(async () => ({ rows: [] }));
    const s = new GapService({ get, set } as unknown as CacheService, compute as never);
    await s.map({ scope: 'faculty', scopeId: 'f1', thresholds: { under: 0.7, over: 3 } });
    const key = (get.mock.calls[0] as unknown as [string])[0];
    expect(key).toContain('gap:map');
    expect(key).toContain('f1');
    expect(key).toContain('0.7');
    expect(key).toContain('3');
    expect(set).toHaveBeenCalledWith(key, { rows: [] }, 300);
  });
  it('serves a hit without computing', async () => {
    const get = vi.fn(async () => ({ rows: ['cached'] }));
    const compute = vi.fn();
    const s = new GapService({ get, set: vi.fn() } as unknown as CacheService, compute as never);
    expect(await s.map({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } })).toEqual({ rows: ['cached'] });
    expect(compute).not.toHaveBeenCalled();
  });
});

describe('GapController decorators', () => {
  it('map and fieldDetail are read-gated and carry gap-map provenance', () => {
    for (const name of ['map', 'fieldDetail'] as const) {
      const m = GapController.prototype[name] as (...a: never[]) => unknown;
      expect(Reflect.getMetadata(PERMISSION_META, m)).toBe('programs:read:all');
      expect((Reflect.getMetadata(PROVENANCE_META, m) as { methodologyVersion: string }).methodologyVersion).toBe('gap-map.v1');
    }
  });
  it('brief is an AI call in the gap-analysis module', () => {
    expect(Reflect.getMetadata(AI_CALL_META, GapController.prototype.brief)).toEqual({ module: 'gap-analysis' });
  });
  it('brief passes only the current view to the service', async () => {
    const generate = vi.fn(async () => ({ output: null }));
    const c = new GapController({} as GapService, { generate } as unknown as GapBriefService);
    const body = new ZodValidationPipe(BriefBody).transform({ scope: 'university', verdict: 'white-space', under: '0.5', over: '2' }, {} as never);
    await c.brief(user, body);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'white-space', facultyId: null, thresholds: { under: 0.5, over: 2 }, userId: 'u1' }));
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter api exec vitest run test/gap-controller.test.ts`
Expected: FAIL — `MapQuery` / `GapService` not found.

- [ ] **Step 6: Write the service, the brief service, the controller, the module**

```ts
// apps/api/src/gap/gap.service.ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import { computeGapMap, type GapMapResult, type GapMapRow, type GapMapScope, type GapThresholds } from '@kku/db';
import { CacheService } from '../common/cache.service';

export const GAP_MAP_TTL_SECONDS = 300;
export const GAP_MAP_CACHE_NS = 'gap:map';
/** DI token for the compute function — the module binds computeGapMap;
 *  unit tests pass a stub through the constructor. */
export const COMPUTE_GAP_MAP = Symbol('COMPUTE_GAP_MAP');

export interface GapMapArgs {
  scope: GapMapScope;
  scopeId: string | null;
  thresholds: GapThresholds;
}

@Injectable()
export class GapService {
  private readonly compute: (args: GapMapArgs) => Promise<GapMapResult>;

  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(COMPUTE_GAP_MAP) compute?: (args: GapMapArgs) => Promise<GapMapResult>,
  ) {
    this.compute = compute ?? computeGapMap;
  }

  async map(args: GapMapArgs): Promise<GapMapResult> {
    const key = CacheService.keyOf(GAP_MAP_CACHE_NS, {
      scope: args.scope,
      scopeId: args.scopeId,
      under: args.thresholds.under,
      over: args.thresholds.over,
    });
    const hit = await this.cache.get<GapMapResult>(key);
    if (hit !== undefined) return hit;
    const value = await this.compute(args);
    await this.cache.set(key, value, GAP_MAP_TTL_SECONDS);
    return value;
  }

  async field(args: GapMapArgs & { slug: string }): Promise<GapMapRow | null> {
    const m = await this.map(args);
    return m.rows.find((r) => r.slug === args.slug) ?? null;
  }
}
```

The module registers `{ provide: COMPUTE_GAP_MAP, useValue: computeGapMap }` (below); the optional parameter keeps the unit test's `new GapService(cache, compute)` working. In the controller test, `brief` calls `clampScopeForUser` — if that function reaches Prisma for an ADMIN user, mock `../common` the way `usage.controller.test.ts` does rather than opening a database from a unit test.

```ts
// apps/api/src/gap/gap-brief.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAiModelOverrideStore, PrismaAiInferenceRecorder, type GapMapResult, type GapMapRow, type GapMapScope, type GapThresholds, type GapVerdict } from '@kku/db';
import {
  buildGapBriefMessages,
  createAiService,
  extractStructuredWithParseRetry,
  GAP_BRIEF_VERSION,
  GapBriefOutputSchema,
  lintBannedTells,
  type AiMessage,
  type AiProviderId,
  type AiService,
  type GapBriefInput,
  type GapBriefOutput,
} from '@kku/shared';
import { GapService } from './gap.service';

export type BriefVerdictFilter = 'all' | GapVerdict;

export interface GapBriefParams {
  scope: GapMapScope;
  scopeId: string | null;
  verdict: BriefVerdictFilter;
  facultyId: string | null;
  thresholds: GapThresholds;
  userId: string;
}

export interface GapBriefResponse {
  output: GapBriefOutput | null;
  rawText: string;
  model: string;
  aiInferenceId: string | null;
  tokens: { input: number; output: number };
  cost: { usd: number; model: string };
  methodologyVersion: string;
  confidence: number;
  /** Sources the panel lists — the same ids the map endpoint declares. */
  sources: Array<{ id: string; name: string }>;
  rowsBriefed: number;
}

export const GAP_MAP_SOURCES = [
  { id: 'jobthai', name: 'JobThai job postings (fields of study, occupations, provinces)' },
  { id: 'job-field-taxonomy', name: 'Field-of-study taxonomy (AI-clustered, admin-reviewed)' },
  { id: 'alumni-cohort-statuses', name: 'Registrar alumni cohorts (graduates per year)' },
  { id: 'student-cohort-distributions', name: 'Registrar active cohorts (pipeline)' },
  { id: 'kmitl-skill-mapping', name: 'LinkedIn labour-market skill growth · subscribed by MHESI (API hosted by KMITL)' },
  { id: 'trend-signals', name: 'Trends Radar signals' },
];

/** The rows the reader has on screen, in the order the page shows them. */
export function visibleRows(map: GapMapResult, verdict: BriefVerdictFilter, facultyId: string | null): GapMapRow[] {
  return map.rows.filter((r) => (verdict === 'all' || r.verdict === verdict) && (!facultyId || r.facultyIds.includes(facultyId)));
}

@Injectable()
export class GapBriefService implements OnModuleInit {
  private readonly logger = new Logger(GapBriefService.name);
  private ai!: AiService;

  constructor(private readonly config: ConfigService, private readonly gap: GapService) {}

  onModuleInit(): void {
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    this.ai = createAiService({
      recorder: new PrismaAiInferenceRecorder(),
      providerId: (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere: intelSphereUrl && intelSphereKey ? { url: intelSphereUrl, apiKey: intelSphereKey } : undefined,
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  private hasProvider(): boolean {
    return Boolean(this.config.get<string>('GOOGLE_AI_API_KEY') || this.config.get<string>('ANTHROPIC_API_KEY'));
  }

  async generate(params: GapBriefParams): Promise<GapBriefResponse> {
    const map = await this.gap.map({ scope: params.scope, scopeId: params.scopeId, thresholds: params.thresholds });
    const rows = visibleRows(map, params.verdict, params.facultyId).slice(0, 60);
    const base = { methodologyVersion: GAP_BRIEF_VERSION, sources: GAP_MAP_SOURCES, rowsBriefed: rows.length };
    if (!this.hasProvider() || rows.length === 0) {
      return {
        ...base,
        output: null,
        rawText: rows.length === 0 ? 'No rows in this view to brief.' : 'No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate a brief.',
        model: 'none',
        aiInferenceId: null,
        tokens: { input: 0, output: 0 },
        cost: { usd: 0, model: 'none' },
        confidence: 0,
      };
    }
    const facultyLabel = params.facultyId ? map.facultyStrip.find((f) => f.facultyId === params.facultyId)?.nameEn ?? null : null;
    const input: GapBriefInput = {
      view: { scopeLabel: map.scope.label ?? 'KKU (all faculties)', verdict: params.verdict, facultyLabel, thresholds: params.thresholds },
      rows: rows.map((r) => ({
        nameEn: r.nameEn,
        nameTh: r.nameTh,
        verdict: r.verdict,
        demandSharePct: r.demandShare * 100,
        supplySharePct: r.supplyShare * 100,
        ratio: r.ratio,
        gradsPerYear: r.gradsPerYear,
        pipelineArrow: r.pipelineArrow,
        postings: r.postings,
        topOccupations: r.occupations.slice(0, 3).map((o) => o.subcategory),
        risingSkills: r.globalSignal.skills.map((s) => `${s.nameEn} ↑ ${s.growthPct.toFixed(0)} %`),
        trendSignalTitles: r.trendSignals.map((s) => s.title),
      })),
      reconciliation: {
        fieldPostings: map.reconciliation.fieldPostings,
        anyFieldPostings: map.reconciliation.anyFieldPostings,
        otherMentions: map.reconciliation.otherMentions,
        proposedFields: map.taxonomy.proposed,
        approvedFields: map.taxonomy.approved,
      },
    };
    const messages = buildGapBriefMessages(input);
    const extractionParams = { ctx: { module: 'gap-analysis', kind: 'gap-brief', userId: params.userId }, methodVersion: GAP_BRIEF_VERSION, maxOutputTokens: 2500 };
    let response = await extractStructuredWithParseRetry(this.ai, { ...extractionParams, messages }, GapBriefOutputSchema, 'gap-brief');
    const violations = lintBannedTells(freeText(response.parsed));
    if (violations.length > 0) {
      const correction: AiMessage[] = [
        ...messages,
        { role: 'assistant', content: response.rawText },
        { role: 'user', content: `Your draft used banned phrase(s): ${violations.map((v) => `"${v.phrase}"`).join(', ')}. Rewrite the ENTIRE JSON without any of these words or their close paraphrases — same structure, same grounding rules.` },
      ];
      const retry = await extractStructuredWithParseRetry(this.ai, { ...extractionParams, messages: correction }, GapBriefOutputSchema, 'gap-brief');
      const still = lintBannedTells(freeText(retry.parsed));
      if (still.length > 0) this.logger.warn(`gap-brief banned-tell lint still failing after retry: ${still.map((v) => v.phrase).join(', ')}`);
      response = retry;
    }
    return {
      ...base,
      output: response.parsed,
      rawText: response.rawText,
      model: response.model,
      aiInferenceId: response.aiInferenceId,
      tokens: response.tokens,
      cost: response.cost,
      confidence: response.confidence,
    };
  }
}

function freeText(o: GapBriefOutput): string {
  return [...o.findings.flatMap((f) => [f.title, f.evidence, f.implication]), ...o.cannotTell, o.reasoning].join(' ');
}
```

```ts
// apps/api/src/gap/gap.controller.ts
import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { computeDqSkillLens, GAP_MAP_VERSION, prisma, ThresholdsSchema } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { AiCall, AiQuota, AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe, clampScopeForUser } from '../common';
import { GapBriefService, GAP_MAP_SOURCES } from './gap-brief.service';
import { GapService } from './gap.service';

// Gap Analyzer API — the demand-first map (gap-map.v1). Programme scope is not
// a map: the page redirects it to the Deep-Dive, and the api refuses it.

const ScopeSchema = z.enum(['university', 'faculty', 'department']);

export const MapQuery = z
  .object({
    scope: ScopeSchema.default('university'),
    scopeId: z.string().optional(),
  })
  .and(ThresholdsSchema);
type MapQueryT = z.infer<typeof MapQuery>;

export const BriefBody = z
  .object({
    scope: ScopeSchema.default('university'),
    scopeId: z.string().optional(),
    verdict: z.enum(['all', 'white-space', 'under-served', 'served', 'over-served', 'too-few-postings']).default('all'),
    facultyId: z.string().optional(),
  })
  .and(ThresholdsSchema);
type BriefBodyT = z.infer<typeof BriefBody>;

const DisagreementBody = z.object({
  aiInferenceId: z.string().optional(),
  bodyEn: z.string().max(4000).optional(),
  bodyTh: z.string().max(4000).optional(),
});

const MAP_CAVEATS = [
  'JobThai adverts are national and Bangkok-weighted (37 % Bangkok, 3.3 % Isan); they carry no salary and no posting date.',
  'Only adverts whose minimum education level admits a bachelor\'s graduate are counted; postgraduate programmes are listed but not scored.',
  'A programme assigned to two fields counts in both fields\' supply; the reconciliation line states how many.',
  'Proposed fields are shown before review; the provenance drawer states how many are unreviewed.',
];

@Controller('/gap')
export class GapController {
  constructor(private readonly gap: GapService, private readonly brief_: GapBriefService) {}

  private async clamp(q: { scope: 'university' | 'faculty' | 'department'; scopeId?: string }, user: SessionUser) {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    if (eff.scope === 'program') throw new NotFoundException('programme scope has no gap map');
    return { scope: eff.scope as 'university' | 'faculty' | 'department', scopeId: eff.scopeId };
  }

  @Get('map')
  @Authorized('programs:read:all')
  @Provenance({ sources: GAP_MAP_SOURCES, methodologyVersion: GAP_MAP_VERSION, caveats: MAP_CAVEATS })
  async map(@AuthSession() user: SessionUser, @Query(new ZodValidationPipe(MapQuery)) q: MapQueryT) {
    const eff = await this.clamp(q, user);
    return this.gap.map({ ...eff, thresholds: { under: q.under, over: q.over } });
  }

  @Get('map/fields/:slug')
  @Authorized('programs:read:all')
  @Provenance({ sources: GAP_MAP_SOURCES, methodologyVersion: GAP_MAP_VERSION, caveats: MAP_CAVEATS })
  async fieldDetail(@AuthSession() user: SessionUser, @Param('slug') slug: string, @Query(new ZodValidationPipe(MapQuery)) q: MapQueryT) {
    const eff = await this.clamp(q, user);
    const row = await this.gap.field({ ...eff, thresholds: { under: q.under, over: q.over }, slug });
    if (!row) throw new NotFoundException(`no field ${slug}`);
    return row;
  }

  @Post('brief')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 60, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'gap-analysis' })
  @AiCall({ module: 'gap-analysis' })
  async brief(@AuthSession() user: SessionUser, @Body(new ZodValidationPipe(BriefBody)) body: BriefBodyT) {
    const eff = await this.clamp(body, user);
    return this.brief_.generate({
      ...eff,
      verdict: body.verdict,
      facultyId: body.facultyId ?? null,
      thresholds: { under: body.under, over: body.over },
      userId: user.userId,
    });
  }

  @Post('brief/disagreements')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'gap_brief.disagreement', entityType: 'Annotation' })
  async disagree(@AuthSession() user: SessionUser, @Body(new ZodValidationPipe(DisagreementBody)) body: z.infer<typeof DisagreementBody>) {
    const data: Prisma.AnnotationUncheckedCreateInput = {
      userId: user.userId,
      entityType: 'gap-map',
      entityId: 'gap-brief',
      kind: 'disagreement',
      sectionKey: 'gap-brief',
      aiInferenceId: body.aiInferenceId,
      bodyEn: body.bodyEn,
      bodyTh: body.bodyTh,
    };
    return prisma.annotation.create({ data });
  }

  // Digital-competency attainment lens — unchanged; the page moved to
  // /education/digital-competency and still reads this server-side.
  @Get('digital-competency')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'kku-dq', name: 'KKU Digital Intelligence (DQ) test · LTIC' },
      { id: 'kmitl-skill-mapping', name: 'LinkedIn labour-market skill demand · subscribed by MHESI (API hosted by KMITL)' },
      { id: 'dq-module-skills', name: 'Curated DQ module → skill-taxonomy mapping' },
    ],
    methodologyVersion: 'dq-skill-lens.v1',
  })
  async digitalCompetency(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(z.object({ scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'), scopeId: z.string().optional() }))) q: { scope: 'university' | 'faculty' | 'department' | 'program'; scopeId?: string },
  ) {
    const eff = await clampScopeForUser(q.scope, q.scopeId ?? null, user);
    return computeDqSkillLens({ scope: eff.scope, scopeId: eff.scopeId ?? null });
  }
}
```

Check `apps/api/src/common/index.ts` exports `AuditLog` (it does — the JobThai controller imports it from there) and that `clampScopeForUser`'s `GenericScope` accepts the three values (it is the union used by the old controller's `FilterQuerySchema`, which included `'program'`; passing a narrower value is fine). If `Reflect.getMetadata(AI_CALL_META, …)` in the test needs the key exported, export `AI_CALL_META` from `decorators.ts` next to `PERMISSION_META`.

Add `'gap_brief.disagreement'` to `DELIBERATELY_OTHER` in `packages/shared/test/usage-action-coverage.test.ts` only if the coverage test fails on it; `program.disagreement` is already classified there — follow whichever family rule it uses.

```ts
// apps/api/src/gap/gap.module.ts
import { Module } from '@nestjs/common';
import { computeGapMap } from '@kku/db';
import { GapController } from './gap.controller';
import { GapBriefService } from './gap-brief.service';
import { COMPUTE_GAP_MAP, GapService } from './gap.service';

@Module({
  controllers: [GapController],
  providers: [GapService, GapBriefService, { provide: COMPUTE_GAP_MAP, useValue: computeGapMap }],
})
export class GapModule {}
```

Delete `apps/api/src/gap/gap-insights.service.ts` and `apps/api/test/gap-insights.test.ts`.

- [ ] **Step 7: Run tests, typecheck, and a live call**

```bash
pnpm --filter api exec vitest run test/gap-controller.test.ts
pnpm --filter api typecheck
pnpm --filter @kku/shared exec vitest run test/usage-action-coverage.test.ts
```

Expected: PASS; typecheck clean (the only remaining references to the deleted prompt are in `tool-executor.service.ts` / `decisions` — those still compile because `@kku/db` still exports the old functions until Task 11). Restart the api, sign in, and:

```bash
curl -s -H "Authorization: Bearer <token>" 'http://localhost:4000/api/v1/gap/map?scope=university' | head -c 600
```

Expected: an envelope with `data.rows`, `meta.methodologyVersion: "gap-map.v1"`, `meta.caveats` (4 entries), `meta.freshnessDate` non-null. A second call within 5 minutes is served from Redis (check the api log for one compute line, not two).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ai/prompts/gap-brief.ts packages/shared/src/ai/prompts/index.ts packages/shared/test/gap-brief-prompt.test.ts apps/api/src/gap apps/api/test/gap-controller.test.ts packages/shared/test/usage-action-coverage.test.ts
git rm -q apps/api/src/gap/gap-insights.service.ts apps/api/test/gap-insights.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-9.txt
```

Message: `feat(api): gap map endpoints, Council brief (gap-brief.v1), disagreements; old gap endpoints removed` + attribution.

---

### Task 10: The page `/gap-analysis`

**Files:**
- Rewrite: `apps/web/app/gap-analysis/page.tsx`, `apps/web/app/gap-analysis/types.ts`
- Create: `apps/web/app/gap-analysis/sections.tsx` (pure render), `apps/web/app/gap-analysis/controls.tsx` (server: chips, strip, thresholds as links + a GET form), `apps/web/app/gap-analysis/row-panels.tsx` (server: the three panels of an open row), `apps/web/app/gap-analysis/brief-panel.tsx` (client: RightPanel)
- Delete: `apps/web/app/gap-analysis/client.tsx`
- Rewrite as redirects: `apps/web/app/gap-analysis/opportunities/page.tsx`, `apps/web/app/gap-analysis/risks/page.tsx`, `apps/web/app/gap-analysis/digital-competency/page.tsx`
- Move: `apps/web/app/gap-analysis/digital-competency/page.tsx` → `apps/web/app/education/digital-competency/page.tsx` (git mv, then fix its `../types` import to `@/app/gap-analysis/types` and its back-link)
- Create: `apps/web/app/api/gap-map/fields/[slug]/route.ts`, `apps/web/app/api/gap-brief/route.ts`, `apps/web/app/api/gap-brief/disagreements/route.ts`
- Test: `apps/web/test/gap-map-render.test.tsx`

Design language (memory: evidence-page): the table is the quietest layer, verdicts and numbers are loud, absent data is grey and stated, caveats in `<details>`, tokens only. UI labels English; field names TH · EN as data labels. `<DataSourceMark source="jobthai">` in the header.

- [ ] **Step 1: Write `types.ts`**

Keep the existing DQ types (`DqLensDemandDto`, `DqSkillConfidenceDto`, `DqSkillLensResponse`, `DqSkillLensRowDto`) — the moved page imports them — and delete every other type. Add:

```ts
// apps/web/app/gap-analysis/types.ts  (append; keep the Dq* types above)
import type { ApiMeta } from '@kku/shared';

export type GapVerdictT = 'white-space' | 'under-served' | 'served' | 'over-served' | 'too-few-postings';
export const VERDICT_ORDER: readonly GapVerdictT[] = ['white-space', 'under-served', 'served', 'over-served', 'too-few-postings'];
export const VERDICT_LABEL: Record<GapVerdictT, string> = {
  'white-space': 'White space',
  'under-served': 'Under-served',
  served: 'Served',
  'over-served': 'Over-served',
  'too-few-postings': 'Too few postings',
};

export interface GapOccupationT { occupationId: string; code: string; category: string; subcategory: string; postings: number; linkedProgramIds: string[] }
export interface GapProgrammeT { programId: string; code: string; nameTh: string; nameEn: string; level: string; facultyId: string | null; facultyNameEn: string | null; gradsPerYear: number | null; supplySource: 'alumni' | 'enrolment-proxy' | null; pipeline: number | null; healthScore: number | null; scored: boolean; reviewStatus: 'PROPOSED' | 'APPROVED' }
export interface GapGlobalSignalT { skills: Array<{ skillId: string; nameEn: string; nameTh: string; growthPct: number }>; scope: 'THAILAND' | 'GLOBAL' | null }
export interface GapTrendSignalT { id: string; title: string; signalType: string; impactScore: number; detectedDate: string; matchedBy: 'programme' | 'initiative' }
export interface GapRowT {
  slug: string; nameTh: string; nameEn: string; reviewStatus: 'PROPOSED' | 'APPROVED';
  postings: number; demandShare: number; supplyShare: number; ratio: number | null; verdict: GapVerdictT;
  gradsPerYear: number | null; pipeline: number | null; pipelineArrow: 'up' | 'down' | 'flat' | null;
  programmeCount: number; signalCount: number;
  kkuTotal: { supplyShare: number; ratio: number | null; verdict: GapVerdictT } | null;
  provinces: Array<{ province: string; share: number }>;
  occupations: GapOccupationT[]; programmes: GapProgrammeT[]; facultyIds: string[];
  globalSignal: GapGlobalSignalT; trendSignals: GapTrendSignalT[];
}
export interface GapMapT {
  methodologyVersion: string; computedAt: string;
  scope: { level: 'university' | 'faculty' | 'department'; id: string | null; label: string | null };
  thresholds: { under: number; over: number };
  rows: GapRowT[];
  verdictCounts: Record<GapVerdictT, number>;
  facultyStrip: Array<{ facultyId: string; nameTh: string; nameEn: string; counts: Record<GapVerdictT, number> }>;
  reconciliation: { eligiblePostings: number; fieldPostings: number; anyFieldPostings: number; otherKinds: number; otherMentions: number; postgraduatePostings: number; demandShareSum: number; supplyShareSum: number; multiFieldProgrammes: number; gradsTotal: number };
  taxonomy: { approved: number; proposed: number };
  freshness: { postingsAsOf: string | null; taxonomyAsOf: string | null };
}

export interface GapPageParams {
  scope: 'university' | 'faculty' | 'department';
  scopeId: string | null;
  verdict: 'all' | GapVerdictT;
  facultyId: string | null;
  under: number;
  over: number;
  field: string | null;
}

/** URL → params. Bad thresholds fall back to defaults rather than 500 the page;
 *  the api validates the same values and the drawer echoes what is in force. */
export function resolveGapParams(sp: Record<string, string | undefined>): GapPageParams {
  const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  let under = num(sp.under, 0.5);
  let over = num(sp.over, 2);
  if (!(under < over)) { under = 0.5; over = 2; }
  const scope = sp.scope === 'faculty' || sp.scope === 'department' ? sp.scope : 'university';
  const verdict = (VERDICT_ORDER as readonly string[]).includes(sp.verdict ?? '') ? (sp.verdict as GapVerdictT) : 'all';
  return { scope, scopeId: sp.scopeId ?? null, verdict, facultyId: sp.faculty ?? null, under, over, field: sp.field ?? null };
}

export function gapHref(p: GapPageParams, patch: Partial<GapPageParams> = {}): string {
  const q = { ...p, ...patch };
  const s = new URLSearchParams();
  if (q.scope !== 'university') { s.set('scope', q.scope); if (q.scopeId) s.set('scopeId', q.scopeId); }
  if (q.verdict !== 'all') s.set('verdict', q.verdict);
  if (q.facultyId) s.set('faculty', q.facultyId);
  if (q.under !== 0.5) s.set('under', String(q.under));
  if (q.over !== 2) s.set('over', String(q.over));
  if (q.field) s.set('field', q.field);
  const qs = s.toString();
  return `/gap-analysis${qs ? `?${qs}` : ''}`;
}

export interface GapPageData {
  params: GapPageParams;
  map: GapMapT;
  meta: ApiMeta;
}
```

- [ ] **Step 2: Write the failing render test**

```tsx
// apps/web/test/gap-map-render.test.tsx
import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';
import { GapMapSections } from '../app/gap-analysis/sections';
import { gapHref, resolveGapParams, type GapMapT, type GapRowT } from '../app/gap-analysis/types';

const meta: ApiMeta = { freshnessDate: '2026-09-15T00:00:00Z', sources: [{ id: 'jobthai', name: 'JobThai' }], methodologyVersion: 'gap-map.v1', caveats: ['national adverts'] };

const row = (o: Partial<GapRowT>): GapRowT => ({
  slug: 'x', nameTh: 'ฟิลด์', nameEn: 'Field', reviewStatus: 'APPROVED', postings: 500, demandShare: 0.05, supplyShare: 0.05, ratio: 1, verdict: 'served',
  gradsPerYear: 100, pipeline: 400, pipelineArrow: 'flat', programmeCount: 1, signalCount: 0, kkuTotal: null, provinces: [{ province: 'กรุงเทพมหานคร', share: 0.6 }],
  occupations: [{ occupationId: 'o1', code: 'jobthai:x', category: 'Cat', subcategory: 'Occ A', postings: 300, linkedProgramIds: ['p1'] }],
  programmes: [{ programId: 'p1', code: 'KKU-SEQ-0001', nameTh: 'โปรแกรม', nameEn: 'Programme', level: 'BACHELOR', facultyId: 'f1', facultyNameEn: 'Engineering', gradsPerYear: 100, supplySource: 'alumni', pipeline: 400, healthScore: 71, scored: true, reviewStatus: 'APPROVED' }],
  facultyIds: ['f1'], globalSignal: { skills: [], scope: null }, trendSignals: [],
  ...o,
});

const map: GapMapT = {
  methodologyVersion: 'gap-map.v1', computedAt: '2026-09-15T00:00:00Z', scope: { level: 'university', id: null, label: null }, thresholds: { under: 0.5, over: 2 },
  rows: [
    row({ slug: 'logistics', nameEn: 'Logistics', nameTh: 'โลจิสติกส์', verdict: 'white-space', ratio: null, programmes: [], programmeCount: 0, gradsPerYear: null, pipeline: null, pipelineArrow: null, facultyIds: [], signalCount: 1, trendSignals: [{ id: 't1', title: 'EEC logistics hub', signalType: 'POLICY', impactScore: 0.8, detectedDate: '2026-08-01', matchedBy: 'initiative' }] }),
    row({ slug: 'electrical-engineering', nameEn: 'Electrical engineering', nameTh: 'วิศวกรรมไฟฟ้า', verdict: 'served', globalSignal: { skills: [{ skillId: 's1', nameEn: 'PLC programming', nameTh: 'พีแอลซี', growthPct: 41 }], scope: 'THAILAND' } }),
    row({ slug: 'geology', nameEn: 'Geology', nameTh: 'ธรณีวิทยา', verdict: 'too-few-postings', postings: 14, ratio: 2.9 }),
    row({ slug: 'unreviewed', nameEn: 'Unreviewed field', nameTh: 'ยังไม่ตรวจ', reviewStatus: 'PROPOSED', verdict: 'under-served', ratio: 0.3 }),
  ],
  verdictCounts: { 'white-space': 1, 'under-served': 1, served: 1, 'over-served': 0, 'too-few-postings': 1 },
  facultyStrip: [{ facultyId: 'f1', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', counts: { 'white-space': 0, 'under-served': 1, served: 2, 'over-served': 0, 'too-few-postings': 0 } }],
  reconciliation: { eligiblePostings: 33_307, fieldPostings: 20_000, anyFieldPostings: 2_566, otherKinds: 3_337, otherMentions: 2_900, postgraduatePostings: 41, demandShareSum: 1, supplyShareSum: 1.12, multiFieldProgrammes: 9, gradsTotal: 12_000 },
  taxonomy: { approved: 3, proposed: 1 },
  freshness: { postingsAsOf: '2026-09-13T00:00:00Z', taxonomyAsOf: '2026-09-15T00:00:00Z' },
};

const render = (params = resolveGapParams({})) =>
  renderToStaticMarkup(
    <TooltipProvider><ProvenanceProvider><GapMapSections data={{ params, map, meta }} /></ProvenanceProvider></TooltipProvider>,
  );
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('GapMapSections', () => {
  const html = render();
  const text = textOf(html);
  it('shows verdict chips with counts and the faculty strip', () => {
    expect(text).toMatch(/All\s*·\s*4/);
    expect(text).toMatch(/White space\s*·\s*1/);
    expect(text).toMatch(/Too few postings\s*·\s*1/);
    expect(text).toContain('Engineering');
  });
  it('renders every row with both names, shares, ratio and verdict; a white space has no ratio', () => {
    expect(text).toContain('โลจิสติกส์');
    expect(text).toContain('Logistics');
    expect(text).toContain('5.0 %');
    expect(html).toContain('data-verdict="white-space"');
    expect(text).toMatch(/Logistics[^]*?—/);
  });
  it('states too few postings instead of a verdict, and marks proposed rows unreviewed', () => {
    expect(text).toContain('too few postings (14)');
    expect(text).toContain('unreviewed');
  });
  it('filters rows by the verdict in the URL', () => {
    const t = textOf(render(resolveGapParams({ verdict: 'white-space' })));
    expect(t).toContain('Logistics');
    expect(t).not.toContain('Geology');
  });
  it('expands the row named in the URL with occupations, programmes and what is coming', () => {
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toContain('Occ A');
    expect(t).toContain('KKU-SEQ-0001');
    expect(t).toContain('PLC programming');
    expect(t).toContain('41 %');
    expect(t).toContain('LinkedIn data via MHESI');
  });
  it('states empty panels instead of hiding them', () => {
    const t = textOf(render(resolveGapParams({ field: 'logistics' })));
    expect(t).toMatch(/No KKU programme/i);
    expect(t).toMatch(/No rising skill/i);
    expect(t).toContain('EEC logistics hub');
  });
  it('shows the reconciliation line and provenance on the table', () => {
    expect(text).toContain('2,566');
    expect(text).toMatch(/9 programmes? .*two fields|two fields.*9/);
    expect(html).toContain('aria-label="Show provenance for Gap map"');
  });
});

describe('gapHref', () => {
  it('round-trips the URL contract and omits defaults', () => {
    const p = resolveGapParams({ scope: 'faculty', scopeId: 'f1', verdict: 'under-served', faculty: 'f1', under: '0.7', over: '3', field: 'x' });
    expect(gapHref(p)).toBe('/gap-analysis?scope=faculty&scopeId=f1&verdict=under-served&faculty=f1&under=0.7&over=3&field=x');
    expect(gapHref(resolveGapParams({}))).toBe('/gap-analysis');
    expect(resolveGapParams({ under: '3', over: '1' })).toMatchObject({ under: 0.5, over: 2 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run test/gap-map-render.test.tsx`
Expected: FAIL — cannot resolve `../app/gap-analysis/sections`.

- [ ] **Step 4: Write `sections.tsx` (pure), `controls.tsx`, `row-panels.tsx`, `brief-panel.tsx`**

```tsx
// apps/web/app/gap-analysis/sections.tsx
import * as React from 'react';
import Link from 'next/link';
import { Card, FreshnessBadge, ProvenanceButton } from '@kku/ui';
import { DataSourceMark } from '@/components/data-source-mark';
import { GapControls } from './controls';
import { RowPanels } from './row-panels';
import { BriefPanelTrigger } from './brief-panel';
import { VERDICT_LABEL, gapHref, type GapPageData, type GapRowT, type GapVerdictT } from './types';

// Pure function of GapPageData: everything below the PageHeader. The only
// client leaf is the brief panel; controls and row panels are server-rendered
// so the render test can assert on the whole page without a DOM or a router.

const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const int = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const ARROW = { up: '↑', down: '↓', flat: '→' } as const;

const VERDICT_TONE: Record<GapVerdictT, string> = {
  'white-space': 'text-danger font-semibold',
  'under-served': 'text-warning font-semibold',
  served: 'text-text-primary font-medium',
  'over-served': 'text-info font-semibold',
  'too-few-postings': 'text-text-tertiary',
};

export function visibleRows(rows: GapRowT[], verdict: 'all' | GapVerdictT, facultyId: string | null): GapRowT[] {
  return rows.filter((r) => (verdict === 'all' || r.verdict === verdict) && (!facultyId || r.facultyIds.includes(facultyId)));
}

export function GapMapSections({ data }: { data: GapPageData }): React.JSX.Element {
  const { params, map, meta } = data;
  const rows = visibleRows(map.rows, params.verdict, params.facultyId);
  const scopeNote = map.scope.level !== 'university' && map.scope.label
    ? `Supply narrowed to ${map.scope.label}; the KKU-total column shows the same field over the whole university.`
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
          <DataSourceMark source="jobthai" size={18} />
          <span>{map.reconciliation.eligiblePostings.toLocaleString('en-US')} eligible adverts · {map.rows.length} fields · {map.taxonomy.approved} approved / {map.taxonomy.proposed} proposed</span>
          <ProvenanceButton title="Gap map" meta={meta} />
          <FreshnessBadge freshnessDate={map.freshness.postingsAsOf} label="JobThai adverts" />
        </div>
        <div className="flex items-center gap-2">
          <BriefPanelTrigger params={params} />
        </div>
      </div>

      <GapControls params={params} verdictCounts={map.verdictCounts} total={map.rows.length} facultyStrip={map.facultyStrip} />

      {scopeNote && <p className="text-xs text-text-tertiary">{scopeNote}</p>}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="px-3 py-2 font-medium">Field of study</th>
              <th className="px-3 py-2 text-right font-medium">Demand share</th>
              <th className="px-3 py-2 text-right font-medium">KKU share</th>
              {map.scope.level !== 'university' && <th className="px-3 py-2 text-right font-medium">KKU total</th>}
              <th className="px-3 py-2 text-right font-medium">Ratio</th>
              <th className="px-3 py-2 text-right font-medium">Grads / yr</th>
              <th className="px-3 py-2 text-right font-medium">Pipeline</th>
              <th className="px-3 py-2 text-right font-medium">Programmes</th>
              <th className="px-3 py-2 text-right font-medium">Signals</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((r) => {
              const open = params.field === r.slug;
              return (
                <React.Fragment key={r.slug}>
                  <tr data-verdict={r.verdict} className={open ? 'bg-surface-2' : ''}>
                    <td className="px-3 py-2">
                      <Link href={gapHref(params, { field: open ? null : r.slug })} className="hover:underline">
                        <span aria-hidden className="mr-1 text-text-tertiary">{open ? '▾' : '▸'}</span>
                        <span lang="th">{r.nameTh}</span>
                        <span className="text-text-secondary"> · {r.nameEn}</span>
                      </Link>
                      {r.reviewStatus === 'PROPOSED' && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-tertiary">unreviewed</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-tabular">{pct(r.demandShare)}</td>
                    <td className="px-3 py-2 text-right font-tabular">{r.programmeCount === 0 ? <span className="text-text-tertiary">0 %</span> : pct(r.supplyShare)}</td>
                    {map.scope.level !== 'university' && (
                      <td className="px-3 py-2 text-right font-tabular text-text-secondary">{r.kkuTotal ? `${pct(r.kkuTotal.supplyShare)} · ${VERDICT_LABEL[r.kkuTotal.verdict].toLowerCase()}` : '—'}</td>
                    )}
                    <td className="px-3 py-2 text-right font-tabular">{r.ratio == null ? <span className="text-text-tertiary">—</span> : r.ratio.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-tabular">{r.gradsPerYear == null ? <span className="text-text-tertiary">—</span> : int(r.gradsPerYear)}</td>
                    <td className="px-3 py-2 text-right font-tabular">{r.pipeline == null ? <span className="text-text-tertiary">—</span> : <>{int(r.pipeline)} {r.pipelineArrow ? <span aria-label={`pipeline ${r.pipelineArrow}`}>{ARROW[r.pipelineArrow]}</span> : null}</>}</td>
                    <td className="px-3 py-2 text-right font-tabular">{r.programmeCount === 0 ? <span className="text-text-tertiary">—</span> : r.programmeCount}</td>
                    <td className="px-3 py-2 text-right font-tabular">{r.signalCount === 0 ? <span className="text-text-tertiary">0</span> : r.signalCount}</td>
                    <td className={`px-3 py-2 ${VERDICT_TONE[r.verdict]}`}>
                      {r.verdict === 'too-few-postings' ? `too few postings (${r.postings})` : VERDICT_LABEL[r.verdict]}
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-surface-2">
                      <td colSpan={map.scope.level !== 'university' ? 10 : 9} className="px-3 pb-4 pt-1">
                        <RowPanels row={r} meta={meta} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-text-tertiary">
                {map.rows.length === 0 ? 'No fields yet — the taxonomy has not been built. An admin runs pnpm jobthai:fields --apply after a JobThai upload.' : 'No field matches this verdict and faculty.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="space-y-1 text-xs text-text-tertiary">
        <p>
          Demand shares sum to 100 % of the {map.reconciliation.fieldPostings.toLocaleString('en-US')} eligible adverts naming a canonical field.
          Not assigned to a field: any field {map.reconciliation.anyFieldPostings.toLocaleString('en-US')} adverts · long-tail strings {map.reconciliation.otherKinds.toLocaleString('en-US')} kinds, {map.reconciliation.otherMentions.toLocaleString('en-US')} mentions.
        </p>
        <p>
          Supply shares sum to {pct(map.reconciliation.supplyShareSum)} of {int(map.reconciliation.gradsTotal)} graduates per year because {map.reconciliation.multiFieldProgrammes} programmes are assigned to two fields and count in each.
          Postgraduate programmes are listed but not scored ({map.reconciliation.postgraduatePostings} adverts state a postgraduate minimum).
        </p>
        <details>
          <summary className="cursor-pointer">Thresholds in force and the supply rule</summary>
          <p className="mt-1">Under-served below {map.thresholds.under}, over-served above {map.thresholds.over} (ratio = KKU share ÷ demand share). Graduates per year = the last five registrar cohorts ÷ 5, or the latest graduated-on-time figure where alumni rows are missing. Pipeline = students currently enrolled; the arrow compares pipeline ÷ 4 with graduates per year at ±25 %. Cached five minutes; computed {new Date(map.computedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>
        </details>
      </div>
    </div>
  );
}
```

```tsx
// apps/web/app/gap-analysis/controls.tsx
import * as React from 'react';
import Link from 'next/link';
import { VERDICT_LABEL, VERDICT_ORDER, gapHref, type GapMapT, type GapPageParams, type GapVerdictT } from './types';

// Every control is a link or a plain GET form, so the page needs no client
// JavaScript to filter, the state is the URL, and the render test can mount
// this without a Next router. Changing a filter closes any open row.

const GLYPH: Record<GapVerdictT, string> = { 'white-space': '⬜', 'under-served': '◔', served: '●', 'over-served': '◉', 'too-few-postings': '○' };
const INPUT = 'ml-1 w-16 rounded border border-default bg-surface-1 px-1 py-0.5 text-text-primary';

export function GapControls({ params, verdictCounts, total, facultyStrip }: {
  params: GapPageParams;
  verdictCounts: GapMapT['verdictCounts'];
  total: number;
  facultyStrip: GapMapT['facultyStrip'];
}): React.JSX.Element {
  const href = (patch: Partial<GapPageParams>) => gapHref(params, { ...patch, field: null });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={params.verdict === 'all'} href={href({ verdict: 'all' })}>All · {total}</Chip>
        {VERDICT_ORDER.map((v) => (
          <Chip key={v} active={params.verdict === v} href={href({ verdict: v })}>
            <span aria-hidden className="mr-1">{GLYPH[v]}</span>{VERDICT_LABEL[v]} · {verdictCounts[v]}
          </Chip>
        ))}
        <span className="flex-1" />
        <details className="text-xs">
          <summary className="cursor-pointer text-text-secondary">Thresholds ⚙ {params.under} / {params.over}</summary>
          <form method="get" action="/gap-analysis" className="mt-2 flex flex-wrap items-center gap-2">
            {params.scope !== 'university' && <input type="hidden" name="scope" value={params.scope} />}
            {params.scopeId && <input type="hidden" name="scopeId" value={params.scopeId} />}
            {params.verdict !== 'all' && <input type="hidden" name="verdict" value={params.verdict} />}
            {params.facultyId && <input type="hidden" name="faculty" value={params.facultyId} />}
            <label>Under-served below <input name="under" className={INPUT} defaultValue={String(params.under)} inputMode="decimal" /></label>
            <label>Over-served above <input name="over" className={INPUT} defaultValue={String(params.over)} inputMode="decimal" /></label>
            <button type="submit" className="rounded border border-default bg-surface-1 px-2 py-0.5">Apply</button>
            <Link href={href({ under: 0.5, over: 2 })} className="underline">Reset</Link>
          </form>
        </details>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {facultyStrip.map((f) => (
          <Link
            key={f.facultyId}
            href={href({ facultyId: params.facultyId === f.facultyId ? null : f.facultyId })}
            aria-pressed={params.facultyId === f.facultyId}
            className={`min-w-[140px] shrink-0 rounded border px-2 py-1 text-left text-xs ${params.facultyId === f.facultyId ? 'border-accent-default bg-accent-subtle' : 'border-default bg-surface-1'}`}
          >
            <div className="truncate font-medium">{f.nameEn}</div>
            <div className="text-text-tertiary">{VERDICT_ORDER.map((v) => `${GLYPH[v]}${f.counts[v]}`).join(' ')}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Link href={href} aria-pressed={active} className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-accent-default bg-accent-subtle font-semibold' : 'border-default bg-surface-1 text-text-secondary'}`}>
      {children}
    </Link>
  );
}
```

`resolveGapParams` already falls back to defaults when the GET form submits an invalid pair (Step 1), so a bad threshold never 500s the page.

```tsx
// apps/web/app/gap-analysis/row-panels.tsx
import * as React from 'react';
import Link from 'next/link';
import type { ApiMeta } from '@kku/shared';
import { FreshnessBadge, ProvenanceButton } from '@kku/ui';
import type { GapRowT } from './types';

// The three panels of an expanded row. Server-rendered from the row already
// in the page payload; no client fetch is needed because the map carries
// every row's panels. (The /api/gap-map/fields/[slug] proxy exists for the
// AI Analyst's evidence rail and for future incremental loads.)

const pct = (v: number) => `${(v * 100).toFixed(0)} %`;

export function RowPanels({ row, meta }: { row: GapRowT; meta: ApiMeta }): React.JSX.Element {
  const nameOf = new Map(row.programmes.map((p) => [p.programId, p.nameEn || p.nameTh]));
  return (
    <div className="grid gap-4 text-xs lg:grid-cols-[1.4fr_1fr_1fr]">
      <section>
        <Header title="Occupations asking for this field (JobThai)" meta={meta} freshness={null} />
        {row.occupations.length === 0 ? (
          <p className="text-text-tertiary">No occupation on eligible adverts names this field.</p>
        ) : (
          <ul className="space-y-1">
            {row.occupations.map((o) => (
              <li key={o.occupationId}>
                <span className="font-medium">{o.subcategory}</span> · {o.postings.toLocaleString('en-US')} adverts
                {o.linkedProgramIds.length > 0
                  ? <span className="text-text-secondary"> ← {o.linkedProgramIds.map((id) => nameOf.get(id) ?? id).slice(0, 3).join(', ')}</span>
                  : <span className="text-text-tertiary"> · no linked programme</span>}
              </li>
            ))}
          </ul>
        )}
        {row.provinces.length > 0 && (
          <p className="mt-2 text-text-tertiary">Provinces: {row.provinces.map((p) => `${pct(p.share)} ${p.province}`).join(' · ')}</p>
        )}
      </section>

      <section>
        <Header title="KKU programmes in this field" meta={meta} freshness={null} />
        {row.programmes.length === 0 ? (
          <p className="text-text-tertiary">No KKU programme is assigned to this field.</p>
        ) : (
          <ul className="space-y-1">
            {row.programmes.map((p) => (
              <li key={p.programId} className={p.scored ? '' : 'text-text-tertiary'}>
                <Link href={`/programs/${p.programId}`} className="font-medium hover:underline">{p.nameEn || p.nameTh}</Link>
                <span className="font-mono text-[10px] text-text-tertiary"> {p.code}</span>
                {p.facultyNameEn && <span className="text-text-tertiary"> · {p.facultyNameEn}</span>}
                <div className="text-text-secondary">
                  {p.gradsPerYear == null ? 'graduates —' : `${Math.round(p.gradsPerYear).toLocaleString('en-US')} grads/yr`}
                  {' · '}{p.pipeline == null ? 'pipeline —' : `${p.pipeline.toLocaleString('en-US')} enrolled`}
                  {' · '}{p.healthScore == null ? 'health —' : `health ${Math.round(p.healthScore)}`}
                  {!p.scored && <span> · {p.level !== 'BACHELOR' ? 'postgraduate, not scored' : 'outside scope'}</span>}
                  {p.reviewStatus === 'PROPOSED' && <span> · assignment unreviewed</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <Header title="What's coming" meta={meta} freshness={null} />
        <p className="font-medium">Global signal <span className="font-normal text-text-tertiary">(LinkedIn data via MHESI{row.globalSignal.scope ? `, ${row.globalSignal.scope === 'THAILAND' ? 'Thailand' : 'global'} series` : ''})</span></p>
        {row.globalSignal.skills.length === 0 ? (
          <p className="text-text-tertiary">No rising skill among this field's occupations intersects the LinkedIn growth series.</p>
        ) : (
          <ul>{row.globalSignal.skills.map((s) => <li key={s.skillId}>{s.nameEn} ↑ {s.growthPct.toFixed(0)} %</li>)}</ul>
        )}
        <p className="mt-2 font-medium">Trend signals</p>
        {row.trendSignals.length === 0 ? (
          <p className="text-text-tertiary">No Trends Radar signal names this field's programmes or occupations.</p>
        ) : (
          <ul>{row.trendSignals.map((s) => (
            <li key={s.id}><Link href={`/trends/${s.id}`} className="hover:underline">{s.title}</Link> <span className="text-text-tertiary">· {s.signalType.toLowerCase()} · impact {s.impactScore.toFixed(1)} · {s.matchedBy === 'initiative' ? 'names an occupation' : 'names a programme'}</span></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}

function Header({ title, meta, freshness }: { title: string; meta: ApiMeta; freshness: string | null }): React.JSX.Element {
  return (
    <div className="mb-1 flex items-center gap-2">
      <h4 className="text-[11px] uppercase tracking-wide text-text-tertiary">{title}</h4>
      <ProvenanceButton title={title} meta={meta} size="xs" />
      {freshness && <FreshnessBadge freshnessDate={freshness} />}
    </div>
  );
}
```

```tsx
// apps/web/app/gap-analysis/brief-panel.tsx
'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button, ConfidenceBadge, RightPanel } from '@kku/ui';
import type { GapPageParams } from './types';

interface BriefT {
  output: { findings: Array<{ title: string; fieldNameEn: string; verdict: string; evidence: string; implication: string }>; cannotTell: string[]; confidence: number; reasoning: string } | null;
  rawText: string;
  model: string;
  aiInferenceId: string | null;
  confidence: number;
  methodologyVersion: string;
  sources: Array<{ id: string; name: string }>;
  rowsBriefed: number;
}

export function BriefPanelTrigger({ params }: { params: GapPageParams }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [brief, setBrief] = React.useState<BriefT | null>(null);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const [disagree, setDisagree] = React.useState('');

  async function generate(): Promise<void> {
    setBusy(true);
    setOpen(true);
    try {
      const res = await fetch('/api/gap-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: params.scope, scopeId: params.scopeId ?? undefined, verdict: params.verdict, facultyId: params.facultyId ?? undefined, under: params.under, over: params.over }),
      });
      const j = (await res.json()) as { data?: BriefT; error?: { message?: string } };
      if (!res.ok || !j.data) { toast.error(j.error?.message ?? 'The brief could not be generated.'); return; }
      setBrief(j.data);
    } finally {
      setBusy(false);
    }
  }

  async function sendDisagreement(): Promise<void> {
    if (!disagree.trim() || !brief) return;
    const res = await fetch('/api/gap-brief/disagreements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiInferenceId: brief.aiInferenceId ?? undefined, bodyEn: disagree.trim() }),
    });
    if (res.ok) { toast.success('Disagreement recorded'); setDisagree(''); } else toast.error('Could not record the disagreement.');
  }

  return (
    <>
      <Button size="sm" onClick={generate} disabled={busy}>{busy ? 'Writing…' : 'Council brief ✦'}</Button>
      <RightPanel open={open} onOpenChange={setOpen} title="Council brief — gap map">
        {!brief && <p className="text-sm text-text-tertiary">{busy ? 'Reading the rows on screen…' : 'Generate a brief to see it here.'}</p>}
        {brief && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceBadge value={brief.confidence} rationale={brief.output?.reasoning} />
              <span className="text-xs text-text-tertiary">{brief.rowsBriefed} rows · {brief.methodologyVersion} · {brief.model}</span>
            </div>
            {!brief.output && <p className="text-text-secondary">{brief.rawText}</p>}
            {brief.output?.findings.map((f, i) => (
              <div key={i} className="rounded border border-default p-3">
                <div className="font-medium">{f.title}</div>
                <div className="text-xs text-text-tertiary">{f.fieldNameEn} · {f.verdict}</div>
                <p className="mt-1 text-text-secondary">{f.evidence}</p>
                <p className="mt-1">{f.implication}</p>
              </div>
            ))}
            {brief.output && brief.output.cannotTell.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-text-tertiary">What this data cannot tell</div>
                <ul className="list-disc pl-4 text-text-secondary">{brief.output.cannotTell.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wide text-text-tertiary">Sources</div>
              <ul className="text-xs text-text-secondary">{brief.sources.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
            </div>
            {brief.output && (
              <button type="button" className="text-xs underline" onClick={() => setShowReasoning((s) => !s)}>{showReasoning ? 'Hide reasoning' : 'Show reasoning'}</button>
            )}
            {showReasoning && brief.output && <p className="text-xs text-text-secondary">{brief.output.reasoning}</p>}
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-text-tertiary">Disagree</div>
              <textarea className="w-full rounded border border-default bg-surface-1 p-2 text-xs" rows={3} value={disagree} onChange={(e) => setDisagree(e.target.value)} placeholder="What is wrong, and what the numbers should say" />
              <Button size="sm" variant="ghost" onClick={sendDisagreement} disabled={!disagree.trim()}>Send disagreement</Button>
            </div>
          </div>
        )}
      </RightPanel>
    </>
  );
}
```

- [ ] **Step 5: Write `page.tsx`, the proxies and the redirects; move the DQ page**

```tsx
// apps/web/app/gap-analysis/page.tsx
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ApiSuccess, SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchEnvelope, apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { GapMapSections } from './sections';
import { resolveGapParams, type GapMapT } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gap Analyzer' };

export default async function GapAnalysisPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const sp = await searchParams;
  // Programme scope is the Deep-Dive's job (spec §4).
  if (sp.scope === 'program' && sp.scopeId) redirect(`/programs/${sp.scopeId}`);
  const params = resolveGapParams(sp);

  const qs = new URLSearchParams({ scope: params.scope, under: String(params.under), over: String(params.over) });
  if (params.scopeId) qs.set('scopeId', params.scopeId);

  // apiFetchEnvelope carries meta (the provenance drawer needs it) and throws
  // on failure; the failure arm re-fetches through apiFetchSafe, whose typed
  // error is what DiagnosticEmptyState renders.
  let page: ReactNode;
  try {
    const env = (await apiFetchEnvelope<GapMapT>(`/gap/map?${qs}`)) as ApiSuccess<GapMapT>;
    page = <GapMapSections data={{ params, map: env.data, meta: env.meta }} />;
  } catch {
    const safe = await apiFetchSafe<GapMapT>(`/gap/map?${qs}`);
    page = <DiagnosticEmptyState surface="gap map" error={safe.ok ? null : safe.error} />;
  }

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Gap Analyzer — which parts of the labour market does KKU serve?"
        subtitle="One row per field of study that employers ask for. Demand share from JobThai adverts; KKU share from graduates per year; the verdict compares the two. Open a row for the occupations, the programmes and what is coming."
      />
      {page}
    </AuthedAppShell>
  );
}
```

```ts
// apps/web/app/api/gap-map/fields/[slug]/route.ts
import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { slug } = await params;
  const url = new URL(req.url);
  const row = await apiFetch(`/gap/map/fields/${encodeURIComponent(slug)}?${url.searchParams.toString()}`);
  return NextResponse.json({ data: row });
}
```

```ts
// apps/web/app/api/gap-brief/route.ts
import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await apiFetch('/gap/brief', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } }, { status: 502 });
  }
}
```

`apps/web/app/api/gap-brief/disagreements/route.ts` is identical with the path `/gap/brief/disagreements`.

Redirects (each file's whole content):

```tsx
// apps/web/app/gap-analysis/opportunities/page.tsx
import { redirect } from 'next/navigation';

// Opportunities are the white-space chip of the gap map (spec §5).
export default async function OpportunitiesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ verdict: 'white-space' });
  if (sp.scope) q.set('scope', sp.scope);
  if (sp.scopeId) q.set('scopeId', sp.scopeId);
  redirect(`/gap-analysis?${q}`);
}
```

```tsx
// apps/web/app/gap-analysis/risks/page.tsx
import { redirect } from 'next/navigation';

// The risk register owns programme risk; the old gap "risks" tab is retired.
export default function RisksRedirect() {
  redirect('/risks');
}
```

```bash
git mv apps/web/app/gap-analysis/digital-competency/page.tsx apps/web/app/education/digital-competency/page.tsx
```

In the moved file change `from '../types'` to `from '@/app/gap-analysis/types'`, and any back-link to `/gap-analysis` in its header to `/education`. Then create the redirect:

```tsx
// apps/web/app/gap-analysis/digital-competency/page.tsx
import { redirect } from 'next/navigation';

export default async function DigitalCompetencyRedirect({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.scope) q.set('scope', sp.scope);
  if (sp.scopeId) q.set('scopeId', sp.scopeId);
  const qs = q.toString();
  redirect(`/education/digital-competency${qs ? `?${qs}` : ''}`);
}
```

Delete `apps/web/app/gap-analysis/client.tsx`. Grep `apps/web` for `gap-analysis/digital-competency` and `gap-analysis/opportunities` (nav, deep-dive links, admin topology) and point them at the new paths.

- [ ] **Step 6: Run tests, typecheck, and look at it**

```bash
pnpm --filter web exec vitest run test/gap-map-render.test.tsx
pnpm --filter web typecheck
pnpm --filter web lint 2>/dev/null || pnpm eslint 'apps/web/app/gap-analysis/**/*.tsx'
```

Expected: PASS; typecheck clean; no colour-literal lint errors. Sign in and open, in this order, reading each as a user: `/gap-analysis`, `/gap-analysis?verdict=white-space`, `/gap-analysis?field=<a slug from the table>`, `/gap-analysis?scope=faculty&scopeId=<id>` (KKU-total column appears), `/gap-analysis/opportunities` (lands on the white-space chip), `/gap-analysis/risks` (lands on /risks), `/education/digital-competency` (renders as before). Press "Council brief" once: the panel shows confidence, findings, sources; the api log shows one `AiInference` row. Check adjacent numbers read as separate tokens (memory: text-readability) — `340 · 1,290 →` must not collapse.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/gap-analysis apps/web/app/education/digital-competency apps/web/app/api/gap-map apps/web/app/api/gap-brief apps/web/test/gap-map-render.test.tsx
git rm -q apps/web/app/gap-analysis/client.tsx
git add -u apps/web
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-10.txt
```

(`git add -u apps/web` stages the moved/modified files under apps/web only; the three untracked root files are untouched.)

Message: `feat(web): /gap-analysis rebuilt as the demand-first field map; redirects for the old sub-pages` + attribution.

---

### Task 11: Re-point the AI Analyst and decision snapshots; retire the old gap code; manifest

**Files:**
- Modify: `packages/shared/src/analyst/tools.ts:17,71-79,332-350` (`QueryGapsInputSchema`, the Gemini JSON copy, `ANALYST_TOOLS_VERSION`)
- Modify: `apps/api/src/analyst/tool-executor.service.ts:257-266`
- Modify: `packages/db/src/decisions.ts:116-160`, `apps/api/src/decisions/decision-review.service.ts:91-114,216-228`
- Modify: `packages/db/src/gap-analysis.ts` (shrink to `computeProgramDemandGaps` + what it needs)
- Delete: `packages/db/src/gap-lenses.ts`, `packages/db/test/gap-analysis.test.ts`, `packages/shared/src/ai/prompts/gap-insights.ts`
- Modify: `packages/db/src/index.ts` (drop the `gap-lenses` export), `packages/shared/src/ai/prompts/index.ts` (drop `gap-insights`)
- Modify: `packages/db/src/methodology-bundle.ts:38,67-73,111,139-140`, `packages/db/test/methodology-bundle.test.ts:81-`
- Test: `apps/api/test/analyst-tool-executor.test.ts` (extend), `packages/db/test/decisions.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/analyst-tool-executor.test.ts`:

```ts
describe('AnalystToolExecutor — query_gaps (gap map)', () => {
  it('rejects the retired dimensions and accepts the verdict ones', async () => {
    const exec = new AnalystToolExecutor();
    for (const dimension of ['skills', 'occupations', 'sectors', 'risks', 'opportunities']) {
      const parsed = JSON.parse(await exec.execute({ id: 'c1', name: 'query_gaps', input: { dimension } })) as { error?: string };
      expect(parsed.error).toBeTruthy();
    }
    expect(QueryGapsInputSchema.safeParse({ dimension: 'white-space' }).success).toBe(true);
    expect(QueryGapsInputSchema.safeParse({ dimension: 'map', scope: 'program', scopeId: 'p1' }).success).toBe(false);
  });
});
```

(Import `QueryGapsInputSchema` from `@kku/shared` at the top of the test file.)

Append to `packages/db/test/decisions.test.ts`:

```ts
import { summariseSnapshotGap } from '../src/decisions';

describe('summariseSnapshotGap', () => {
  it('reads a gap-map snapshot', () => {
    expect(summariseSnapshotGap({ gapMap: { verdictCounts: { 'white-space': 2, 'under-served': 3, served: 10, 'over-served': 1, 'too-few-postings': 4 }, topWhiteSpaces: [{ nameEn: 'Logistics', demandSharePct: 4.8 }], methodologyVersion: 'gap-map.v1' } }))
      .toBe('gap map: 2 white spaces, 3 under-served, 10 served, 1 over-served (4 without a verdict); top white spaces: Logistics (4.8 %)');
  });
  it('still reads a pre-v1.9.7 skill-gap snapshot', () => {
    expect(summariseSnapshotGap({ topSkillGaps: { rows: [{ gap: 5, nameEn: 'Python' }, { gap: 3, nameEn: 'SQL' }] } }))
      .toBe('2 skill gaps; top 3: Python, SQL');
  });
  it('states missing data', () => {
    expect(summariseSnapshotGap({})).toBe('(no data)');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm --filter api exec vitest run test/analyst-tool-executor.test.ts
pnpm --filter @kku/db exec vitest run test/decisions.test.ts
```

Expected: FAIL — the old dimensions still parse; `summariseSnapshotGap` is not exported.

- [ ] **Step 3: Re-point the analyst tool**

In `packages/shared/src/analyst/tools.ts`:

```ts
export const ANALYST_TOOLS_VERSION = 'analyst-tools.v2';
```

Replace the `query_gaps` block (lines 71–79):

```ts
// ── 5. query_gaps ───────────────────────────────────────────────────
// The demand-first gap map (gap-map.v1). `dimension` selects a verdict
// filter; 'map' returns every field. Programme scope has no map.
export const QueryGapsInputSchema = z.object({
  dimension: z.enum(['map', 'white-space', 'under-served', 'served', 'over-served']),
  scope: z.enum(['university', 'faculty', 'department']).default('university'),
  scopeId: z.string().optional(),
  under: z.number().positive().default(0.5),
  over: z.number().positive().default(2),
  limit: z.number().int().min(1).max(50).default(20),
}).refine((q) => q.under < q.over, { message: 'under must be less than over' });
export type QueryGapsInput = z.infer<typeof QueryGapsInputSchema>;
```

Replace the Gemini JSON copy (lines 332–350):

```ts
  {
    name: 'query_gaps',
    description: 'Demand-first gap map: one row per field of study employers ask for (JobThai), with KKU\'s supply share and a verdict. Dimensions: "map" (all fields), "white-space" (no KKU programme), "under-served", "served", "over-served". Shares are of eligible bachelor-level adverts and of graduates per year; thresholds default 0.5 / 2.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: { type: 'string', enum: ['map', 'white-space', 'under-served', 'served', 'over-served'] },
        scope: { type: 'string', enum: ['university', 'faculty', 'department'], default: 'university' },
        scopeId: { type: 'string' },
        under: { type: 'number', minimum: 0, description: 'Under-served below this ratio (default 0.5).', default: 0.5 },
        over: { type: 'number', minimum: 0, description: 'Over-served above this ratio (default 2).', default: 2 },
        limit: { type: 'number', minimum: 1, maximum: 50, default: 20 },
      },
      required: ['dimension'],
    },
  },
```

Check the Anthropic tool list in the same file (if it is derived from the Gemini copy, nothing else changes; if it is a separate array, mirror the block there too).

In `apps/api/src/analyst/tool-executor.service.ts` replace lines 257–266:

```ts
    query_gaps: async (input) => {
      const q = QueryGapsInputSchema.parse(input);
      const map = await computeGapMap({ scope: q.scope, scopeId: q.scopeId ?? null, thresholds: { under: q.under, over: q.over } });
      const rows = map.rows
        .filter((r) => q.dimension === 'map' || r.verdict === q.dimension)
        .slice(0, q.limit)
        .map((r) => ({
          slug: r.slug,
          nameEn: r.nameEn,
          nameTh: r.nameTh,
          verdict: r.verdict,
          demandSharePct: Math.round(r.demandShare * 1000) / 10,
          supplySharePct: Math.round(r.supplyShare * 1000) / 10,
          ratio: r.ratio,
          gradsPerYear: r.gradsPerYear,
          pipelineArrow: r.pipelineArrow,
          postings: r.postings,
          programmeCount: r.programmeCount,
          programmes: r.programmes.slice(0, 5).map((p) => ({ programId: p.programId, code: p.code, nameEn: p.nameEn })),
          unreviewed: r.reviewStatus === 'PROPOSED',
        }));
      return {
        methodologyVersion: map.methodologyVersion,
        thresholds: map.thresholds,
        verdictCounts: map.verdictCounts,
        reconciliation: map.reconciliation,
        rows,
      };
    },
```

Update the file's `@kku/db` import: add `computeGapMap`, remove `computeSkillGap`, `computeOccupationGap`, `computeSectorGap`, `computeRisks`, `computeOpportunities`. If `ANALYST_SYSTEM_PROMPT` in `tools.ts` describes `query_gaps` dimensions, reword that sentence to the new ones and bump `ANALYST_SYSTEM_PROMPT_VERSION` too.

- [ ] **Step 4: Re-point decision snapshots (back-compatible)**

In `packages/db/src/decisions.ts` replace lines 116–160:

```ts
export interface DecisionSnapshotGapMap {
  verdictCounts: Record<string, number>;
  topWhiteSpaces: Array<{ nameEn: string; demandSharePct: number }>;
  methodologyVersion: string;
}

export interface DecisionSnapshot {
  capturedAt: string;
  scope: { affectedProgramIds: string[]; facultyId: string | null };
  health: unknown;
  /** Pre-v1.9.7 snapshots carry the old risk + skill-gap payloads; new ones carry gapMap. */
  risks: unknown;
  topSkillGaps: unknown;
  gapMap: DecisionSnapshotGapMap | null;
  recentTrendCount: number;
  methodologyVersion: typeof DECISION_WORKSPACE_VERSION;
}

/** One line for the outcome-review prompt, from either snapshot generation. */
export function summariseSnapshotGap(s: { gapMap?: DecisionSnapshotGapMap | null; topSkillGaps?: unknown }): string {
  if (s.gapMap) {
    const c = s.gapMap.verdictCounts;
    const top = s.gapMap.topWhiteSpaces.map((w) => `${w.nameEn} (${w.demandSharePct.toFixed(1)} %)`).join(', ');
    return `gap map: ${c['white-space'] ?? 0} white spaces, ${c['under-served'] ?? 0} under-served, ${c.served ?? 0} served, ${c['over-served'] ?? 0} over-served (${c['too-few-postings'] ?? 0} without a verdict); top white spaces: ${top || '(none)'}`;
  }
  const gaps = s.topSkillGaps;
  if (!gaps || typeof gaps !== 'object' || !('rows' in (gaps as object))) return '(no data)';
  const g = gaps as { rows: Array<{ gap: number; nameEn: string }> };
  const top = g.rows.slice(0, 3).map((x) => x.nameEn).join(', ');
  return `${g.rows.length} skill gaps; top 3: ${top || '(none)'}`;
}

export async function snapshotGapMap(scope: 'university' | 'faculty', scopeId: string | null): Promise<DecisionSnapshotGapMap> {
  const map = await computeGapMap({ scope, scopeId, thresholds: DEFAULT_GAP_THRESHOLDS });
  return {
    verdictCounts: map.verdictCounts,
    topWhiteSpaces: map.rows.filter((r) => r.verdict === 'white-space').slice(0, 5).map((r) => ({ nameEn: r.nameEn, demandSharePct: Math.round(r.demandShare * 1000) / 10 })),
    methodologyVersion: map.methodologyVersion,
  };
}

export async function captureSnapshot(decisionId: string, force = false): Promise<DecisionSnapshot> {
  const decision = await prisma.councilDecision.findUniqueOrThrow({
    where: { id: decisionId },
    select: { affectedProgramIds: true, facultyId: true, snapshotJson: true },
  });
  if (decision.snapshotJson && !force) {
    return decision.snapshotJson as unknown as DecisionSnapshot;
  }
  const scope = decision.facultyId ? 'faculty' : 'university';
  const scopeId = decision.facultyId ?? null;
  const [health, gapMap, recentTrendCount] = await Promise.all([
    computeHealthScores(scope, scopeId),
    snapshotGapMap(scope, scopeId),
    prisma.trendSignal.count({
      where: {
        detectedDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        OR: decision.affectedProgramIds.length > 0 ? [{ affectedProgramIds: { hasSome: decision.affectedProgramIds } }] : undefined,
      },
    }),
  ]);
  const snapshot: DecisionSnapshot = {
    capturedAt: new Date().toISOString(),
    scope: { affectedProgramIds: decision.affectedProgramIds, facultyId: decision.facultyId },
    health,
    risks: null,
    topSkillGaps: null,
    gapMap,
    recentTrendCount,
    methodologyVersion: DECISION_WORKSPACE_VERSION,
  };
```

(the `prisma.councilDecision.update` that follows is unchanged). Update the file's imports: add `computeGapMap` from `./gap-map` and `DEFAULT_GAP_THRESHOLDS` from `./gap-map-rules`; remove `computeRisks`, `computeSkillGap`. If `decisions.ts` is imported by `gap-map.ts` transitively (it is not today), break the cycle by importing the map lazily; run `pnpm --filter @kku/db exec vitest run test/decisions.test.ts` — a TDZ error on import means a cycle.

In `apps/api/src/decisions/decision-review.service.ts` replace lines 91–96 and the two `summarise*` helpers at 216–228:

```ts
    // Recompute current state.
    const [currentHealth, currentGapMap] = await Promise.all([
      computeHealthScores(scope, scopeId ?? null),
      snapshotGapMap(scope, scopeId ?? null),
    ]);
```

and in the `input` literal use `riskSummary: '(risk register — see /risks)'` for both snapshot and current, `topSkillGapsSummary: summariseSnapshotGap(snapshot)` and `topSkillGapsSummary: summariseSnapshotGap({ gapMap: currentGapMap })`. Delete `summariseRisks` and `summariseGaps`; import `snapshotGapMap`, `summariseSnapshotGap` from `@kku/db`; drop `computeRisks`, `computeSkillGap` from the import. The `decision-review` prompt's input field names are unchanged, so its version does not bump.

- [ ] **Step 5: Retire the old code**

```bash
git rm -q packages/db/src/gap-lenses.ts packages/db/test/gap-analysis.test.ts packages/shared/src/ai/prompts/gap-insights.ts
```

Remove `export * from './gap-lenses';` from `packages/db/src/index.ts` and `export * from './gap-insights';` from `packages/shared/src/ai/prompts/index.ts`.

In `packages/db/src/gap-analysis.ts` delete `computeSkillGap`, `resolveDemandSource`, `fetchDemandRows`, `computeOccupationGap`, `computeSectorGap`, `computeRegionalGap`, `computeOpportunities`, `computeRisks`, `computeForecastAccuracy`, `programIdsForScope`, `totalStudentsInScope`, `regionFilterClause`, `forecastDemandForOccupation`, `approximateOccupationSupply`, their result interfaces, and the `FORECASTING_VERSION` / `ForecastResult` / `TimePoint` re-exports. Keep `GAP_ANALYSIS_VERSION`, `GapFilterSchema` / `GapFilter` / `GapFilterInput` (drop the `horizon`, `comparison`, `demandSource` fields; keep `scope`, `scopeId`, `region`, `limit`, `excludeSoftSkills`), `isSoftSkill` if still referenced, and `computeProgramDemandGaps` with its interfaces. Change its scope line to:

```ts
  const programIds = (await scopeProgramIds(f.scope === 'program' ? 'university' : f.scope, f.scopeId ?? null)) ?? [];
  const scopedIds = f.scope === 'program' && f.scopeId ? [f.scopeId] : programIds;
```

and use `scopedIds` where `programIds` was used (import `scopeProgramIds` from `./gap-map`). Update the header comment: the file now holds only the per-programme LinkedIn demand-gap helper, kept for the AI Analyst's evidence and a future Deep-Dive card. Grep the repo for every deleted name (`computeSkillGap`, `computeRisks`, `computeGapAnalysis`, `GapInsightsService`, `buildGapInsightsMessages`, `GAP_INSIGHTS_VERSION`, `computeSectorGap`, `computeOpportunities`, `computeOccupationGap`, `computeRegionalGap`, `computeForecastAccuracy`, `programIdsForScope`) — after this task the only hits must be in docs and this plan. `packages/shared/src/ai/prompts/trend-signal-analysis.ts:309` mentions `computeSkillGap` in a comment; reword it to "the gap map (`computeGapMap`)".

- [ ] **Step 6: Manifest**

In `packages/db/src/methodology-bundle.ts`: import `GAP_MAP_VERSION` from `./gap-map-rules`; add `GAP_BRIEF_VERSION`, `JOB_FIELD_TAXONOMY_VERSION`, `PROGRAM_JOB_FIELD_VERSION` to the `@kku/shared` import and remove `GAP_INSIGHTS_VERSION`; in `METHODOLOGY_MANIFEST` replace the `'gap-insights'` line with, keeping alphabetical order:

```ts
  // Demand-first gap map: the verdict rule Council reads on /gap-analysis.
  'gap-map':                   GAP_MAP_VERSION,
  'gap-brief':                 GAP_BRIEF_VERSION,
  // The field-of-study taxonomy the map's rows come from — a prompt bump
  // re-clusters demand, so it moves Council figures.
  'job-field-taxonomy':        JOB_FIELD_TAXONOMY_VERSION,
  'program-job-field':         PROGRAM_JOB_FIELD_VERSION,
```

Keep `'gap-analysis': GAP_ANALYSIS_VERSION` (the per-programme demand-gap helper survives). Bump `BUNDLE_CALENDAR_TAG` to `'landscape-2026-09.v4'`. In `packages/db/test/methodology-bundle.test.ts` add to the drift catcher:

```ts
    expect(METHODOLOGY_MANIFEST['gap-map']).toBe(GAP_MAP_VERSION);
    expect(METHODOLOGY_MANIFEST['gap-brief']).toBe(GAP_BRIEF_VERSION);
    expect(METHODOLOGY_MANIFEST['job-field-taxonomy']).toBe(JOB_FIELD_TAXONOMY_VERSION);
    expect(METHODOLOGY_MANIFEST['program-job-field']).toBe(PROGRAM_JOB_FIELD_VERSION);
```

with matching imports, and remove the `gap-insights` assertion if present. If the test pins a fingerprint or the calendar tag, update it to the new values the test prints.

- [ ] **Step 7: Run the whole check**

```bash
pnpm typecheck
pnpm --filter @kku/db exec vitest run
pnpm --filter @kku/shared exec vitest run
pnpm --filter api exec vitest run
pnpm --filter web exec vitest run
pnpm --filter ingestion exec vitest run
```

Expected: typecheck clean across the workspace; every suite PASS; compare the test-file count of each package against the previous run (`git stash` is forbidden — compare against the counts printed on the last green commit's CI or run the suites on `HEAD~1` in a worktree) so no suite silently shrank beyond the two deleted files.

- [ ] **Step 8: Commit**

```bash
git add -u packages/db packages/shared apps/api
git add packages/db/test/decisions.test.ts apps/api/test/analyst-tool-executor.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-11.txt
```

Message: `refactor(gap): analyst query_gaps and decision snapshots read the gap map; seven-lens analyzer, skill-gap and gap-insights retired; manifest gains gap-map` + attribution.

---

### Task 12: Documentation, topology, changelog, release audit

**Files:**
- Create: `docs/methodologies/gap-map.md`
- Modify: `docs/methodologies/README.md` (table), `docs/data-sources/jobthai.md` (Runbook + a new "Field taxonomy" section before Readiness), `docs/evaluation-pipeline.md` (the surface map + the AI-prompt table), `apps/web/app/docs/methodology/content-en.tsx` and `content-th.tsx` (new §4.8 + Appendix A rows), `apps/web/app/admin/application-topology/topology-data.ts` (four nodes), `apps/web/app/changelog/page.tsx` (v1.9.7 entry), `CLAUDE.md` ("Current status" + a decisions entry)

- [ ] **Step 1: Write `docs/methodologies/gap-map.md`**

```markdown
# Gap map — `gap-map.v1`

| Version | Date | Change |
|---|---|---|
| `gap-map.v1` | 2026-09-15 | First version. Replaces `gap-analysis.v1` (skill-level demand − supply) and `gap-lenses.v1` (seven lenses + composite index) on `/gap-analysis`. |

## What it answers

Strategic questions 3 and 5: starting from **demand**, which parts of the
labour market does KKU's portfolio fail to serve, over-serve, or serve with
the wrong programmes. The unit is a **field of study** — what employers say
a graduate should hold — because JobThai adverts state it directly and with
counts, which no other source does.

## The row

One row per canonical field in `job_field_taxonomy` (APPROVED and PROPOSED;
REJECTED rows are invisible).

| Column | Definition |
|---|---|
| Demand share | eligible adverts naming any of the field's synonyms ÷ eligible adverts naming any canonical field |
| KKU share | graduates/yr of the field's scored programmes ÷ graduates/yr of every scored programme assigned to any field |
| Ratio | KKU share ÷ demand share, two decimals |
| Grads / yr | last five registrar alumni cohorts (`alumni_cohort_statuses`, GRADUATED) ÷ 5; `enrollment_metrics.graduated_on_time` where alumni rows are missing; both `realDataWhere()`-gated |
| Pipeline | current enrolment from `student_cohort_distributions` (`realDataWhere()`); arrow ↑ when pipeline ÷ 4 > 1.25 × grads/yr, ↓ when < 0.75 ×, → otherwise, — when either side is missing |
| Verdict | white space = no scored programme; under-served ratio < `under`; over-served ratio > `over`; served otherwise; **too few postings** below `JOBTHAI_MIN_POSTINGS_FOR_SIGNAL` (20) |

Defaults `under` 0.5, `over` 2; both are URL parameters echoed in the
provenance drawer, so an analyst can tighten them without a code change.

**Eligible** adverts are those whose minimum education level admits a
bachelor's graduate (`eligiblePostingLevels('BACHELOR')` = VOCATIONAL_CERT,
HIGHER_VOCATIONAL_CERT, BACHELOR). UNSPECIFIED is never eligible.
Postgraduate programmes are listed inside rows with their graduates but are
**not scored**: only 41 of 47,631 adverts state a postgraduate minimum, so a
verdict on them would be built from undergraduate adverts.

## Why shares, not counts

`gap-analysis.v1` compared a sum of posting-weight percentages (2,469 at
university scope) with graduates per year (157,356) and called the
difference a gap; nearly everything read as oversupply. Shares put both sides
on the same scale and also absorb JobThai's national, Bangkok-weighted
volume (37 % Bangkok, 3.3 % Isan): a field's *share* of adverts is
comparable across fields even though the absolute count is not a KKU-region
figure. Province breakdown is shown per row for exactly that reason.

## The taxonomy

Raw `job_postings.required_fields_raw` strings with **≥ 5 mentions** (518 of
3,854 on 2026-09-15) are clustered by `job-field-taxonomy.v1` into canonical
fields with Thai and English names; each field absorbs its raw strings as
synonyms, and a string belongs to at most one field. Strings below the floor
are the **other** bucket: counted in denominators, never assigned. `*ANY*`
(ทุกสาขา) is reported as its own line and assigned to nothing. Programmes
are assigned first by the name-match rule the JobThai bridge uses
(`matchFieldToProgramme`, `source = rule`), then by `program-job-field.v1`
(≤ 3 fields, `source = ai`), then by hand on `/admin/job-fields`
(`source = manual`). PROPOSED rows appear on the map at once, labelled
unreviewed; APPROVED/REJECTED rows are never renamed or downgraded by the
build step. Every write stamps the latest SUCCEEDED JobThai run.

## Reconciliation

Demand shares over canonical fields sum to 100 % of field-naming adverts;
"any field" and "other" are shown beside them. Supply shares may sum above
100 %: a programme assigned to two fields counts in both numerators while the
denominator counts each programme once. The line under the table states the
sum and the number of multi-field programmes.

## Scope

Faculty and department scope restrict **supply** to that unit's programmes
and add a KKU-total column, so a faculty view cannot show a false white
space. Programme scope is the Deep-Dive's; `/gap-analysis?scope=program`
redirects there.

## What's coming

Per field: (a) the field's occupations → `jobthai_occupation_skills` at
≥ 5 % posting share, generic skills removed → intersected with
`kmitl_skill_growths` (THAILAND, GLOBAL fallback) → top three rising skills,
labelled "LinkedIn data via MHESI"; (b) Trends Radar signals whose
`affectedProgramIds` include an assigned programme or whose
`newInitiatives` name one of the field's occupations. Forecasting is
deferred until JobThai batches form a time series.

## Council brief — `gap-brief.v1`

One call over the rows on screen (verdict, faculty, thresholds): ≤ 5
findings, each citing one row's numbers, plus what the data cannot tell.
Rule 3 of the prompt forbids programme-level recommendations. Confidence,
sources, reasoning and a disagreement button are shown; one `AiInference`
per call.

## Caveats carried on every figure

National adverts, Bangkok-weighted; no salary; no posting date; postgraduate
fields unscored; proposed fields unreviewed (counts in the drawer); a
programme in two fields counts twice on the supply side; 5-minute cache,
purged on taxonomy approval.

## Changed from `gap-analysis.v1` / `gap-lenses.v1`

Removed: skill-level demand − supply, the composite gap index and its six
re-projected health dimensions, sector/occupation/regional gaps built on
empty or 2026-04 regex tables, forecast accuracy, the placeholder
`regionalDemand = 100`, three AI insight modes. Kept: the per-programme
LinkedIn demand-gap helper (`computeProgramDemandGaps`, AI Analyst
evidence) and the digital-competency lens (moved to
`/education/digital-competency`). Numbers on `/gap-analysis` after v1.9.7
are not comparable to any earlier figure.
```

- [ ] **Step 2: README, JobThai doc, evaluation pipeline**

`docs/methodologies/README.md`: replace the `forecasting | Gap Analyzer` row's module with `(deferred — no consumer since v1.9.7)` and add rows:

```markdown
| `gap-map` | Gap Analyzer | `gap-map.v1` | [gap-map.md](./gap-map.md) |
| `gap-brief` | Gap Analyzer (Council brief) | `gap-brief.v1` | `packages/shared/src/ai/prompts/gap-brief.ts` |
| `job-field-taxonomy` | Gap Analyzer (rows) | `job-field-taxonomy.v1` | [gap-map.md](./gap-map.md) §taxonomy |
```

`docs/data-sources/jobthai.md`: in Runbook add after the derive lines:

```bash
pnpm jobthai:fields                                      # dry run (makes the model calls, writes nothing)
pnpm jobthai:fields --apply                              # field taxonomy + programme assignments
```

and a new section `## Field-of-study taxonomy (v1.9.7)` before `## Readiness`, stating: what the two tables are, the 5-mention floor and the counts on 2026-09-15, the `*ANY*` line, that the connector runs the step after links and a model outage logs `fields: FAILED` without failing the batch, the review page, and that `/gap-analysis` reads only these tables plus postings.

`docs/evaluation-pipeline.md`: in the surface layer keep `/gap-analysis`; in the AI-prompt table add `job-field-taxonomy.v1`, `program-job-field.v1`, `gap-brief.v1` rows (table → consumer), remove `gap-insights.v2`; add one paragraph under the cross-joins section: the gap map reads `job_postings` × `job_field_taxonomy`, `program_job_fields`, `alumni_cohort_statuses`, `enrollment_metrics`, `student_cohort_distributions`, `program_jobthai_links`, `jobthai_occupation_skills` × `kmitl_skill_growths`, `trend_signals`, and the programme health index — and writes nothing. Update the "Last updated" line.

- [ ] **Step 3: In-app paper**

In `content-en.tsx`, after `DocSubsection 4.7` (before `</DocSection>` at ~line 1072) add:

```tsx
        <DocSubsection number="4.8" title="Gap map — field-of-study demand vs KKU supply">
          <P>
            The Gap Analyzer (<Code>gap-map.v1</Code>) starts from demand. Each row is a{' '}
            <Strong>field of study</Strong> that employers name in JobThai adverts, clustered from
            free text by <Code>job-field-taxonomy.v1</Code> and reviewed by an administrator.{' '}
            <Strong>Demand share</Strong> is the field's share of eligible adverts (those admitting a
            bachelor's graduate) that name any canonical field; <Strong>KKU share</Strong> is the
            field's share of graduates per year across every programme assigned to a field. The{' '}
            <Strong>verdict</Strong> is the ratio of the two: white space when no programme is
            assigned, under-served below 0.5, over-served above 2, served between, and no verdict
            under 20 adverts. Thresholds are URL parameters echoed in the provenance drawer.
          </P>
          <P>
            Graduates per year follow the registrar rule used elsewhere in this paper (five alumni
            cohorts ÷ 5, with the graduated-on-time proxy as fallback); current enrolment supplies a
            pipeline arrow. A programme assigned to two fields counts in both fields' supply and
            the reconciliation line under the table says how many. Postgraduate programmes are
            listed but not scored, because only 41 of 47,631 adverts state a postgraduate minimum.
            Shares replace the earlier demand − supply difference, which compared a sum of
            percentages with a count of graduates. See <Code>docs/methodologies/gap-map.md</Code>.
          </P>
        </DocSubsection>
```

In Appendix A add a document-revision row `1.4 · 2026-09-15 · Re-issued for gap-map.v1: the Gap Analyzer is rebuilt as a demand-first field map (§4.8); gap-analysis.v1 and gap-lenses.v1 retired.` and a methodology-code row for `gap-map.v1`. Mirror both in `content-th.tsx` (§4.8 in Thai, same numbers; the appendix row in Thai). Bump whatever constant carries the paper's document revision (grep `1.3` near the provenance section at line 53) to `1.4`.

- [ ] **Step 4: Topology**

In `topology-data.ts`: change `dash.gap-analyzer` (`href: '/gap-analysis'`, subtitle `/gap-analysis`, description: "Demand-first gap map: one row per field of study employers ask for (JobThai), KKU supply share from registrar graduates, share-vs-share verdict, occupations and programmes inside each row, LinkedIn-via-MHESI growth and Trends Radar signals as what's coming, one Council brief."); replace `ai.gap-insights` with `ai.gap-brief` (`subtitle: 'On-demand · gap-brief.v1'`, cadence `User-triggered from /gap-analysis`); add two table nodes with `brand: 'jobthai'` — `Job-field taxonomy` (`prismaModel: 'JobFieldTaxonomy'`) and `Programme job fields` (`prismaModel: 'ProgramJobField'`); add an ingestion node `Job-field taxonomy build` (`jobthai-fields`, "after every JobThai batch refresh; operator dry-run + --apply"); add an admin node `/admin/job-fields`. Wire edges the way the existing JobThai nodes are wired (grep `brand: 'jobthai'` for the pattern). Run `pnpm --filter web exec vitest run test/topology` if such a test exists.

- [ ] **Step 5: Changelog and CLAUDE.md**

Prepend to `ENTRIES` in `apps/web/app/changelog/page.tsx`:

```ts
  {
    date: '2026-09-15',
    version: 'v1.9.7 · Gap Analyzer rebuilt as a demand-first map',
    title:
      'The Gap Analyzer now starts from what employers ask for: one row per field of study, KKU’s share of graduates against the market’s share of adverts, and a verdict per field',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Each row is a field of study named in JobThai adverts — accounting, electrical engineering, logistics — with the market’s share of adverts asking for it, KKU’s share of graduates holding it, and the ratio. White space means no KKU programme produces it; under-served and over-served follow thresholds you can change in the address bar; a field with fewer than twenty adverts gets no verdict.',
      'Open a row for the occupations behind the demand (with the programmes linked to each and where the adverts are), the KKU programmes in the field with graduates, enrolment and health, and what is coming: the fastest-rising skills among the field’s occupations (LinkedIn data via MHESI) and Trends Radar signals that name a programme or an occupation.',
      'Filter by verdict or faculty; every view is a link. A Council brief button writes up to five findings from the rows on screen, each citing the row’s numbers, with confidence, sources, reasoning and a disagree button.',
      'The fields are clustered from employers’ free text by AI and reviewed at Admin → Job fields; unreviewed fields are shown and labelled. The step runs after every JobThai upload and must be run once by hand after this release.',
      'These numbers are new and are not comparable to the previous Composite Gap Index. The seven-lens view, the opportunities and risks sub-pages and the three insight modes are retired: opportunities are the white-space filter, risks live in the risk register, and the digital-competency lens has moved to Education. Old links redirect.',
    ],
  },
```

`CLAUDE.md`: in "Current status" add a line for v1.9.7 (gap map, taxonomy, review page, retirements, post-deploy step `pnpm jobthai:fields --apply` then review), and a "Recent decisions" entry (dated 2026-09-15) with: share-vs-share and why; bachelor universe / postgraduate unscored; PROPOSED shown as unreviewed; the taxonomy step is in the batch refresh but non-fatal; `getProgramScoreIndex` is now exported; `ANALYST_TOOLS_VERSION` v2; `BUNDLE_CALENDAR_TAG` v4; the dry-run makes real model calls. Keep the retired names out of user-facing text.

- [ ] **Step 6: Release audit (no build)**

```bash
pnpm check
grep -rn "gap-analysis/opportunities\|gap-analysis/risks\|gap-analysis/digital-competency\|gap-insights\|Composite Gap Index" apps packages docs --include=*.ts --include=*.tsx --include=*.md | grep -v "docs/superpowers\|changelog\|redirect\|gap-map.md"
grep -n "'jobthai-fields.ts'" apps/ingestion/scripts/bundle-pipeline-scripts.ts
```

Expected: `pnpm check` green (lint on changed files, typecheck, tests); the grep returns nothing outside the allowed files; the TARGET line is present. Do **not** run `pnpm build:release` — the operator decides when to build (memory: never build unless asked). Record in the commit body: the post-deploy steps (`docker compose exec ingestion node /app/dist/scripts/jobthai-fields.js` dry-run, then `--apply`, then review at `/admin/job-fields`) and that the bundle target must be verified inside the image at build time.

- [ ] **Step 7: Commit**

```bash
git add docs/methodologies/gap-map.md docs/methodologies/README.md docs/data-sources/jobthai.md docs/evaluation-pipeline.md apps/web/app/docs/methodology/content-en.tsx apps/web/app/docs/methodology/content-th.tsx apps/web/app/admin/application-topology/topology-data.ts apps/web/app/changelog/page.tsx CLAUDE.md
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/gm-12.txt
```

Message: `docs: gap-map.v1 methodology, paper §4.8, topology, changelog v1.9.7` + attribution.

---

## Post-plan notes for the controller

- Tasks 1–4 are the data layer and can be reviewed against the numbers in `pnpm jobthai:fields` output; Tasks 7–8 against the reconciliation invariants; Task 10 by reading the page as a Council member.
- Task 4's dry run and Task 8's live check spend model credits (a few Gemini calls). Note the cost from the api log in the commit bodies.
- The api must be restarted after Tasks 3, 5, 7, 8, 9 and 11 (`packages/*` changes are not hot-reloaded).
- Deployment is the operator's call: after the tarball is built on request and deployed, run the taxonomy step on prod (dry-run first) and review at `/admin/job-fields`; prod numbers will differ from dev.

# JobThai Plan A — ingestion and extraction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-13-jobthai-demand-extraction-design.md`

**Goal:** Get all 47,643 JobThai postings, 173 occupations and their skills into the database through an admin-managed file upload, and stop the `demand_match_filled` relevance driver being silently discarded.

**Architecture:** An admin uploads XLSX files to MinIO; each file is a `JobThaiBatch`. A `CsvFileConnector` subclass enumerates PENDING batches, parses rows into `JobPosting`, then four ordered phases derive occupations, match skills deterministically against the existing 4,407-skill / 5,313-alias taxonomy, fill the never-used `Skill.embedding` vectors for a semantic second pass, and finally spend a bounded ~$2-5 of LLM on occupation profiles and novel-skill discovery.

**Tech Stack:** TypeScript strict, Prisma, `xlsx@0.18.5` (already a dependency in api and ingestion), pgvector, BullMQ, NestJS, Next.js App Router, Vitest.

**Changes no Council figure.** No `HEALTH_SCORE_VERSION` bump. The relevance driver, the programme bridge and the scoring integration are Plan B.

---

## Deviation from the spec's split — read this first

The spec put the connector flip in Plan B (step 8). **It belongs here instead**, and the plan reflects that:

The parse phase *is* the connector's `load()` — that is the architecture `CsvFileConnector` documents. You cannot build parse without building the connector. And loading 47,643 rows under a `data_sources` row still marked `mocked: true` would mean every row is invisible to `realDataWhere()`, which is precisely the trap recorded in the `data_sources` drift memory.

So Plan A ends with `jobthai` genuinely real and carrying data. What stays in Plan B is only the **scoring** integration: `ProgramJobThaiLink`, the `jobthai_demand_alignment` driver, and `health-score.v5.1`. Gate 11's 30-day green-history clock governs Council *use* of the numbers, which is Plan B's concern, and it starts ticking from the flip in Task 5 here.

## Environment constraints that will bite

- **Never run `prisma migrate dev`, `migrate reset`, `db push`, or `migrate diff --from-migrations`.** A `PreToolUse` guard denies them outright. Hand blocked commands to the operator; never work around the guard.
- **Never redirect a generated diff into `migration.sql`.** Even `--from-schema-datasource` emits unrelated drift against this database (`DROP TABLE mv_refresh_log`, dropped columns on `verdict_snapshots`, five `DROP INDEX`). Generate to a scratch path *outside* the repo for reference, hand-copy only your own statements, then run `pnpm tsx scripts/migration-linter.ts <path>`.
- **After any change under `packages/`, restart the api and ingestion.** `nest start --watch` only watches `apps/api/src`. Worse, `apps/api/src` *does* hot-reload, so you get new controller code calling an old `packages/db`. Check `ps -o lstart= -p <pid>` against the commit time before debugging anything.
- **Never run `pnpm --filter web build` while the dev server is up** — it writes into the same `.next/` and 500s the running server.
- **`AiJobKind` and `AiJobData` are hand-maintained in two files and have already drifted.** Any new job kind must be added to BOTH `apps/api/src/ai-jobs/ai-jobs-queue.service.ts` and `apps/ingestion/src/ai-jobs/queue.ts`.
- Use `git commit -F <file>`, never `-m` — the guard matches raw command strings and several phrases in these messages would trip it.
- Tests baseline to beat: `@kku/shared` 967 · `@kku/db` 437 · web 157 · api 135 · ingestion 193. **Counts must not drop** — a narrowed vitest `include` glob silently orphans tests and `passWithNoTests` hides it.

## File structure

| Path | Responsibility |
|---|---|
| `packages/db/prisma/migrations/20260913120000_jobthai_demand/migration.sql` | 4 tables, 2 enums, `JobPosting` columns. Hand-written. |
| `packages/shared/src/jobthai/columns.ts` | The 7 expected headers as one exported constant — the single source of truth for header validation. |
| `packages/shared/src/jobthai/parse-row.ts` | Pure row normalisation: gender/age exclusion, PII scrub, field-of-study and education-level extraction. No IO. |
| `packages/shared/src/jobthai/parse-sheet.ts` | Pure: buffer → validated rows, or a named-column error. |
| `packages/shared/src/jobthai/index.ts` | Barrel re-exporting `JOBTHAI_COLUMNS`, `JOBTHAI_DATE_COLUMN`, `JOBTHAI_ANY_FIELD`, `NormalisedJobThaiRow`, `normaliseJobThaiRow`, `extractFieldsOfStudy`, `extractMinEducationLevel`, `parseJobThaiSheet`, `ParseSheetResult`. Client components must `import type` only from `@kku/shared` — the barrel re-exports subpaths that use `node:crypto`. |
| `apps/ingestion/src/connectors/sources/jobthai/connector.ts` | `CsvFileConnector` subclass: fetch PENDING batches → transform rows → load `JobPosting`. |
| `apps/ingestion/src/jobthai/derive-occupations.ts` | Phase 2. |
| `apps/ingestion/src/jobthai/match-skills.ts` | Phase 3 (deterministic) and phase 4 (semantic). |
| `apps/ingestion/src/jobthai/llm-phases.ts` | Phase 5. |
| `apps/api/src/jobthai/` | `jobthai.module.ts`, `.controller.ts`, `.service.ts` — upload, list, delete. |
| `apps/web/app/admin/jobthai/` | `page.tsx`, `client.tsx`. |
| `packages/db/src/jobthai.ts` | Read helpers the admin UI and (later) Plan B consume. |

---

### Task 1: Prerequisite — stop discarding 6,224 demand matches  ✅ DONE 2026-09-13 (fca886d)

Nothing else in this plan is visible until this lands. All 6,224 `program_demand_matches` rows carry `ingestion_run_id = NULL`, so zero pass `realDataWhere()` and `demand_match_filled` is null on all 301 programmes.

**Files:**
- Create: `apps/ingestion/src/scripts/backfill-demand-match-provenance.ts`
- Modify: `apps/ingestion/src/program-demand-match/run.ts`
- Test: `apps/ingestion/test/program-demand-match/provenance.test.ts`

- [x] **Step 1: Write the failing test**

Create `apps/ingestion/test/program-demand-match/provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveDemandProvenanceRunId } from '../../src/program-demand-match/run';

describe('resolveDemandProvenanceRunId', () => {
  it('returns the run id of the demand source that supplied the skill set', async () => {
    const runId = await resolveDemandProvenanceRunId({
      findLatestSucceededRun: (slug) =>
        Promise.resolve(slug === 'kmitl-skill-mapping' ? 'run-kmitl-1' : null),
      demandSourceSlug: 'kmitl-skill-mapping',
    });
    expect(runId).toBe('run-kmitl-1');
  });

  it('returns null rather than inventing a run when the source has none', async () => {
    const runId = await resolveDemandProvenanceRunId({
      findLatestSucceededRun: () => Promise.resolve(null),
      demandSourceSlug: 'kmitl-skill-mapping',
    });
    expect(runId).toBeNull();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `pnpm --filter ingestion test -- provenance`
Expected: FAIL — `resolveDemandProvenanceRunId` is not exported.

- [x] **Step 3: Add the resolver and stamp on write**

In `apps/ingestion/src/program-demand-match/run.ts`, add near the top:

```ts
/** Injectable seam so the resolver is unit-testable without Prisma. */
export interface DemandProvenanceDeps {
  findLatestSucceededRun: (slug: string) => Promise<string | null>;
  demandSourceSlug: string;
}

/**
 * A ProgramDemandMatch row exists because a demanded skill was resolved
 * from a demand source, so THAT source's ingestion run is the row's
 * provenance. These rows are AI-derived, not connector-derived, which is
 * why "the latest run of this table's own connector" is meaningless here
 * and why every row was left NULL.
 *
 * Returns null rather than fabricating a run id: a wrong provenance is
 * worse than an absent one, and realDataWhere() already treats null as
 * "not real".
 */
export async function resolveDemandProvenanceRunId(
  deps: DemandProvenanceDeps,
): Promise<string | null> {
  return deps.findLatestSucceededRun(deps.demandSourceSlug);
}
```

Then in `runDemandMatch`, after the demand tier is chosen, resolve the run id once and pass it into every `programDemandMatch` upsert as `ingestionRunId`. The demand source slug is `'kmitl-skill-mapping'` for every tier in the current fallback chain.

The Prisma implementation of `findLatestSucceededRun`:

```ts
const findLatestSucceededRun = async (slug: string): Promise<string | null> => {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug } },
    // NOTE: the column is completed_at, not finished_at.
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
};
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter ingestion test -- provenance`
Expected: PASS.

- [x] **Step 5: Write the one-shot backfill script**

Create `apps/ingestion/src/scripts/backfill-demand-match-provenance.ts`. Dry-run by default; `--apply` required to write. Every existing row is `demand-match.v2` or `.v3`, both of which predate JobThai, so all 6,224 came from `kmitl-skill-mapping`.

```ts
import { prisma } from '@kku/db';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const before = await prisma.programDemandMatch.count({ where: { ingestionRunId: null } });
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: 'kmitl-skill-mapping' } },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true },
  });
  console.log(`untagged rows: ${before}`);
  console.log(`anchor run: ${run?.id ?? '(none found)'} completed ${run?.completedAt?.toISOString() ?? '-'}`);
  if (!run) {
    console.error('No SUCCEEDED kmitl-skill-mapping run exists — cannot anchor. Run the connector first.');
    process.exit(1);
  }
  if (!apply) {
    console.log('DRY RUN — pass --apply to write.');
    await prisma.$disconnect();
    return;
  }
  const res = await prisma.programDemandMatch.updateMany({
    where: { ingestionRunId: null },
    data: { ingestionRunId: run.id },
  });
  console.log(`tagged ${res.count} rows`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Register in root `package.json`: `"demand:backfill-provenance": "tsx apps/ingestion/src/scripts/backfill-demand-match-provenance.ts"`.

The anchor is **approximate** — these rows did not literally come from that run — but the source family is correct. This is the same compromise accepted for the v1.1.3 provenance backfill, and it must be stated in the commit message so nobody later reads the FK as exact.

- [x] **Step 6: Dry-run, then apply, then verify the driver lights up**

```bash
pnpm demand:backfill-provenance
pnpm demand:backfill-provenance --apply
```

Then confirm `demand_match_filled` is no longer null. Write a scratch script (outside the repo, in the scratchpad) that calls `computeHealthScores('program', <a programme id with matches>)` and prints the relevance drivers. Expected: `demand_match_filled` has a non-null value where it was null before.

**Do not skip this verification.** The whole point of Task 1 is the driver changing state; a green unit test does not demonstrate it.

- [x] **Step 7: Commit**

```bash
git add apps/ingestion/src/program-demand-match/run.ts apps/ingestion/src/scripts/backfill-demand-match-provenance.ts apps/ingestion/test/program-demand-match/provenance.test.ts package.json
git commit -F - <<'MSG'
fix(demand-match): stamp provenance so the relevance driver is not discarded

All 6,224 program_demand_matches rows carried ingestion_run_id = NULL, so
none passed realDataWhere() and demand_match_filled was null on all 301
programmes despite 285 having real AI analysis behind them.

These rows are AI-derived, not connector-derived, so there is no run of
"their own" connector to point at. Their real provenance is the demand
source that supplied the skill set, which the runner now stamps.

The one-shot backfill anchors the existing rows to the latest SUCCEEDED
kmitl-skill-mapping run. Every existing row is demand-match.v2 or .v3, both
of which predate any other demand source. The anchor is approximate - the
rows did not literally come from that run - but the source family is
correct, the same compromise accepted for the v1.1.3 backfill.

Third occurrence of this class after tcas and Google Scholar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 2: Schema migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260913120000_jobthai_demand/migration.sql`

- [ ] **Step 1: Add the models to `schema.prisma`**

```prisma
enum JobThaiBatchStatus {
  PENDING
  PARSING
  PARSED
  FAILED
}

/// Education floor a posting states. A separate enum from ProgramLevel
/// because 26.9% of postings ask for ปวช/ปวส, which ProgramLevel cannot
/// express — it describes KKU degree programmes, not the Thai vocational
/// tiers below them. Ordered lowest to highest.
enum JobRequiredEducationLevel {
  UNSPECIFIED
  VOCATIONAL_CERT
  HIGHER_VOCATIONAL_CERT
  BACHELOR
  MASTER
  DOCTORATE
}

model JobThaiBatch {
  id               String             @id @default(cuid())
  filename         String
  /// SHA-256 of the uploaded bytes. Unique: re-uploading the same file is
  /// a no-op, matching the PdfDocument dedupe pattern.
  contentHash      String             @unique @map("content_hash")
  storageKey       String             @map("storage_key")
  fileSize         Int                @map("file_size")
  rowCount         Int                @default(0) @map("row_count")
  /// Upload date. Also the postedDate fallback for rows with no date column.
  receivedDate     DateTime           @map("received_date") @db.Date
  status           JobThaiBatchStatus @default(PENDING)
  parseError       String?            @map("parse_error") @db.Text
  uploadedByUserId String?            @map("uploaded_by_user_id")
  ingestionRunId   String?            @map("ingestion_run_id")
  createdAt        DateTime           @default(now()) @map("created_at")
  updatedAt        DateTime           @updatedAt @map("updated_at")

  uploadedBy   User?         @relation(fields: [uploadedByUserId], references: [id], onDelete: SetNull)
  ingestionRun IngestionRun? @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)
  postings     JobPosting[]

  @@index([status])
  @@map("jobthai_batches")
}

/// The profession layer. One row per (category, subcategory) — 173 from
/// the 2026-09 drop. JobThai-native rather than mapped onto KmitlCareer,
/// because these columns are source-authoritative and 100% populated
/// whereas a crosswalk would invent precision.
model JobThaiOccupation {
  id             String                       @id @default(cuid())
  category       String
  subcategory    String
  /// Stable slug used as OccupationDemand.occupation_code, namespaced
  /// `jobthai:<slug>` so rows never collide with a future ISCO-08 code.
  code           String                       @unique
  postingCount   Int                          @default(0) @map("posting_count")
  profileTh      String?                      @map("profile_th") @db.Text
  typicalTasksTh String[]                     @map("typical_tasks_th")
  embedding      Unsupported("vector(1536)")?
  methodVersion  String                       @default("jobthai-occupation.v1") @map("method_version")
  createdAt      DateTime                     @default(now()) @map("created_at")
  updatedAt      DateTime                     @updatedAt @map("updated_at")

  skills JobThaiOccupationSkill[]

  @@unique([category, subcategory])
  @@map("jobthai_occupations")
}

model JobThaiOccupationSkill {
  id                  String      @id @default(cuid())
  jobThaiOccupationId String      @map("jobthai_occupation_id")
  skillId             String      @map("skill_id")
  postingCount        Int         @map("posting_count")
  /// 0..1 — postingCount over the occupation's total postings.
  share               Float
  extractedBy         SkillSource @map("extracted_by")
  createdAt           DateTime    @default(now()) @map("created_at")
  updatedAt           DateTime    @updatedAt @map("updated_at")

  occupation JobThaiOccupation @relation(fields: [jobThaiOccupationId], references: [id], onDelete: Cascade)
  skill      Skill             @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([jobThaiOccupationId, skillId])
  @@index([skillId])
  @@map("jobthai_occupation_skills")
}
```

Add to `JobPosting`:

```prisma
  jobThaiBatchId       String?                    @map("jobthai_batch_id")
  jobCategory          String?                    @map("job_category")
  jobSubcategory       String?                    @map("job_subcategory")
  businessType         String?                    @map("business_type")
  qualificationRaw     String?                    @map("qualification_raw") @db.Text
  /// Normalised fields of study the posting asks for. The sentinel
  /// '*ANY*' means the posting said ทุกสาขา (any field) — a real and
  /// common category, not an extraction failure.
  requiredFieldsRaw    String[]                   @map("required_fields_raw")
  minEducationLevel    JobRequiredEducationLevel  @default(UNSPECIFIED) @map("min_education_level")
  /// True when postedDate came from the batch receipt date rather than
  /// the source, because the 2026-09 drop carries no date column.
  postedDateEstimated  Boolean                    @default(false) @map("posted_date_estimated")

  jobThaiBatch JobThaiBatch? @relation(fields: [jobThaiBatchId], references: [id], onDelete: Cascade)
```

Add `ALIAS_MATCHED` and `EMBEDDING_MATCHED` to `enum SkillSource`. Add the back-relations on `Skill` (`jobThaiOccupationSkills`), `User` (`jobThaiBatches`) and `IngestionRun` (`jobThaiBatches`).

`ProgramJobThaiLink` is **not** created here — it is Plan B's, and creating an unused table now would be a table nobody reads.

- [ ] **Step 2: Hand-write the migration SQL**

Create the directory and write `migration.sql` by hand. For reference only, you may generate a diff to a scratch path **outside the repo**:

```bash
pnpm --filter @kku/db exec prisma migrate diff \
  --from-schema-datasource packages/db/prisma/schema.prisma \
  --to-schema-datamodel packages/db/prisma/schema.prisma \
  --script > /tmp/claude-1000/-home-denpong-projects-program-landscape/dfbd1955-f4ad-4144-88c6-716721b9260a/scratchpad/jobthai-diff.sql
```

**Copy only your own statements out of it.** That file will also contain unrelated drift (`DROP TABLE mv_refresh_log`, dropped `verdict_snapshots` columns, five `DROP INDEX`) which must never reach a migration.

The enum additions use the idempotent form, matching the prompt-12 `DecisionStatus` precedent:

```sql
ALTER TYPE "SkillSource" ADD VALUE IF NOT EXISTS 'ALIAS_MATCHED';
ALTER TYPE "SkillSource" ADD VALUE IF NOT EXISTS 'EMBEDDING_MATCHED';
```

All other statements are `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` / `CREATE INDEX` — additive only.

- [ ] **Step 3: Lint the migration**

Run: `pnpm tsx scripts/migration-linter.ts packages/db/prisma/migrations/20260913120000_jobthai_demand/migration.sql`
Expected: exit 0, no violations. If it flags anything destructive, you copied drift out of the scratch diff — remove it rather than adding an allow-annotation.

- [ ] **Step 4: Apply and regenerate**

```bash
pnpm --filter @kku/db exec prisma migrate deploy
pnpm --filter @kku/db exec prisma generate
```

Then **restart api and ingestion** — `packages/db` changed and their watchers do not see it.

- [ ] **Step 5: Verify the schema landed**

Write a scratch script asserting `prisma.jobThaiBatch.count()`, `prisma.jobThaiOccupation.count()` and `prisma.jobThaiOccupationSkill.count()` all return 0 without throwing. A Prisma client that still has the old DMMF throws here — that is the signal you skipped the restart.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260913120000_jobthai_demand/
git commit -F - <<'MSG'
feat(db): JobThai batch, occupation and occupation-skill tables

Four additive tables plus columns on the empty job_postings table, which
has existed since prompt 01 and never held a row.

JobRequiredEducationLevel is a new enum rather than a reuse of
ProgramLevel: 26.9% of postings ask for a Thai vocational certificate
(ปวช/ปวส), which ProgramLevel cannot express because it describes KKU
degree programmes. Reusing it would force 12,831 postings into a wrong
value or a null.

SkillSource gains ALIAS_MATCHED and EMBEDDING_MATCHED because a
deterministic alias hit is neither MANUAL nor LLM_EXTRACTED, and a
provenance drawer must not claim otherwise.

ProgramJobThaiLink is deliberately absent - it belongs to Plan B, and an
unused table is a table nobody reads.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 3: Pure row parser

The whole extraction correctness story lives here, with no IO, so it is cheap to test exhaustively.

**Files:**
- Create: `packages/shared/src/jobthai/columns.ts`, `parse-row.ts`, `parse-sheet.ts`, `index.ts`
- Test: `packages/shared/test/jobthai/parse-row.test.ts`, `parse-sheet.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/test/jobthai/parse-row.test.ts`. These cases come from real rows in `Job_Data_01.xlsx`:

```ts
import { describe, expect, it } from 'vitest';

import { normaliseJobThaiRow, JOBTHAI_ANY_FIELD } from '../../src/jobthai/parse-row';

const base = {
  'Job Title': 'เจ้าหน้าที่การเงิน',
  'Job Category (ประเภทงานหลัก)': 'งานการเงิน/ธนาคาร',
  'Job Subcategory (ประเภทงานย่อย)': 'งานการเงิน',
  'Business (ประเภทธุรกิจ)': 'ธุรกิจ วัสดุก่อสร้าง/ก่อสร้าง',
  Province: 'สมุทรปราการ',
  'Job Description (Raw)': 'จัดทำเอกสารใบแจ้งหนี้ลูกค้า',
  'Qualification (Raw)': '',
};

describe('normaliseJobThaiRow — education and field of study', () => {
  it('extracts the named fields of study', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'วุฒิการศึกษา ปริญญาตรี สาขาบัญชี , การเงินการธนาคาร เท่านั้น',
    });
    expect(r.requiredFieldsRaw).toEqual(['บัญชี', 'การเงินการธนาคาร']);
    expect(r.minEducationLevel).toBe('BACHELOR');
  });

  it('treats ทุกสาขา as the any-field sentinel, not a field named ทุก', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'วุฒิการศึกษา ปวช., ปวส.- ปริญญาตรี ทุกสาขา',
    });
    expect(r.requiredFieldsRaw).toEqual([JOBTHAI_ANY_FIELD]);
  });

  it('takes the LOWEST stated level as the floor the employer accepts', () => {
    // "ปวช., ปวส.- ปริญญาตรี" means a ปวช holder is acceptable.
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'วุฒิการศึกษา ปวช., ปวส.- ปริญญาตรี ทุกสาขา',
    });
    expect(r.minEducationLevel).toBe('VOCATIONAL_CERT');
  });

  it('is UNSPECIFIED when no qualification is stated', () => {
    expect(normaliseJobThaiRow(base).minEducationLevel).toBe('UNSPECIFIED');
  });
});

describe('normaliseJobThaiRow — exclusions', () => {
  it('strips gender and age requirements from stored text', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'เพศหญิง อายุไม่เกิน 30 ปี วุฒิการศึกษา ปริญญาตรี สาขาบัญชี',
    });
    expect(r.qualificationRaw).not.toMatch(/เพศ/);
    expect(r.qualificationRaw).not.toMatch(/อายุ/);
    // The legitimate signal survives the strip.
    expect(r.requiredFieldsRaw).toEqual(['บัญชี']);
    expect(r.minEducationLevel).toBe('BACHELOR');
  });

  it('scrubs email addresses and phone-like digits', () => {
    const r = normaliseJobThaiRow({
      ...base,
      'Qualification (Raw)': 'ส่งประวัติมาที่ somchai@example.com หรือโทร 0812345678',
    });
    expect(r.qualificationRaw).not.toMatch(/@example\.com/);
    expect(r.qualificationRaw).not.toMatch(/0812345678/);
  });
});
```

And `packages/shared/test/jobthai/parse-sheet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseJobThaiSheet, JOBTHAI_COLUMNS } from '../../src/jobthai';

function workbookOf(headers: string[], rows: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseJobThaiSheet', () => {
  it('names the missing column instead of failing mid-parse', () => {
    const headers = JOBTHAI_COLUMNS.filter((c) => c !== 'Province');
    const result = parseJobThaiSheet(workbookOf([...headers], [headers.map(() => 'x')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('Province');
  });

  it('accepts a sheet carrying all seven expected columns', () => {
    const result = parseJobThaiSheet(workbookOf([...JOBTHAI_COLUMNS], [JOBTHAI_COLUMNS.map(() => 'x')]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toHaveLength(1);
  });

  it('drops exactly-duplicate rows', () => {
    const row = JOBTHAI_COLUMNS.map(() => 'same');
    const result = parseJobThaiSheet(workbookOf([...JOBTHAI_COLUMNS], [row, [...row]]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicatesDropped).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @kku/shared test -- jobthai`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `columns.ts`**

```ts
/**
 * The seven columns every JobThai drop carries, in source order.
 * Validation compares against this list and names what is missing, so an
 * operator learns which column is absent instead of watching a parse die
 * on row 4,000.
 */
export const JOBTHAI_COLUMNS = [
  'Job Title',
  'Job Category (ประเภทงานหลัก)',
  'Job Subcategory (ประเภทงานย่อย)',
  'Business (ประเภทธุรกิจ)',
  'Province',
  'Job Description (Raw)',
  'Qualification (Raw)',
] as const;

export type JobThaiColumn = (typeof JOBTHAI_COLUMNS)[number];

/**
 * Optional. Absent from the 2026-09 drop; JobThai can supply it, and the
 * parser accepts it the moment they do, so no migration is needed later.
 */
export const JOBTHAI_DATE_COLUMN = 'Posted Date';
```

- [ ] **Step 4: Implement `parse-row.ts`**

Key decisions to encode:

- **Order matters: strip gender/age BEFORE extracting fields**, so a stripped phrase cannot leak into a field name.
- `ทุกสาขา` maps to the `'*ANY*'` sentinel. Without this, a naive capture yields a field literally named `ทุก`, which would then fail to match any programme and quietly under-count 12,831 vocational-plus-any-field postings.
- `minEducationLevel` is the **lowest** stated level, because `ปวช., ปวส.- ปริญญาตรี` means a ปวช holder is acceptable. The floor is what the text means.

```ts
import { JOBTHAI_COLUMNS, JOBTHAI_DATE_COLUMN } from './columns';

export const JOBTHAI_ANY_FIELD = '*ANY*';

export type JobRequiredEducationLevel =
  | 'UNSPECIFIED' | 'VOCATIONAL_CERT' | 'HIGHER_VOCATIONAL_CERT'
  | 'BACHELOR' | 'MASTER' | 'DOCTORATE';

/** The normalised shape every downstream phase consumes. */
export interface NormalisedJobThaiRow {
  title: string;
  jobCategory: string;
  jobSubcategory: string;
  businessType: string;
  province: string;
  descriptionRaw: string;
  qualificationRaw: string;
  requiredFieldsRaw: string[];
  minEducationLevel: JobRequiredEducationLevel;
  /** Set only when the source carries JOBTHAI_DATE_COLUMN. */
  postedDate: Date | null;
  /** SHA-256 of the seven source values — the dedupe key. */
  rowKey: string;
}

// Lowest first: extractMinEducationLevel takes the FIRST match, because
// "ปวช., ปวส.- ปริญญาตรี" means a ปวช holder is acceptable and the floor
// is what the text means.
const LEVELS: Array<[JobRequiredEducationLevel, RegExp]> = [
  ['VOCATIONAL_CERT', /ปวช/],
  ['HIGHER_VOCATIONAL_CERT', /ปวส/],
  ['BACHELOR', /ปริญญาตรี|ป\.ตรี/],
  ['MASTER', /ปริญญาโท/],
  ['DOCTORATE', /ปริญญาเอก/],
];

/** Gender and age requirements are removed, never stored. They appear in
 *  47.5% and 55.3% of postings, they are not skills, and surfacing
 *  "employers want women under 30" on a Council surface would be the
 *  worst outcome this feature could have. */
const EXCLUDE_PATTERNS: RegExp[] = [
  /เพศ(ชาย|หญิง|ไม่จำกัด)?/g,
  /อายุ\s*(ไม่เกิน|ตั้งแต่)?\s*\d+\s*(-\s*\d+)?\s*ปี?/g,
];

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE = /0\d{8,9}/g;

function scrub(text: string): string {
  let out = text;
  for (const re of EXCLUDE_PATTERNS) out = out.replace(re, ' ');
  out = out.replace(EMAIL, '[redacted-email]').replace(PHONE, '[redacted-phone]');
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function extractFieldsOfStudy(text: string): string[] {
  if (/ทุกสาขา/.test(text)) return [JOBTHAI_ANY_FIELD];
  const out: string[] = [];
  const re = /สาขา(?:วิชา)?\s*([^\n]{1,120})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tail = m[1]!.split(/เท่านั้น|ขึ้นไป|หรือสาขาที่เกี่ยวข้อง|\(|\)/)[0]!;
    for (const part of tail.split(/,|、|และ|หรือ|\//)) {
      const f = part.trim().replace(/^(วิชา)\s*/, '');
      if (f.length >= 2 && f.length <= 60) out.push(f);
    }
  }
  return [...new Set(out)];
}

export function extractMinEducationLevel(text: string): JobRequiredEducationLevel {
  for (const [level, re] of LEVELS) if (re.test(text)) return level;
  return 'UNSPECIFIED';
}
```

Then `normaliseJobThaiRow(raw)` returns `{ title, jobCategory, jobSubcategory, businessType, province, descriptionRaw, qualificationRaw, requiredFieldsRaw, minEducationLevel, postedDate?, rowKey }` where the text fields are scrubbed and `rowKey` is a SHA-256 of the seven source values for dedupe. `postedDate` is set only when `JOBTHAI_DATE_COLUMN` is present.

- [ ] **Step 5: Implement `parse-sheet.ts`**

Returns a discriminated result, never throws on bad input:

```ts
export type ParseSheetResult =
  | { ok: true; rows: NormalisedJobThaiRow[]; duplicatesDropped: number; hasDateColumn: boolean }
  | { ok: false; error: string };
```

Validate headers against `JOBTHAI_COLUMNS` first and return `{ ok: false, error }` naming every missing column. Dedupe on `rowKey`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @kku/shared test -- jobthai`
Expected: PASS.

- [ ] **Step 7: Validate against the real files before trusting the regexes**

The tests use hand-picked rows. Run the parser over all five real files from a scratch script and print: total rows, duplicates dropped, `minEducationLevel` distribution, share with ≥1 field of study, the 30 most common extracted fields, and any field longer than 40 characters.

Expected from the measured baseline: ~47,643 rows, 19 duplicates, roughly 57.8% with a field of study, ~51% BACHELOR-or-lower floors. **If the field-of-study share lands far from 57.8%, the regex is wrong — fix it before proceeding.** Eyeball the top-30 list: it should read like real disciplines (บัญชี, วิศวกรรม, การตลาด), not sentence fragments.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/jobthai/ packages/shared/test/jobthai/
git commit -F - <<'MSG'
feat(jobthai): pure XLSX row parser with field-of-study extraction

No IO, so the correctness story is exhaustively testable. Header
validation names the missing column rather than dying on row 4,000.

Three decisions worth knowing:

Gender and age requirements are stripped before anything else reads the
text, so a stripped phrase cannot leak into a field name. They are 47.5%
and 55.3% of postings and they are not skills.

ทุกสาขา becomes an explicit any-field sentinel. A naive capture yields a
field literally named ทุก, which matches no programme and would have
quietly under-counted 12,831 postings.

minEducationLevel is the LOWEST stated level, because "ปวช., ปวส.-
ปริญญาตรี" means a ปวช holder is acceptable. The floor is what the text
means.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 4: The connector

**Files:**
- Create: `apps/ingestion/src/connectors/sources/jobthai/connector.ts`
- Modify: `apps/ingestion/src/connectors/registry.ts`, `apps/ingestion/src/connectors/sources/kku-connectors.ts` (delete the stub)
- Test: `apps/ingestion/test/jobthai/connector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';

import { JobThaiConnector } from '../../src/connectors/sources/jobthai/connector';

describe('JobThaiConnector', () => {
  it('declares itself a real XLSX file connector', () => {
    const c = new JobThaiConnector();
    expect(c.slug).toBe('jobthai');
    expect(c.mocked).toBe(false);
    expect(c.inputFormat).toBe('XLSX');
  });

  it('fetches nothing when no batch is PENDING', async () => {
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
    });
    const raw = await c.fetch(ctxStub());
    expect(raw).toHaveLength(0);
  });

  it('stamps ingestionRunId from the context onto every loaded posting', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const c = new JobThaiConnector({
      listPendingBatches: () => Promise.resolve([]),
      readObject: () => Promise.resolve(Buffer.alloc(0)),
      writePostings: (rows) => { writes.push(...rows); return Promise.resolve(rows.length); },
    });
    await c.load(ctxStub('run-42'), [
      { target: 'job_postings', externalId: 'ab12cd34:0', payload: { title: 'x' }, freshnessDate: new Date() },
    ]);
    expect(writes[0]!.ingestionRunId).toBe('run-42');
  });
});

function ctxStub(runId = 'run-1') {
  return {
    runId,
    dataSource: { id: 'ds', slug: 'jobthai', name: 'JobThai', baseUrl: null, lastSyncedAt: null },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never;
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ingestion test -- jobthai`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the connector**

Extends `CsvFileConnector`, with dependencies injected so the tests above need no MinIO and no database:

```ts
export interface JobThaiConnectorDeps {
  listPendingBatches: () => Promise<Array<{ id: string; contentHash: string; storageKey: string; receivedDate: Date }>>;
  readObject: (storageKey: string) => Promise<Buffer>;
  writePostings?: (rows: Array<Record<string, unknown>>) => Promise<number>;
}

export class JobThaiConnector extends CsvFileConnector {
  readonly slug = 'jobthai';
  readonly mocked = false;
  readonly inputFormat = 'XLSX' as const;
  // ...
}
```

- `fetch()` lists PENDING batches, reads each object, returns one `RawRecord` per batch (`externalId` = contentHash).
- `transform()` runs `parseJobThaiSheet`; on `ok: false` throws `NonRetryableError` (a malformed sheet will never parse on retry) and sets the batch `FAILED` with `parseError`.
- `load()` writes `JobPosting` rows in chunks of 500 via `Promise.allSettled`, mirroring the `kmitl-skill-mapping` chunk-of-25 pattern scaled for simple inserts. Sets `source: 'jobthai'`, `externalId: <hash8>:<rowIndex>`, `ingestionRunId: ctx.runId`, `postedDate` from the row when present else the batch `receivedDate` with `postedDateEstimated: true`. Flips the batch to `PARSED` with its `rowCount`.
- `healthCheck()` reports how many batches are PENDING — for a manual-upload connector that is the only meaningful health signal.

- [ ] **Step 4: Register it and delete the stub**

In `apps/ingestion/src/connectors/registry.ts` replace the jobthai line with:

```ts
  { slug: 'jobthai', mock: () => new JobThaiMockConnector(), real: () => new JobThaiConnector() },
```

Keep a minimal mock so `CONNECTOR_JOBTHAI_MODE=mocked` remains a working rollback, as the prompt-14 rollback story requires. Delete `JobThaiConnector` from `kku-connectors.ts` (rename the remaining stub to `JobThaiMockConnector`).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter ingestion test -- jobthai`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/connectors/
git commit -F - <<'MSG'
feat(jobthai): real XLSX file connector replacing the one-record stub

The previous JobThaiConnector extended ApiConnector, returned a single
hardcoded posting and had a load() that wrote nothing and returned counts.
This one enumerates PENDING JobThaiBatch rows, parses the sheet, and writes
job_postings stamped with ctx.runId.

A malformed sheet throws NonRetryableError - it will never parse on a
retry - and marks the batch FAILED with the parse error, so an operator
sees why rather than watching BullMQ retry three times.

The mock is kept and renamed so CONNECTOR_JOBTHAI_MODE=mocked remains a
working rollback.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 5: Catalog flip

**Files:**
- Modify: `packages/shared/src/ingestion/catalog.ts`
- Modify: `.env.example`
- Test: `packages/shared/test/ingestion/catalog.test.ts` (extend if it exists, create if not)

- [ ] **Step 1: Write the failing test**

```ts
it('jobthai is a real XLSX file source, not a deprecated API stub', () => {
  const entry = SOURCE_CATALOG.find((s) => s.slug === 'jobthai')!;
  expect(entry.deprecated).toBeUndefined();
  // status and mocked must flip together: prisma/seed.ts writes both from
  // this field on every seed, so a stale `mocked: true` would make
  // realDataWhere() discard every row the connector ever loaded.
  expect(entry.mocked).toBe(false);
  expect(entry.kind).toBe('CSV');
  expect(entry.inputFormat).toBe('XLSX');
  // Files arrive by hand — a cron cadence would run a connector with
  // nothing to do every six hours.
  expect(entry.scheduleEnabled).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @kku/shared test -- catalog`
Expected: FAIL — currently `deprecated: true`, `mocked: true`, `kind: 'API'`.

- [ ] **Step 3: Update the catalog entry**

```ts
  {
    slug: 'jobthai',
    name: 'JobThai (Job postings)',
    kind: 'CSV',
    inputFormat: 'XLSX',
    // Files arrive by hand from JobThai and are uploaded through
    // /admin/jobthai, so there is nothing for a schedule to trigger.
    scheduleEnabled: false,
    ownerContact: 'KKU Data Office',
    notes:
      'Manual XLSX drops of Thai job postings (47,643 rows as of 2026-09). ' +
      'Un-deprecated 2026-09-13: the 2026-05-01 supersession assumed a paid API ' +
      'we never bought, but file drops give us what kmitl-skill-mapping cannot — ' +
      'province granularity, industry sector, and explicit degree + field-of-study ' +
      'requirements (57.8% of postings). CAVEATS: 37% Bangkok, 3.3% Northeast, ' +
      '0.8% postgraduate, and no salary, employer or posting date in the source.',
    mocked: false,
  },
```

Leave `jobsdb` deprecated. Add `MINIO_BUCKET_CSV_UPLOADS=csv-uploads` and `CONNECTOR_JOBTHAI_MODE=real` to `.env.example` with comments.

- [ ] **Step 4: Reseed the data source row and verify both flags moved**

```bash
pnpm db:seed
```

Then verify with a scratch script that `data_sources` where slug='jobthai' has `status='active'` **and** `mocked=false`. Per the drift-audit memory these must never diverge — `status='real'` does not imply `mocked=false`, and the mismatch produces a silently empty UI.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/ingestion/catalog.ts packages/shared/test/ingestion/ .env.example
git commit -F - <<'MSG'
feat(jobthai): un-deprecate as a real XLSX file source

The 2026-05-01 supersession by kmitl-skill-mapping assumed JobThai meant a
paid API we never bought. Hand-delivered file drops give us three things
kmitl-skill-mapping structurally cannot: province granularity, industry
sector, and explicit degree plus field-of-study requirements in 57.8% of
postings.

status and mocked flip together, per the data_sources drift audit:
prisma/seed.ts writes both from the catalog on every seed, so a stale
mocked:true would make realDataWhere() discard every row loaded.

scheduleEnabled is false because files arrive by hand; a six-hourly cron
would wake a connector with nothing to do.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 6: Admin API

**Files:**
- Create: `apps/api/src/jobthai/jobthai.module.ts`, `jobthai.controller.ts`, `jobthai.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/jobthai.service.test.ts`

Follow `apps/api/src/trend-documents/` closely — it is the working precedent for MinIO upload plus content-hash dedupe plus enqueue.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';

import { JOBTHAI_COLUMNS } from '@kku/shared';

import { JobThaiService } from '../src/jobthai/jobthai.service';

function sheetBuffer(headers: readonly string[]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([[...headers], headers.map(() => 'x')]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'S');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function serviceWith(over: Partial<{
  findByHash: (h: string) => Promise<{ id: string } | null>;
  createBatch: (d: Record<string, unknown>) => Promise<{ id: string }>;
  putObject: (a: unknown) => Promise<void>;
  enqueue: (id: string) => Promise<void>;
}> = {}) {
  const calls = { put: 0, created: [] as Record<string, unknown>[], enqueued: [] as string[] };
  const svc = new JobThaiService({
    findByHash: over.findByHash ?? (() => Promise.resolve(null)),
    createBatch: over.createBatch ?? ((d) => { calls.created.push(d); return Promise.resolve({ id: 'b1' }); }),
    putObject: over.putObject ?? (() => { calls.put += 1; return Promise.resolve(); }),
    enqueue: over.enqueue ?? ((id) => { calls.enqueued.push(id); return Promise.resolve(); }),
  } as never);
  return { svc, calls };
}

describe('JobThaiService.ingestFile', () => {
  it('rejects a non-xlsx file by extension', async () => {
    const { svc } = serviceWith();
    await expect(
      svc.ingestFile({ originalFilename: 'jobs.csv', bytes: Buffer.from('a,b'), uploadedByUserId: null }),
    ).rejects.toThrow(/Unsupported file type/i);
  });

  it('rejects a sheet missing an expected column, naming it', async () => {
    const { svc } = serviceWith();
    const headers = JOBTHAI_COLUMNS.filter((c) => c !== 'Province');
    await expect(
      svc.ingestFile({ originalFilename: 'jobs.xlsx', bytes: sheetBuffer(headers), uploadedByUserId: null }),
    ).rejects.toThrow(/Province/);
  });

  it('validates headers BEFORE storing anything', async () => {
    const { svc, calls } = serviceWith();
    const headers = JOBTHAI_COLUMNS.filter((c) => c !== 'Province');
    await svc
      .ingestFile({ originalFilename: 'jobs.xlsx', bytes: sheetBuffer(headers), uploadedByUserId: null })
      .catch(() => undefined);
    // The operator is standing there; a bad file must not reach MinIO.
    expect(calls.put).toBe(0);
    expect(calls.created).toHaveLength(0);
  });

  it('returns deduplicated:true for a byte-identical re-upload without writing', async () => {
    const { svc, calls } = serviceWith({ findByHash: () => Promise.resolve({ id: 'existing' }) });
    const res = await svc.ingestFile({
      originalFilename: 'jobs.xlsx', bytes: sheetBuffer(JOBTHAI_COLUMNS), uploadedByUserId: null,
    });
    expect(res).toEqual({ batchId: 'existing', deduplicated: true });
    expect(calls.put).toBe(0);
  });

  it('creates a PENDING batch and enqueues a parse job', async () => {
    const { svc, calls } = serviceWith();
    const res = await svc.ingestFile({
      originalFilename: 'jobs.xlsx', bytes: sheetBuffer(JOBTHAI_COLUMNS), uploadedByUserId: 'u1',
    });
    expect(res.deduplicated).toBe(false);
    expect(calls.created[0]).toMatchObject({ status: 'PENDING', uploadedByUserId: 'u1' });
    expect(calls.enqueued).toEqual(['b1']);
  });
});
```

The service takes its Prisma and storage collaborators as constructor
dependencies so these tests need neither a database nor MinIO.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter api test -- jobthai`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Mirrors `TrendDocumentsService`: `S3Storage` built in `onModuleInit`, bucket from `MINIO_BUCKET_CSV_UPLOADS`.

`ingestFile({ originalFilename, bytes, uploadedByUserId })`:

1. Extension must be `xlsx`.
2. Non-empty.
3. **Validate headers by calling `parseJobThaiSheet` before storing anything.** A file with the wrong columns must be rejected at upload with the column named, not accepted and failed asynchronously — the operator is standing there.
4. SHA-256 dedupe against `JobThaiBatch.contentHash`; identical bytes return `{ deduplicated: true }`.
5. `putObject` to `csv-uploads/jobthai/<hash>.xlsx`.
6. Create the `PENDING` batch with `receivedDate` = today, `rowCount` from the validation parse.
7. Enqueue the parse.

`list()` returns batches newest-first with a skills-extracted count. `remove(id)` deletes the batch (postings cascade), recomputes occupation aggregates, and deletes the MinIO object.

- [ ] **Step 4: Implement the controller**

`@Authorized('data_sources:configure')` for mutations, `data_sources:read` for the list. `@AuditLog()` on upload and delete. `FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } })` — the files are 4.2–5.4 MB, so 25 MB is headroom without inviting a whole-year dump through a synchronous request.

Add a new `AiJobKind` `'PARSE_JOBTHAI_BATCH'` to **both** `apps/api/src/ai-jobs/ai-jobs-queue.service.ts` and `apps/ingestion/src/ai-jobs/queue.ts`. They are hand-maintained in two places and have already drifted once.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter api test -- jobthai
pnpm typecheck
```
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jobthai/ apps/api/src/app.module.ts apps/api/src/ai-jobs/ apps/ingestion/src/ai-jobs/queue.ts apps/api/test/jobthai.service.test.ts
git commit -F - <<'MSG'
feat(jobthai): admin upload, list and delete endpoints

Follows the trend-documents precedent for MinIO storage plus content-hash
dedupe plus enqueue.

Headers are validated before the file is stored, so a wrong-columns upload
is rejected at the request with the missing column named. Accepting it and
failing asynchronously would make the operator, who is standing there
watching, go and read a job log to learn that Province was missing.

PARSE_JOBTHAI_BATCH is added to both AiJobKind definitions - they are
hand-maintained in two files and have already drifted once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 7: Admin UI at `/admin/jobthai`

**Files:**
- Create: `apps/web/app/admin/jobthai/page.tsx`, `client.tsx`
- Modify: the admin navigation entry alongside the other `/admin/*` links

- [ ] **Step 1: Build the page**

Server component fetches `GET /jobthai/batches` via `apiFetch`. Client component renders a `DataTable` of batches — filename, rows, received date, status badge, skills-extracted count, delete action — plus a drop zone posting multipart to `/jobthai/batches`.

Reuse `DataTable`, `Badge`, `FreshnessBadge`, `RightPanel` from `@kku/ui`. **English labels only** per the language policy. No hardcoded colours — design tokens only, and note that most `border-*` utilities emit no CSS (see the 807-utility defect), so for a non-`border` family use an arbitrary value wrapping the token var: `border-[oklch(var(--color-danger-default)/0.3)]`.

Show a standing caveat line above the table with the real numbers — 37% Bangkok, 3.3% Northeast, 0.8% postgraduate — so nobody reads these counts as a picture of the Isan labour market. Read the rendered strings back: adjacent numbers and text run together in this codebase (`0 of 5. 5 left.` read as one number), so separate the count and its unit structurally, not with a flex gap.

- [ ] **Step 2: Verify in the browser**

The api must be running (`:4000`) — it was down at the start of this session, and `/admin/jobthai` fetches through it. Upload one real file from `/home/denpong/JobThaiData`, confirm the batch appears PENDING then PARSED with ~10,000 rows.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/admin/jobthai/
git commit -F - <<'MSG'
feat(jobthai): admin UI for managing uploaded drops

Table of batches plus a drop zone, following the trend-documents layout.
Carries a standing caveat line with the real geography counts, so nobody
reads a Bangkok-weighted national dataset as a picture of the Isan labour
market.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 8: Occupations and deterministic skill matching

**Files:**
- Create: `apps/ingestion/src/jobthai/derive-occupations.ts`, `match-skills.ts`
- Create: `packages/db/src/jobthai.ts`
- Test: `apps/ingestion/test/jobthai/derive-occupations.test.ts`, `match-skills.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/ingestion/test/jobthai/derive-occupations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { occupationCode, groupPostingsIntoOccupations } from '../../src/jobthai/derive-occupations';

describe('occupationCode', () => {
  it('is namespaced so it cannot collide with a future ISCO-08 code', () => {
    expect(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป')).toMatch(/^jobthai:/);
  });

  it('is stable across calls for the same pair', () => {
    const a = occupationCode('งานบัญชี', 'งานบัญชีทั่วไป');
    expect(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป')).toBe(a);
  });

  it('distinguishes two subcategories under one category', () => {
    expect(occupationCode('งานบัญชี', 'งานบัญชีทั่วไป'))
      .not.toBe(occupationCode('งานบัญชี', 'งานตรวจสอบภายใน'));
  });
});

describe('groupPostingsIntoOccupations', () => {
  const postings = [
    { id: 'p1', jobCategory: 'งานบัญชี', jobSubcategory: 'งานบัญชีทั่วไป' },
    { id: 'p2', jobCategory: 'งานบัญชี', jobSubcategory: 'งานบัญชีทั่วไป' },
    { id: 'p3', jobCategory: 'งานบัญชี', jobSubcategory: 'งานตรวจสอบภายใน' },
  ];

  it('produces one occupation per distinct pair with the right counts', () => {
    const out = groupPostingsIntoOccupations(postings);
    expect(out).toHaveLength(2);
    expect(out.find((o) => o.subcategory === 'งานบัญชีทั่วไป')!.postingCount).toBe(2);
    expect(out.find((o) => o.subcategory === 'งานตรวจสอบภายใน')!.postingCount).toBe(1);
  });

  it('is idempotent — grouping twice yields the same codes', () => {
    const a = groupPostingsIntoOccupations(postings).map((o) => o.code).sort();
    const b = groupPostingsIntoOccupations(postings).map((o) => o.code).sort();
    expect(a).toEqual(b);
  });

  it('ignores postings with a missing category rather than inventing an occupation', () => {
    const out = groupPostingsIntoOccupations([
      ...postings,
      { id: 'p4', jobCategory: null, jobSubcategory: 'งานบัญชีทั่วไป' },
    ]);
    expect(out).toHaveLength(2);
  });
});
```

`apps/ingestion/test/jobthai/match-skills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rollUpOccupationSkills } from '../../src/jobthai/match-skills';

describe('rollUpOccupationSkills', () => {
  it('computes share as postings-with-skill over the occupation total', () => {
    const out = rollUpOccupationSkills({
      occupationPostingCount: 4,
      matches: [
        { postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
        { postingId: 'p2', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
        { postingId: 'p3', skillId: 's2', extractedBy: 'ALIAS_MATCHED' },
      ],
    });
    expect(out.find((r) => r.skillId === 's1')).toMatchObject({ postingCount: 2, share: 0.5 });
    expect(out.find((r) => r.skillId === 's2')).toMatchObject({ postingCount: 1, share: 0.25 });
  });

  it('counts a skill once per posting even when matched twice in the text', () => {
    const out = rollUpOccupationSkills({
      occupationPostingCount: 1,
      matches: [
        { postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
        { postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ postingCount: 1, share: 1 });
  });

  it('emits nothing for a skill with no matches — absent evidence is not a zero-weight row', () => {
    expect(rollUpOccupationSkills({ occupationPostingCount: 10, matches: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter ingestion test -- jobthai`

- [ ] **Step 3: Implement occupation derivation**

Group `JobPosting` where `source='jobthai'` by `(jobCategory, jobSubcategory)`; upsert `JobThaiOccupation` on the unique pair; set `postingCount`. Also write `OccupationDemand` rows keyed `jobthai:<slug>` × province × year/month from `postedDate` — this finally gives the Gap Analyzer's regional lens data, and it must carry `ingestionRunId` so `realDataWhere()` accepts it.

- [ ] **Step 4: Implement deterministic skill matching**

For each posting, tokenise `qualificationRaw` + `descriptionRaw` into candidate phrases, then `lookupAliasesBulk` against the 4,407 skills / 5,313 aliases. Write `JobPostingSkill` with `extractedBy: 'ALIAS_MATCHED'`, then roll up into `JobThaiOccupationSkill` with `postingCount` and `share`.

Process in chunks with `Promise.allSettled`; 47,643 postings sequentially would be tens of minutes of round-trips, the same bottleneck the `kku-research` and `kmitl-skill-mapping` sessions both hit.

- [ ] **Step 5: Run tests, then run for real and record the numbers**

```bash
pnpm --filter ingestion test -- jobthai
pnpm jobthai:derive-occupations --apply
pnpm jobthai:match-skills --apply
```

Record: occupations created (expect 173), postings with ≥1 matched skill, distinct skills matched, and the 20 most-demanded skills. **Expect a low match rate on the first run** — that has been true of every skill-matching pass in this project (KMITL's first run left ~80% unmapped) and it is the input to Task 10, not a failure.

- [ ] **Step 6: Commit**

```bash
git add apps/ingestion/src/jobthai/ packages/db/src/jobthai.ts apps/ingestion/test/jobthai/ package.json
git commit -F - <<'MSG'
feat(jobthai): derive 173 occupations and match skills deterministically

The profession layer comes straight from the two taxonomy columns, which
are 100% populated and source-authoritative, so no LLM is involved.

Skill matching runs against the existing 4,407 skills and 5,313 aliases at
zero cost, writing ALIAS_MATCHED. Province and month aggregates land in the
existing OccupationDemand table, which has never held a row - that is the
Gap Analyzer's regional lens getting data for the first time - and they
carry ingestionRunId so realDataWhere() accepts them.

An unmatched phrase writes nothing rather than a zero-weight row: absent
evidence is not evidence of absence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 9: Embeddings and the semantic second pass

**Files:**
- Modify: `apps/ingestion/src/jobthai/match-skills.ts`
- Create: `apps/ingestion/src/jobthai/embed.ts`
- Test: `apps/ingestion/test/jobthai/embed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';

import {
  JOBTHAI_EMBED_MATCH_FLOOR,
  acceptSemanticMatches,
} from '../../src/jobthai/embed';

describe('acceptSemanticMatches', () => {
  it('rejects a candidate below the floor', () => {
    const out = acceptSemanticMatches({
      existing: [],
      candidates: [{ postingId: 'p1', skillId: 's1', cosine: JOBTHAI_EMBED_MATCH_FLOOR - 0.01 }],
    });
    expect(out).toEqual([]);
  });

  it('accepts at the floor and marks it EMBEDDING_MATCHED', () => {
    const out = acceptSemanticMatches({
      existing: [],
      candidates: [{ postingId: 'p1', skillId: 's1', cosine: JOBTHAI_EMBED_MATCH_FLOOR }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.extractedBy).toBe('EMBEDDING_MATCHED');
  });

  it('never overrides a deterministic alias match for the same posting and skill', () => {
    const out = acceptSemanticMatches({
      existing: [{ postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' }],
      candidates: [{ postingId: 'p1', skillId: 's1', cosine: 0.99 }],
    });
    // The cheap, exact signal wins; a fuzzy one must not downgrade its provenance.
    expect(out).toEqual([]);
  });

  it('reads the floor from the exported constant, not an inlined literal', () => {
    // Guards against a future edit that hardcodes 0.8 somewhere and leaves
    // the constant stale after Task 10 measures the real value.
    expect(JOBTHAI_EMBED_MATCH_FLOOR).toBeGreaterThan(0);
    expect(JOBTHAI_EMBED_MATCH_FLOOR).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement**

Embed the 4,407 `Skill` rows and the 173 occupation profiles through `AiService.embed()`, writing the `vector(1536)` columns with `$queryRaw` (Prisma cannot express the type). **This is the first thing in the project to populate `Skill.embedding`** — the columns have existed since prompt 01 with zero rows.

Then, for postings whose deterministic pass found nothing, match residual phrases by `embedding <-> query_vector` above:

```ts
/** Cosine floor for accepting an embedding-based skill match.
 *
 *  0.80 is a STARTING VALUE, not a measured one. It must be validated
 *  against a hand-checked sample of 100 matches (Task 10) before any
 *  figure derived from it reaches a Council surface. An unvalidated
 *  similarity threshold that mislabels skills produces numbers that look
 *  precise and are not. */
export const JOBTHAI_EMBED_MATCH_FLOOR = 0.8;
```

- [ ] **Step 4: Run tests, then embed for real**

```bash
pnpm --filter ingestion test -- jobthai
pnpm jobthai:embed --apply
```

Verify with a scratch query that `SELECT COUNT(*) FROM skills WHERE embedding IS NOT NULL` is now 4,407, up from 0.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/jobthai/ apps/ingestion/test/jobthai/
git commit -F - <<'MSG'
feat(jobthai): populate skill embeddings and add a semantic match pass

First code in this project to write Skill.embedding - the vector(1536)
columns have existed since prompt 01 and held zero rows.

Alias matches take precedence over embedding matches, so the cheap
deterministic signal is never overridden by a fuzzy one. The 0.80 cosine
floor is a starting value, named rather than inlined, and explicitly
unvalidated until the hand-checked sample in the next task.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

### Task 10: Bounded LLM phases, threshold validation, and the numbers Plan B needs

**Files:**
- Create: `apps/ingestion/src/jobthai/llm-phases.ts`
- Create: `packages/shared/src/ai/prompts/jobthai-occupation-profile.ts`
- Create: `docs/data-sources/jobthai.md` (rewrite — it is currently all `_tbd_` under a SUPERSEDED banner)
- Test: `apps/ingestion/test/jobthai/llm-phases.test.ts`

- [ ] **Step 1: Write the prompt and its Zod schema**

`jobthai-occupation-profile.v1` — input is the occupation name plus a sample of its postings' titles and scrubbed qualification text; output is `{ profileTh, typicalTasksTh[], seniorityHint, confidence }`. Version constant exported, per the prompt-versioning policy: behaviour change bumps the version, never edit a published one in place.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import {
  buildDiscoverySample,
  DISCOVERY_PER_SUBCATEGORY,
  DISCOVERY_HARD_CAP,
  classifyDiscoveredSkill,
} from '../../src/jobthai/llm-phases';

describe('buildDiscoverySample', () => {
  it('takes at most two postings per subcategory', () => {
    const postings = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, jobSubcategory: 'งานบัญชีทั่วไป' }));
    expect(buildDiscoverySample(postings)).toHaveLength(DISCOVERY_PER_SUBCATEGORY);
  });

  it('stratifies across subcategories rather than draining one', () => {
    const postings = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, jobSubcategory: 'A' })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, jobSubcategory: 'B' })),
    ];
    const sample = buildDiscoverySample(postings);
    expect(sample.filter((p) => p.jobSubcategory === 'A')).toHaveLength(2);
    expect(sample.filter((p) => p.jobSubcategory === 'B')).toHaveLength(2);
  });

  it('never exceeds the hard cap even with many subcategories', () => {
    const postings = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, jobSubcategory: `S${i}` }));
    expect(buildDiscoverySample(postings).length).toBeLessThanOrEqual(DISCOVERY_HARD_CAP);
  });
});

describe('classifyDiscoveredSkill', () => {
  it('routes a skill already in the taxonomy to a link, not a proposal', () => {
    expect(classifyDiscoveredSkill({ name: 'Excel', existingSkillId: 'sk-1' }))
      .toEqual({ action: 'link', skillId: 'sk-1' });
  });

  it('routes an unknown skill to PROPOSED_SKILL review, never straight into skills', () => {
    // The taxonomy grew from 561 seeded skills to 4,407 through this queue.
    // Writing Skill rows directly would bypass analyst review entirely.
    expect(classifyDiscoveredSkill({ name: 'การวิเคราะห์ข้อมูลขนาดใหญ่', existingSkillId: null }))
      .toEqual({ action: 'propose', extractionType: 'PROPOSED_SKILL' });
  });
});
```

- [ ] **Step 3: Implement**

Three bounded jobs on the `ai-jobs` queue: occupation profiles (173 calls), field-of-study normalisation over the **distinct** `สาขา` phrasings rather than per posting, and novel-skill discovery on the stratified sample feeding the existing `PROPOSED_SKILL` review queue — which is how the taxonomy has always grown, from 561 seeded skills to today's 4,407.

Budget check before running: the whole task must stay inside the $10/day `AiQuotaGuard`. Print the projected cost and abort if it exceeds it rather than discovering the cap mid-run.

- [ ] **Step 4: Run for real**

```bash
pnpm jobthai:llm-phases --apply
```

Record actual spend from `AiInference.costEstimateUsd` and compare against the ~$2–5 estimate in the spec. **If it is materially higher, write down the real number** — the spec's estimate is then wrong and Plan B should not inherit it.

- [ ] **Step 5: Validate the 0.80 cosine floor — do not skip this**

Sample 100 `EMBEDDING_MATCHED` rows spanning the score range, hand-check each for whether the skill genuinely appears in the posting, and record precision at 0.80 plus what it would be at 0.75 and 0.85. Adjust `JOBTHAI_EMBED_MATCH_FLOOR` to the measured value and re-run the semantic pass.

Until this is done, every embedding-derived figure is unvalidated, and Plan B's driver would be built on it.

- [ ] **Step 6: Record the distributions Plan B needs**

Plan B's two thresholds must come from observation, not guesswork. Produce and commit into `docs/data-sources/jobthai.md`:

- postings per occupation — min, median, max
- **postings per programme** once occupations are provisionally linked, which sets `JOBTHAI_MIN_POSTINGS_FOR_SIGNAL` (the spec's 30 is a placeholder chosen because only 304 Khon Kaen postings exist in total)
- skills per occupation, and the share of postings with no matched skill at all
- how many of the 173 occupations fall below any plausible floor

- [ ] **Step 7: Rewrite the data-source doc**

`docs/data-sources/jobthai.md` is currently every field `_tbd_` beneath a ⛔ SUPERSEDED banner. Replace it: real shape, the measured facts table, the mapping to our schema, the caveats, the parse-and-extract runbook, and a session log dating the un-deprecation.

- [ ] **Step 8: Full verification**

```bash
pnpm --filter @kku/shared test
pnpm --filter @kku/db test
pnpm --filter api test
pnpm --filter ingestion test
pnpm --filter web test
pnpm typecheck
pnpm lint
```

Every suite green, counts at or above baseline (`@kku/shared` 967 · `@kku/db` 437 · web 157 · api 135 · ingestion 193 — **compare file and test counts, not just the pass line**).

Confirm three green connector runs for `jobthai` per the prompt-14 gate, and that `demand_match_filled` is still non-null from Task 1.

- [ ] **Step 9: Commit**

```bash
git add apps/ingestion/src/jobthai/ packages/shared/src/ai/prompts/jobthai-occupation-profile.ts docs/data-sources/jobthai.md apps/ingestion/test/jobthai/
git commit -F - <<'MSG'
feat(jobthai): bounded LLM phases, measured cosine floor, source doc

173 occupation-profile calls, field-of-study normalisation over distinct
phrasings rather than per posting, and novel-skill discovery on a
stratified sample feeding the existing PROPOSED_SKILL review queue - the
path that grew the taxonomy from 561 seeded skills to 4,407.

The 0.80 cosine floor is replaced with the value measured against 100
hand-checked matches. Every embedding-derived figure was unvalidated until
that ran, and Plan B's driver would have been built on it.

docs/data-sources/jobthai.md is rewritten from a page of _tbd_ under a
SUPERSEDED banner into the real spec, and records the per-programme posting
distribution that sets Plan B's signal floor - a number the spec could only
guess at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01PJvHuDaJfLtS58xN4PhBP1
MSG
```

---

## Definition of done

- `/admin/jobthai` uploads, lists and deletes drops; a wrong-columns file is refused at upload with the column named.
- 47,643 postings, 173 occupations and their skills in the database, tagged with `ingestion_run_id`.
- `jobthai` is `mocked: false`, `status: active`, un-deprecated, three green runs.
- `Skill.embedding` populated (4,407 rows, was 0); `OccupationDemand` populated (was 0).
- `demand_match_filled` non-null on programmes that have matches — **verified by reading the driver, not by a passing unit test.**
- Gender and age requirements appear nowhere in the database.
- All suites green, counts not below baseline, typecheck and lint clean.
- No Council figure has moved and `HEALTH_SCORE_VERSION` is unchanged.

## Handoff to Plan B

Plan B needs three things this plan produces and cannot be written responsibly without them: the measured cosine floor, the per-programme posting distribution that sets `JOBTHAI_MIN_POSTINGS_FOR_SIGNAL`, and the actual LLM spend. All three land in `docs/data-sources/jobthai.md` in Task 10.

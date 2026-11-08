# Institute XLSX import, Phase 1 (Framework + org backbone): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic spreadsheet-import framework — one declaration per dataset driving template generation, validation, loading and start-over — and use it to let an adopting university create its faculties, departments and programmes from three uploaded workbooks, with no code edits.

**Architecture:**
- Declarations live in `packages/db/src/import/`, the only package that has Prisma and is reachable from both apps. They must never import `xlsx`.
- The `xlsx` parser and template writer live in `apps/api/src/import/`, matching how `packages/shared/src/jobthai/parse-sheet.ts` is kept off the shared barrel.
- Validation is a pure function over an already-parsed sheet, so its large test surface needs neither a database nor a spreadsheet.
- The upload service mirrors `JobThaiService` exactly: `@Optional()`-injected `deps` so unit tests need no database and no MinIO.
- Each dataset writes its own rows in plain Prisma. The framework does not abstract the writes — there is no generic upsert helper, because three to twenty lines of explicit Prisma per dataset is clearer than a generic one nobody can read.

**Tech Stack:** TypeScript strict, Prisma 5 / PostgreSQL 16, NestJS, Next.js 14 App Router, Zod, Vitest, `xlsx@0.18.5`, MinIO via `S3Storage`.

**Spec:** `docs/superpowers/specs/2026-10-17-institute-xlsx-import-design.md`. This plan covers spec §9 Phase 1: §6.1–§6.3, §6.5–§6.10, §7, §8.1, §8.2, and the tier-0 rows of §5.2. Tier 1 and tier 2 datasets are later plans.

## Global Constraints

- **No `any`.** TypeScript strict. Zod on every I/O boundary. Explicit return types on every exported function in `packages/*` — those packages build with `declaration: true` and inferred types referencing Prisma internals fail the portability check.
- **`packages/db/src/import/**` must not import `xlsx`.** Task 1 adds a test that asserts this, because the failure it prevents (pulling a server-only parser into a bundle) is invisible until a build breaks.
- **`packages/shared` has no `@prisma/client` dependency.** Nothing placed there may name a Prisma type.
- **Roles are `SUPER_ADMIN | SYSTEM_ADMIN | UNIVERSITY_USER | FACULTY_USER | PROGRAM_USER`.** There is no `ADMIN` role; CLAUDE.md's `ANALYST`/`ADMIN`/`COUNCIL` vocabulary is stale. Upload is gated `data_sources:configure`; start-over is gated by a new `imports:destroy`.
- **Every mutation carries `@AuditLog`.** Actions: `import.upload`, `import.start_over`.
- **Migrations:** hand-written SQL in a new timestamped folder (`packages/db/prisma/migrations/20261017120000_import_batches/migration.sql`), applied with `pnpm db:migrate`. **Never** run `prisma migrate dev`, `migrate reset`, `db push`, or `migrate diff --from-migrations`, and never pass `--shadow-database-url`. The repo's `PreToolUse` guard denies these outright and must not be worked around.
- **Never name `.env` in a shell command.** The same guard blocks it. Use `cut -d= -f1 .env` for key names if needed.
- **PII:** validation error messages name a sheet, a row and a column. They **never** echo a cell value that triggered a privacy rule. No real national ID, personal email or name+ID pair in any test fixture — use obviously synthetic values.
- **UI:** English labels, design tokens only, no hex. Use `border-default`, **not** `border-border-default`, which emits no CSS repo-wide. `sonner` toasts, not modals.
- **Commits:** conventional style. Write the message to a file and use `git commit -F <file>` — the guard rejects some `-m` strings. End every message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run a workspace's tests with `pnpm --filter <workspace> test`. A single file: `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts`. Workspace filter names are `@kku/db`, `@kku/shared`, `api`, `ingestion`, `web`.
- **`packages/db` has no build step** — its `package.json` points `main`/`types` straight at `src/index.ts`, so apps consume the TypeScript source and `declaration: true` from `tsconfig.base.json` applies. Every exported function needs an explicit return type and a named exported interface for its result.
- **Never import `@prisma/client` directly in app code.** `@kku/db` re-exports it; import `{ prisma, type Prisma }` from `@kku/db`.
- **A new Prisma model with an `ingestionRunId` needs a back-relation line on `IngestionRun`**, alongside the existing `jobThaiBatches` / `jobPostings` entries.
- **Adding a permission:** append to `PERMISSIONS` in resource order. `SUPER_ADMIN_PERMS` spreads it and `SYSTEM_ADMIN_PERMS` filters only `queues:manage` and `ai_models:configure`, so both admin roles pick it up with no further edit — record the grant in a comment beside it, as `scholar:admin` does, and assert it in a test.

## Review Focus

Five input classes the spec implies but does not name, ordered by how likely they are to bite a real operator. Each has a test in the task that owns the code.

1. **A header with a trailing space.** `"Faculty Code "` is what Excel gives you when someone types into a cell. Exact matching reports "missing column: Faculty Code" while the operator is looking straight at that column — the most infuriating possible failure. Headers must be trimmed before comparison. Tested in Task 3.
2. **A code Excel turned into a number.** `001` in a code column arrives as `1`, and `1.0` for a decimal-formatted cell. A `text`-typed column must accept a numeric cell and render it without a decimal point or lost leading zeros, or every adopter whose faculty codes start with `0` is blocked. Tested in Task 3.
3. **Blank trailing rows.** Excel files routinely carry hundreds of empty rows after the data. A row whose every cell is null must be skipped silently, not reported as a required-field error per column — otherwise one stray blank row produces an error list longer than the cap. Tested in Task 3.
4. **Re-uploading a file after start-over.** Start-over marks batches `CLEARED` rather than deleting them, so the `(datasetSlug, contentHash)` unique still holds the old row. The dedupe check must ignore cleared batches or replay — the entire recovery story — is impossible. Tested in Task 5 and Task 9.
5. **A date cell as an Excel serial number.** `45200` is 2023-10-07. A `date` column must accept the serial, the ISO string and a real `Date`, or half of all uploads land with nonsense years. Tested in Task 3.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/privacy/national-id.ts` (create) | `looksLikeThaiNationalId()` — mod-11 checksum |
| `packages/shared/src/privacy/index.ts` (create) | barrel for the above |
| `packages/shared/src/auth/permissions.ts` (modify) | add `imports:destroy` |
| `packages/db/src/import/types.ts` (create) | every declaration and result type |
| `packages/db/src/import/registry.ts` (create) | slug → declaration; list; lookup |
| `packages/db/src/import/validate.ts` (create) | pure sheet validation |
| `packages/db/src/import/batches.ts` (create) | batch rows, ingestion runs, start-over |
| `packages/db/src/import/datasets/{faculties,departments,programs}.ts` (create) | tier-0 declarations |
| `packages/db/src/import/index.ts` (create) | barrel, re-exported from `@kku/db` |
| `packages/db/prisma/schema.prisma` (modify) + `migrations/20261017120000_import_batches/migration.sql` (create) | `ImportBatch`, provenance columns |
| `packages/db/prisma/seed.ts` (modify) | `DataSource` row per dataset |
| `apps/api/src/import/parse.ts` (create) | bytes → `ParsedSheet` |
| `apps/api/src/import/template.ts` (create) | declaration → workbook bytes |
| `apps/api/src/import/import.service.ts` (create) | upload, template, start-over, listing |
| `apps/api/src/import/import.controller.ts` (create) | REST surface |
| `apps/api/src/import/import.module.ts` (create) | wiring |
| `apps/api/src/app.module.ts` (modify) | register `ImportModule` |
| `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx` (modify) | registry from the API; import panel |
| `apps/web/app/admin/data-setup/raw/[dataset]/import-panel.tsx` (create) | download / upload / batches / start-over |
| `apps/web/app/api/admin-imports/**` (create) | multipart + JSON proxies |
| `docs/data-import.md` (create), `docs/data-sources/README.md` (modify) | adopter guide |

---

### Task 1: Declaration types and registry

**Files:**
- Create: `packages/db/src/import/types.ts`, `packages/db/src/import/registry.ts`, `packages/db/src/import/index.ts`
- Test: `packages/db/test/import-registry.test.ts`

**Interfaces:**
- Produces:
  - `ImportCellType = 'text' | 'integer' | 'decimal' | 'date' | 'boolean' | 'enum'`
  - `ImportCellValue = string | number | boolean | Date | null`
  - `ImportRow = Readonly<Record<string, ImportCellValue>>`
  - `interface ImportColumn { header: string; key: string; type: ImportCellType; required: boolean; enumValues?: readonly string[]; guide: string; example: string; references?: { dataset: string; column: string }; groupSizeFor?: { minimum: number } }`
  - `type ImportMatch = { kind: 'unique'; columns: readonly string[] } | { kind: 'manual'; columns: readonly string[]; fallback?: readonly string[] }`
  - `type ImportStrategy = { kind: 'upsert'; match: ImportMatch } | { kind: 'term-scoped'; termColumns: readonly string[]; match: ImportMatch }`
  - `interface ImportValidationError { sheet: string; row: number; column: string | null; message: string }` — `row` is the 1-based spreadsheet row, so the header is row 1 and the first data row is row 2
  - `interface ImportLoadContext { tx: Prisma.TransactionClient; ingestionRunId: string }`
  - `interface ImportLoadResult { inserted: number; updated: number; deleted: number }`
  - `interface PrefillOptions { fromYear?: number; toYear?: number }`
  - `interface ImportDataset { slug: string; title: string; description: string; tier: 0 | 1 | 2; sheetName: string; columns: readonly ImportColumn[]; strategy: ImportStrategy; prefill?: (prisma: PrismaClient, opts: PrefillOptions) => Promise<readonly ImportRow[]>; load: (ctx: ImportLoadContext, rows: readonly ImportRow[]) => Promise<ImportLoadResult>; count: (prisma: PrismaClient) => Promise<number>; clear: (tx: Prisma.TransactionClient, runIds: readonly string[]) => Promise<number>; dependents?: readonly string[] }`
  - `IMPORT_DATASETS: readonly ImportDataset[]`, `getImportDataset(slug: string): ImportDataset` (throws `ApiError('NOT_FOUND', …)` on an unknown slug), `listImportDatasets(): readonly ImportDataset[]`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`packages/db/test/import-registry.test.ts`, covering structural invariants that would otherwise only surface at runtime:

```ts
describe('import registry', () => {
  it('returns a dataset by slug', () => {
    expect(getImportDataset('faculties').slug).toBe('faculties');
  });
  it('throws a NOT_FOUND ApiError for an unknown slug', () => {
    expect(() => getImportDataset('nope')).toThrow(/nope/);
  });
  it('has unique slugs', () => {
    const slugs = IMPORT_DATASETS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
  it('has unique column keys and headers within each dataset', () => {
    for (const d of IMPORT_DATASETS) {
      expect(new Set(d.columns.map((c) => c.key)).size).toBe(d.columns.length);
      expect(new Set(d.columns.map((c) => c.header)).size).toBe(d.columns.length);
    }
  });
  it('only names match columns that exist', () => {
    for (const d of IMPORT_DATASETS) {
      const keys = new Set(d.columns.map((c) => c.key));
      for (const k of d.strategy.match.columns) expect(keys).toContain(k);
    }
  });
  it('only references datasets that exist, on a column that exists there', () => {
    for (const d of IMPORT_DATASETS) {
      for (const c of d.columns) {
        if (!c.references) continue;
        const target = IMPORT_DATASETS.find((x) => x.slug === c.references!.dataset);
        expect(target, `${d.slug}.${c.key} → ${c.references.dataset}`).toBeDefined();
        expect(target!.columns.map((x) => x.key)).toContain(c.references.column);
      }
    }
  });
  it('gives every enum column its values', () => {
    for (const d of IMPORT_DATASETS) {
      for (const c of d.columns) {
        if (c.type === 'enum') expect(c.enumValues?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
  it('gives every column guide text and an example', () => {
    for (const d of IMPORT_DATASETS) {
      for (const c of d.columns) {
        expect(c.guide.length, `${d.slug}.${c.key}`).toBeGreaterThan(10);
        expect(c.example.length, `${d.slug}.${c.key}`).toBeGreaterThan(0);
      }
    }
  });
  it('never imports xlsx into packages/db', () => {
    // Guards the server-only boundary the JobThai barrel comment describes.
    const dir = path.join(__dirname, '..', 'src', 'import');
    for (const f of walk(dir)) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/from ['"]xlsx['"]/);
    }
  });
});
```

The registry starts empty, so the slug-lookup cases are written now and pass once Task 7 lands; keep them and let them fail until then, or seed the registry with the faculties declaration in Task 7 and run this suite again. The invariant tests pass vacuously over an empty registry and become load-bearing as declarations arrive.

- [ ] **Step 2: Run the test and watch it fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-registry.test.ts`
Expected: FAIL — module `../src/import` not found.

- [ ] **Step 3: Write `types.ts`**

Every type in the Interfaces block above, each exported, each with a one-line comment saying what it is for. `ImportValidationError.row` carries a comment stating it is a spreadsheet row number, because every consumer renders it to an operator who is counting rows in Excel.

- [ ] **Step 4: Write `registry.ts` and `index.ts`**

`IMPORT_DATASETS` is an empty `readonly ImportDataset[]` for now, populated in Task 7. `getImportDataset` throws `new ApiError('NOT_FOUND', ...)` from `@kku/shared` naming the slug and listing the valid ones. `index.ts` re-exports `./types`, `./registry`.

- [ ] **Step 5: Export from the package barrel**

Add `export * from './import';` to `packages/db/src/index.ts`, in the existing alphabetical-ish block.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @kku/db exec vitest run test/import-registry.test.ts`
Expected: PASS, except the two slug-lookup cases, which fail until Task 7. Mark them `it.todo` if that is cleaner, and restore them in Task 7.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @kku/db exec tsc --noEmit`

```bash
git add packages/db/src/import packages/db/src/index.ts packages/db/test/import-registry.test.ts
git commit -F .git/COMMIT_MSG_import_types
```

---

### Task 2: Thai national-ID detector

**Files:**
- Create: `packages/shared/src/privacy/national-id.ts`, `packages/shared/src/privacy/index.ts`
- Test: `packages/shared/test/national-id.test.ts`

**Interfaces:**
- Produces: `looksLikeThaiNationalId(value: string): boolean`
- Consumes: nothing.

The check is the standard mod-11: strip spaces and hyphens; require exactly 13 digits; `sum = Σ digit[i] × (13 − i)` for `i` in `0..11`; the check digit is `(11 − (sum % 11)) % 10` and must equal `digit[12]`. The checksum is what keeps a 13-digit course or class code from being flagged, which is why a bare length test will not do.

- [ ] **Step 1: Write the failing test**

```ts
describe('looksLikeThaiNationalId', () => {
  it('accepts a well-formed synthetic id', () => {
    expect(looksLikeThaiNationalId('1101700207364')).toBe(true);
  });
  it('accepts one written with hyphens and spaces', () => {
    expect(looksLikeThaiNationalId('1-1017-00207-36-4')).toBe(true);
  });
  it('rejects 13 digits that fail the checksum', () => {
    expect(looksLikeThaiNationalId('1101700207365')).toBe(false);
  });
  it('rejects anything that is not 13 digits', () => {
    for (const v of ['', '123', '11017002073641', 'KKU-SEQ-0001', '2568'])
      expect(looksLikeThaiNationalId(v)).toBe(false);
  });
});
```

Derive the valid fixture by computing the check digit for an arbitrary 12-digit prefix; do not copy a real number from anywhere.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/shared exec vitest run test/national-id.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement `looksLikeThaiNationalId` in `packages/shared/src/privacy/national-id.ts`**

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @kku/shared exec vitest run test/national-id.test.ts`
Expected: PASS, 4 cases.

- [ ] **Step 5: Add `imports:destroy` to the permission list**

In `packages/shared/src/auth/permissions.ts`, add `'imports:destroy'` to the `PERMISSIONS` array in the `// Admin` block beside `data_sources:configure`. Both `SUPER_ADMIN_PERMS` and `SYSTEM_ADMIN_PERMS` spread `PERMISSIONS`, so both roles gain it with no further edit — which is the intended grant today, separable later.

- [ ] **Step 6: Run the shared suite and commit**

Run: `pnpm --filter @kku/shared test`
Expected: PASS, including the existing permission-matrix tests.

```bash
git add packages/shared/src/privacy packages/shared/src/auth/permissions.ts packages/shared/test/national-id.test.ts
git commit -F .git/COMMIT_MSG_import_privacy
```

---

### Task 3: Validation engine

The largest test surface in the plan, and all of it pure. Every Review Focus item except #4 is pinned here.

**Files:**
- Create: `packages/db/src/import/validate.ts`
- Test: `packages/db/test/import-validate.test.ts`

**Interfaces:**
- Consumes: Task 1's types; Task 2's `looksLikeThaiNationalId`.
- Produces:
  - `interface ParsedSheet { sheetName: string; headers: readonly string[]; rows: readonly Readonly<Record<string, unknown>>[] }` — `rows[i]` is spreadsheet row `i + 2`
  - `interface ValidationContext { references: ReadonlyMap<string, ReadonlySet<string>>; heldRowCount: number; allowShrink: boolean; maxRows: number }`
  - `type ValidateResult = { ok: true; rows: readonly ImportRow[]; term: Readonly<Record<string, ImportCellValue>> | null } | { ok: false; errors: readonly ImportValidationError[]; totalErrors: number }`
  - `validateSheet(dataset: ImportDataset, parsed: ParsedSheet, ctx: ValidationContext): ValidateResult`
  - `MAX_REPORTED_ERRORS = 100`

Validation order, which the tests assert by checking *which* error comes back for input that violates several rules at once: headers → row-level cells → key integrity → references → privacy → whole-file guards. A header failure returns immediately without reporting cell errors, because every cell error would be noise about a sheet whose shape is already wrong.

- [ ] **Step 1: Write the failing test**

`packages/db/test/import-validate.test.ts`. Build a small fixture dataset inline (not from the real registry, so the suite does not move when a declaration changes):

```ts
const FIXTURE: ImportDataset = {
  slug: 'fixture', title: 'Fixture', description: '', tier: 0, sheetName: 'Data',
  columns: [
    { header: 'Code', key: 'code', type: 'text', required: true, guide: 'g', example: 'A1' },
    { header: 'Name', key: 'name', type: 'text', required: true, guide: 'g', example: 'x' },
    { header: 'Year', key: 'year', type: 'integer', required: false, guide: 'g', example: '2568' },
    { header: 'Level', key: 'level', type: 'enum', required: false, enumValues: ['BACHELOR', 'MASTER'], guide: 'g', example: 'BACHELOR' },
    { header: 'Started', key: 'started', type: 'date', required: false, guide: 'g', example: '2024-01-31' },
    { header: 'Headcount', key: 'headcount', type: 'integer', required: false, groupSizeFor: { minimum: 5 }, guide: 'g', example: '7' },
  ],
  strategy: { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } },
  load: async () => ({ inserted: 0, updated: 0, deleted: 0 }),
  count: async () => 0,
  clear: async () => 0,
};
```

Cases, each asserting the message names the right row and column:

```
headers
  ✓ accepts headers in a different order from the declaration
  ✓ trims whitespace on headers before comparing          // Review Focus 1
  ✓ reports every missing header in one error
  ✓ rejects an unknown header, naming it                  // the PII backstop
  ✓ returns header errors alone, without cell errors, when both are present

cells
  ✓ required cell null → error naming row and column
  ✓ integer column given "12" → 12
  ✓ integer column given 12.5 → error
  ✓ decimal column given "1,234.50" → 1234.5
  ✓ text column given the number 1 → "1"                  // Review Focus 2
  ✓ text column given 1.0 → "1", never "1.0"              // Review Focus 2
  ✓ text column trims surrounding whitespace
  ✓ enum column rejects a value outside enumValues, listing the allowed ones
  ✓ enum column is case-sensitive
  ✓ date column accepts an ISO string
  ✓ date column accepts an Excel serial number            // Review Focus 5
  ✓ date column accepts a Date
  ✓ date column rejects "31/02/2024"
  ✓ boolean column accepts true/false/1/0/yes/no
  ✓ a row whose every cell is null is skipped silently    // Review Focus 3
  ✓ skipped blank rows do not shift the reported row numbers of later rows

keys
  ✓ duplicate key values → one error naming both spreadsheet rows
  ✓ a null in a key column → error even when the column is not `required`

references
  ✓ a reference value absent from ctx.references → error naming the value
  ✓ a reference value present → ok

privacy
  ✓ a cell holding a valid national id → error, and the message does NOT contain the value
  ✓ groupSizeFor: a row with headcount 4 → error; 5 → ok; null → ok

whole-file guards
  ✓ rows > ctx.maxRows → single error, no per-row errors
  ✓ rows < half of heldRowCount and !allowShrink → shrink error
  ✓ same, with allowShrink → ok
  ✓ heldRowCount 0 never triggers the shrink guard
  ✓ more than MAX_REPORTED_ERRORS errors → exactly 100 returned, totalErrors is the true count

term-scoped
  ✓ a term-scoped dataset whose rows disagree on the term columns → error naming the first dissenting row
  ✓ agreeing rows → ok, and `term` carries the shared values
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts`
Expected: FAIL — `validateSheet` not exported.

- [ ] **Step 3: Implement `validateSheet` in `packages/db/src/import/validate.ts`**

Coercion rules the tests pin and the signature does not:
- `text` from a number uses `Number.isInteger(v) ? String(v) : String(v)` — never `toFixed`, so `1` renders `"1"`. A value arriving as a string keeps its leading zeros; a value arriving as a number has already lost them in Excel and cannot be recovered, which the guide sheet warns about.
- `date` from a number is the Excel serial epoch: `new Date(Date.UTC(1899, 11, 30) + serial × 86_400_000)`. Reject a serial below 1 or above 2_958_465.
- `decimal` strips `,` before parsing; rejects anything `Number.isFinite` refuses.
- A blank row is one where every declared column's cell is `null`, `undefined` or an empty/whitespace string.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kku/db exec vitest run test/import-validate.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @kku/db exec tsc --noEmit`

```bash
git add packages/db/src/import/validate.ts packages/db/test/import-validate.test.ts
git commit -F .git/COMMIT_MSG_import_validate
```

---

### Task 4: Schema — `ImportBatch` and provenance columns

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20261017120000_import_batches/migration.sql`
- Test: `packages/db/test/import-schema.test.ts`

**Interfaces:**
- Produces: the `ImportBatch` model and `ImportBatchStatus` enum; nullable `ingestionRunId` on `Faculty`, `Department`, `Program`, `FacultyMember`.

- [ ] **Step 1: Add the model to `schema.prisma`**

Exactly as spec §8.1, including `clearedAt`, the `ingestionRun` relation with `onDelete: SetNull`, `@@unique([datasetSlug, contentHash])`, `@@index([datasetSlug, createdAt])` and `@@index([ingestionRunId])`.

- [ ] **Step 2: Add the provenance columns**

`ingestionRunId String? @map("ingestion_run_id")` plus the relation and `@@index([ingestionRunId])` on `Faculty`, `Department`, `Program`, `FacultyMember`. All nullable, `onDelete: SetNull` — nothing existing changes behaviour, since `realDataWhere()` is never applied to these four.

Add five back-relation lines to `IngestionRun` (the four above plus `importBatches ImportBatch[]`), in the existing back-relation block beside `jobThaiBatches`. Prisma fails to generate without them, so this is not optional tidiness.

- [ ] **Step 3: Hand-write the migration SQL**

`CREATE TYPE "ImportBatchStatus" AS ENUM (...)`, `CREATE TABLE "import_batches" (...)`, the two indexes and the unique, the FK to `ingestion_runs` with `ON DELETE SET NULL`, then four `ALTER TABLE … ADD COLUMN "ingestion_run_id" TEXT`, four FKs and four indexes. Use `IF NOT EXISTS` on the indexes so a re-run is safe.

- [ ] **Step 4: Apply and regenerate**

Run: `pnpm db:migrate && pnpm db:generate`
Expected: one migration applied, client regenerated.

- [ ] **Step 5: Write and run the schema test**

```ts
it('can create and clear an import batch', async () => {
  const b = await prisma.importBatch.create({ data: { datasetSlug: 'faculties', filename: 'f.xlsx', contentHash: 'h1', storageKey: 'k', fileSize: 1, rowCount: 1, status: 'SUCCEEDED' } });
  await prisma.importBatch.update({ where: { id: b.id }, data: { status: 'CLEARED', clearedAt: new Date() } });
  await prisma.importBatch.delete({ where: { id: b.id } });
});
it('rejects a duplicate (datasetSlug, contentHash)', async () => { /* expect the create to reject */ });
it('allows the same hash under a different dataset', async () => { /* … */ });
```

Run: `pnpm --filter @kku/db exec vitest run test/import-schema.test.ts`
Expected: PASS. This suite talks to the dev database, as other `packages/db` suites do.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261017120000_import_batches packages/db/test/import-schema.test.ts
git commit -F .git/COMMIT_MSG_import_schema
```

---

### Task 5: Batch store, ingestion runs and start-over

**Files:**
- Create: `packages/db/src/import/batches.ts`
- Test: `packages/db/test/import-batches.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 4 schema.
- Produces:
  - `importDataSourceSlug(datasetSlug: string): string` → `` `xlsx-${datasetSlug}` ``
  - `findLiveBatchByHash(datasetSlug: string, contentHash: string): Promise<{ id: string; rowCount: number } | null>` — **ignores `CLEARED`** (Review Focus 4)
  - `listImportBatches(datasetSlug: string, limit?: number): Promise<ImportBatchView[]>` where `ImportBatchView = { id: string; filename: string; rowCount: number; fileSize: number; status: ImportBatchStatus; createdAt: Date; clearedAt: Date | null; uploadedBy: string | null; storageKey: string }`
  - `startImportRun(datasetSlug: string, userId: string | null): Promise<{ runId: string }>` — creates an `IngestionRun` against the dataset's `DataSource`, trigger `MANUAL`, status `RUNNING`; throws if the `DataSource` row is absent, naming `pnpm db:seed`
  - `finishImportRun(runId: string, result: { loaded: number; failed: number; status: 'SUCCEEDED' | 'FAILED'; errorMessage?: string }): Promise<void>`
  - `startOverDataset(datasetSlug: string): Promise<{ rowsDeleted: number; batchesCleared: number }>`
  - `importDatasetStatus(datasetSlug: string): Promise<{ rowCount: number; lastUpload: Date | null; batchCount: number; liveBatchCount: number }>`

`startOverDataset` runs in one `$transaction`: resolve the dataset's import run ids; refuse with an `ApiError('VALIDATION_FAILED', …)` naming the blocking datasets if any `dependents` entry reports a non-zero `count()`; call `dataset.clear(tx, runIds)`; mark those `IngestionRun` rows' batches `CLEARED` with `clearedAt`; delete the `IngestionRun` rows **after** the data rows. Uploaded objects in MinIO are untouched.

- [ ] **Step 1: Write the failing test**

Against the dev database, creating and removing its own `DataSource` row:

```
✓ findLiveBatchByHash returns a SUCCEEDED batch
✓ findLiveBatchByHash returns null for a CLEARED batch with the same hash   // Review Focus 4
✓ startImportRun creates a RUNNING run against xlsx-<slug>
✓ startImportRun throws, naming `pnpm db:seed`, when the DataSource is missing
✓ finishImportRun records counts and completedAt
✓ startOverDataset deletes only rows written by this dataset's import runs
✓ startOverDataset leaves rows with a null ingestionRunId alone
✓ startOverDataset marks batches CLEARED rather than deleting them
✓ startOverDataset refuses while a dependent dataset holds rows, naming it
✓ importDatasetStatus reports row count, batch count and last upload
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-batches.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `batches.ts`**

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kku/db exec vitest run test/import-batches.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
git add packages/db/src/import/batches.ts packages/db/test/import-batches.test.ts
git commit -F .git/COMMIT_MSG_import_batches
```

---

### Task 6: Tier-0 declarations — faculties and departments

**Files:**
- Create: `packages/db/src/import/datasets/faculties.ts`, `packages/db/src/import/datasets/departments.ts`
- Modify: `packages/db/src/import/registry.ts`
- Test: `packages/db/test/import-datasets-org.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 5 helpers.
- Produces: `facultiesDataset`, `departmentsDataset`, both `ImportDataset`, registered in `IMPORT_DATASETS`.

Columns — faculties (`sheetName: 'Faculties'`, `match: { kind: 'unique', columns: ['code'] }`, `dependents: ['departments', 'programs']`):

| header | key | type | required | notes |
|---|---|---|---|---|
| `Faculty Code` | `code` | text | yes | the adopter's own code; becomes `Faculty.code` |
| `Name (Thai)` | `nameTh` | text | yes | |
| `Name (English)` | `nameEn` | text | yes | |
| `Kind` | `kind` | enum | no | `ACADEMIC`/`ADMIN`/`INSTITUTE`/`RESEARCH_CENTER`, default `ACADEMIC` |

Departments (`sheetName: 'Departments'`, key `code`, `dependents: ['programs']`): `Department Code` → `code`, `Name (Thai)`, `Name (English)`, and `Faculty Code` → `facultyCode`, `references: { dataset: 'faculties', column: 'code' }`.

`load` resolves `facultyCode` → `Faculty.id` with one `findMany` before the loop, then upserts on `code`, stamping `ingestionRunId`. `count` is `prisma.faculty.count()`. `clear` is `deleteMany({ where: { ingestionRunId: { in: runIds } } })`.

- [ ] **Step 1: Write the failing test**

```
faculties
  ✓ load inserts a new faculty with the run id stamped
  ✓ load updates an existing faculty by code without duplicating
  ✓ load defaults Kind to ACADEMIC when the cell is blank
  ✓ clear removes only rows carrying the given run ids
departments
  ✓ load resolves Faculty Code to the faculty id
  ✓ load fails loudly when the faculty code is absent (should be unreachable — validation catches it first)
registry
  ✓ getImportDataset('faculties') and ('departments') resolve
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-datasets-org.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both declarations and register them**

Write the guide text as prose an adopter can act on — for `Faculty Code`, say that it is their own identifier, that it must stay stable between uploads because it is how rows are matched, and that leading zeros survive only if the cell is formatted as text.

- [ ] **Step 4: Run both suites**

Run: `pnpm --filter @kku/db exec vitest run test/import-datasets-org.test.ts test/import-registry.test.ts`
Expected: PASS, including the two slug-lookup cases deferred in Task 1.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/import packages/db/test/import-datasets-org.test.ts
git commit -F .git/COMMIT_MSG_import_org_datasets
```

---

### Task 7: Tier-0 declaration — programmes, with canonicality

The task that makes imported programmes visible. Spec §6.8.

**Files:**
- Create: `packages/db/src/import/datasets/programs.ts`
- Modify: `packages/db/src/import/registry.ts`
- Test: `packages/db/test/import-datasets-programs.test.ts`

**Interfaces:**
- Produces: `programsDataset: ImportDataset`.

Columns (`sheetName: 'Programmes'`, key `code`): `Programme Code` → `code`; `Name (Thai)`, `Name (English)`; `Faculty Code` → `facultyCode` (`references` faculties); `Department Code` → `departmentCode`, optional, references departments; `Level` → enum `BACHELOR|MASTER|DOCTORAL|HIGHER_GRAD_DIPLOMA`; `Status` → enum `ACTIVE|PAUSED|SUNSET`, optional, default `ACTIVE`; `Year Established` integer optional; `Duration (years)` integer optional; `Total Credits` integer optional; `MHESI Code` text optional.

`sequenceNoFromSheet` is **not** a column. On insert the loader assigns `(max(sequenceNoFromSheet) ?? 0) + 1` inside the transaction, exactly as `apps/api/src/programs/programs.service.ts:529-532`. On update of an existing code it is left untouched.

- [ ] **Step 1: Write the failing test**

```
✓ an inserted programme is CANONICAL — sequenceNoFromSheet is not null
✓ two programmes inserted in one load get consecutive sequence numbers
✓ a load into a database that already has sequence 7 starts at 8
✓ updating an existing programme by code leaves its sequence number unchanged
✓ the row is visible through withCanonical()
✓ Status defaults to ACTIVE
✓ Department Code may be blank → departmentId null
✓ clear removes only rows carrying the given run ids
```

The `withCanonical()` case is the one that matters: it is the assertion that would have caught the invisible-programme bug the design review found.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @kku/db exec vitest run test/import-datasets-programs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the declaration**

Resolve faculty and department codes in one `findMany` each before the loop. Allocate sequence numbers once per load with a single `aggregate`, then increment in memory, so N inserts do not issue N aggregates. The whole load already runs inside the caller's transaction, so a concurrent upload conflicts on the `@unique` and the transaction retries — note this in a comment.

- [ ] **Step 4: Run the tests and commit**

Run: `pnpm --filter @kku/db exec vitest run test/import-datasets-programs.test.ts`
Expected: PASS.

```bash
git add packages/db/src/import packages/db/test/import-datasets-programs.test.ts
git commit -F .git/COMMIT_MSG_import_programs_dataset
```

---

### Task 8: Spreadsheet parser

**Files:**
- Create: `apps/api/src/import/parse.ts`
- Test: `apps/api/test/import-parse.test.ts`

**Interfaces:**
- Consumes: `ParsedSheet` from `@kku/db`.
- Produces: `parseImportWorkbook(bytes: Buffer, sheetName: string): { ok: true; parsed: ParsedSheet } | { ok: false; error: string }`

Never throws, mirroring `parseJobThaiSheet`. Reads only `sheetName`; a workbook missing it fails with a message listing the sheets it does have. Uses `XLSX.utils.sheet_to_json(ws, { defval: null, raw: true })` — `raw: true` so dates arrive as serials for Task 3 to coerce, rather than as locale-formatted strings.

- [ ] **Step 1: Write the failing test**

Build workbooks in-test with `XLSX.utils.aoa_to_sheet` / `book_new` / `write({ type: 'buffer' })`:

```
✓ reads headers and rows from the named sheet
✓ ignores other sheets, including one named Guide
✓ a workbook without the named sheet fails, listing the sheets present
✓ unreadable bytes fail with a message, never throw
✓ a sheet with headers and no data rows succeeds with rows: []
✓ a numeric cell arrives as a number, a date cell as a serial number
```

The empty-rows case succeeds here and is rejected later only if the dataset needs rows — the parser's job is shape, not policy.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter api exec vitest run test/import-parse.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `parseImportWorkbook`**

- [ ] **Step 4: Run it and commit**

Run: `pnpm --filter api exec vitest run test/import-parse.test.ts`
Expected: PASS.

```bash
git add apps/api/src/import/parse.ts apps/api/test/import-parse.test.ts
git commit -F .git/COMMIT_MSG_import_parse
```

---

### Task 9: Template writer

**Files:**
- Create: `apps/api/src/import/template.ts`
- Test: `apps/api/test/import-template.test.ts`

**Interfaces:**
- Produces: `buildImportTemplate(dataset: ImportDataset, prefillRows: readonly ImportRow[]): Buffer`, `importTemplateFilename(dataset: ImportDataset, today: Date): string` → `` `${slug}-template-${YYYY-MM-DD}.xlsx` ``

Two sheets. The data sheet carries the headers in declared order, then one row per prefill row with only the columns that row supplies. The `Guide` sheet carries a preamble block — dataset title, what the key columns are, a sentence saying that re-uploading updates rows matching the key and leaves others alone — then a header row `Column | Required | Type | What to put | Example | Allowed values` and one row per column.

- [ ] **Step 1: Write the failing test**

```
✓ the workbook has exactly the data sheet and Guide, in that order
✓ the data sheet's first row is the declared headers, in declared order
✓ with no prefill rows the data sheet has only the header row
✓ prefill rows appear under the right headers, blanks for columns they omit
✓ the Guide has one row per column, in declared order
✓ the Guide's Allowed values cell lists an enum column's values
✓ the Guide's Required cell reads Yes/No
✓ round-trip: parseImportWorkbook(buildImportTemplate(d, rows), d.sheetName) returns those rows
✓ importTemplateFilename formats the date as YYYY-MM-DD
```

The round-trip case is the one that pins template and parser together, so a change to either is caught by the other.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter api exec vitest run test/import-template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both functions**

- [ ] **Step 4: Run it and commit**

Run: `pnpm --filter api exec vitest run test/import-template.test.ts`
Expected: PASS.

```bash
git add apps/api/src/import/template.ts apps/api/test/import-template.test.ts
git commit -F .git/COMMIT_MSG_import_template
```

---

### Task 10: Import service

**Files:**
- Create: `apps/api/src/import/import.service.ts`
- Test: `apps/api/test/import-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 5, 8, 9.
- Produces:
  - `ImportServiceDeps` — `findLiveBatchByHash`, `createBatch`, `putObject`, `loadReferences`, `heldCount`, `runLoad`, `startOver`, `signDownload` — every one injected `@Optional()` exactly as `JobThaiServiceDeps` is, so the unit tests touch neither Postgres nor MinIO
  - `IMPORT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024`, `IMPORT_MAX_ROWS = 50_000`
  - `uploadFile(args: { datasetSlug: string; originalFilename: string; bytes: Buffer; uploadedByUserId: string | null; allowShrink: boolean }): Promise<{ batchId: string; deduplicated: boolean; rowCount: number; inserted: number; updated: number; deleted: number }>`
  - `getTemplate(datasetSlug: string, opts: PrefillOptions): Promise<{ filename: string; bytes: Buffer }>`
  - `listDatasets(): Promise<ImportDatasetSummary[]>` and `getDataset(slug): Promise<ImportDatasetDetail>` — detail carries the column list for the web registry, the batch list, and the row count
  - `startOver(datasetSlug: string, confirmName: string, userId: string | null): Promise<{ rowsDeleted: number; batchesCleared: number }>` — rejects when `confirmName !== dataset.title`

`uploadFile` order: extension → size → parse → validate → hash → dedupe → MinIO → batch row → ingestion run → `load` in a transaction → finish run → complete batch. A validation failure throws `ApiError('VALIDATION_FAILED', message, { errors, totalErrors })` and **nothing is stored**. A failure during load marks the run `FAILED` and the batch `FAILED`, and rethrows.

- [ ] **Step 1: Write the failing test**

```
✓ rejects a non-.xlsx extension, naming it
✓ rejects an empty file
✓ rejects a file over IMPORT_MAX_UPLOAD_BYTES
✓ rejects a workbook missing the dataset's sheet
✓ a validation failure throws before putObject or createBatch is called
✓ the thrown error carries the structured error list
✓ a duplicate live hash returns deduplicated: true and does not load
✓ a hash matching only a CLEARED batch loads normally       // Review Focus 4
✓ a successful upload calls putObject, createBatch, then runLoad, in that order
✓ allowShrink is passed through to validation
✓ a load failure marks the batch FAILED and rethrows
✓ getTemplate returns the declared filename and parseable bytes
✓ startOver rejects a wrong confirmation name without calling the store
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter api exec vitest run test/import-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ImportService`**

Copy `JobThaiService`'s constructor shape verbatim, including the `@Optional()` comment explaining that without it Nest tries to resolve the test seam as a provider and the app fails to boot. Bucket from `MINIO_BUCKET_CSV_UPLOADS`, default `csv-uploads`; key `imports/<dataset>/<hash>.xlsx`; `ensureBucket` before the first put.

- [ ] **Step 4: Run it and commit**

Run: `pnpm --filter api exec vitest run test/import-service.test.ts`
Expected: PASS.

```bash
git add apps/api/src/import/import.service.ts apps/api/test/import-service.test.ts
git commit -F .git/COMMIT_MSG_import_service
```

---

### Task 11: Controller, module, and seeded data sources

**Files:**
- Create: `apps/api/src/import/import.controller.ts`, `apps/api/src/import/import.module.ts`
- Modify: `apps/api/src/app.module.ts`, `packages/db/prisma/seed.ts`
- Test: `apps/api/test/import-controller.test.ts`

**Interfaces:**
- Produces, all under `/admin/imports`:
  - `GET /` → dataset list — `data_sources:read`
  - `GET /:dataset` → detail — `data_sources:read`
  - `GET /:dataset/template?fromYear&toYear` → xlsx download — `data_sources:read`
  - `POST /:dataset` → multipart upload, field `file`, query `allowShrink` — `data_sources:configure`, `@AuditLog({ action: 'import.upload', entityType: 'ImportBatch' })`
  - `POST /:dataset/start-over` → body `{ confirmName }` — `imports:destroy`, `@AuditLog({ action: 'import.start_over', entityType: 'ImportBatch' })`

Mirror `JobThaiController` for the multipart handler, including `decodeFilename`'s latin1→utf8 recovery, which Thai filenames need.

The seed gains, for every entry in `IMPORT_DATASETS`, a `DataSource` upsert: slug `xlsx-<dataset>`, name `<title> (spreadsheet import)`, `inputFormat: 'XLSX'`, `mocked: false`, `scheduleEnabled: false`, `status: 'real'`. `mocked: false` is load-bearing — `realDataWhere()` discards rows from a mocked source, so getting it wrong makes every imported row invisible while the upload reports success.

- [ ] **Step 1: Write the failing test**

Instantiate the controller with a stub service, as the existing api controller tests do:

```
✓ upload with no file throws VALIDATION_FAILED naming the "file" field
✓ upload decodes a latin1-encoded Thai filename
✓ upload passes allowShrink=true through from the query
✓ start-over forwards the confirmation name
✓ the template response sets Content-Disposition with the declared filename
✓ every handler carries @Authorized with the permission this plan specifies
✓ the two mutating handlers carry @AuditLog
```

The last two read decorator metadata with `Reflect.getMetadata`, so a dropped guard fails the suite rather than shipping.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter api exec vitest run test/import-controller.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the controller and module; register in `app.module.ts`**

- [ ] **Step 4: Extend the seed**

- [ ] **Step 5: Run the seed and the api suite**

Run: `pnpm db:seed && pnpm --filter api test`
Expected: seed completes; api suite passes.

- [ ] **Step 6: Verify a data source row exists**

Run: `pnpm --filter @kku/db exec prisma studio` is interactive — instead assert it in the Task 5 suite by re-running `pnpm --filter @kku/db exec vitest run test/import-batches.test.ts`, which now finds the seeded `xlsx-faculties` row.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/import apps/api/src/app.module.ts packages/db/prisma/seed.ts apps/api/test/import-controller.test.ts
git commit -F .git/COMMIT_MSG_import_api
```

---

### Task 12: Web — import panel on the existing data-setup pages

Spec §6.7: extend the registry that exists, do not stand up a second one.

**Files:**
- Create: `apps/web/app/admin/data-setup/raw/[dataset]/import-panel.tsx`
- Modify: `apps/web/app/admin/data-setup/raw/[dataset]/page.tsx`, `apps/web/app/admin/data-setup/page.tsx`
- Test: `apps/web/test/import-panel.test.tsx`

**Interfaces:**
- Consumes: Task 11's endpoints.

**No Next proxy route.** JobThai's client posts its multipart straight to `/api/v1/admin/jobthai/batches` and NestJS accepts the `authjs.session-token` cookie as well as a bearer (`apps/api/src/common/jwt-auth.guard.ts:104`). Follow that: the panel fetches `/api/v1/admin/imports/...` directly. The streaming proxy at `apps/web/app/api/admin-pdfs/upload/route.ts` exists for a different reason and is not needed here.

The template download is a plain `<a href="/api/v1/admin/imports/<slug>/template">`, so the browser handles the file rather than JavaScript buffering it.

`DATASET_TITLES` in `page.tsx` is the page's allowlist, and `DATASETS` in `apps/api/src/admin-data-setup/raw-data.controller.ts:85` is the matching server-side registry. Neither is replaced wholesale in this phase: the tier-0 datasets are additive entries, and the page gains the panel when `GET /admin/imports` reports the slug as importable. A dataset absent from the import registry renders exactly as today.

Note that the raw viewer's `ColumnSpec` is declared twice — `raw/[dataset]/page.tsx:14` and `raw-data.controller.ts:26`. Deriving both from `ImportColumn` is spec §6.7's intent, but doing it now would churn thirteen existing datasets for no behaviour change. **This phase adds the import panel beside the existing registry and leaves the duplication in place**; the reconciliation moves to the Phase 2 plan, where the tier-1 datasets make it pay. Record this deviation in the commit message.

The panel shows: a **Download template** button; a drag-and-drop upload zone following `UploadStep` in `apps/web/app/admin/programs/from-pdf/client.tsx:488`; the batch table (file, date, who, rows, status) with download links and cleared rows visibly struck through; and **Start over** at the foot, separated by a rule, behind a type-the-title confirmation.

A validation failure renders the structured errors as a table — row, column, message — not a toast, because the operator needs to read them against their spreadsheet.

- [ ] **Step 1: Write the failing test**

Render-level tests with the existing web test setup:

```
✓ renders the download and upload controls for an importable dataset
✓ renders a validation error list as rows naming row and column
✓ shows the batch list with cleared batches marked
✓ start-over is disabled until the typed name matches the dataset title
✓ a dataset not in the import registry renders no panel
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web exec vitest run test/import-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the proxy route, the panel, and the page changes**

- [ ] **Step 4: Run the web suite**

Run: `pnpm --filter web test`
Expected: PASS. Compare the file and test counts against the previous run — a narrowed `include` glob silently drops tests and `passWithNoTests` hides it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/data-setup apps/web/app/api/admin-imports apps/web/test/import-panel.test.tsx
git commit -F .git/COMMIT_MSG_import_web
```

---

### Task 13: End-to-end check and documentation

**Files:**
- Create: `docs/data-import.md`
- Modify: `docs/data-sources/README.md`, `apps/web/app/changelog/page.tsx`
- Test: `apps/api/test/import-e2e.test.ts`

- [ ] **Step 1: Write the end-to-end test**

One test that runs the whole loop against the dev database, proving the three datasets compose:

```
✓ template → fill → upload → rows exist and are canonical
    1. getTemplate('faculties'), fill two rows, upload
    2. getTemplate('departments') — upload one row referencing a faculty code
    3. getTemplate('programmes') — upload one row referencing both
    4. the programme is returned by a withCanonical() query
    5. every created row carries an ingestionRunId whose DataSource has mocked = false
    6. re-uploading the same programmes file with one changed name updates, does not duplicate
    7. startOver('programmes') removes it and marks the batch CLEARED
    8. re-uploading the identical file after start-over loads again
```

Step 5 is the assertion that the spec's loudest anti-goal cannot regress, and step 8 is Review Focus 4 end to end.

- [ ] **Step 2: Run it**

Run: `pnpm --filter api exec vitest run test/import-e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Write `docs/data-import.md`**

The adopter's guide: what the datasets are, the order to load them (faculties → departments → programmes), what the two sheets in a template are, what happens on re-upload, what start-over does and what it cannot undo. Link the spec. State plainly that uploaded workbooks are retained and that this is what makes start-over recoverable.

- [ ] **Step 4: Update `docs/data-sources/README.md` and the changelog**

Add the `xlsx-*` sources to the README's table. Add a changelog entry describing the feature in adopter-facing terms.

- [ ] **Step 5: Build the docs site**

Run: `pnpm docs:build`
Expected: PASS — no dead links, no retired product names.

- [ ] **Step 6: Full check**

Run: `pnpm check`
Expected: lint, typecheck and tests pass. CLAUDE.md records that CI has pre-existing repo-wide ESLint errors unrelated to this work; compare the failure list against `develop` before treating any as new.

- [ ] **Step 7: Commit**

```bash
git add docs/data-import.md docs/data-sources/README.md apps/web/app/changelog/page.tsx apps/api/test/import-e2e.test.ts
git commit -F .git/COMMIT_MSG_import_docs
```

---

## Self-review notes

- **Spec coverage.** §6.1 → Tasks 1, 6, 7. §6.2 → Task 9. §6.3 → Tasks 3, 8, 10. §6.5 → Tasks 5, 11. §6.6 → Tasks 5, 12. §6.7 → Task 12. §6.8 → Task 7. §6.9 → Task 1 (`ImportMatch` in the interface) and the declarations' own `load`. §6.10 → deferred to Phase 2 with the datasets that need it; `prefill` is in the interface and Task 9 consumes it, so nothing is retrofitted. §7 → Tasks 2, 3. §8.1, §8.2 → Task 4. §6.4's `IMPORT_MAX_ROWS` → Tasks 3, 10.
- **Not in this plan, by design:** §6.11 term-scoped loading (no tier-0 dataset uses it; `ImportStrategy` carries the variant from Task 1 so Phase 3 adds a branch, not an interface change), and §8.3 `ResearchOutput` matching.
- **Deliberately absent:** a generic upsert helper. Each declaration's `load` is explicit Prisma. The framework's value is in validation, templates and provenance, not in hiding twenty lines of writes behind a combinator.

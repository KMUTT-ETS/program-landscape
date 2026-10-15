# White label, Phase 1 (Foundation): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the organisation's identity (names, short names, region, contact email, app URL) out of `.env` and into a database singleton. Every process reads it through a boot-loaded cache, an admin edits it at `/admin/organization`, and KKU is seeded with its current values.

**Architecture:**
- A new Prisma singleton `OrganizationProfile` (`id = 'default'`).
- `@kku/shared`'s `getInstitution()` stays synchronous but reads a module-level cache instead of `process.env`.
  - The cache is filled by `loadOrganization()` from `@kku/db`, at api/worker boot and at the start of every CLI script's `main()`.
  - Long-running processes poll `version` every 60 s.
  - Reading the cache before it is loaded, or when no row exists, **throws**. Nothing falls back to KKU.
- The api exposes a public read, an admin read/write with an optimistic version lock, and a TCAS name helper.
- The web app gets an Identity admin page.

**Tech Stack:** Prisma 5 / PostgreSQL 16 (`pg_trgm`), NestJS, Next.js 14 App Router, Zod, Vitest, BullMQ, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-10-15-white-label-organization-design.md`. This plan covers spec §15 phase 1: §3 (identity columns), §4, §11 (Identity tab only), §12 (identity endpoints), §13, and §16.

## Global Constraints

- One organisation per install; the singleton row id is always `'default'`.
- Organisation identity lives **only in the database**. Remove `INSTITUTION_NAME_TH/EN`, `INSTITUTION_SHORT_NAME_TH/EN` and `INSTITUTION_CONTACT_EMAIL` from `.env.example`, `.env.prod.example` and the docs.
- **Deviation from spec §4.3, recorded here on purpose:** the `APP_PUBLIC_URL` **env key stays**. It is also the web app's own origin for the profile-page QR code (`apps/web/app/api/me/public-profile/qr/route.ts:18`, `apps/web/app/profile/page.tsx:32`), which is deployment config. The organisation's `appUrl` column replaces it **only** for outbound User-Agents.
- `getInstitution()` never returns KKU values unless the database row holds them. Delete `DEFAULT_INSTITUTION_*` and `DEFAULT_APP_PUBLIC_URL`. KKU's values live only in `KKU_REFERENCE_ORGANIZATION`, used by the seed script and the test setup.
- **Edit permission:** `settings:configure` (SUPER_ADMIN + SYSTEM_ADMIN). Every mutation carries `@AuditLog`.
- **Error codes:** no profile row → HTTP 409 `ORG_NOT_CONFIGURED`. Stale `expectedVersion` → HTTP 409 `ORG_VERSION_CONFLICT`. Cache never loaded → HTTP 500 (a code defect).
- **Refresh:** one-row `SELECT version` every 60 000 ms. No Redis pub/sub.
- TypeScript strict, no `any`; Zod on every input; raw SQL only through `$queryRaw` with Zod-validated results.
- **Migrations:** hand-written SQL in a new timestamped folder, applied with `pnpm db:migrate`. **Never** run `prisma migrate dev` / `reset` / `db push`, or `migrate diff --from-migrations`; the repo's guard hook blocks them.
- **UI:** English labels, design tokens only (no hex). Use `border-default`, **not** `border-border-default`, which emits no CSS. Use `sonner` toasts, not modals.
- Commits: conventional style, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Write the message to a file and use `git commit -F <file>`; the guard rejects some `-m` strings.
- PII policy: no personal email or citizen id in any committed file. Use `example.ac.th` addresses in tests.

## Review Focus

1. **Whitespace around a pasted name.** An admin pastes `" มหาวิทยาลัย… "`. It must be stored trimmed, so the TCAS exact match still works. Tested in Task 1 (schema).
2. **Clearing an optional field.** An admin clears the region or the contact email (empty string). It must be stored as `null`, and the User-Agent must then omit the email. Tested in Task 1 (schema) and Task 2 (`profileToInstitution`).
3. **Two admins saving at once.** The second save must get 409 `ORG_VERSION_CONFLICT`, not overwrite the first. Tested in Task 2 (`saveOrganizationIdentity`) and Task 5 (filter mapping).
4. **The database drops during a refresh poll.** The process must keep the last good identity and keep running, not crash or drop to "not configured". Tested in Task 2 (`startOrganizationRefresh`).
5. **Fresh install, connector run.** It must fail once as `ORG_NOT_CONFIGURED` and **not** be retried by BullMQ. Tested in Task 3 (runner).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/institution.ts` (modify) | `Institution` type; cache; sync readers; error classes; test seam |
| `packages/shared/src/organization/kku-reference.ts` (create) | `KKU_REFERENCE_ORGANIZATION` constant |
| `packages/shared/src/organization/schema.ts` (create) | `OrganizationIdentityInputSchema`, `OrganizationPublicView` |
| `packages/shared/src/organization/index.ts` (create) | barrel |
| `packages/shared/src/api/errors.ts` (modify) | new error codes |
| `packages/{shared,db}/test/setup-organization.ts`, `apps/{api,ingestion}/test/setup-organization.ts` (create) | load KKU reference identity for existing suites |
| `packages/db/prisma/schema.prisma` (modify) + `migrations/20261015120000_organization_profile/migration.sql` (create) | table |
| `packages/db/src/organization.ts` (create) | load / refresh / read / save / TCAS helper |
| `apps/api/src/main.ts`, `apps/ingestion/src/main.ts` (modify) | load at boot + start refresh |
| `apps/ingestion/src/connectors/runner.ts` (modify) | not-configured is non-retryable |
| `apps/ingestion/src/ai-jobs/queue.ts` (modify) | not-configured → BullMQ `UnrecoverableError` |
| `apps/ingestion/src/scripts/*.ts` (modify, codemod) | `await loadOrganization()` first in `main()` |
| `apps/ingestion/src/scripts/org-seed-kku.ts` (create) | idempotent KKU seed |
| `apps/api/src/organization/*` (create) | module, controllers, service |
| `apps/api/src/common/exception.filter.ts` (modify) | map org errors |
| `apps/web/app/admin/organization/{page,client}.tsx`, `apps/web/app/api/admin-organization/**` (create) | Identity page and proxies |
| `.env.example`, `.env.prod.example`, docs (modify) | key removal |
| `scripts/smoke-test.sh` (modify) | deploy fails if the profile is missing |

---

### Task 1: Shared: cache-backed identity, schema and test setup

**Files:**
- Modify: `packages/shared/src/institution.ts` (full rewrite)
- Create: `packages/shared/src/organization/kku-reference.ts`, `packages/shared/src/organization/schema.ts`, `packages/shared/src/organization/index.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from './organization';` next to `export * from './institution';`)
- Modify: `packages/shared/src/api/errors.ts`
- Create: `packages/shared/test/setup-organization.ts`, `packages/db/test/setup-organization.ts`, `apps/api/test/setup-organization.ts`, `apps/ingestion/test/setup-organization.ts`
- Modify: `packages/shared/vitest.config.ts`, `packages/db/vitest.config.ts`, `apps/api/vitest.config.ts`, `apps/ingestion/vitest.config.ts` (add `setupFiles`)
- Test: `packages/shared/test/institution.test.ts` (rewrite), `packages/shared/test/organization-schema.test.ts` (create)

**Interfaces:**
- Produces:
  - `interface Institution { nameTh: string; nameEn: string; shortNameEn: string; shortNameTh: string; regionTh: string | null; regionEn: string | null; contactEmail: string | null; appUrl: string }`
  - `getInstitution(): Institution`, which throws `OrganizationNotLoadedError` or `OrganizationNotConfiguredError`
  - `outboundUserAgent(purpose?: string): string`
  - `isOwnInstitution(name: string | null | undefined): boolean`
  - `setOrganizationCache(inst: Institution | null): void`, which marks the cache loaded
  - `setOrganizationForTest(inst: Institution | null | undefined): void`, where `undefined` means unloaded
  - Error classes `OrganizationNotLoadedError`, `OrganizationNotConfiguredError`, `OrganizationVersionConflictError`
  - `KKU_REFERENCE_ORGANIZATION: Institution`
  - `OrganizationIdentityInputSchema` (Zod) and `type OrganizationIdentityInput`
  - `interface OrganizationPublicView`
  - `ApiErrorCode` gains `'ORG_NOT_CONFIGURED' | 'ORG_VERSION_CONFLICT'`

- [ ] **Step 1: Write the failing tests**

Replace `packages/shared/test/institution.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KKU_REFERENCE_ORGANIZATION,
  OrganizationNotConfiguredError,
  OrganizationNotLoadedError,
  getInstitution,
  isOwnInstitution,
  outboundUserAgent,
  setOrganizationCache,
  setOrganizationForTest,
  type Institution,
} from '../src';

const EXAMPLE: Institution = {
  nameTh: 'มหาวิทยาลัยตัวอย่าง',
  nameEn: 'Example University',
  shortNameEn: 'EXU',
  shortNameTh: 'มต.',
  regionTh: null,
  regionEn: null,
  contactEmail: 'landscape@example.ac.th',
  appUrl: 'https://landscape.example.ac.th',
};

beforeEach(() => setOrganizationForTest(undefined));
afterEach(() => setOrganizationForTest(KKU_REFERENCE_ORGANIZATION));

describe('getInstitution', () => {
  it('throws OrganizationNotLoadedError before anything is loaded — never a KKU fallback', () => {
    expect(() => getInstitution()).toThrow(OrganizationNotLoadedError);
  });

  it('throws OrganizationNotConfiguredError when loaded but no row exists', () => {
    setOrganizationCache(null);
    expect(() => getInstitution()).toThrow(OrganizationNotConfiguredError);
  });

  it('returns the cached identity once loaded', () => {
    setOrganizationCache(EXAMPLE);
    expect(getInstitution()).toEqual(EXAMPLE);
  });
});

describe('outboundUserAgent', () => {
  it('includes purpose, app URL and contact email', () => {
    setOrganizationCache(EXAMPLE);
    expect(outboundUserAgent('discovery')).toBe(
      'Program-Landscape/1.0 discovery (+https://landscape.example.ac.th; landscape@example.ac.th)',
    );
  });

  it('omits the email when none is configured', () => {
    setOrganizationCache({ ...EXAMPLE, contactEmail: null });
    expect(outboundUserAgent()).toBe('Program-Landscape/1.0 (+https://landscape.example.ac.th)');
  });
});

describe('isOwnInstitution', () => {
  it('matches the configured Thai name, ignoring surrounding whitespace', () => {
    setOrganizationCache(EXAMPLE);
    expect(isOwnInstitution(' มหาวิทยาลัยตัวอย่าง ')).toBe(true);
    expect(isOwnInstitution('มหาวิทยาลัยขอนแก่น')).toBe(false);
    expect(isOwnInstitution(null)).toBe(false);
  });
});
```

Create `packages/shared/test/organization-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OrganizationIdentityInputSchema } from '../src';

const base = {
  nameTh: 'มหาวิทยาลัยตัวอย่าง',
  nameEn: 'Example University',
  shortNameTh: 'มต.',
  shortNameEn: 'EXU',
  appUrl: 'https://landscape.example.ac.th',
  expectedVersion: null,
};

describe('OrganizationIdentityInputSchema', () => {
  it('trims names so the TCAS exact match still works on pasted text', () => {
    const out = OrganizationIdentityInputSchema.parse({ ...base, nameTh: '  มหาวิทยาลัยตัวอย่าง \n' });
    expect(out.nameTh).toBe('มหาวิทยาลัยตัวอย่าง');
  });

  it('stores cleared optional fields as null', () => {
    const out = OrganizationIdentityInputSchema.parse({
      ...base,
      regionTh: '  ',
      regionEn: '',
      contactEmail: '',
    });
    expect(out.regionTh).toBeNull();
    expect(out.regionEn).toBeNull();
    expect(out.contactEmail).toBeNull();
  });

  it('rejects a blank required name, a bad email and a non-http URL', () => {
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, nameEn: '   ' }).success).toBe(false);
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, contactEmail: 'nope' }).success).toBe(false);
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, appUrl: 'ftp://x.example' }).success).toBe(false);
  });

  it('strips a trailing slash from the app URL', () => {
    expect(OrganizationIdentityInputSchema.parse({ ...base, appUrl: 'https://a.example/' }).appUrl).toBe(
      'https://a.example',
    );
  });

  it('requires expectedVersion to be null or a positive integer', () => {
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, expectedVersion: 0 }).success).toBe(false);
    expect(OrganizationIdentityInputSchema.parse({ ...base, expectedVersion: 3 }).expectedVersion).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @kku/shared exec vitest run test/institution.test.ts test/organization-schema.test.ts`
Expected: FAIL. `setOrganizationCache`, `KKU_REFERENCE_ORGANIZATION` and `OrganizationIdentityInputSchema` are not exported.

- [ ] **Step 3: Implement**

Replace `packages/shared/src/institution.ts` with:

```ts
/**
 * Institution identity — who this deployment is.
 *
 * Read from the `organization_profile` row (an admin edits it at
 * /admin/organization). Each process fills this cache with
 * `loadOrganization()` from @kku/db — the api and the ingestion worker at
 * boot, every CLI script at the top of main(). The readers here stay
 * synchronous so AI prompt builders and connectors need no plumbing.
 *
 * There is deliberately NO fallback: reading before the cache is loaded,
 * or when no row exists, throws. A white-label install must never quietly
 * call itself Khon Kaen University.
 */

export interface Institution {
  /** Must equal the `สถาบัน` column of the TCAS sheets (trimmed). */
  nameTh: string;
  /** Must equal the name in ranking tables and the Scopus affiliation. */
  nameEn: string;
  shortNameEn: string;
  shortNameTh: string;
  regionTh: string | null;
  regionEn: string | null;
  /** Sent in outbound User-Agents; null omits it. */
  contactEmail: string | null;
  /** Sent in outbound User-Agents. No trailing slash. */
  appUrl: string;
}

export class OrganizationNotLoadedError extends Error {
  constructor() {
    super(
      'Organisation identity read before loadOrganization() ran in this process — ' +
        'call `await loadOrganization()` at the entry point.',
    );
    this.name = 'OrganizationNotLoadedError';
  }
}

export class OrganizationNotConfiguredError extends Error {
  constructor() {
    super('Organisation is not configured yet — an administrator must fill in /admin/organization.');
    this.name = 'OrganizationNotConfiguredError';
  }
}

export class OrganizationVersionConflictError extends Error {
  constructor() {
    super('The organisation profile was changed by someone else — reload and try again.');
    this.name = 'OrganizationVersionConflictError';
  }
}

type CacheState = { loaded: false } | { loaded: true; inst: Institution | null };
let cache: CacheState = { loaded: false };

/** Called by @kku/db's loader. `null` means "loaded, no row". */
export function setOrganizationCache(inst: Institution | null): void {
  cache = { loaded: true, inst };
}

/** Test seam. `undefined` returns the cache to the never-loaded state. */
export function setOrganizationForTest(inst: Institution | null | undefined): void {
  cache = inst === undefined ? { loaded: false } : { loaded: true, inst };
}

export function getInstitution(): Institution {
  if (!cache.loaded) throw new OrganizationNotLoadedError();
  if (!cache.inst) throw new OrganizationNotConfiguredError();
  return cache.inst;
}

/**
 * The honest identifying User-Agent for outbound fetches:
 * `Program-Landscape/1.0 (+<appUrl>; <contactEmail>)`, with an optional
 * purpose suffix on the product token. Sites that refuse bot User-Agents
 * (the curated report feeds) use a browser string instead.
 */
export function outboundUserAgent(purpose?: string): string {
  const { appUrl, contactEmail } = getInstitution();
  const product = purpose ? `Program-Landscape/1.0 ${purpose}` : 'Program-Landscape/1.0';
  const comment = contactEmail ? `+${appUrl}; ${contactEmail}` : `+${appUrl}`;
  return `${product} (${comment})`;
}

/** True when a source row's institution name is this deployment's (trimmed compare). */
export function isOwnInstitution(institutionName: string | null | undefined): boolean {
  return institutionName?.trim() === getInstitution().nameTh;
}
```

Create `packages/shared/src/organization/kku-reference.ts`:

```ts
import type { Institution } from '../institution';

/**
 * Khon Kaen University's identity, exactly as the platform used it before
 * white-labelling. Used ONLY by `org-seed-kku` (to seed KKU's own
 * deployment) and by test setup files. It is never a runtime fallback —
 * getInstitution() throws rather than reach for this.
 */
export const KKU_REFERENCE_ORGANIZATION: Institution = {
  nameTh: 'มหาวิทยาลัยขอนแก่น',
  nameEn: 'Khon Kaen University',
  shortNameEn: 'KKU',
  shortNameTh: 'มข.',
  regionTh: 'ภาคตะวันออกเฉียงเหนือ',
  regionEn: 'Northeast',
  contactEmail: null,
  appUrl: 'https://program-landscape.kku.ac.th',
};
```

Create `packages/shared/src/organization/schema.ts`:

```ts
import { z } from 'zod';

const requiredText = z.string().trim().min(1, 'required').max(200);
const optionalText = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null));

export const OrganizationIdentityInputSchema = z.object({
  nameTh: requiredText,
  nameEn: requiredText,
  shortNameTh: requiredText.pipe(z.string().max(30)),
  shortNameEn: requiredText.pipe(z.string().max(30)),
  regionTh: optionalText,
  regionEn: optionalText,
  contactEmail: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email().nullable()),
  appUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'must start with http:// or https://')
    .transform((u) => u.replace(/\/+$/, '')),
  /** null when creating the first profile; otherwise the version the form was loaded at. */
  expectedVersion: z.number().int().positive().nullable(),
});
export type OrganizationIdentityInput = z.infer<typeof OrganizationIdentityInputSchema>;

/** What GET /api/v1/organization returns to anyone, signed in or not. */
export type OrganizationPublicView =
  | { configured: false }
  | {
      configured: true;
      nameTh: string;
      nameEn: string;
      shortNameTh: string;
      shortNameEn: string;
      tagline: string;
      version: number;
    };
```

Create `packages/shared/src/organization/index.ts`:

```ts
export * from './kku-reference';
export * from './schema';
```

In `packages/shared/src/index.ts`, add `export * from './organization';` on the line after `export * from './institution';`.

In `packages/shared/src/api/errors.ts`, add two entries before `'INTERNAL'`:

```ts
  'ORG_NOT_CONFIGURED',
  'ORG_VERSION_CONFLICT',
```

Create the four test setup files. For `packages/shared/test/setup-organization.ts`:

```ts
// Every existing suite was written against KKU's identity (prompt text,
// TCAS "own institution" rows). Load it as the test default; suites that
// test the cache itself reset it with setOrganizationForTest(undefined).
import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '../src';

setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
```

`packages/db/test/setup-organization.ts`, `apps/api/test/setup-organization.ts` and `apps/ingestion/test/setup-organization.ts` contain the same comment and code, but import from `'@kku/shared'`.

Add the setup file to each vitest config's `test` block:
- `packages/shared/vitest.config.ts`, `packages/db/vitest.config.ts`, `apps/ingestion/vitest.config.ts`: `setupFiles: ['./test/setup-organization.ts'],`
- `apps/api/vitest.config.ts`: change `setupFiles: ['reflect-metadata'],` to `setupFiles: ['reflect-metadata', './test/setup-organization.ts'],`

- [ ] **Step 4: Run the shared suite and typecheck**

Run: `pnpm --filter @kku/shared exec vitest run test/institution.test.ts test/organization-schema.test.ts`
Expected: PASS (11 tests).

Run: `pnpm --filter @kku/shared test 2>&1 | tail -5`
Expected: the same pass/fail totals as before this task, plus the new tests. The 4 failures already in `usage-action-coverage` are pre-existing; record their count, they are not yours.

Run: `pnpm --filter @kku/shared typecheck && pnpm --filter api typecheck && pnpm --filter ingestion typecheck && pnpm --filter @kku/db typecheck`
Expected: no errors. `DEFAULT_*` had no callers outside the old test; any compile error points at a stale import, so remove it.

- [ ] **Step 5: Commit**

```bash
git add packages/shared packages/db/test/setup-organization.ts packages/db/vitest.config.ts \
  apps/api/test/setup-organization.ts apps/api/vitest.config.ts \
  apps/ingestion/test/setup-organization.ts apps/ingestion/vitest.config.ts
printf 'feat(shared): read institution identity from a loaded cache, not env\n\nNo KKU fallback: reading before load or with no profile throws.\nTest suites load KKU_REFERENCE_ORGANIZATION via setup files.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 2: DB: `organization_profile` table and the `organization.ts` loader

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append the model after `model SystemSetting`)
- Create: `packages/db/prisma/migrations/20261015120000_organization_profile/migration.sql`
- Create: `packages/db/src/organization.ts`
- Modify: `packages/db/src/index.ts` (add `export * from './organization';` after `export * from './academic-year';`)
- Test: `packages/db/test/organization.test.ts`

**Interfaces:**
- Consumes (Task 1): `Institution`, `setOrganizationCache`, `OrganizationVersionConflictError`, `OrganizationIdentityInput`.
- Produces:
  - `profileToInstitution(row: OrganizationProfile): Institution`
  - `loadOrganization(client?: OrgClient): Promise<Institution | null>`
  - `startOrganizationRefresh(client?: OrgClient, intervalMs?: number): () => void`, which returns a stop function
  - `getOrganizationProfile(client?: OrgClient): Promise<OrganizationProfile | null>`
  - `saveOrganizationIdentity(input: OrganizationIdentityInput, userId: string, client?: OrgClient): Promise<OrganizationProfile>`, which throws `OrganizationVersionConflictError`
  - `tcasInstitutionMatches(name: string, client?: OrgClient): Promise<TcasNameMatch>`, where `interface TcasNameMatch { exactRows: number; suggestions: { name: string; rows: number; similarity: number }[] }`
  - `type OrgClient = Pick<PrismaClient, 'organizationProfile' | 'tcasAdmissionStat' | '$queryRaw'>`
  - `organizationTagline(shortNameEn: string): string`

- [ ] **Step 1: Add the model and the migration**

Append to `packages/db/prisma/schema.prisma`, directly after the closing `}` of `model SystemSetting`:

```prisma
/// Singleton: the organisation this installation serves. `id` is always
/// 'default'. Edited at /admin/organization; read through the boot-loaded
/// cache in packages/db/src/organization.ts. Phase 1 holds identity only —
/// brand and legal columns arrive in later phases of the white-label spec.
model OrganizationProfile {
  id           String   @id @default("default")
  /// Must equal the TCAS `สถาบัน` spelling exactly.
  nameTh       String   @map("name_th")
  nameEn       String   @map("name_en")
  shortNameTh  String   @map("short_name_th")
  shortNameEn  String   @map("short_name_en")
  regionTh     String?  @map("region_th")
  regionEn     String?  @map("region_en")
  /// Outbound User-Agent contact only — never shown publicly.
  contactEmail String?  @map("contact_email")
  appUrl       String   @map("app_url")
  /// Bumped on every save; cache refresh + optimistic lock.
  version      Int      @default(1)
  updatedAt    DateTime @updatedAt @map("updated_at")
  updatedBy    String?  @map("updated_by")

  @@map("organization_profile")
}
```

Create `packages/db/prisma/migrations/20261015120000_organization_profile/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "organization_profile" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "short_name_th" TEXT NOT NULL,
    "short_name_en" TEXT NOT NULL,
    "region_th" TEXT,
    "region_en" TEXT,
    "contact_email" TEXT,
    "app_url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "organization_profile_pkey" PRIMARY KEY ("id"),
    -- Singleton: no second row can ever exist.
    CONSTRAINT "organization_profile_singleton" CHECK ("id" = 'default')
);
```

Run: `pnpm db:migrate && pnpm --filter @kku/db exec prisma generate`
Expected: `Applying migration 20261015120000_organization_profile`, then the client is generated.

- [ ] **Step 2: Write the failing tests**

Create `packages/db/test/organization.test.ts`. It uses an in-memory fake client, never the live database: the singleton row is real state on the dev box.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KKU_REFERENCE_ORGANIZATION,
  OrganizationNotConfiguredError,
  OrganizationVersionConflictError,
  getInstitution,
  setOrganizationForTest,
} from '@kku/shared';
import {
  loadOrganization,
  organizationTagline,
  profileToInstitution,
  saveOrganizationIdentity,
  startOrganizationRefresh,
  type OrgClient,
} from '../src/organization';

type Row = {
  id: string; nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string;
  regionTh: string | null; regionEn: string | null; contactEmail: string | null; appUrl: string;
  version: number; updatedAt: Date; updatedBy: string | null;
};

const ROW: Row = {
  id: 'default',
  nameTh: 'มหาวิทยาลัยตัวอย่าง',
  nameEn: 'Example University',
  shortNameTh: 'มต.',
  shortNameEn: 'EXU',
  regionTh: null,
  regionEn: null,
  contactEmail: null,
  appUrl: 'https://landscape.example.ac.th',
  version: 1,
  updatedAt: new Date('2026-10-15T00:00:00Z'),
  updatedBy: null,
};

function fakeClient(initial: Row | null) {
  let row: Row | null = initial ? { ...initial } : null;
  const client = {
    organizationProfile: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      create: vi.fn(async ({ data }: { data: Omit<Row, 'id' | 'version' | 'updatedAt'> }) => {
        if (row) throw Object.assign(new Error('unique'), { code: 'P2002' });
        row = { ...ROW, ...data, id: 'default', version: 1, updatedAt: new Date() };
        return { ...row };
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { version: number }; data: Partial<Row> & { version: { increment: number } } }) => {
          if (!row || row.version !== where.version) return { count: 0 };
          const { version: _v, ...rest } = data;
          row = { ...row, ...rest, version: row.version + 1, updatedAt: new Date() };
          return { count: 1 };
        },
      ),
    },
    tcasAdmissionStat: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
  };
  return {
    client: client as unknown as OrgClient,
    raw: client,
    setRow: (r: Row | null) => (row = r),
  };
}

beforeEach(() => setOrganizationForTest(undefined));
afterEach(() => {
  vi.useRealTimers();
  setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
});

describe('profileToInstitution', () => {
  it('maps columns and keeps a null contact email null (UA then omits it)', () => {
    expect(profileToInstitution(ROW)).toEqual({
      nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
      shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: null,
      appUrl: 'https://landscape.example.ac.th',
    });
  });
});

describe('organizationTagline', () => {
  it('keeps the product name fixed and puts the short name in the tagline', () => {
    expect(organizationTagline('EXU')).toBe('EXU Curriculum Intelligence Platform');
  });
});

describe('loadOrganization', () => {
  it('fills the cache from the row', async () => {
    const { client } = fakeClient(ROW);
    await loadOrganization(client);
    expect(getInstitution().nameEn).toBe('Example University');
  });

  it('marks the cache loaded-but-empty when no row exists', async () => {
    const { client } = fakeClient(null);
    expect(await loadOrganization(client)).toBeNull();
    expect(() => getInstitution()).toThrow(OrganizationNotConfiguredError);
  });
});

describe('saveOrganizationIdentity', () => {
  const input = {
    nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
    regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://landscape.example.ac.th',
  };

  it('creates the first profile and refreshes this process cache', async () => {
    const { client } = fakeClient(null);
    await loadOrganization(client);
    const saved = await saveOrganizationIdentity({ ...input, expectedVersion: null }, 'u1', client);
    expect(saved.version).toBe(1);
    expect(getInstitution().shortNameEn).toBe('EXU');
  });

  it('rejects a create when a profile already exists (two first-time admins)', async () => {
    const { client } = fakeClient(ROW);
    await expect(
      saveOrganizationIdentity({ ...input, expectedVersion: null }, 'u1', client),
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });

  it('bumps the version on update and rejects a stale expectedVersion', async () => {
    const { client } = fakeClient(ROW);
    const first = await saveOrganizationIdentity({ ...input, nameEn: 'A', expectedVersion: 1 }, 'u1', client);
    expect(first.version).toBe(2);
    await expect(
      saveOrganizationIdentity({ ...input, nameEn: 'B', expectedVersion: 1 }, 'u2', client),
    ).rejects.toBeInstanceOf(OrganizationVersionConflictError);
  });
});

describe('startOrganizationRefresh', () => {
  it('reloads when the version moves', async () => {
    vi.useFakeTimers();
    const { client, setRow } = fakeClient(ROW);
    await loadOrganization(client);
    const stop = startOrganizationRefresh(client, 1000);
    setRow({ ...ROW, nameEn: 'Renamed University', version: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(getInstitution().nameEn).toBe('Renamed University');
    stop();
  });

  it('keeps the last good identity when the database is unreachable', async () => {
    vi.useFakeTimers();
    const { client, raw } = fakeClient(ROW);
    await loadOrganization(client);
    const stop = startOrganizationRefresh(client, 1000);
    raw.organizationProfile.findUnique.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(getInstitution().nameEn).toBe('Example University');
    stop();
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `pnpm --filter @kku/db exec vitest run test/organization.test.ts`
Expected: FAIL with "Cannot find module '../src/organization'".

- [ ] **Step 4: Implement `packages/db/src/organization.ts`**

```ts
import { z } from 'zod';
import type { OrganizationProfile, PrismaClient } from '@prisma/client';
import {
  OrganizationVersionConflictError,
  setOrganizationCache,
  type Institution,
  type OrganizationIdentityInput,
} from '@kku/shared';
import { prisma } from './index';

// The organisation this installation serves — see
// docs/superpowers/specs/2026-10-15-white-label-organization-design.md §4.
// Every process calls loadOrganization() once at its entry point; @kku/shared's
// synchronous getInstitution() then reads the cache this fills.

const SINGLETON_ID = 'default';

export type OrgClient = Pick<PrismaClient, 'organizationProfile' | 'tcasAdmissionStat' | '$queryRaw'>;

let loadedVersion: number | null = null;

export function profileToInstitution(row: OrganizationProfile): Institution {
  return {
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    shortNameTh: row.shortNameTh,
    shortNameEn: row.shortNameEn,
    regionTh: row.regionTh,
    regionEn: row.regionEn,
    contactEmail: row.contactEmail,
    appUrl: row.appUrl,
  };
}

/** The product name is fixed; only the tagline carries the organisation. */
export function organizationTagline(shortNameEn: string): string {
  return `${shortNameEn} Curriculum Intelligence Platform`;
}

export async function getOrganizationProfile(client: OrgClient = prisma): Promise<OrganizationProfile | null> {
  return client.organizationProfile.findUnique({ where: { id: SINGLETON_ID } });
}

/** Reads the row and fills the shared cache. Returns null when no row exists. */
export async function loadOrganization(client: OrgClient = prisma): Promise<Institution | null> {
  const row = await getOrganizationProfile(client);
  const inst = row ? profileToInstitution(row) : null;
  setOrganizationCache(inst);
  loadedVersion = row?.version ?? null;
  return inst;
}

/**
 * Long-running processes only. Polls the row every `intervalMs` and reloads
 * when its version moved. A failed poll keeps the last good identity — a
 * database blip must not turn every AI call into "not configured".
 */
export function startOrganizationRefresh(client: OrgClient = prisma, intervalMs = 60_000): () => void {
  const timer = setInterval(() => {
    void getOrganizationProfile(client)
      .then((row) => {
        const version = row?.version ?? null;
        if (version === loadedVersion) return;
        setOrganizationCache(row ? profileToInstitution(row) : null);
        loadedVersion = version;
      })
      .catch((err: unknown) => {
        console.warn(`[organization] refresh failed, keeping last identity: ${(err as Error).message}`);
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

/**
 * Creates the profile (expectedVersion null) or updates it under an
 * optimistic lock. Throws OrganizationVersionConflictError when someone else
 * saved first. Refreshes this process's cache immediately.
 */
export async function saveOrganizationIdentity(
  input: OrganizationIdentityInput,
  userId: string,
  client: OrgClient = prisma,
): Promise<OrganizationProfile> {
  const { expectedVersion, ...fields } = input;
  if (expectedVersion === null) {
    try {
      await client.organizationProfile.create({ data: { id: SINGLETON_ID, ...fields, updatedBy: userId } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new OrganizationVersionConflictError();
      throw err;
    }
  } else {
    const { count } = await client.organizationProfile.updateMany({
      where: { id: SINGLETON_ID, version: expectedVersion },
      data: { ...fields, updatedBy: userId, version: { increment: 1 } },
    });
    if (count === 0) throw new OrganizationVersionConflictError();
  }
  const row = await getOrganizationProfile(client);
  if (!row) throw new Error('organization_profile row vanished after save');
  setOrganizationCache(profileToInstitution(row));
  loadedVersion = row.version;
  return row;
}

export interface TcasNameMatch {
  exactRows: number;
  suggestions: { name: string; rows: number; similarity: number }[];
}

const SuggestionRows = z.array(
  z.object({ name: z.string(), rows: z.number().int(), similarity: z.number() }),
);

/** Backs the admin form's "does this match TCAS?" helper. Read-only. */
export async function tcasInstitutionMatches(name: string, client: OrgClient = prisma): Promise<TcasNameMatch> {
  const trimmed = name.trim();
  const exactRows = await client.tcasAdmissionStat.count({ where: { institutionName: trimmed } });
  const raw = await client.$queryRaw`
    SELECT institution_name AS name,
           COUNT(*)::int AS rows,
           MAX(similarity(institution_name, ${trimmed}))::float8 AS similarity
    FROM tcas_admission_stats
    GROUP BY institution_name
    ORDER BY similarity DESC
    LIMIT 5`;
  return { exactRows, suggestions: SuggestionRows.parse(raw) };
}
```

`import { prisma } from './index'` is the package convention (`academic-year.ts`, `job108-settings.ts` do the same).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @kku/db exec vitest run test/organization.test.ts && pnpm --filter @kku/db typecheck`
Expected: PASS (9 tests), and no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20261015120000_organization_profile \
  packages/db/src/organization.ts packages/db/src/index.ts packages/db/test/organization.test.ts
printf 'feat(db): organization_profile singleton with boot-loaded cache\n\nOptimistic version lock on save; 60 s version poll keeps the last good\nidentity on a failed read; TCAS name helper via pg_trgm.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 3: Load at boot in the long-running processes, and make "not configured" non-retryable

**Files:**
- Modify: `apps/api/src/main.ts` (start of `bootstrap()`)
- Modify: `apps/ingestion/src/main.ts` (start of `bootstrap()`)
- Modify: `apps/ingestion/src/connectors/runner.ts:219-221`
- Modify: `apps/ingestion/src/ai-jobs/queue.ts:250-259`
- Modify: `apps/ingestion/src/scripts/bulk-pdf-load.ts:41`, `apps/ingestion/src/scripts/capture-kmitl-skill-mapping.ts:39`
- Test: `apps/ingestion/test/runner-organization.test.ts` (create)

**Interfaces:**
- Consumes: `loadOrganization`, `startOrganizationRefresh` (Task 2); `OrganizationNotConfiguredError`, `outboundUserAgent` (Task 1).
- Produces: `isOrganizationNotConfigured(err: unknown): boolean`, exported from `apps/ingestion/src/connectors/runner.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/ingestion/test/runner-organization.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { OrganizationNotConfiguredError } from '@kku/shared';
import { isOrganizationNotConfigured } from '../src/connectors/runner';

describe('isOrganizationNotConfigured', () => {
  it('treats a missing organisation profile as non-retryable', () => {
    expect(isOrganizationNotConfigured(new OrganizationNotConfiguredError())).toBe(true);
  });

  it('leaves other errors to BullMQ retries', () => {
    expect(isOrganizationNotConfigured(new Error('ECONNRESET'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter ingestion exec vitest run test/runner-organization.test.ts`
Expected: FAIL. `isOrganizationNotConfigured` is not exported.

- [ ] **Step 3: Implement**

In `apps/ingestion/src/connectors/runner.ts`:
- Add `OrganizationNotConfiguredError` to the existing `from '@kku/shared'` import.
- Add this below the imports:

```ts
/** A fresh install with no organisation profile: retrying cannot help until an admin fills it in. */
export function isOrganizationNotConfigured(err: unknown): boolean {
  return err instanceof OrganizationNotConfiguredError;
}
```

- Replace lines 219 and 221:

```ts
      const isNonRetryable = err instanceof NonRetryableError || isOrganizationNotConfigured(err);
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof NonRetryableError
          ? err.code
          : isOrganizationNotConfigured(err)
            ? 'ORG_NOT_CONFIGURED'
            : 'UNCAUGHT';
```

Read the rest of that `catch` block before editing. If it re-throws based on `isNonRetryable`, it now covers this case; if it tests `instanceof NonRetryableError` a second time further down, replace that test with `isNonRetryable`.

In `apps/ingestion/src/ai-jobs/queue.ts`:
- Change the bullmq import to `import { Queue, Worker, QueueEvents, UnrecoverableError, type ConnectionOptions, type WorkerOptions } from 'bullmq';`.
- Add `import { OrganizationNotConfiguredError } from '@kku/shared';`.
- Replace the `const outcome = await handler({...}); return outcome;` block with:

```ts
      try {
        return await handler({
          entityId,
          trigger,
          triggeredByUserId: triggeredByUserId ?? null,
          pipelinePhases,
          pipelineForce,
          scholarTrigger,
          scholarActorRole,
        });
      } catch (err) {
        // No organisation profile yet: retrying cannot help, so fail once.
        if (err instanceof OrganizationNotConfiguredError) throw new UnrecoverableError(err.message);
        throw err;
      }
```

In `apps/api/src/main.ts`:
- Add `import { loadOrganization, startOrganizationRefresh } from '@kku/db';`.
- Make these the first lines inside `async function bootstrap() {`:

```ts
  // Organisation identity (white-label). A missing profile must not stop the
  // api booting — the admin needs the app up to fill it in; identity-dependent
  // calls answer 409 ORG_NOT_CONFIGURED until then.
  const org = await loadOrganization();
  if (!org) console.warn('[organization] no organisation profile — /admin/organization to set one up');
  startOrganizationRefresh();
```

In `apps/ingestion/src/main.ts`, add the same import and the same three statements as the first lines of `bootstrap()`. They must come **before** `NestFactory.createApplicationContext`, because the BullMQ workers start inside it.

In `apps/ingestion/src/scripts/bulk-pdf-load.ts` and `capture-kmitl-skill-mapping.ts`:
- Replace the inline `const appUrl = process.env.APP_PUBLIC_URL?.trim() || 'https://program-landscape.kku.ac.th';` and the hand-built User-Agent string that follows it with `outboundUserAgent('<purpose>')`. Use the purpose token the current string already carries; read 5 lines around line 41/39 to find it.
- Import `outboundUserAgent` from `@kku/shared`.
- These scripts get `loadOrganization()` in Task 4.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter ingestion exec vitest run test/runner-organization.test.ts && pnpm --filter ingestion test 2>&1 | tail -4 && pnpm --filter ingestion typecheck && pnpm --filter api typecheck`
Expected: PASS, with the ingestion totals unchanged apart from the 2 new tests, and no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/main.ts apps/ingestion/src apps/ingestion/test/runner-organization.test.ts
printf 'feat: load organisation identity at api/worker boot\n\nA missing profile fails connector runs and ai-jobs once (no retry)\nwith ORG_NOT_CONFIGURED; the processes still boot.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 4: CLI scripts load the organisation first

**Files:**
- Modify: every `apps/ingestion/src/scripts/*.ts` that has `async function main(`, except `ai-eval-accuracy.ts`, through a one-off codemod that is **not** committed
- Create: `apps/ingestion/test/scripts-load-organization.test.ts`
- Modify: `apps/ingestion/scripts/bundle-pipeline-scripts.ts` (no change expected; only verify the bundle in step 4)

**Interfaces:**
- Consumes: `loadOrganization()` from `@kku/db` (Task 2), whose default client is the shared prisma.

- [ ] **Step 1: Write the failing structural test**

Create `apps/ingestion/test/scripts-load-organization.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every CLI script — including the six the worker spawns as child
// processes — must load the organisation before main() does any work,
// or the first AI prompt / User-Agent it builds throws
// OrganizationNotLoadedError. Scripts with no main() are listed here.
const EXEMPT = new Set(['ai-eval-accuracy.ts']);
const DIR = path.join(__dirname, '..', 'src', 'scripts');

describe('CLI scripts load the organisation', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !EXEMPT.has(f));

  it.each(files)('%s awaits loadOrganization() first in main()', (file) => {
    const src = readFileSync(path.join(DIR, file), 'utf8');
    const body = src.split(/^async function main\([^)]*\)[^{]*\{\s*$/m)[1];
    expect(body, 'no `async function main(` found — add it to EXEMPT only if the script has no entry point').toBeDefined();
    expect(body!.trimStart().startsWith('await loadOrganization();')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter ingestion exec vitest run test/scripts-load-organization.test.ts 2>&1 | tail -3`
Expected: FAIL for about 86 files.

- [ ] **Step 3: Apply the codemod**

Write `/tmp/codemod-org.cjs` (outside the repo, never committed):

```js
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
let changed = 0;
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.ts') || f === 'ai-eval-accuracy.ts') continue;
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('await loadOrganization();')) continue;
  const mainRe = /^(async function main\([^)]*\)[^{]*\{[ \t]*\n)/m;
  if (!mainRe.test(s)) { console.log('SKIP (no main):', f); continue; }
  s = s.replace(mainRe, '$1  await loadOrganization();\n');
  const dbImport = /import \{([^}]*)\} from '@kku\/db';/;
  if (dbImport.test(s)) {
    s = s.replace(dbImport, (_m, names) => `import { loadOrganization,${names}} from '@kku/db';`);
  } else {
    s = s.replace(/^import /m, "import { loadOrganization } from '@kku/db';\nimport ");
  }
  fs.writeFileSync(p, s);
  changed++;
}
console.log('changed', changed);
```

Run:
```bash
node /tmp/codemod-org.cjs apps/ingestion/src/scripts
pnpm exec prettier --write "apps/ingestion/src/scripts/*.ts" >/dev/null
git diff --stat apps/ingestion/src/scripts | tail -1
```
Expected: `changed 86` (or the number of files with a `main`). No `SKIP` lines other than ones you can explain.

Spot-check three files (`programs-pipeline.ts`, `run-connector.ts`, `retention-sweep.ts`) with `git diff`. Each must show one added import name and `await loadOrganization();` as the first statement of `main`.

- [ ] **Step 4: Run tests, typecheck, lint and the bundle**

Run: `pnpm --filter ingestion exec vitest run test/scripts-load-organization.test.ts && pnpm --filter ingestion typecheck && pnpm --filter ingestion lint && pnpm --filter ingestion build 2>&1 | tail -3`
Expected: PASS, no type or lint errors, and the build ends with the esbuild bundle step succeeding.

Smoke-run one script against the dev database: `pnpm --filter ingestion exec tsx src/scripts/pipeline-status.ts 2>&1 | head -5`
Expected: normal output. The profile row does not exist until Task 6, which is fine: `pipeline-status` doesn't read identity, and the load only marks the cache empty.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/scripts apps/ingestion/test/scripts-load-organization.test.ts
printf 'feat(ingestion): every CLI script loads the organisation first\n\nStructural test fails any script whose main() does not start with\nawait loadOrganization().\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 5: API: organisation endpoints and error mapping

**Files:**
- Create: `apps/api/src/organization/organization.service.ts`, `organization.controller.ts`, `organization.module.ts`
- Modify: `apps/api/src/app.module.ts` (add `OrganizationModule` to `imports`)
- Modify: `apps/api/src/common/exception.filter.ts` (`toEnvelope` + `statusForCode`)
- Test: `apps/api/test/organization.test.ts` (create); `apps/api/test/exception-filter.test.ts` (append)

**Interfaces:**
- Consumes: `getOrganizationProfile`, `saveOrganizationIdentity`, `tcasInstitutionMatches`, `organizationTagline` (Task 2); `OrganizationIdentityInputSchema`, `OrganizationPublicView`, the error classes (Task 1).
- Produces HTTP:
  - `GET /api/v1/organization` (public) → `OrganizationPublicView`
  - `GET /api/v1/admin/organization` → `{ profile: OrganizationProfile | null }`
  - `PUT /api/v1/admin/organization` → `{ profile: OrganizationProfile }`
  - `GET /api/v1/admin/organization/tcas-match?name=` → `TcasNameMatch`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/exception-filter.test.ts`. Add `OrganizationNotConfiguredError, OrganizationVersionConflictError, OrganizationNotLoadedError` to its `@kku/shared` import.

```ts
describe('GlobalExceptionFilter — organisation errors', () => {
  it('maps a missing profile to 409 ORG_NOT_CONFIGURED', () => {
    const { status, body } = run(new OrganizationNotConfiguredError());
    expect(status).toBe(409);
    expect(body.error.code).toBe('ORG_NOT_CONFIGURED');
  });

  it('maps a stale save to 409 ORG_VERSION_CONFLICT', () => {
    const { status, body } = run(new OrganizationVersionConflictError());
    expect(status).toBe(409);
    expect(body.error.code).toBe('ORG_VERSION_CONFLICT');
  });

  it('keeps a never-loaded cache a 500 — it is a code defect', () => {
    expect(run(new OrganizationNotLoadedError()).status).toBe(500);
  });
});
```

Create `apps/api/test/organization.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrganizationProfile: vi.fn(),
  saveOrganizationIdentity: vi.fn(),
  tcasInstitutionMatches: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  getOrganizationProfile: mocks.getOrganizationProfile,
  saveOrganizationIdentity: mocks.saveOrganizationIdentity,
  tcasInstitutionMatches: mocks.tcasInstitutionMatches,
  organizationTagline: (s: string) => `${s} Curriculum Intelligence Platform`,
}));

import { OrganizationService } from '../src/organization/organization.service';

const ROW = {
  id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
  shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: 'landscape@example.ac.th',
  appUrl: 'https://landscape.example.ac.th', version: 4, updatedAt: new Date(), updatedBy: 'u1',
};

describe('OrganizationService.publicView', () => {
  beforeEach(() => mocks.getOrganizationProfile.mockReset());

  it('reports configured:false on a fresh install (200, so the sign-in page still renders)', async () => {
    mocks.getOrganizationProfile.mockResolvedValue(null);
    expect(await new OrganizationService().publicView()).toEqual({ configured: false });
  });

  it('never exposes the contact email publicly', async () => {
    mocks.getOrganizationProfile.mockResolvedValue(ROW);
    const view = await new OrganizationService().publicView();
    expect(view).toEqual({
      configured: true, nameTh: ROW.nameTh, nameEn: ROW.nameEn, shortNameTh: 'มต.', shortNameEn: 'EXU',
      tagline: 'EXU Curriculum Intelligence Platform', version: 4,
    });
    expect(JSON.stringify(view)).not.toContain('example.ac.th');
  });
});

describe('OrganizationService.save', () => {
  it('passes the parsed input and the acting user through', async () => {
    mocks.saveOrganizationIdentity.mockResolvedValue(ROW);
    const input = {
      nameTh: ROW.nameTh, nameEn: ROW.nameEn, shortNameTh: 'มต.', shortNameEn: 'EXU', regionTh: null,
      regionEn: null, contactEmail: null, appUrl: ROW.appUrl, expectedVersion: 3,
    };
    expect(await new OrganizationService().save(input, 'u9')).toEqual({ profile: ROW });
    expect(mocks.saveOrganizationIdentity).toHaveBeenCalledWith(input, 'u9');
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter api exec vitest run test/organization.test.ts test/exception-filter.test.ts`
Expected: FAIL. The service module is missing, and the filter returns 500 for organisation errors.

- [ ] **Step 3: Implement**

`apps/api/src/organization/organization.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { OrganizationProfile } from '@prisma/client';
import {
  getOrganizationProfile,
  organizationTagline,
  saveOrganizationIdentity,
  tcasInstitutionMatches,
  type TcasNameMatch,
} from '@kku/db';
import type { OrganizationIdentityInput, OrganizationPublicView } from '@kku/shared';

@Injectable()
export class OrganizationService {
  async publicView(): Promise<OrganizationPublicView> {
    const row = await getOrganizationProfile();
    if (!row) return { configured: false };
    return {
      configured: true,
      nameTh: row.nameTh,
      nameEn: row.nameEn,
      shortNameTh: row.shortNameTh,
      shortNameEn: row.shortNameEn,
      tagline: organizationTagline(row.shortNameEn),
      version: row.version,
    };
  }

  async adminView(): Promise<{ profile: OrganizationProfile | null }> {
    return { profile: await getOrganizationProfile() };
  }

  async save(input: OrganizationIdentityInput, userId: string): Promise<{ profile: OrganizationProfile }> {
    return { profile: await saveOrganizationIdentity(input, userId) };
  }

  async tcasMatch(name: string): Promise<TcasNameMatch> {
    return tcasInstitutionMatches(name);
  }
}
```

If `apps/api` cannot import `@prisma/client` types directly, `grep -rn "from '@prisma/client'" apps/api/src | head -2`. If there are no hits, use `Awaited<ReturnType<typeof getOrganizationProfile>>` instead.

`apps/api/src/organization/organization.controller.ts`:

```ts
import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { OrganizationIdentityInputSchema, type OrganizationIdentityInput, type SessionUser } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, Provenance, Public, ZodValidationPipe } from '../common';
import { OrganizationService } from './organization.service';

const TcasMatchQuery = z.object({ name: z.string().trim().min(1).max(200) });

@Controller('/organization')
export class OrganizationPublicController {
  constructor(private readonly service: OrganizationService) {}

  /** Public: the sign-in page and the setup banner read this before any session exists. */
  @Get()
  @Public()
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    return this.service.publicView();
  }
}

@Controller('/admin/organization')
export class OrganizationAdminController {
  constructor(private readonly service: OrganizationService) {}

  @Get()
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    return this.service.adminView();
  }

  @Put()
  @Authorized('settings:configure')
  @AuditLog({ action: 'organization.update', entityType: 'OrganizationProfile' })
  async put(
    @Body(new ZodValidationPipe(OrganizationIdentityInputSchema)) body: OrganizationIdentityInput,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.save(body, user.userId);
  }

  @Get('tcas-match')
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'tcas', name: 'TCAS admission statistics' }] })
  async tcasMatch(@Query(new ZodValidationPipe(TcasMatchQuery)) q: z.infer<typeof TcasMatchQuery>) {
    return this.service.tcasMatch(q.name);
  }
}
```

`apps/api/src/organization/organization.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OrganizationAdminController, OrganizationPublicController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [OrganizationPublicController, OrganizationAdminController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
```

In `apps/api/src/app.module.ts`, import `OrganizationModule` and add it to the `imports: [` array next to the admin module.

In `apps/api/src/common/exception.filter.ts`:
- Import `OrganizationNotConfiguredError` and `OrganizationVersionConflictError` from `@kku/shared`.
- Make these the first lines of `toEnvelope`:

```ts
    if (e instanceof OrganizationNotConfiguredError) e = new ApiError('ORG_NOT_CONFIGURED', e.message);
    else if (e instanceof OrganizationVersionConflictError) e = new ApiError('ORG_VERSION_CONFLICT', e.message);
```

- Add two cases to `statusForCode` above `default:`:

```ts
    case 'ORG_NOT_CONFIGURED':
    case 'ORG_VERSION_CONFLICT':
      return 409;
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `pnpm --filter api exec vitest run test/organization.test.ts test/exception-filter.test.ts && pnpm --filter api test 2>&1 | tail -4 && pnpm --filter api typecheck && pnpm --filter api lint`
Expected: PASS; api totals are 411 plus the new tests, with nothing newly failing.

Live check: the dev server (`pnpm dev`) hot-reloads `apps/api/src`, but `packages/db` changed, so restart it. Find the PID with `ss -ltnp | grep 4000` and kill it explicitly; never use `pkill -f "pnpm dev"`. Then run `curl -s localhost:4000/api/v1/organization`.
Expected: `{"data":{"configured":false},…}`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/organization apps/api/src/app.module.ts apps/api/src/common/exception.filter.ts \
  apps/api/test/organization.test.ts apps/api/test/exception-filter.test.ts
printf 'feat(api): organisation profile endpoints\n\nPublic read (no contact email), admin read/write gated by\nsettings:configure with an optimistic version lock, TCAS name helper.\nMissing profile and stale saves map to 409.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 6: KKU seed script and deploy smoke check

**Files:**
- Create: `apps/ingestion/src/scripts/org-seed-kku.ts`
- Modify: `apps/ingestion/package.json` (script `org:seed-kku`), root `package.json` (forwarding script, if the root forwards other ingestion scripts)
- Modify: `apps/ingestion/scripts/bundle-pipeline-scripts.ts` (add `'org-seed-kku.ts'` to the entry list next to `'sync-data-sources.ts'`)
- Modify: `scripts/smoke-test.sh` (one new `check`)
- Test: covered by Task 4's structural test (the new script must start `main()` with `loadOrganization()`), plus the run below.

**Interfaces:**
- Consumes: `KKU_REFERENCE_ORGANIZATION` (Task 1); `loadOrganization`, `getOrganizationProfile`, `saveOrganizationIdentity` (Task 2).

- [ ] **Step 1: Write the script**

`apps/ingestion/src/scripts/org-seed-kku.ts`:

```ts
// Seeds Khon Kaen University's organisation profile — KKU's OWN deployment
// only, once, right after the white-label phase-1 migration. Never overwrites
// an existing profile: an admin's edits win. Other adopters do NOT run this;
// they fill in /admin/organization.
//
//   pnpm org:seed-kku
//   prod: docker compose exec ingestion node /app/dist/scripts/org-seed-kku.js </dev/null
import { loadOrganization, getOrganizationProfile, prisma, saveOrganizationIdentity } from '@kku/db';
import { KKU_REFERENCE_ORGANIZATION } from '@kku/shared';

async function main(): Promise<void> {
  await loadOrganization();
  const existing = await getOrganizationProfile();
  if (existing) {
    console.log(`[org-seed-kku] profile already exists (${existing.nameEn}, version ${existing.version}) — left unchanged`);
    return;
  }
  const row = await saveOrganizationIdentity({ ...KKU_REFERENCE_ORGANIZATION, expectedVersion: null }, 'org-seed-kku');
  console.log(`[org-seed-kku] seeded ${row.nameEn} (version ${row.version})`);
}

main()
  .catch((err) => {
    console.error('[org-seed-kku] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

In `apps/ingestion/package.json` `scripts`, add `"org:seed-kku": "tsx src/scripts/org-seed-kku.ts"`. Match the exact `tsx` invocation the neighbouring scripts use; for example `"connector:run"`.

Check whether the root forwards ingestion scripts: `grep -n '"connector:run"' package.json`. If it does, add `"org:seed-kku": "pnpm --filter ingestion org:seed-kku"` in the same style.

Add `'org-seed-kku.ts',` to the entry array in `apps/ingestion/scripts/bundle-pipeline-scripts.ts`.

Append to `scripts/smoke-test.sh`, after the `/api/v1/ready` check:

```bash
check "GET $BASE_HTTPS/api/v1/organization → configured" \
  "curl -fsS -k --http1.1 -H 'Host: program-landscape.kku.ac.th' -m 10 '$BASE_HTTPS/api/v1/organization' | grep -q '\"configured\":true'"
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter ingestion exec vitest run test/scripts-load-organization.test.ts`
Expected: PASS, and the list includes `org-seed-kku.ts`.

Run: `bash -n scripts/smoke-test.sh`
Expected: no output (the syntax is valid).

**Do not run the seed on this dev database.** It is the KMUTT adopter's install; Task 7 creates its profile through the UI. To exercise the "already exists" branch, first finish Task 7, then run `pnpm --filter ingestion org:seed-kku`.
Expected: `profile already exists (… version N) — left unchanged`.

- [ ] **Step 3: Commit**

```bash
git add apps/ingestion/src/scripts/org-seed-kku.ts apps/ingestion/package.json package.json \
  apps/ingestion/scripts/bundle-pipeline-scripts.ts scripts/smoke-test.sh
printf 'feat(ingestion): org:seed-kku seeds KKU profile once; smoke test checks it\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 7: Web: `/admin/organization` Identity page

**Files:**
- Create: `apps/web/app/admin/organization/page.tsx`, `apps/web/app/admin/organization/client.tsx`
- Create: `apps/web/app/api/admin-organization/route.ts` (PUT proxy), `apps/web/app/api/admin-organization/tcas-match/route.ts` (GET proxy)
- Modify: `apps/web/app/admin/page.tsx` (card next to "Academic year", around line 812)
- Test: `apps/web/app/admin/organization/client.test.tsx` (create)

**Interfaces:**
- Consumes: the Task 5 endpoints through the proxies; `OrganizationIdentityInput` field names.
- Produces: `OrganizationClient({ initial: AdminOrganizationResponse | null, loadError: string | null })`, where `interface AdminOrganizationResponse { profile: OrganizationProfileDto | null }` and `OrganizationProfileDto` has the Task 2 row fields, with `updatedAt` as a string.

- [ ] **Step 1: Write the failing render test**

Check how existing web client tests render: `ls apps/web/app/**/*.test.tsx | head -3`, then copy the imports one of them uses (`@testing-library/react`, plus any `vi.mock` of `sonner`).

`apps/web/app/admin/organization/client.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrganizationClient } from './client';

describe('OrganizationClient', () => {
  it('shows a first-time setup state when no profile exists', () => {
    render(<OrganizationClient initial={{ profile: null }} loadError={null} />);
    expect(screen.getByText(/not configured yet/i)).toBeTruthy();
    expect((screen.getByLabelText(/Thai name/i) as HTMLInputElement).value).toBe('');
  });

  it('prefills an existing profile and shows its version', () => {
    render(
      <OrganizationClient
        initial={{
          profile: {
            id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
            shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: null,
            appUrl: 'https://landscape.example.ac.th', version: 3, updatedAt: '2026-10-15T00:00:00Z', updatedBy: null,
          },
        }}
        loadError={null}
      />,
    );
    expect((screen.getByLabelText(/English name/i) as HTMLInputElement).value).toBe('Example University');
    expect(screen.getByText(/version 3/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter web exec vitest run app/admin/organization/client.test.tsx`
Expected: FAIL with "Cannot find module './client'".

- [ ] **Step 3: Implement**

`apps/web/app/api/admin-organization/route.ts`: copy `apps/web/app/api/admin-academic-year/route.ts` exactly, changing only the upstream path to `/api/v1/admin/organization` and the header comment to `// Proxy: client-side PUT to save the organisation profile.`

`apps/web/app/api/admin-organization/tcas-match/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy: the Identity form's "does this Thai name match TCAS?" helper.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function GET(req: Request) {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const cookieName =
    process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const name = new URL(req.url).searchParams.get('name') ?? '';
  const upstream = await fetch(
    `${API_BASE}/api/v1/admin/organization/tcas-match?name=${encodeURIComponent(name)}`,
    { headers, cache: 'no-store' },
  );
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
```

`apps/web/app/admin/organization/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { OrganizationClient, type AdminOrganizationResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Organisation — Admin' };

export default async function AdminOrganizationPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  let data: AdminOrganizationResponse | null = null;
  let loadError: string | null = null;
  try {
    data = await apiFetch<AdminOrganizationResponse>('/admin/organization');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <OrganizationClient initial={data} loadError={loadError} />
    </AuthedAppShell>
  );
}
```

`apps/web/app/admin/organization/client.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Badge } from '@kku/ui';
import { Building2, AlertTriangle } from 'lucide-react';

export interface OrganizationProfileDto {
  id: string;
  nameTh: string;
  nameEn: string;
  shortNameTh: string;
  shortNameEn: string;
  regionTh: string | null;
  regionEn: string | null;
  contactEmail: string | null;
  appUrl: string;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}
export interface AdminOrganizationResponse {
  profile: OrganizationProfileDto | null;
}
interface TcasMatch {
  exactRows: number;
  suggestions: { name: string; rows: number; similarity: number }[];
}

type FormState = {
  nameTh: string; nameEn: string; shortNameTh: string; shortNameEn: string;
  regionTh: string; regionEn: string; contactEmail: string; appUrl: string;
};

function toForm(p: OrganizationProfileDto | null): FormState {
  return {
    nameTh: p?.nameTh ?? '', nameEn: p?.nameEn ?? '', shortNameTh: p?.shortNameTh ?? '',
    shortNameEn: p?.shortNameEn ?? '', regionTh: p?.regionTh ?? '', regionEn: p?.regionEn ?? '',
    contactEmail: p?.contactEmail ?? '', appUrl: p?.appUrl ?? '',
  };
}

const FIELDS: { key: keyof FormState; label: string; hint?: string; required?: boolean }[] = [
  { key: 'nameTh', label: 'Thai name', required: true,
    hint: 'Must match the สถาบัน column of the TCAS sheets character for character.' },
  { key: 'nameEn', label: 'English name', required: true,
    hint: 'As it appears in ranking tables and your Scopus affiliation.' },
  { key: 'shortNameTh', label: 'Thai short name', required: true },
  { key: 'shortNameEn', label: 'English short name', required: true, hint: 'Shown in the tagline and AI text.' },
  { key: 'regionTh', label: 'Region (Thai)' },
  { key: 'regionEn', label: 'Region (English)' },
  { key: 'contactEmail', label: 'Contact email',
    hint: 'Sent in outbound User-Agents so site operators can reach you. Never shown publicly.' },
  { key: 'appUrl', label: 'Public app URL', required: true },
];

export function OrganizationClient({
  initial,
  loadError,
}: {
  initial: AdminOrganizationResponse | null;
  loadError: string | null;
}) {
  const [profile, setProfile] = useState<OrganizationProfileDto | null>(initial?.profile ?? null);
  const [form, setForm] = useState<FormState>(toForm(initial?.profile ?? null));
  const [saving, setSaving] = useState(false);
  const [tcas, setTcas] = useState<TcasMatch | null>(null);

  async function checkTcas() {
    if (!form.nameTh.trim()) return;
    const res = await fetch(`/api/admin-organization/tcas-match?name=${encodeURIComponent(form.nameTh)}`);
    if (res.ok) setTcas((await res.json()).data as TcasMatch);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin-organization', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, expectedVersion: profile?.version ?? null }),
      });
      const json = await res.json();
      if (res.status === 409 && json.error?.code === 'ORG_VERSION_CONFLICT') {
        toast.error('Someone else changed the organisation — reload the page and try again.');
        return;
      }
      if (!res.ok) throw new Error(json.error?.message ?? `Save failed (${res.status})`);
      const next = json.data.profile as OrganizationProfileDto;
      setProfile(next);
      setForm(toForm(next));
      toast.success('Organisation saved. Other services pick it up within a minute.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <header className="flex items-center gap-2">
        <Building2 className="size-icon-lg text-accent-default" aria-hidden />
        <h1 className="text-lg font-semibold">Organisation</h1>
        {profile && <Badge tone="info">version {profile.version}</Badge>}
      </header>

      {loadError && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{loadError}</div>
      )}

      {!profile && !loadError && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-icon-md text-warning" aria-hidden />
          <span>
            The organisation is not configured yet. AI features and data connectors stay unavailable
            until you save this form.
          </span>
        </div>
      )}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="text-text-secondary">
              {f.label}
              {f.required ? ' *' : ''}
            </span>
            <input
              value={form[f.key]}
              required={f.required}
              type={f.key === 'contactEmail' ? 'email' : f.key === 'appUrl' ? 'url' : 'text'}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              onBlur={f.key === 'nameTh' ? () => void checkTcas() : undefined}
              className="rounded-md border border-default bg-surface-1 px-2 py-1"
            />
            {f.hint && <span className="text-xs text-text-tertiary">{f.hint}</span>}
            {f.key === 'nameTh' && tcas && (
              <span className="text-xs">
                {tcas.exactRows > 0 ? (
                  <Badge tone="success">Matches {tcas.exactRows} TCAS rows</Badge>
                ) : (
                  <>
                    <Badge tone="warning">No TCAS rows match exactly</Badge>{' '}
                    {tcas.suggestions.length > 0 && (
                      <span className="text-text-secondary">
                        Closest: {tcas.suggestions.slice(0, 3).map((s) => `${s.name} (${s.rows})`).join(' · ')}
                      </span>
                    )}
                  </>
                )}
              </span>
            )}
          </label>
        ))}
        <div>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : profile ? 'Save changes' : 'Create organisation'}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

`Badge` (`packages/ui/src/primitives/badge.tsx`) supports the `info`, `success` and `warning` tones used here.

In `apps/web/app/admin/page.tsx`, add a card directly before the `href: '/admin/app/academic-year'` entry, and add `Building2` to its `lucide-react` import:

```tsx
    {
      href: '/admin/organization',
      label: 'Organisation',
      description:
        'Your institution’s names, short names, region, contact email and public URL — used for TCAS matching, AI text and outbound requests.',
      icon: <Building2 className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
```

- [ ] **Step 4: Run tests, typecheck and lint, then try it in the browser**

Run: `pnpm --filter web exec vitest run app/admin/organization/client.test.tsx && pnpm --filter web typecheck && pnpm --filter web lint`
Expected: PASS, and no errors.

Browser check with playwright-cli (session already signed in as an admin; run it from a scratch directory outside the repo; use `--browser chromium`):
1. Open `http://localhost:3000/admin/organization`. Expect the "not configured yet" banner and empty fields.
2. Fill in **this install's** values (the KMUTT values that used to be in `.env`). Blur the Thai name field and expect "Matches N TCAS rows" with N > 0.
3. Save. Expect a toast and "version 1".
4. Run `curl -s localhost:4000/api/v1/organization` and expect `"configured":true` with the short name.
5. Re-save from a second tab that still shows version 1. Expect the conflict toast.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/admin/organization apps/web/app/api/admin-organization apps/web/app/admin/page.tsx
printf 'feat(web): /admin/organization identity page\n\nFirst-time setup state, TCAS name match helper, optimistic-lock\nconflict toast.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

### Task 8: Remove the env keys, update the docs, and run full verification

**Files:**
- Modify: `.env.example` (lines 19–30 and line 320), `.env.prod.example` (lines 36–45)
- Modify: `docs/adopters/README.md:286-288`, `docs/adopters/README.th.md:290-292`, `docs/guides/fresh-checkout-setup.md:175-176`, `docs/data-sources/job-108.md:57`

- [ ] **Step 1: Edit the env templates**

In `.env.example`, delete the whole institution-identity block: the comment lines plus `INSTITUTION_NAME_TH`, `INSTITUTION_NAME_EN`, `INSTITUTION_SHORT_NAME_EN`, `INSTITUTION_SHORT_NAME_TH` and `INSTITUTION_CONTACT_EMAIL`. Read lines 15–35 first so the block is removed exactly. Put this in its place:

```
# Institution identity (names, short names, region, contact email, public
# URL) is NOT configured here. After first boot, sign in as an admin and fill
# in /admin/organization — AI features and data connectors stay unavailable
# until you do. APP_PUBLIC_URL below is still read by the web app for its own
# origin (profile QR codes).
```

If `APP_PUBLIC_URL=` sat inside the removed block, keep that one line directly after the new comment.

At line 320, replace `# Set INSTITUTION_NAME_TH above first.` with `# Set the Thai name at /admin/organization first (it must match TCAS exactly).`

Make the same changes in `.env.prod.example` lines 36–45.

- [ ] **Step 2: Edit the docs**

- **`docs/adopters/README.md`:** replace the three table rows at lines 286–288 with one row:
  `| *(none — moved)* | Institution identity is set in the app at **/admin/organization** (names, short names, region, contact email, public URL). The Thai name must match the TCAS สถาบัน column exactly; the form checks it for you. |`
- **`docs/adopters/README.th.md`:** make the matching change in Thai:
  `| *(ย้ายแล้ว)* | ตั้งค่าข้อมูลสถาบันในแอปที่ **/admin/organization** (ชื่อ ชื่อย่อ ภูมิภาค อีเมลติดต่อ URL สาธารณะ) ชื่อภาษาไทยต้องตรงกับคอลัมน์ สถาบัน ของ TCAS ทุกตัวอักษร ฟอร์มจะตรวจให้ |`
- **`docs/guides/fresh-checkout-setup.md:175-176`:** replace the sentence that tells adopters to set `INSTITUTION_*` in `.env` with: "…running them at an institution other than KKU, **first fill in /admin/organization** (sign in as an admin). The Thai name there must match TCAS exactly; the form shows how many TCAS rows it matches."
- **`docs/data-sources/job-108.md:57`:** change the placeholder line to `User-Agent: Program-Landscape/1.0 (+<organisation app URL>; <organisation contact email>)`.

- [ ] **Step 3: Leak and leftover scan**

Run: `git grep -nE "INSTITUTION_(NAME|SHORT|CONTACT)" -- ':!docs/superpowers' ':!CLAUDE.md'`
Expected: no output.

Run: `git diff develop --stat | tail -1 && git diff develop | grep -nE "@kku\.ac\.th|[0-9]{13}" | grep -v "program-landscape.kku.ac.th"`
Expected: no personal KKU email addresses and no 13-digit IDs.

- [ ] **Step 4: Full verification**

Run: `pnpm check 2>&1 | tail -25`
Expected: lint, typecheck and test all pass, except the failures that already exist: shared `usage-action-coverage` (4) and db `gap-map.test.ts` (5). Compare the counts with the start of the branch; nothing new may fail.

Regression, with **this dev install's** profile saved in Task 7:
- TCAS: `pnpm --filter ingestion connector:run tcas 2>&1 | grep -E "outcome|kkuMatched|matched"`
  Expected: `outcome=SUCCEEDED`, with the same matched-row count the run produced before this branch (it used the env value that the form now holds).
- User-Agent: `pnpm --filter ingestion connector:run world-bank 2>&1 | grep -E "outcome"`
  Expected: `SUCCEEDED`.

Restart the dev server (resolve PIDs with `ss -ltnp`, kill them explicitly), then open `http://localhost:3000/trends?windowDays=3650` and an analyst brief. Expect them to behave as before.

- [ ] **Step 5: Commit**

```bash
git add .env.example .env.prod.example docs/adopters docs/guides/fresh-checkout-setup.md docs/data-sources/job-108.md
printf 'docs: institution identity moves from .env to /admin/organization\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' > /tmp/msg && git commit -F /tmp/msg
```

---

## Deployment note for KKU (carry into the release notes)

1. `prisma migrate deploy` runs as usual in `deploy.sh`.
2. **Before** the smoke test, run `docker compose exec -T ingestion node /app/dist/scripts/org-seed-kku.js </dev/null`. The new smoke check `GET /api/v1/organization → configured` fails the deploy if this is skipped.
3. Remove `INSTITUTION_*` from `/opt/program-landscape/.env.prod` afterwards. Nothing reads those keys any more.

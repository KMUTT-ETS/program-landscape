# Staff Profile API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let other KKU systems fetch a staff member's `/profile` data as JSON, keyed by Thai citizen ID or email, authenticated by per-client API keys that admins manage in the console.

**Architecture:** The profile builder moves out of `apps/web` into `packages/db/src/staff-profile/` as `buildStaffProfile(facultyMemberId)`, so the page and the new NestJS endpoint compute identical figures. The publications cache moves to a new table keyed by staff record. A global `ApiKeyGuard` (active only on `@ApiKeyAuth()` routes) authenticates `POST /api/v1/external/staff-profile`; a pure mapper filters sections per client grant; every call is logged without the identifier. An admin console at `/admin/external/api-clients` manages clients and keys.

**Tech Stack:** NestJS 10, Prisma 5 / PostgreSQL 16, Zod, ioredis, Next.js 14 App Router, vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-staff-profile-api-design.md` — read it first.

---

## Ground rules for every task

- **Run the dev-safety guard's rules, never around them.** `.claude/settings.json` blocks `prisma migrate dev`, `db push`, `migrate reset`, `migrate diff --from-migrations`, `--shadow-database-url`, `TRUNCATE`, `DROP DATABASE`. Migrations here are hand-written SQL applied with `pnpm db:migrate` (= `prisma migrate deploy`). If a command is refused, stop and tell the controller.
- **Never print `.env`.** Test a key is set with `grep -c '^KEY=' .env`.
- **Commit with `git commit -F <file>`**, message ending with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
  Never `git add` `handoff.md`, `presentation_en.md`, `presentation_th.md`.
- **Scratch files** go in the session scratchpad; delete only files you created, by name.
- **`nest start --watch` does not reload `packages/*`**, and a long-running `next dev` keeps the old Prisma client after a schema change. After Tasks 4, 5 and 7, restart the dev servers before any live check (resolve PIDs with `ss -ltnp`; never `pkill -f "pnpm dev"`).
- **`npx prisma` at the repo root resolves a global v7** — always run Prisma as `pnpm --filter @kku/db exec prisma …`.
- Test commands: `pnpm --filter @kku/shared test`, `pnpm --filter @kku/db test`, `pnpm --filter api test`, `pnpm --filter web test`. Typecheck: `pnpm --filter <pkg> typecheck`.

## File map

**Create**
- `apps/web/scripts/profile-snapshot.ts` — dev-only characterisation harness (Task 1)
- `packages/shared/src/identity/thai-citizen-id.ts` — checksum validation (Task 2)
- `packages/shared/src/net/ip-allowlist.ts`, `packages/shared/src/net/index.ts` — CIDR matching (Task 2)
- `packages/shared/src/staff-profile/types.ts` — profile types + APA helpers, moved (Task 3)
- `packages/shared/src/staff-profile/api-schema.ts` — request + response Zod schemas (Task 9)
- `packages/shared/src/staff-profile/index.ts`
- `packages/db/src/staff-profile/{kku-scholar,scopus,external,teaching,profile,lookup,index}.ts` (Task 5)
- `packages/db/src/api-clients.ts` — key crypto, CRUD, request log (Task 8)
- `packages/db/prisma/migrations/20260930100000_staff_publications_cache/migration.sql` (Task 4)
- `packages/db/prisma/migrations/20260930110000_api_clients/migration.sql` (Task 7)
- `apps/api/src/external/{api-key.guard,staff-profile.mapper,staff-profile.service,staff-profile.controller,external.module}.ts` (Tasks 11–13)
- `apps/api/src/admin/api-clients/api-clients.controller.ts` (Task 14)
- `apps/web/app/admin/external/api-clients/{page,client}.tsx`, `apps/web/src/lib/actions/api-clients.ts` (Task 17)
- `docs/integrations/staff-profile-api.md` (Task 18)
- Tests listed per task.

**Move** (`git mv`, Task 5)
- `apps/web/src/lib/kku-publications.ts` → `packages/db/src/staff-profile/kku-scholar.ts`
- `apps/web/src/lib/scopus-publications.ts` → `packages/db/src/staff-profile/scopus.ts`
- `apps/web/src/lib/external-publications.ts` → `packages/db/src/staff-profile/external.ts`
- `apps/web/src/lib/teaching-profile.ts` → `packages/db/src/staff-profile/teaching.ts`
- `apps/web/test/publication-cache-callers.test.ts` → `packages/db/test/publication-cache-callers.test.ts`

**Modify**
- `apps/web/src/lib/profile-data.ts` (becomes thin wrapper), `apps/web/src/lib/profile-types.ts`
- `packages/db/prisma/schema.prisma`, `packages/db/package.json`, `packages/db/src/index.ts`, `packages/db/src/scholar-fetch.ts`, `packages/db/src/retention.ts`
- `packages/shared/src/index.ts`, `packages/shared/src/identity/index.ts`, `packages/shared/src/auth/permissions.ts`, `packages/shared/src/api/envelope.ts`, `packages/shared/src/observability/log-redaction.ts`
- `apps/api/src/app.module.ts`, `apps/api/src/admin/admin.module.ts`, `apps/api/src/common/cache.service.ts`
- `apps/ingestion/src/scripts/retention-sweep.ts`
- `apps/web/app/admin/page.tsx` (console tile)
- `infra/nginx/nginx.conf`, `infra/nginx/conf.d/program-landscape.conf`
- `docs/pdpa.md`, `CLAUDE.md`

---

### Task 1: Baseline snapshot of `/profile` output (dev only)

The refactor in Tasks 3–5 must not change what `/profile` shows. There are no unit tests for `getProfileData` (it needs a database and makes live Scopus calls), so this harness captures real output on dev before and after.

**Files:**
- Create: `apps/web/scripts/profile-snapshot.ts`

- [ ] **Step 1: Write the harness**

```ts
// Dev-only characterisation harness for the staff-profile refactor
// (docs/superpowers/plans/2026-09-30-staff-profile-api.md, Tasks 1 and 5).
//
//   pnpm exec tsx apps/web/scripts/profile-snapshot.ts <out.json>
//
// Picks a fixed set of dev users who resolve to a staff record with research
// rows (plus the one Scholar-bound person, if any), forces their publications
// cache cold so the live pipeline runs, and writes getProfileData() output as
// key-sorted JSON. Run before and after the refactor and `diff` the files.
//
// `source` and `scholarPaperId` are stripped from publications because the
// refactor ADDS them — every other field must match.
import { writeFileSync } from 'node:fs';
import { prisma } from '@kku/db';
import { getProfileData } from '../src/lib/profile-data';

const SAMPLE = 5;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

async function pickUsers(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    (SELECT u.id FROM users u
       JOIN faculty_members fm ON fm.employee_id = u.employee_id AND fm.is_active
      WHERE EXISTS (SELECT 1 FROM research_outputs r WHERE r.faculty_member_id = fm.id)
      ORDER BY u.id LIMIT ${SAMPLE})
    UNION
    (SELECT u.id FROM users u
       JOIN faculty_members fm ON fm.employee_id = u.employee_id
      WHERE fm.scholar_profile_id IS NOT NULL
      LIMIT 1)`;
  return rows.map((r) => r.id).sort();
}

async function forceCold(): Promise<void> {
  // Whichever cache table exists — the refactor replaces one with the other.
  for (const table of ['user_publications_cache', 'staff_publications_cache']) {
    const exists = await prisma.$queryRawUnsafe<Array<{ t: string | null }>>(
      `SELECT to_regclass('public.${table}')::text AS t`,
    );
    if (exists[0]?.t) {
      await prisma.$executeRawUnsafe(`UPDATE ${table} SET fetched_at = to_timestamp(0)`);
    }
  }
}

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('usage: profile-snapshot.ts <out.json>');
  const userIds = await pickUsers();
  await forceCold();
  const snapshot: Record<string, unknown> = {};
  for (const id of userIds) {
    const profile = await getProfileData(id);
    if (profile) {
      for (const p of profile.publications as Array<Record<string, unknown>>) {
        delete p.source;
        delete p.scholarPaperId;
      }
    }
    snapshot[id] = profile;
  }
  writeFileSync(out, JSON.stringify(sortKeys(snapshot), null, 2) + '\n');
  console.log(`wrote ${userIds.length} profiles to ${out}`);
  await prisma.$disconnect();
}

void main();
```

- [ ] **Step 2: Capture the baseline**

Run (dev database up):
```bash
pnpm exec tsx apps/web/scripts/profile-snapshot.ts "$SCRATCH/profile-before.json"
```
where `$SCRATCH` is the session scratchpad. Expected: `wrote N profiles to …` with N between 1 and 6. Keep the file — Task 5 compares against it. Run it a second time into `profile-before-2.json` and `diff` the two: any difference is live-source churn (e.g. a citation count moved) and must be noted so Task 5 does not misread it as a regression.

- [ ] **Step 3: Commit**

```bash
git add apps/web/scripts/profile-snapshot.ts
git commit -F <msg>   # test(profile): snapshot harness for the staff-profile refactor
```

---

### Task 2: Thai citizen-ID checksum and IP allowlist helpers

**Files:**
- Create: `packages/shared/src/identity/thai-citizen-id.ts`
- Create: `packages/shared/src/net/ip-allowlist.ts`, `packages/shared/src/net/index.ts`
- Modify: `packages/shared/src/identity/index.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/thai-citizen-id.test.ts`, `packages/shared/test/ip-allowlist.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/thai-citizen-id.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isValidThaiCitizenId, normaliseThaiCitizenId } from '../src/identity/thai-citizen-id';

// 1101700203883: weights 13..2 over the first 12 digits sum to 162;
// (11 - 162 % 11) % 10 = 3, the 13th digit. 3100600123455 likewise (sum 160).
describe('isValidThaiCitizenId', () => {
  it('accepts ids whose 13th digit matches the mod-11 checksum', () => {
    expect(isValidThaiCitizenId('1101700203883')).toBe(true);
    expect(isValidThaiCitizenId('3100600123455')).toBe(true);
  });
  it('rejects a wrong check digit', () => {
    expect(isValidThaiCitizenId('1101700203884')).toBe(false);
  });
  it('accepts the dashed and spaced forms people type', () => {
    expect(isValidThaiCitizenId('1-1017-00203-88-3')).toBe(true);
    expect(isValidThaiCitizenId('1 1017 00203 88 3')).toBe(true);
  });
  it('rejects anything that is not exactly 13 digits', () => {
    expect(isValidThaiCitizenId('110170020388')).toBe(false);
    expect(isValidThaiCitizenId('11017002038830')).toBe(false);
    expect(isValidThaiCitizenId('11017002038a3')).toBe(false);
    expect(isValidThaiCitizenId('')).toBe(false);
  });
});

describe('normaliseThaiCitizenId', () => {
  it('strips dashes and whitespace only', () => {
    expect(normaliseThaiCitizenId(' 1-1017-00203-88-3 ')).toBe('1101700203883');
  });
});
```

`packages/shared/test/ip-allowlist.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ipAllowed, isValidAllowlistEntry } from '../src/net/ip-allowlist';

describe('ipAllowed', () => {
  it('allows everyone when the list is empty', () => {
    expect(ipAllowed('203.0.113.9', [])).toBe(true);
    expect(ipAllowed(undefined, [])).toBe(true);
  });
  it('matches IPv4 CIDRs and bare addresses', () => {
    expect(ipAllowed('10.101.5.7', ['10.101.0.0/16'])).toBe(true);
    expect(ipAllowed('10.102.5.7', ['10.101.0.0/16'])).toBe(false);
    expect(ipAllowed('10.101.118.80', ['10.101.118.80'])).toBe(true);
  });
  it('unwraps IPv4-mapped IPv6, which is what Express reports', () => {
    expect(ipAllowed('::ffff:10.101.5.7', ['10.101.0.0/16'])).toBe(true);
  });
  it('matches IPv6 prefixes', () => {
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
  });
  it('refuses an unknown caller address when a list is set', () => {
    expect(ipAllowed(undefined, ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('not-an-ip', ['10.0.0.0/8'])).toBe(false);
  });
});

describe('isValidAllowlistEntry', () => {
  it('accepts addresses and CIDRs', () => {
    for (const e of ['10.0.0.0/8', '10.1.2.3', '2001:db8::/32', '::1']) {
      expect(isValidAllowlistEntry(e)).toBe(true);
    }
  });
  it('rejects malformed entries', () => {
    for (const e of ['10.0.0.0/33', '10.0.0/8', '10.0.0.0/', '10.0.0.0/8x', 'host.kku.ac.th', '']) {
      expect(isValidAllowlistEntry(e)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @kku/shared exec vitest run test/thai-citizen-id.test.ts test/ip-allowlist.test.ts`
Expected: FAIL — cannot resolve `../src/identity/thai-citizen-id` / `../src/net/ip-allowlist`.

- [ ] **Step 3: Implement**

`packages/shared/src/identity/thai-citizen-id.ts`:
```ts
// Thai citizen ID (เลขประจำตัวประชาชน) validation.
//
// 13 digits; the 13th is a check digit: the first 12 digits are weighted
// 13, 12, …, 2, summed, and the check digit is (11 - sum mod 11) mod 10.
// Validating it at an API boundary turns a typo into a 400 instead of a
// 404 that looks like "this person is not on staff".

/** Strip the dashes and whitespace people type; nothing else. */
export function normaliseThaiCitizenId(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

export function isValidThaiCitizenId(raw: string): boolean {
  const id = normaliseThaiCitizenId(raw);
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}
```

`packages/shared/src/net/ip-allowlist.ts`:
```ts
// Caller-IP allowlists for machine clients. Entries are bare addresses or
// CIDRs, IPv4 or IPv6. An empty list means "any address".
import { BlockList, isIP } from 'node:net';

interface ParsedEntry {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

function parseEntry(entry: string): ParsedEntry | null {
  const trimmed = entry.trim();
  const slash = trimmed.indexOf('/');
  const address = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const prefixRaw = slash === -1 ? null : trimmed.slice(slash + 1);
  const version = isIP(address);
  if (version === 0) return null;
  const max = version === 4 ? 32 : 128;
  if (prefixRaw !== null && !/^\d{1,3}$/.test(prefixRaw)) return null;
  const prefix = prefixRaw === null ? max : Number(prefixRaw);
  if (prefix > max) return null;
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' };
}

export function isValidAllowlistEntry(entry: string): boolean {
  return parseEntry(entry) !== null;
}

/** Express reports IPv4 callers on a dual-stack socket as ::ffff:a.b.c.d. */
function unwrapMapped(ip: string): string {
  const tail = ip.startsWith('::ffff:') ? ip.slice(7) : null;
  return tail !== null && isIP(tail) === 4 ? tail : ip;
}

export function ipAllowed(ip: string | null | undefined, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!ip) return false;
  const addr = unwrapMapped(ip);
  const version = isIP(addr);
  if (version === 0) return false;
  const list = new BlockList();
  for (const entry of allowlist) {
    const parsed = parseEntry(entry);
    if (parsed) list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  return list.check(addr, version === 4 ? 'ipv4' : 'ipv6');
}
```

`packages/shared/src/net/index.ts`:
```ts
export * from './ip-allowlist';
```

Append to `packages/shared/src/identity/index.ts`:
```ts
export * from './thai-citizen-id';
```

In `packages/shared/src/index.ts`, beside the existing `export * from './identity';` line, add:
```ts
export * from './net';
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @kku/shared exec vitest run test/thai-citizen-id.test.ts test/ip-allowlist.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Verify by mutation**

Change `(13 - i)` to `(12 - i)` in `thai-citizen-id.ts`, rerun: the "accepts" test must FAIL. Change `prefix > max` to `prefix > max + 1`, rerun: `10.0.0.0/33` must be accepted and the test FAIL. Revert both.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter @kku/shared typecheck` → no errors.
```bash
git add packages/shared/src/identity packages/shared/src/net packages/shared/src/index.ts packages/shared/test/thai-citizen-id.test.ts packages/shared/test/ip-allowlist.test.ts
git commit -F <msg>   # feat(shared): Thai citizen-ID checksum and IP allowlist matching
```

---

### Task 3: Move profile types and APA helpers into `@kku/shared`

Both the browser (`profile-view.tsx`) and the API need these types and the three pure APA functions. They move to a client-safe module in `@kku/shared` that the browser imports by **deep path** (the `@kku/shared` barrel re-exports modules using `node:crypto`, which webpack cannot bundle). `ProfileData` stays in web because it references `TeachingTalentStamp` from `@kku/db`. `PublicationEntry` gains `source` and `scholarPaperId`.

**Files:**
- Create: `packages/shared/src/staff-profile/types.ts`, `packages/shared/src/staff-profile/index.ts`
- Modify: `packages/shared/src/index.ts`, `apps/web/src/lib/profile-types.ts`, `apps/web/src/lib/profile-data.ts`
- Test: `apps/web/test/profile-types-client-safe.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/test/profile-types-client-safe.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// profile-view.tsx is a CLIENT component and imports runtime helpers from
// profile-types. If any import on that path reaches the @kku/shared or
// @kku/db barrel, webpack tries to bundle node:crypto and the build breaks.
// Pin the two files' import lines structurally.
const read = (...p: string[]) => readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const importLines = (src: string) => src.split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\s+'/.test(l));

describe('profile types stay client-safe', () => {
  it('the shared types module has no runtime imports at all', () => {
    const src = read('..', '..', 'packages', 'shared', 'src', 'staff-profile', 'types.ts');
    for (const line of importLines(src)) expect(line).toMatch(/^\s*(import|export) type\b/);
  });

  it('web profile-types takes runtime code only from the deep path', () => {
    const src = read('src', 'lib', 'profile-types.ts');
    for (const line of importLines(src)) {
      if (/^\s*(import|export) type\b/.test(line)) continue;
      expect(line).toContain("'@kku/shared/src/staff-profile/types'");
    }
  });

  it('the shared types carry the new provenance fields', () => {
    const src = read('..', '..', 'packages', 'shared', 'src', 'staff-profile', 'types.ts');
    expect(src).toMatch(/source:\s*string\s*\|\s*null/);
    expect(src).toMatch(/scholarPaperId:\s*string\s*\|\s*null/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter web exec vitest run test/profile-types-client-safe.test.ts`
Expected: FAIL — ENOENT on `packages/shared/src/staff-profile/types.ts`.

- [ ] **Step 3: Create the shared module**

Create `packages/shared/src/staff-profile/types.ts` from the body of `apps/web/src/lib/profile-types.ts`, with these exact differences:

1. Replace the file's header comment with:
```ts
// Staff-profile types and pure helpers — shared by the /profile page, its
// CLIENT component, and the external staff-profile API.
//
// CLIENT-SAFE BY CONSTRUCTION: this file must never import anything at
// runtime. Browser code imports it by deep path
// ('@kku/shared/src/staff-profile/types'), never through the @kku/shared
// barrel, which pulls node:crypto. Pinned by
// apps/web/test/profile-types-client-safe.test.ts.
```
2. Delete the `import type { TeachingTalentStamp } from '@kku/db';` line, the `export type { TeachingTalentStamp };` line, and the whole `ProfileData` interface (they stay in web).
3. In `PublicationEntry`, after `authorsAreComplete: boolean;`, add:
```ts
  /** Where the paper came from: the local row's `ResearchOutput.source`
   *  (e.g. 'google-scholar', 'kku-publications:scopus'), or `live:<source>`
   *  for a paper only the live library read returned. */
  source: string | null;
  /** Google Scholar's paper id when the row came from a Scholar import. */
  scholarPaperId: string | null;
```
4. After the `ResearchSummary` interface, add:
```ts
/** Which source family built the publication list. `google-scholar` once
 *  the person has any Scholar import (see hasScholarImport in @kku/db). */
export type ResearchBasis = 'google-scholar' | 'library';

/** How the publications list was served from its cache. */
export type PublicationsCacheStatus = 'hit' | 'stale' | 'miss';
```

`packages/shared/src/staff-profile/index.ts`:
```ts
export * from './types';
```

In `packages/shared/src/index.ts` add:
```ts
export * from './staff-profile';
```

- [ ] **Step 4: Reduce web `profile-types.ts` to a re-export plus `ProfileData`**

Replace the whole of `apps/web/src/lib/profile-types.ts` with:
```ts
// Client-safe profile types. The shared shapes and the APA helpers live in
// @kku/shared/src/staff-profile/types (imported by DEEP PATH — the
// @kku/shared barrel pulls node:crypto, which webpack cannot bundle for the
// browser). Only ProfileData lives here, because it references a type from
// @kku/db. `import type` is erased at compile time, so neither barrel ever
// reaches the browser bundle.
import type { TeachingTalentStamp } from '@kku/db';
import type {
  CachedExpertiseNarrative,
  CurriculumProgram,
  EducationEntry,
  ProfileBasicInfo,
  PublicationEntry,
  ResearchSummary,
  TeachingProfile,
} from '@kku/shared/src/staff-profile/types';

export * from '@kku/shared/src/staff-profile/types';
export type { TeachingTalentStamp };
```
then paste the `ProfileData` interface below it **verbatim** from the old file.

- [ ] **Step 5: Populate the new fields where `PublicationEntry` objects are built**

Run: `pnpm --filter web typecheck`. The compiler names every construction site missing `source` / `scholarPaperId`. In `apps/web/src/lib/profile-data.ts`:

- `interface ResearchOutputRow` — add `source: string | null;` and `scholarPaperId: string | null;`.
- `dedupePublications` — in the `out.push({ … })` object add `source: canonical.source, scholarPaperId: canonical.scholarPaperId,`.
- `mergeAndEnrichPublications` Pass 3 (the object built from an unclaimed `KkuScholarPublication sp`) — add `source: \`live:${sp.source}\`, scholarPaperId: null,`.
- Any other site the compiler names: a paper built from a local row takes that row's fields; a paper built from a live read takes `live:<its source>` and `null`.

Rerun until `pnpm --filter web typecheck` is clean.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter web exec vitest run test/profile-types-client-safe.test.ts` → PASS.
Run: `pnpm --filter web test` and `pnpm --filter @kku/shared test` → PASS, with the same file/test counts as before plus the new file (compare against the count printed before your change — a narrowed include glob hides tests).

- [ ] **Step 7: Verify by mutation**

Add `import { z } from 'zod';` to the top of `packages/shared/src/staff-profile/types.ts`; the first test must FAIL. Revert.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/staff-profile packages/shared/src/index.ts apps/web/src/lib/profile-types.ts apps/web/src/lib/profile-data.ts apps/web/test/profile-types-client-safe.test.ts
git commit -F <msg>   # refactor(profile): profile types move to @kku/shared, and a paper names its source
```

---

### Task 4: `staff_publications_cache` table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260930100000_staff_publications_cache/migration.sql`

- [ ] **Step 1: Add the model**

In `schema.prisma`, directly after `model UserPublicationsCache { … }`, add:
```prisma
// Publications-list cache keyed by STAFF RECORD (replaces the user-keyed
// UserPublicationsCache above, which has no reader after 2026-09-30 and is
// dropped in a later release). Keyed by staff record so the /profile page, the
// home sparkline and the external staff-profile API share one row per person —
// and so staff who have never signed in can be cached at all.
// The Scholar runner invalidates a row by backdating fetched_at to the epoch
// (PUBLICATIONS_CACHE_INVALIDATED_MS); readers treat that value as a miss.
model StaffPublicationsCache {
  id              String        @id @default(cuid())
  facultyMemberId String        @unique @map("faculty_member_id")
  payloadJson     Json          @map("payload_json")
  paperCount      Int           @map("paper_count")
  fetchedAt       DateTime      @default(now()) @map("fetched_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  facultyMember FacultyMember @relation(fields: [facultyMemberId], references: [id], onDelete: Cascade)

  @@map("staff_publications_cache")
}
```
Add a comment line above the existing `model UserPublicationsCache`:
```prisma
// DEPRECATED 2026-09-30 — no reader; superseded by StaffPublicationsCache.
```
In `model FacultyMember`, beside `scholarFetchRuns`, add:
```prisma
  publicationsCache     StaffPublicationsCache?
```

- [ ] **Step 2: Write the migration**

`packages/db/prisma/migrations/20260930100000_staff_publications_cache/migration.sql`:
```sql
-- HAND-WRITTEN. Additive only: a new cache table keyed by staff record.
-- user_publications_cache is left in place (no reader) and dropped later.

-- CreateTable
CREATE TABLE "staff_publications_cache" (
    "id" TEXT NOT NULL,
    "faculty_member_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "paper_count" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_publications_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_publications_cache_faculty_member_id_key" ON "staff_publications_cache"("faculty_member_id");

-- AddForeignKey
ALTER TABLE "staff_publications_cache" ADD CONSTRAINT "staff_publications_cache_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply, generate, and check for drift on the new table**

```bash
pnpm db:migrate
pnpm --filter @kku/db exec prisma generate
pnpm --filter @kku/db exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > "$SCRATCH/drift.sql"
grep -c staff_publications_cache "$SCRATCH/drift.sql"
```
Expected: migrate reports `20260930100000_staff_publications_cache` applied; the grep prints `0` (the file may contain pre-existing unrelated drift — only the new table matters).

- [ ] **Step 4: Run the migration linter and commit**

Run: `pnpm --filter @kku/db exec vitest run test/migration-linter.test.ts` → PASS.
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260930100000_staff_publications_cache
git commit -F <msg>   # feat(db): publications cache keyed by staff record
```

---

### Task 5: Move the profile builder into `packages/db`

The largest task. Behaviour must not change; Task 1's snapshot is the proof.

**Files:**
- Move (`git mv`): the four helper modules and the cache-callers test (see File map)
- Create: `packages/db/src/staff-profile/profile.ts`, `lookup.ts`, `index.ts`
- Modify: `packages/db/package.json`, `packages/db/src/index.ts`, `packages/db/src/scholar-fetch.ts`, `packages/db/test/scholar-fetch.test.ts`, `apps/web/src/lib/profile-data.ts`
- Test: `packages/db/test/publication-cache-callers.test.ts` (moved), `packages/db/test/staff-lookup.test.ts`

- [ ] **Step 1: Add `pg` to `packages/db`**

In `packages/db/package.json` add `"pg": "^8.13.1"` to `dependencies` and `"@types/pg": "^8.11.10"` to `devDependencies` (the versions `apps/web` already uses). Run `pnpm install`. Expected: lockfile updated, no new packages downloaded.

- [ ] **Step 2: Move the four helpers**

```bash
mkdir -p packages/db/src/staff-profile
git mv apps/web/src/lib/kku-publications.ts      packages/db/src/staff-profile/kku-scholar.ts
git mv apps/web/src/lib/scopus-publications.ts   packages/db/src/staff-profile/scopus.ts
git mv apps/web/src/lib/external-publications.ts packages/db/src/staff-profile/external.ts
git mv apps/web/src/lib/teaching-profile.ts      packages/db/src/staff-profile/teaching.ts
```
Rewrite imports exactly:
- `scopus.ts` and `external.ts`: `from './kku-publications'` → `from './kku-scholar'`.
- `teaching.ts`: `import { prisma } from '@kku/db';` → `import { prisma } from '../index';`; the `from './profile-types'` type import → `from '@kku/shared'` (keep it `import type`).

- [ ] **Step 3: Make the course limit a parameter**

In `packages/db/src/staff-profile/teaching.ts`:

Add above `summariseTeaching`:
```ts
export interface SummariseTeachingOptions {
  /** Maximum courses in `topCourses`, ranked by sections then students.
   *  `null` returns every course in the window (the external API).
   *  Defaults to TOP_COURSES_LIMIT, the page's top-10. */
  courseLimit?: number | null;
}
```
Change the signature to:
```ts
export async function summariseTeaching(
  member: { id: string; kkuEmail: string | null },
  opts: SummariseTeachingOptions = {},
): Promise<TeachingProfile> {
  const courseLimit = opts.courseLimit === undefined ? TOP_COURSES_LIMIT : opts.courseLimit;
```
and replace the top-courses block (the `[...courseMap.values()].sort(…).slice(0, TOP_COURSES_LIMIT).map(…)` chain) with:
```ts
  // Ranked by section count, then students taught as tiebreak.
  const rankedCourses = [...courseMap.values()].sort(
    (a, b) => b.sections - a.sections || b.studentsTaught - a.studentsTaught,
  );
  const topCourses: TeachingTopCourse[] = (
    courseLimit === null ? rankedCourses : rankedCourses.slice(0, courseLimit)
  ).map((c) => ({
    courseCode: c.courseCode,
    courseNameTh: c.courseNameTh,
    courseNameEn: c.courseNameEn,
    sections: c.sections,
    studentsTaught: c.studentsTaught,
    firstYearBE: c.firstYear,
    lastYearBE: c.lastYear,
  }));
```

- [ ] **Step 4: Create `profile.ts` — the builder**

Create `packages/db/src/staff-profile/profile.ts`. It is `apps/web/src/lib/profile-data.ts` re-shaped around a staff-record id. Copy these private members **verbatim** from `profile-data.ts` into it: `RANK_LABEL`, `ds2003ToEducationEntry`, `PublicationMember`, `computePublications` (and its doc comment), `mergeAndEnrichPublications`, `applyScholarAuthorsToLocal`, `scholarPersonIdFromEmployeeCode`, `firstTokenOf`, `lastTokenOf`, `parseEducation`, `emptyResearchSummary` (export it), `summariseResearch`, `computeHIndex`, `ResearchOutputRow`, `dedupePublications`, `TITLE_PREFIXES`, `stripTitlePrefixes` (export it), `CACHE_FRESH_MS`, `inFlightRefreshes`.

Imports at the top:
```ts
// Staff profile builder — the single implementation behind the /profile page,
// the home-page sparkline and the external staff-profile API
// (POST /api/v1/external/staff-profile). Moved from apps/web/src/lib/
// profile-data.ts on 2026-09-30; the page keeps a thin user-keyed wrapper.
import { Prisma } from '@prisma/client';
import { prisma } from '../index';
import { teachingTalentForFacultyMember, type TeachingTalentStamp } from '../teaching-talent';
import { decidePublicationsCacheAction, hasScholarImport } from '../publication-source-precedence';
import { SCHOLAR_RESEARCH_OUTPUT_SOURCE } from '../scholar-fetch';
import type {
  AuthorName,
  CurriculumProgram,
  EducationEntry,
  FacultyRankCode,
  ProfileBasicInfo,
  PublicationEntry,
  PublicationsCacheStatus,
  ResearchBasis,
  ResearchSummary,
  TeachingProfile,
} from '@kku/shared';
import {
  fetchAuthorsByPaper,
  fetchKkuScholarPublicationsByPerson,
  type KkuScholarPublication,
  type PaperLookupKey,
} from './kku-scholar';
import { fetchPublicationsByScopusAuthor, resolveScopusAuthorId } from './scopus';
import { fetchExternalAuthors, fetchExternalAuthorsByMetadata } from './external';
import { summariseTeaching } from './teaching';
```
(Drop any of these names the verbatim-copied code turns out not to use — `pnpm --filter @kku/db typecheck` with `noUnusedLocals` will say.)

Then add the new public surface:
```ts
/** Basic info derivable from the staff record alone. The page adds the
 *  signed-in user's email and avatar; the API adds the staff record's email. */
export type StaffBasicInfo = Omit<ProfileBasicInfo, 'email' | 'avatarUrl'>;

export interface StaffProfileOptions {
  /** Passed to summariseTeaching: 10 for the page (the default), null for
   *  every course (the external API). */
  courseLimit?: number | null;
}

export interface StaffProfile {
  facultyMemberId: string;
  isActive: boolean;
  rank: FacultyRankCode;
  nameTh: string;
  nameEn: string;
  kkuEmail: string | null;
  basic: StaffBasicInfo;
  education: EducationEntry[];
  research: ResearchSummary;
  researchBasis: ResearchBasis;
  curriculum: CurriculumProgram[];
  publications: PublicationEntry[];
  publicationsCache: PublicationsCacheStatus;
  /** ISO time the publication list was computed. */
  publicationsFetchedAt: string;
  teaching: TeachingProfile;
  talent: TeachingTalentStamp | null;
}

const DEFAULT_COURSE_LIMIT = 10;

/**
 * Build one staff member's full profile. Returns null when the id matches no
 * staff record. Does NOT filter on isActive — callers decide whether an
 * inactive record is visible (the page resolves active records only; the API
 * follows the client's includeInactive grant).
 */
export async function buildStaffProfile(
  facultyMemberId: string,
  opts: StaffProfileOptions = {},
): Promise<StaffProfile | null> {
  const member = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    include: {
      faculty: { select: { nameTh: true, nameEn: true } },
      department: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!member) return null;

  // ── paste verbatim from getProfileData: the Promise.all over
  //    programFaculty / researchOutput / staffEducationHistory, the
  //    `curriculum` mapping and the `education` DS2003-or-fallback line. ──

  const dedupedLocal = dedupePublications(papers);
  const scholarIsPrimary = hasScholarImport(papers);
  const pubs = await loadPublicationsWithCache(member.id, () =>
    computePublications(member, dedupedLocal, scholarIsPrimary),
  );

  const [teaching, talent] = await Promise.all([
    summariseTeaching(
      { id: member.id, kkuEmail: member.kkuEmail },
      { courseLimit: opts.courseLimit === undefined ? DEFAULT_COURSE_LIMIT : opts.courseLimit },
    ),
    teachingTalentForFacultyMember(member.id),
  ]);

  return {
    facultyMemberId: member.id,
    isActive: member.isActive,
    rank: member.rank,
    nameTh: member.nameTh,
    nameEn: member.nameEn,
    kkuEmail: member.kkuEmail,
    basic: buildMemberBasicInfo(member, education),
    education,
    research: summariseResearch(pubs.papers),
    // The constant, not a literal: the source-precedence rule owns the name.
    researchBasis: (scholarIsPrimary ? SCHOLAR_RESEARCH_OUTPUT_SOURCE : 'library') as ResearchBasis,
    curriculum,
    publications: pubs.papers,
    publicationsCache: pubs.status,
    publicationsFetchedAt: pubs.fetchedAt,
    teaching,
    talent,
  };
}

/**
 * The page's user → staff-record bridge: HR employeeId first, then the Thai
 * name with honorifics stripped (for users who predate employeeId capture).
 * Active records only — the page has never shown an inactive one.
 */
export async function resolveFacultyMemberForUser(user: {
  employeeId: string | null;
  name: string | null;
}): Promise<string | null> {
  if (user.employeeId) {
    const byEmployee = await prisma.facultyMember.findFirst({
      where: { employeeId: user.employeeId, isActive: true },
      select: { id: true },
    });
    if (byEmployee) return byEmployee.id;
  }
  if (user.name) {
    const stripped = stripTitlePrefixes(user.name);
    if (stripped) {
      const byName = await prisma.facultyMember.findFirst({
        where: { nameTh: stripped, isActive: true },
        select: { id: true },
      });
      if (byName) return byName.id;
    }
  }
  return null;
}
```

Replace `buildBasicInfo` with a member-only version (the user-only fallback moves to the web wrapper in Step 7):
```ts
function buildMemberBasicInfo(
  member: {
    rank: FacultyRankCode;
    nameTh: string;
    nameEn: string;
    academicQualification: string | null;
    orcid: string | null;
    scopusAuthorId: string | null;
    openalexAuthorId: string | null;
    scholarProfileId: string | null;
    faculty: { nameTh: string; nameEn: string } | null;
    department: { nameTh: string; nameEn: string } | null;
  },
  education: EducationEntry[],
): StaffBasicInfo {
  // ── paste verbatim: the `hasDoctorate` computation from buildBasicInfo ──
  const rank = RANK_LABEL[member.rank];
  const dr = hasDoctorate ? ' ดร.' : '';
  const drEn = hasDoctorate ? ' Dr.' : '';
  return {
    fullNameTh: `${rank.thAbbrev}${dr} ${member.nameTh}`.replace(/\s+/g, ' ').trim(),
    fullNameEn: `${rank.enAbbrev}${drEn} ${member.nameEn}`.replace(/\s+/g, ' ').trim(),
    rankLabelTh: rank.th,
    rankLabelEn: rank.en,
    facultyNameTh: member.faculty?.nameTh ?? null,
    facultyNameEn: member.faculty?.nameEn ?? null,
    departmentNameTh: member.department?.nameTh ?? null,
    departmentNameEn: member.department?.nameEn ?? null,
    orcid: member.orcid,
    scopusAuthorId: member.scopusAuthorId,
    openalexAuthorId: member.openalexAuthorId,
    scholarProfileId: member.scholarProfileId,
  };
}
```

Replace `loadPublicationsWithCache` / `writeCache` with staff-keyed versions that also report how the list was served (keep the original doc comment, updated to say "staff record"):
```ts
interface CachedPublications {
  papers: PublicationEntry[];
  status: PublicationsCacheStatus;
  fetchedAt: string;
}

async function loadPublicationsWithCache(
  facultyMemberId: string,
  compute: () => Promise<PublicationEntry[]>,
): Promise<CachedPublications> {
  const cached = await prisma.staffPublicationsCache.findUnique({
    where: { facultyMemberId },
  });

  const action = decidePublicationsCacheAction({
    cachedFetchedAtMs: cached?.fetchedAt.getTime() ?? null,
    nowMs: Date.now(),
    freshForMs: CACHE_FRESH_MS,
  });

  if (cached && action !== 'compute') {
    if (action === 'serve-and-revalidate' && !inFlightRefreshes.has(facultyMemberId)) {
      inFlightRefreshes.add(facultyMemberId);
      // Fire-and-forget — does NOT block the current request.
      void (async () => {
        try {
          await writeCache(facultyMemberId, await compute());
        } catch (err) {
          console.warn(
            `[staff-profile] background publications refresh failed for member=${facultyMemberId}:`,
            (err as Error).message,
          );
        } finally {
          inFlightRefreshes.delete(facultyMemberId);
        }
      })();
    }
    return {
      papers: cached.payloadJson as unknown as PublicationEntry[],
      status: action === 'serve' ? 'hit' : 'stale',
      fetchedAt: cached.fetchedAt.toISOString(),
    };
  }

  const fresh = await compute();
  const fetchedAt = await writeCache(facultyMemberId, fresh);
  return { papers: fresh, status: 'miss', fetchedAt };
}

async function writeCache(facultyMemberId: string, papers: PublicationEntry[]): Promise<string> {
  const row = await prisma.staffPublicationsCache.upsert({
    where: { facultyMemberId },
    update: {
      payloadJson: papers as unknown as Prisma.InputJsonValue,
      paperCount: papers.length,
      fetchedAt: new Date(),
    },
    create: {
      facultyMemberId,
      payloadJson: papers as unknown as Prisma.InputJsonValue,
      paperCount: papers.length,
    },
    select: { fetchedAt: true },
  });
  return row.fetchedAt.toISOString();
}
```

Replace `getHomePublicationsSnapshot` with a staff-keyed version. It no longer re-reads the cache row: the loader now reports `status` and `fetchedAt`, so the second freshness decision goes away.
```ts
export interface StaffPublicationsSnapshot {
  byYear: Array<{ year: number; count: number }>;
  totalPapers: number;
  fetchedAt: string;
  /** True when served from a cache row past CACHE_FRESH_MS (a background
   *  refresh is running) — the home page shows a subtle "refreshing…" hint. */
  isStale: boolean;
}

export async function getStaffPublicationsSnapshot(
  facultyMemberId: string,
): Promise<StaffPublicationsSnapshot | null> {
  const member = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    select: { id: true, nameEn: true, nameTh: true, employeeCode: true, scopusAuthorId: true },
  });
  if (!member) return null;

  const localPapers = await prisma.researchOutput.findMany({
    where: { facultyMemberId: member.id },
    orderBy: { year: 'desc' },
  });
  const dedupedLocal = dedupePublications(localPapers);

  // Same compute, through the same function, writing the same row as
  // buildStaffProfile — two implementations would take turns overwriting it.
  const pubs = await loadPublicationsWithCache(member.id, () =>
    computePublications(member, dedupedLocal, hasScholarImport(localPapers)),
  );

  const byYearMap = new Map<number, number>();
  for (const p of pubs.papers) {
    if (typeof p.year === 'number') byYearMap.set(p.year, (byYearMap.get(p.year) ?? 0) + 1);
  }
  return {
    byYear: [...byYearMap.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    totalPapers: pubs.papers.length,
    fetchedAt: pubs.fetchedAt,
    isStale: pubs.status === 'stale',
  };
}
```

`computePublications` takes `member: PublicationMember`; the full `member` from `findUnique` satisfies it structurally, so the verbatim body needs no change.

- [ ] **Step 5: Write the failing lookup test, then `lookup.ts`**

`packages/db/test/staff-lookup.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fmFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
}));
vi.mock('../src/index', () => ({
  prisma: {
    facultyMember: { findFirst: mocks.fmFindFirst },
    user: { findFirst: mocks.userFindFirst },
  },
}));

import { hashCitizenId } from '@kku/shared';
import { resolveStaffForLookup } from '../src/staff-profile/lookup';

beforeEach(() => {
  mocks.fmFindFirst.mockReset();
  mocks.userFindFirst.mockReset();
});

describe('resolveStaffForLookup', () => {
  it('matches a citizen id on its hash, active records only by default', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce({ id: 'fm1' });
    await expect(resolveStaffForLookup({ citizenId: '1101700203883' }, { includeInactive: false })).resolves.toBe('fm1');
    expect(mocks.fmFindFirst).toHaveBeenCalledWith({
      where: { citizenIdHash: hashCitizenId('1101700203883'), isActive: true },
      select: { id: true },
    });
  });

  it('drops the active filter when the client may see inactive staff', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce({ id: 'fm1' });
    await resolveStaffForLookup({ citizenId: '1101700203883' }, { includeInactive: true });
    expect(mocks.fmFindFirst.mock.calls[0]![0].where).toEqual({ citizenIdHash: hashCitizenId('1101700203883') });
  });

  it('matches an email on kkuEmail, lowercased', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce({ id: 'fm2' });
    await expect(resolveStaffForLookup({ email: ' Someone@KKU.ac.th ' }, { includeInactive: false })).resolves.toBe('fm2');
    expect(mocks.fmFindFirst.mock.calls[0]![0].where).toEqual({ kkuEmail: 'someone@kku.ac.th', isActive: true });
  });

  it('falls back to the signed-in user bridge when kkuEmail misses', async () => {
    mocks.fmFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'fm3' });
    mocks.userFindFirst.mockResolvedValueOnce({ employeeId: 'E42' });
    await expect(resolveStaffForLookup({ email: 'a@kku.ac.th' }, { includeInactive: false })).resolves.toBe('fm3');
    expect(mocks.fmFindFirst.mock.calls[1]![0].where).toEqual({ employeeId: 'E42', isActive: true });
  });

  it('returns null when nothing matches', async () => {
    mocks.fmFindFirst.mockResolvedValue(null);
    mocks.userFindFirst.mockResolvedValue(null);
    await expect(resolveStaffForLookup({ email: 'x@kku.ac.th' }, { includeInactive: false })).resolves.toBeNull();
  });
});
```

Run: `pnpm --filter @kku/db exec vitest run test/staff-lookup.test.ts` → FAIL (module missing).

`packages/db/src/staff-profile/lookup.ts`:
```ts
// Resolve an external caller's identifier to a staff record.
//   citizen id → SHA-256 join key (hashCitizenId) → FacultyMember.citizenIdHash
//   email      → FacultyMember.kkuEmail, then User.email → employeeId (the
//                bridge the /profile page itself uses)
import { hashCitizenId } from '@kku/shared';
import { prisma } from '../index';

export type StaffLookup = { citizenId: string } | { email: string };

export async function resolveStaffForLookup(
  lookup: StaffLookup,
  opts: { includeInactive: boolean },
): Promise<string | null> {
  const active = opts.includeInactive ? {} : { isActive: true };

  if ('citizenId' in lookup) {
    const citizenIdHash = hashCitizenId(lookup.citizenId);
    if (!citizenIdHash) return null;
    const m = await prisma.facultyMember.findFirst({
      where: { citizenIdHash, ...active },
      select: { id: true },
    });
    return m?.id ?? null;
  }

  const email = lookup.email.trim().toLowerCase();
  const direct = await prisma.facultyMember.findFirst({
    where: { kkuEmail: email, ...active },
    select: { id: true },
  });
  if (direct) return direct.id;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { employeeId: true },
  });
  if (!user?.employeeId) return null;
  const viaUser = await prisma.facultyMember.findFirst({
    where: { employeeId: user.employeeId, ...active },
    select: { id: true },
  });
  return viaUser?.id ?? null;
}
```

Run the test again → PASS (5 tests).

- [ ] **Step 6: Export from the barrel**

`packages/db/src/staff-profile/index.ts`:
```ts
// Public surface only — the fetchers and helpers behind it stay internal.
export {
  buildStaffProfile,
  emptyResearchSummary,
  getStaffPublicationsSnapshot,
  resolveFacultyMemberForUser,
  stripTitlePrefixes,
  type StaffBasicInfo,
  type StaffProfile,
  type StaffProfileOptions,
  type StaffPublicationsSnapshot,
} from './profile';
export { resolveStaffForLookup, type StaffLookup } from './lookup';
```
Before adding it to the barrel, confirm no name collides:
```bash
grep -rn -E "export (async )?(function|const|type|interface) (buildStaffProfile|emptyResearchSummary|getStaffPublicationsSnapshot|resolveFacultyMemberForUser|stripTitlePrefixes|StaffBasicInfo|StaffProfile|StaffProfileOptions|StaffPublicationsSnapshot|resolveStaffForLookup|StaffLookup)\b" packages/db/src --include=*.ts | grep -v staff-profile/
```
Expected: no output. Then append to `packages/db/src/index.ts`:
```ts
export * from './staff-profile';
```

- [ ] **Step 7: Reduce the web module to thin wrappers**

Replace the whole of `apps/web/src/lib/profile-data.ts` with:
```ts
// /profile page data — a thin user-keyed wrapper over buildStaffProfile in
// @kku/db (packages/db/src/staff-profile/profile.ts), which the external
// staff-profile API also calls. What stays here is what belongs to the
// SIGNED-IN USER rather than to the staff record: the account email, the
// uploaded avatar, the cached AI narrative, and the fallback for accounts that
// resolve to no staff record.
import {
  buildStaffProfile,
  emptyResearchSummary,
  getStaffPublicationsSnapshot,
  prisma,
  resolveFacultyMemberForUser,
  type StaffPublicationsSnapshot,
} from '@kku/db';
import { EXPERTISE_NARRATIVE_VERSION } from '@kku/shared';
import type { ProfileBasicInfo, ProfileData } from './profile-types';

export type {
  CurriculumProgram,
  EducationEntry,
  FacultyRankCode,
  ProfileBasicInfo,
  ProfileData,
  PublicationEntry,
  ResearchSummary,
} from './profile-types';
export { formatApa } from './profile-types';

/** The page shows the top ten courses; the external API shows all of them. */
const PAGE_COURSE_LIMIT = 10;

export async function getProfileData(userId: string): Promise<ProfileData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      employeeId: true,
      avatarStorageKey: true,
      avatarUpdatedAt: true,
      faculty: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!user) return null;

  // ── paste verbatim from the old getProfileData: the avatarUrl build, and
  //    the cachedNarrativeRow query + cachedNarrative mapping (with its long
  //    comment about filtering to the current method version). ──

  const memberId = await resolveFacultyMemberForUser(user);
  const staff = memberId
    ? await buildStaffProfile(memberId, { courseLimit: PAGE_COURSE_LIMIT })
    : null;

  if (!staff) {
    return {
      hasFacultyMemberRecord: false,
      basic: userOnlyBasicInfo(user, avatarUrl),
      education: [],
      research: emptyResearchSummary(),
      curriculum: [],
      publications: [],
      teaching: null,
      talent: null,
      cachedNarrative,
    };
  }

  return {
    hasFacultyMemberRecord: true,
    basic: { ...staff.basic, email: user.email, avatarUrl },
    education: staff.education,
    research: staff.research,
    curriculum: staff.curriculum,
    publications: staff.publications,
    teaching: staff.teaching,
    talent: staff.talent,
    cachedNarrative,
  };
}

/** An account that resolves to no staff record — render what the User row has. */
function userOnlyBasicInfo(
  user: { email: string; name: string | null; faculty: { nameTh: string; nameEn: string } | null },
  avatarUrl: string | null,
): ProfileBasicInfo {
  // ── paste verbatim: the "No FacultyMember match" return block from the old
  //    buildBasicInfo, with its scholarProfileId comment. ──
}

export type HomePublicationsSnapshot = StaffPublicationsSnapshot;

/** Home-page sparkline — null for accounts that are not academic staff. */
export async function getHomePublicationsSnapshot(
  userId: string,
): Promise<HomePublicationsSnapshot | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employeeId: true, name: true },
  });
  if (!user) return null;
  const memberId = await resolveFacultyMemberForUser(user);
  return memberId ? getStaffPublicationsSnapshot(memberId) : null;
}
```

- [ ] **Step 8: Move the Scholar invalidation to the new table**

In `packages/db/src/scholar-fetch.ts`:
- Rename `expireUserPublicationsCache(userId: string)` to `expireStaffPublicationsCache(facultyMemberId: string)`; its body becomes
```ts
  try {
    await prisma.staffPublicationsCache.updateMany({
      where: { facultyMemberId },
      data: { fetchedAt: new Date(PUBLICATIONS_CACHE_INVALIDATED_MS) },
    });
  } catch (err) {
    console.warn(
      `[scholar-fetch] could not expire publications cache for member=${facultyMemberId}:`,
      describeError(err),
    );
  }
```
- The call site (`// ── 7. Expire the publications cache`) becomes `await expireStaffPublicationsCache(member.id);`.
- In the doc comments on `PUBLICATIONS_CACHE_INVALIDATED_MS` and the function, replace "`user_publications_cache`" with "`staff_publications_cache`" and "`loadPublicationsWithCache` in apps/web/src/lib/profile-data.ts" with "`loadPublicationsWithCache` in packages/db/src/staff-profile/profile.ts", and "user's" with "staff member's".

In `packages/db/test/scholar-fetch.test.ts`, replace every `userPublicationsCache` with `staffPublicationsCache`, and in any assertion on the `updateMany` call change `where: { userId: … }` to `where: { facultyMemberId: <the fixture member's id> }`.

- [ ] **Step 9: Move and update the cache-callers source test**

```bash
git mv apps/web/test/publication-cache-callers.test.ts packages/db/test/publication-cache-callers.test.ts
```
Edits:
- `SOURCE` path: `path.join(__dirname, '..', 'src', 'staff-profile', 'profile.ts')`.
- In the header comment, `getProfileData` → `buildStaffProfile`, `getHomePublicationsSnapshot` → `getStaffPublicationsSnapshot`, "the user id" → "the staff-record id", `user_publications_cache` → `staff_publications_cache`.
- `expect(SOURCE).toContain("from '@kku/db'")` → `expect(SOURCE).toContain("from '../publication-source-precedence'")`.
- The last test: `expect(countInCode('decidePublicationsCacheAction(')).toBe(2)` → `.toBe(1)`, and replace its comment with: "The loader is the only freshness decision. The home snapshot used to make a second one to report `isStale`; it now reads the status the loader returns, so the two cannot disagree about an invalidated row."
- The first three counts stay `3`, `3`, `2`.

- [ ] **Step 10: Typecheck, test, bundle**

```bash
pnpm --filter @kku/db typecheck && pnpm --filter web typecheck && pnpm --filter api typecheck
pnpm --filter @kku/db test && pnpm --filter web test && pnpm --filter @kku/shared test
pnpm --filter ingestion build
```
Expected: all clean. Test counts: `web` loses exactly one file (the moved test), `@kku/db` gains two. `ingestion build` proves the esbuild bundling of pipeline scripts still resolves now that the `@kku/db` barrel pulls `pg`.

- [ ] **Step 11: Characterisation — compare with Task 1**

Restart the dev servers (Prisma client changed). Then:
```bash
pnpm exec tsx apps/web/scripts/profile-snapshot.ts "$SCRATCH/profile-after.json"
diff "$SCRATCH/profile-before.json" "$SCRATCH/profile-after.json"
```
Expected: no diff, except differences also present between `profile-before.json` and `profile-before-2.json` (live-source churn noted in Task 1). **Any other difference is a regression — stop and report it.** Then open `/profile` in the browser as a dev user and confirm it renders.

- [ ] **Step 12: Commit**

```bash
git add -A packages/db apps/web/src/lib apps/web/test packages/db/test pnpm-lock.yaml
git status --short   # confirm handoff.md / presentation_*.md are NOT staged
git commit -F <msg>   # refactor(profile): the profile builder moves to @kku/db, keyed by staff record
```

---

### Task 6: `staff-profile.v1` request and response schemas

**Files:**
- Create: `packages/shared/src/staff-profile/api-schema.ts`
- Modify: `packages/shared/src/staff-profile/index.ts`
- Test: `packages/shared/test/staff-profile-api-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { StaffProfileLookupSchema } from '../src/staff-profile/api-schema';

describe('StaffProfileLookupSchema', () => {
  it('accepts a valid citizen id and normalises it', () => {
    const r = StaffProfileLookupSchema.safeParse({ citizenId: '1-1017-00203-88-3' });
    expect(r.success && r.data).toEqual({ citizenId: '1101700203883' });
  });
  it('rejects a citizen id failing the checksum', () => {
    expect(StaffProfileLookupSchema.safeParse({ citizenId: '1101700203884' }).success).toBe(false);
  });
  it('accepts an email and lowercases it', () => {
    const r = StaffProfileLookupSchema.safeParse({ email: ' Someone@KKU.ac.th ' });
    expect(r.success && r.data).toEqual({ email: 'someone@kku.ac.th' });
  });
  it('rejects both identifiers, neither, and unknown keys', () => {
    expect(StaffProfileLookupSchema.safeParse({ citizenId: '1101700203883', email: 'a@kku.ac.th' }).success).toBe(false);
    expect(StaffProfileLookupSchema.safeParse({}).success).toBe(false);
    expect(StaffProfileLookupSchema.safeParse({ email: 'a@kku.ac.th', extra: 1 }).success).toBe(false);
  });
});
```
Run: `pnpm --filter @kku/shared exec vitest run test/staff-profile-api-schema.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`packages/shared/src/staff-profile/api-schema.ts`:
```ts
// Wire contract for POST /api/v1/external/staff-profile (staff-profile.v1).
// Additive changes keep v1; renaming or removing a field is v2.
import { z } from 'zod';
import { isValidThaiCitizenId, normaliseThaiCitizenId } from '../identity/thai-citizen-id';

export const STAFF_PROFILE_API_VERSION = 'staff-profile.v1';

/** Sections an admin can grant. `person` is always returned. */
export const STAFF_PROFILE_SECTIONS = [
  'affiliation',
  'education',
  'teaching',
  'research',
  'publications',
] as const;
export type StaffProfileSection = (typeof STAFF_PROFILE_SECTIONS)[number];

export const StaffProfileLookupSchema = z.union([
  z
    .object({
      citizenId: z
        .string()
        .refine(isValidThaiCitizenId, 'citizenId must be 13 digits with a valid check digit')
        .transform(normaliseThaiCitizenId),
    })
    .strict(),
  z.object({ email: z.string().trim().toLowerCase().email() }).strict(),
]);
export type StaffProfileLookup = z.infer<typeof StaffProfileLookupSchema>;

const Bilingual = z.object({ th: z.string().nullable(), en: z.string().nullable() });

export const StaffProfileResponseDataSchema = z.object({
  person: z.object({
    facultyMemberId: z.string(),
    isActive: z.boolean(),
    title: z.object({ th: z.string(), en: z.string(), abbrevTh: z.string(), abbrevEn: z.string() }),
    name: z.object({ th: z.string(), en: z.string() }),
    displayName: z.object({ th: z.string(), en: z.string() }),
    email: z.string().nullable(),
    identifiers: z.object({
      orcid: z.string().nullable(),
      scopusAuthorId: z.string().nullable(),
      openalexAuthorId: z.string().nullable(),
      scholarProfileId: z.string().nullable(),
    }),
  }),
  affiliation: z
    .object({
      faculty: Bilingual,
      department: Bilingual,
      programmes: z.array(
        z.object({
          code: z.string(),
          nameTh: z.string(),
          nameEn: z.string(),
          level: z.string(),
          role: z.enum(['COORDINATOR', 'CORE', 'SUPPORT']),
        }),
      ),
    })
    .optional(),
  education: z
    .array(
      z.object({
        qualification: z.string(),
        level: z.string().nullable(),
        major: z.string().nullable(),
        institute: z.string().nullable(),
        countryCode: z.string().nullable(),
        yearBE: z.number().nullable(),
        source: z.enum(['unicon-ds2003', 'fallback']),
      }),
    )
    .optional(),
  teaching: z
    .object({
      available: z.boolean(),
      windowYearsBE: z.object({ from: z.number(), to: z.number() }),
      totals: z.object({
        studentsTaught: z.number(),
        sections: z.number(),
        distinctCourses: z.number(),
        activeSemesters: z.number(),
        avgContactHrsPerWeek: z.number(),
      }),
      byYear: z.array(
        z.object({
          yearBE: z.number(),
          sections: z.number(),
          studentsTaught: z.number(),
          contactHrsPerWeek: z.number(),
        }),
      ),
      courses: z.array(
        z.object({
          code: z.string(),
          nameTh: z.string().nullable(),
          nameEn: z.string().nullable(),
          sections: z.number(),
          studentsTaught: z.number(),
          firstYearBE: z.number(),
          lastYearBE: z.number(),
        }),
      ),
    })
    .optional(),
  research: z
    .object({
      basis: z.enum(['google-scholar', 'library']),
      totalPapers: z.number(),
      totalCitations: z.number(),
      hIndex: z.number(),
      earliestYear: z.number().nullable(),
      latestYear: z.number().nullable(),
      yearsActive: z.number().nullable(),
      peakYear: z.number().nullable(),
      peakYearCount: z.number(),
      topVenues: z.array(z.object({ venue: z.string(), count: z.number() })),
    })
    .optional(),
  publications: z
    .array(
      z.object({
        year: z.number(),
        title: z.string(),
        venue: z.string().nullable(),
        type: z.string(),
        citations: z.number(),
        source: z.string().nullable(),
        doi: z.string().nullable(),
        scopusId: z.string().nullable(),
        pmid: z.string().nullable(),
        scholarPaperId: z.string().nullable(),
        authors: z.array(
          z.object({ family: z.string(), given: z.string().nullable(), initials: z.string().nullable() }),
        ),
        authorsComplete: z.boolean(),
        apa: z.string(),
      }),
    )
    .optional(),
});
export type StaffProfileResponseData = z.infer<typeof StaffProfileResponseDataSchema>;
```
Note `person.displayName` carries the page's composed "รศ. ดร. …" name; `name` is the bare name. Both are cheap and callers asked for "name and title".

Append to `packages/shared/src/staff-profile/index.ts`:
```ts
export * from './api-schema';
```
(The `types.ts` client-safety test is unaffected: `api-schema.ts` is a separate file, not imported by `types.ts`.)

- [ ] **Step 3: Run tests, typecheck, commit**

Run: `pnpm --filter @kku/shared exec vitest run test/staff-profile-api-schema.test.ts` → PASS (4). `pnpm --filter @kku/shared typecheck` → clean.
```bash
git add packages/shared/src/staff-profile packages/shared/test/staff-profile-api-schema.test.ts
git commit -F <msg>   # feat(shared): staff-profile.v1 wire schemas
```

---

### Task 7: API client tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260930110000_api_clients/migration.sql`

- [ ] **Step 1: Add enums and models** (append near the end of `schema.prisma`, beside the other enums/models)

```prisma
// ─── External API clients (staff-profile.v1) ───────────────────────────────
// Other KKU systems call POST /api/v1/external/staff-profile with a per-client
// API key. Keys are stored as SHA-256 only; the plaintext is shown once.
// Creator ids are plain columns, not relations: @AuditLog records who did what.

enum ApiClientStatus {
  ACTIVE
  DISABLED
}

enum ApiLookupType {
  CITIZEN_ID
  EMAIL
}

model ApiClient {
  id                   String          @id @default(cuid())
  name                 String          @unique
  description          String?
  ownerContact         String?         @map("owner_contact")
  status               ApiClientStatus @default(ACTIVE)
  /// Subset of STAFF_PROFILE_SECTIONS; `person` is implicit.
  allowedSections      String[]        @default([]) @map("allowed_sections")
  allowCitizenIdLookup Boolean         @default(false) @map("allow_citizen_id_lookup")
  allowEmailLookup     Boolean         @default(false) @map("allow_email_lookup")
  includeInactive      Boolean         @default(false) @map("include_inactive")
  /// CIDRs or bare addresses; empty = any address.
  ipAllowlist          String[]        @default([]) @map("ip_allowlist")
  rateLimitPerMinute   Int             @default(60) @map("rate_limit_per_minute")
  createdById          String?         @map("created_by_id")
  lastUsedAt           DateTime?       @map("last_used_at")
  createdAt            DateTime        @default(now()) @map("created_at")
  updatedAt            DateTime        @updatedAt @map("updated_at")

  keys     ApiClientKey[]
  requests ApiRequestLog[]

  @@map("api_clients")
}

model ApiClientKey {
  id            String    @id @default(cuid())
  clientId      String    @map("client_id")
  /// First 16 chars of the key — shown in the UI and used to find the row.
  prefix        String    @unique
  /// SHA-256 hex of the full key. The key is 32 random bytes, so unsalted is sound.
  keyHash       String    @map("key_hash")
  expiresAt     DateTime? @map("expires_at")
  revokedAt     DateTime? @map("revoked_at")
  revokedReason String?   @map("revoked_reason")
  lastUsedAt    DateTime? @map("last_used_at")
  createdById   String?   @map("created_by_id")
  createdAt     DateTime  @default(now()) @map("created_at")

  client ApiClient @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@index([clientId])
  @@map("api_client_keys")
}

/// One row per authenticated call. NEVER stores the citizen id, its hash
/// (unsalted over a ~2^43 keyspace — storing it is storing the id) or the
/// email. Deleted after 365 days by the retention sweep.
model ApiRequestLog {
  id               String         @id @default(cuid())
  clientId         String         @map("client_id")
  keyId            String?        @map("key_id")
  /// Null when the call failed before its lookup type was known.
  lookupType       ApiLookupType? @map("lookup_type")
  facultyMemberId  String?        @map("faculty_member_id")
  status           Int
  sectionsReturned String[]       @default([]) @map("sections_returned")
  latencyMs        Int            @map("latency_ms")
  ip               String?
  requestId        String?        @map("request_id")
  createdAt        DateTime       @default(now()) @map("created_at")

  client ApiClient @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@index([clientId, createdAt])
  @@index([createdAt])
  @@map("api_request_logs")
}
```

- [ ] **Step 2: Write the migration**

`packages/db/prisma/migrations/20260930110000_api_clients/migration.sql`:
```sql
-- HAND-WRITTEN. Additive only: external API clients, their keys, and a call log.

-- CreateEnum
CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApiLookupType" AS ENUM ('CITIZEN_ID', 'EMAIL');

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_contact" TEXT,
    "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowed_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_citizen_id_lookup" BOOLEAN NOT NULL DEFAULT false,
    "allow_email_lookup" BOOLEAN NOT NULL DEFAULT false,
    "include_inactive" BOOLEAN NOT NULL DEFAULT false,
    "ip_allowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
    "created_by_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_client_keys" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_client_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "key_id" TEXT,
    "lookup_type" "ApiLookupType",
    "faculty_member_id" TEXT,
    "status" INTEGER NOT NULL,
    "sections_returned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latency_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_name_key" ON "api_clients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "api_client_keys_prefix_key" ON "api_client_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_client_keys_client_id_idx" ON "api_client_keys"("client_id");

-- CreateIndex
CREATE INDEX "api_request_logs_client_id_created_at_idx" ON "api_request_logs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "api_request_logs_created_at_idx" ON "api_request_logs"("created_at");

-- AddForeignKey
ALTER TABLE "api_client_keys" ADD CONSTRAINT "api_client_keys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "api_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply, generate, drift-check, lint, commit**

```bash
pnpm db:migrate
pnpm --filter @kku/db exec prisma generate
pnpm --filter @kku/db exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > "$SCRATCH/drift.sql"
grep -c -E 'api_clients|api_client_keys|api_request_logs|ApiClientStatus|ApiLookupType' "$SCRATCH/drift.sql"
pnpm --filter @kku/db exec vitest run test/migration-linter.test.ts
```
Expected: migration applied; grep prints `0`; linter PASS. (If the drift file shows the `TEXT[] DEFAULT` columns needing `NOT NULL`, match Prisma's form exactly — `String[] @default([])` generates a nullable-with-default array; copy whatever Prisma emits for those columns into the migration and re-apply on a fresh check.)
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260930110000_api_clients
git commit -F <msg>   # feat(db): external API clients, keys and call log
```

---

### Task 8: API client domain module

**Files:**
- Create: `packages/db/src/api-clients.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/api-clients.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  API_KEY_LOOKUP_PREFIX_LENGTH,
  API_KEY_PREFIX,
  ApiClientInputSchema,
  apiKeyHashMatches,
  generateApiKey,
  hashApiKey,
  isKeyRowUsable,
} from '../src/api-clients';

const now = new Date('2026-09-30T08:00:00Z');
const liveRow = (key: string, over: Partial<Parameters<typeof isKeyRowUsable>[0]> = {}) => ({
  keyHash: hashApiKey(key),
  revokedAt: null,
  expiresAt: null,
  client: { status: 'ACTIVE' as const },
  ...over,
});

describe('generateApiKey', () => {
  it('produces kpl_live_ + 43 base64url chars, a 16-char prefix and its hash', () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^kpl_live_[A-Za-z0-9_-]{43}$/);
    expect(k.prefix).toBe(k.key.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH));
    expect(k.prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.keyHash).toBe(hashApiKey(k.key));
    expect(generateApiKey().key).not.toBe(k.key);
  });
});

describe('apiKeyHashMatches', () => {
  it('matches only the exact key', () => {
    const { key, keyHash } = generateApiKey();
    expect(apiKeyHashMatches(key, keyHash)).toBe(true);
    expect(apiKeyHashMatches(key + 'x', keyHash)).toBe(false);
    expect(apiKeyHashMatches(key, 'not-hex')).toBe(false);
  });
});

describe('isKeyRowUsable', () => {
  const { key } = generateApiKey();
  it('accepts a live key on an active client', () => {
    expect(isKeyRowUsable(liveRow(key), key, now)).toBe(true);
  });
  it('refuses a wrong key, a revoked key, an expired key and a disabled client', () => {
    expect(isKeyRowUsable(liveRow(key), generateApiKey().key, now)).toBe(false);
    expect(isKeyRowUsable(liveRow(key, { revokedAt: now }), key, now)).toBe(false);
    expect(isKeyRowUsable(liveRow(key, { expiresAt: now }), key, now)).toBe(false);
    expect(isKeyRowUsable(liveRow(key, { client: { status: 'DISABLED' } }), key, now)).toBe(false);
  });
  it('accepts a key whose expiry is still ahead', () => {
    expect(isKeyRowUsable(liveRow(key, { expiresAt: new Date(now.getTime() + 1000) }), key, now)).toBe(true);
  });
});

describe('ApiClientInputSchema', () => {
  const valid = {
    name: 'HR portal',
    allowedSections: ['affiliation', 'education'],
    allowCitizenIdLookup: true,
    allowEmailLookup: false,
    includeInactive: false,
    ipAllowlist: ['10.101.0.0/16'],
    rateLimitPerMinute: 60,
  };
  it('accepts a valid client', () => {
    expect(ApiClientInputSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects an unknown section, a bad CIDR, an out-of-range limit and unknown keys', () => {
    expect(ApiClientInputSchema.safeParse({ ...valid, allowedSections: ['salary'] }).success).toBe(false);
    expect(ApiClientInputSchema.safeParse({ ...valid, ipAllowlist: ['10.0.0.0/33'] }).success).toBe(false);
    expect(ApiClientInputSchema.safeParse({ ...valid, rateLimitPerMinute: 0 }).success).toBe(false);
    expect(ApiClientInputSchema.safeParse({ ...valid, rateLimitPerMinute: 601 }).success).toBe(false);
    // .strict(): a body can never smuggle a key into the audit payload.
    expect(ApiClientInputSchema.safeParse({ ...valid, key: 'kpl_live_x' }).success).toBe(false);
  });
});
```
Run: `pnpm --filter @kku/db exec vitest run test/api-clients.test.ts` → FAIL.

- [ ] **Step 2: Implement `packages/db/src/api-clients.ts`**

```ts
// External API clients — key crypto, admin CRUD, and the call log.
//
// A key is `kpl_live_` + 32 random bytes (base64url, 43 chars). Only its
// SHA-256 is stored; the plaintext exists in exactly one response — the one
// that created it. Lookup is by the first 16 characters (`prefix`), then a
// constant-time hash comparison.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type ApiClient, type ApiClientStatus, type ApiLookupType } from '@prisma/client';
import { z } from 'zod';
import { isValidAllowlistEntry, STAFF_PROFILE_SECTIONS } from '@kku/shared';
import { prisma } from './index';

export const API_KEY_PREFIX = 'kpl_live_';
export const API_KEY_LOOKUP_PREFIX_LENGTH = 16;

export interface GeneratedApiKey {
  key: string;
  prefix: string;
  keyHash: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  return { key, prefix: key.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH), keyHash: hashApiKey(key) };
}

export function apiKeyHashMatches(presented: string, storedHash: string): boolean {
  const a = Buffer.from(hashApiKey(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every reason a key can fail collapses to `false`: callers must not be able
 *  to tell a revoked key from an unknown one. */
export function isKeyRowUsable(
  row: {
    keyHash: string;
    revokedAt: Date | null;
    expiresAt: Date | null;
    client: { status: ApiClientStatus };
  },
  presented: string,
  now: Date,
): boolean {
  if (!apiKeyHashMatches(presented, row.keyHash)) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  return row.client.status === 'ACTIVE';
}

export interface ResolvedApiKey {
  client: ApiClient;
  keyId: string;
}

export async function resolveApiKey(presented: string, now: Date = new Date()): Promise<ResolvedApiKey | null> {
  if (!presented.startsWith(API_KEY_PREFIX) || presented.length <= API_KEY_LOOKUP_PREFIX_LENGTH) return null;
  const row = await prisma.apiClientKey.findUnique({
    where: { prefix: presented.slice(0, API_KEY_LOOKUP_PREFIX_LENGTH) },
    include: { client: true },
  });
  if (!row || !isKeyRowUsable(row, presented, now)) return null;
  return { client: row.client, keyId: row.id };
}

// lastUsedAt is written at most once a minute per key, so a busy client does
// not turn every call into two extra UPDATEs.
const lastTouchMs = new Map<string, number>();
export async function touchApiKeyUsage(keyId: string, clientId: string, nowMs: number = Date.now()): Promise<void> {
  const prev = lastTouchMs.get(keyId);
  if (prev !== undefined && nowMs - prev < 60_000) return;
  lastTouchMs.set(keyId, nowMs);
  const at = new Date(nowMs);
  await prisma.$transaction([
    prisma.apiClientKey.update({ where: { id: keyId }, data: { lastUsedAt: at } }),
    prisma.apiClient.update({ where: { id: clientId }, data: { lastUsedAt: at } }),
  ]);
}

/** Deliberately has no field for the identifier the caller sent. */
export interface ApiRequestLogEntry {
  clientId: string;
  keyId: string | null;
  lookupType: ApiLookupType | null;
  facultyMemberId: string | null;
  status: number;
  sectionsReturned: string[];
  latencyMs: number;
  ip: string | null;
  requestId: string | null;
}

export async function recordApiRequest(entry: ApiRequestLogEntry): Promise<void> {
  await prisma.apiRequestLog.create({ data: entry });
}

// ─── Admin CRUD ────────────────────────────────────────────────────────────

export const ApiClientInputSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500).nullable().optional(),
    ownerContact: z.string().trim().max(200).nullable().optional(),
    allowedSections: z.array(z.enum(STAFF_PROFILE_SECTIONS)).max(STAFF_PROFILE_SECTIONS.length),
    allowCitizenIdLookup: z.boolean(),
    allowEmailLookup: z.boolean(),
    includeInactive: z.boolean(),
    ipAllowlist: z
      .array(z.string().trim())
      .max(50)
      .refine((xs) => xs.every(isValidAllowlistEntry), 'every entry must be an IP address or CIDR'),
    rateLimitPerMinute: z.number().int().min(1).max(600),
  })
  .strict();
export type ApiClientInput = z.infer<typeof ApiClientInputSchema>;

export const ApiClientPatchSchema = ApiClientInputSchema.partial()
  .extend({ status: z.enum(['ACTIVE', 'DISABLED']).optional() })
  .strict();
export type ApiClientPatch = z.infer<typeof ApiClientPatchSchema>;

export const IssueKeySchema = z
  .object({ expiresAt: z.string().datetime().nullable().optional() })
  .strict();
export const RevokeKeySchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export interface ApiClientKeyView {
  id: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IssuedApiKey {
  id: string;
  prefix: string;
  /** Plaintext — returned once, never stored, never logged. */
  key: string;
  expiresAt: string | null;
}

export interface ApiClientView {
  id: string;
  name: string;
  description: string | null;
  ownerContact: string | null;
  status: ApiClientStatus;
  allowedSections: string[];
  allowCitizenIdLookup: boolean;
  allowEmailLookup: boolean;
  includeInactive: boolean;
  ipAllowlist: string[];
  rateLimitPerMinute: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiClientSummary extends ApiClientView {
  activeKeys: number;
  requests24h: number;
  requests30d: number;
  notFound30d: number;
}

export interface ApiClientDetail extends ApiClientView {
  keys: ApiClientKeyView[];
  statusCounts30d: Array<{ status: number; count: number }>;
  recentRequests: Array<{
    id: string;
    createdAt: string;
    lookupType: ApiLookupType | null;
    staffName: string | null;
    status: number;
    latencyMs: number;
  }>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toView(c: ApiClient): ApiClientView {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    ownerContact: c.ownerContact,
    status: c.status,
    allowedSections: c.allowedSections,
    allowCitizenIdLookup: c.allowCitizenIdLookup,
    allowEmailLookup: c.allowEmailLookup,
    includeInactive: c.includeInactive,
    ipAllowlist: c.ipAllowlist,
    rateLimitPerMinute: c.rateLimitPerMinute,
    lastUsedAt: iso(c.lastUsedAt),
    createdAt: c.createdAt.toISOString(),
  };
}

async function insertKey(
  tx: Prisma.TransactionClient,
  clientId: string,
  actorId: string | null,
  expiresAt: Date | null,
): Promise<IssuedApiKey> {
  // A 42-bit prefix collision is vanishingly rare; retry rather than fail.
  for (let attempt = 0; attempt < 3; attempt++) {
    const g = generateApiKey();
    try {
      const row = await tx.apiClientKey.create({
        data: { clientId, prefix: g.prefix, keyHash: g.keyHash, expiresAt, createdById: actorId },
      });
      return { id: row.id, prefix: row.prefix, key: g.key, expiresAt: iso(row.expiresAt) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
      throw err;
    }
  }
  throw new Error('could not generate a unique API key prefix');
}

export async function createApiClient(
  input: ApiClientInput,
  actorId: string | null,
): Promise<{ id: string; client: ApiClientView; key: IssuedApiKey }> {
  return prisma.$transaction(async (tx) => {
    const client = await tx.apiClient.create({
      data: {
        ...input,
        description: input.description ?? null,
        ownerContact: input.ownerContact ?? null,
        createdById: actorId,
      },
    });
    const key = await insertKey(tx, client.id, actorId, null);
    return { id: client.id, client: toView(client), key };
  });
}

export async function updateApiClient(id: string, patch: ApiClientPatch): Promise<ApiClientView | null> {
  const exists = await prisma.apiClient.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;
  return toView(await prisma.apiClient.update({ where: { id }, data: patch }));
}

export async function issueApiClientKey(
  clientId: string,
  actorId: string | null,
  expiresAt: Date | null,
): Promise<IssuedApiKey | null> {
  const exists = await prisma.apiClient.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!exists) return null;
  return prisma.$transaction((tx) => insertKey(tx, clientId, actorId, expiresAt));
}

export async function revokeApiClientKey(
  clientId: string,
  keyId: string,
  reason: string,
): Promise<ApiClientKeyView | null> {
  const key = await prisma.apiClientKey.findFirst({ where: { id: keyId, clientId } });
  if (!key) return null;
  const row = key.revokedAt
    ? key
    : await prisma.apiClientKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
  return keyView(row);
}

function keyView(k: {
  id: string;
  prefix: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): ApiClientKeyView {
  return {
    id: k.id,
    prefix: k.prefix,
    expiresAt: iso(k.expiresAt),
    revokedAt: iso(k.revokedAt),
    revokedReason: k.revokedReason,
    lastUsedAt: iso(k.lastUsedAt),
    createdAt: k.createdAt.toISOString(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function listApiClients(now: Date = new Date()): Promise<ApiClientSummary[]> {
  const since24h = new Date(now.getTime() - DAY_MS);
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const [clients, keys, r24, r30, nf30] = await Promise.all([
    prisma.apiClient.findMany({ orderBy: { name: 'asc' } }),
    prisma.apiClientKey.groupBy({
      by: ['clientId'],
      where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      _count: { _all: true },
    }),
    prisma.apiRequestLog.groupBy({ by: ['clientId'], where: { createdAt: { gte: since24h } }, _count: { _all: true } }),
    prisma.apiRequestLog.groupBy({ by: ['clientId'], where: { createdAt: { gte: since30d } }, _count: { _all: true } }),
    prisma.apiRequestLog.groupBy({
      by: ['clientId'],
      where: { createdAt: { gte: since30d }, status: 404 },
      _count: { _all: true },
    }),
  ]);
  const count = (rows: Array<{ clientId: string; _count: { _all: number } }>, id: string) =>
    rows.find((r) => r.clientId === id)?._count._all ?? 0;
  return clients.map((c) => ({
    ...toView(c),
    activeKeys: count(keys, c.id),
    requests24h: count(r24, c.id),
    requests30d: count(r30, c.id),
    notFound30d: count(nf30, c.id),
  }));
}

export async function getApiClientDetail(id: string, now: Date = new Date()): Promise<ApiClientDetail | null> {
  const client = await prisma.apiClient.findUnique({
    where: { id },
    include: { keys: { orderBy: { createdAt: 'desc' } } },
  });
  if (!client) return null;
  const since30d = new Date(now.getTime() - 30 * DAY_MS);
  const [byStatus, recent] = await Promise.all([
    prisma.apiRequestLog.groupBy({
      by: ['status'],
      where: { clientId: id, createdAt: { gte: since30d } },
      _count: { _all: true },
      orderBy: { status: 'asc' },
    }),
    prisma.apiRequestLog.findMany({ where: { clientId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const memberIds = [...new Set(recent.map((r) => r.facultyMemberId).filter((x): x is string => !!x))];
  const members = memberIds.length
    ? await prisma.facultyMember.findMany({ where: { id: { in: memberIds } }, select: { id: true, nameTh: true } })
    : [];
  const nameOf = new Map(members.map((m) => [m.id, m.nameTh]));
  return {
    ...toView(client),
    keys: client.keys.map(keyView),
    statusCounts30d: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    recentRequests: recent.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lookupType: r.lookupType,
      staffName: r.facultyMemberId ? nameOf.get(r.facultyMemberId) ?? null : null,
      status: r.status,
      latencyMs: r.latencyMs,
    })),
  };
}
```

Append to `packages/db/src/index.ts`:
```ts
export * from './api-clients';
```

- [ ] **Step 3: Run tests, verify by mutation, typecheck, commit**

Run: `pnpm --filter @kku/db exec vitest run test/api-clients.test.ts` → PASS (8).
Mutation: delete the `if (row.revokedAt) return false;` line → the revoked assertion must FAIL; revert. Remove `.strict()` from `ApiClientInputSchema` → the smuggled-key assertion must FAIL; revert.
Run: `pnpm --filter @kku/db typecheck` → clean.
```bash
git add packages/db/src/api-clients.ts packages/db/src/index.ts packages/db/test/api-clients.test.ts
git commit -F <msg>   # feat(db): API client keys, admin CRUD and call log
```

---

### Task 9: Permission, `meta.integration`, log redaction

**Files:**
- Modify: `packages/shared/src/auth/permissions.ts`, `packages/shared/src/api/envelope.ts`, `packages/shared/src/observability/log-redaction.ts`
- Test: `packages/shared/test/role-permission-grid.test.ts` (runs unchanged — see Step 2)

- [ ] **Step 1: Add the permission**

In `packages/shared/src/auth/permissions.ts`, directly after `'scholar:admin',`, add:
```ts
  // Manage machine clients of the external staff-profile API
  // (/admin/external/api-clients): create clients, grant sections, issue and
  // revoke keys. Admin-grade only — appending here grants it to SUPER_ADMIN
  // and SYSTEM_ADMIN and to no other role.
  'api_clients:admin',
```

- [ ] **Step 2: Run the permission tests**

Run: `pnpm --filter @kku/shared exec vitest run test/role-permission-grid.test.ts test/can.test.ts`
Expected: PASS, with **one more test** than before in the SYSTEM_ADMIN block (`has api_clients:admin`) — the grid iterates `PERMISSIONS`. `UNIVERSITY_USER`'s explicit expected set does not list it, so the grid also proves no lower role got it.

- [ ] **Step 3: Add `meta.integration`**

In `packages/shared/src/api/envelope.ts`, above `export const ApiMetaSchema`, add:
```ts
/**
 * Present only on responses to machine clients of the external API
 * (e.g. POST /api/v1/external/staff-profile). Says which contract version
 * answered, how fresh the expensive part was, and which sections the client's
 * grant withheld — so a missing section is never mistaken for missing data.
 */
export const ApiMetaIntegrationSchema = z.object({
  apiVersion: z.string(),
  generatedAt: z.string().datetime(),
  publicationsCache: z.enum(['hit', 'stale', 'miss']),
  sectionsIncluded: z.array(z.string()),
  sectionsWithheld: z.array(z.string()),
});
export type ApiMetaIntegration = z.infer<typeof ApiMetaIntegrationSchema>;
```
and inside `ApiMetaSchema`, after `caveats`, add:
```ts
  integration: ApiMetaIntegrationSchema.optional(),
```

- [ ] **Step 4: Redact the lookup body in logs**

In `packages/shared/src/observability/log-redaction.ts`, add to `REDACT_PATHS` after `'req.body.exportReason',`:
```ts
  // External staff-profile lookups: the identifier a machine client sent.
  'req.body.citizenId',
  'req.body.email',
```

- [ ] **Step 5: Test, typecheck, commit**

Run: `pnpm --filter @kku/shared test` → PASS. `pnpm --filter @kku/shared typecheck` and `pnpm --filter api typecheck` → clean.
```bash
git add packages/shared/src/auth/permissions.ts packages/shared/src/api/envelope.ts packages/shared/src/observability/log-redaction.ts
git commit -F <msg>   # feat(shared): api_clients:admin, meta.integration, lookup-body redaction
```

---

### Task 10: `CacheService.incrWindow`

**Files:**
- Modify: `apps/api/src/common/cache.service.ts`
- Test: `apps/api/test/cache-incr-window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { CacheService } from '../src/common/cache.service';

function withClient(client: unknown): CacheService {
  const config = { get: () => undefined } as unknown as ConfigService;
  const svc = new CacheService(config); // REDIS_URL unset → no client
  (svc as unknown as { client: unknown }).client = client;
  return svc;
}

describe('CacheService.incrWindow', () => {
  it('returns the new count and sets the TTL only on the first hit', async () => {
    const client = { incr: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2), expire: vi.fn() };
    const svc = withClient(client);
    await expect(svc.incrWindow('rl:a', 120)).resolves.toBe(1);
    await expect(svc.incrWindow('rl:a', 120)).resolves.toBe(2);
    expect(client.expire).toHaveBeenCalledTimes(1);
    expect(client.expire).toHaveBeenCalledWith('kku:cache:rl:a', 120);
  });
  it('returns undefined when Redis is unavailable', async () => {
    await expect(withClient(null).incrWindow('rl:a', 120)).resolves.toBeUndefined();
    const failing = withClient({ incr: vi.fn().mockRejectedValue(new Error('down')), expire: vi.fn() });
    await expect(failing.incrWindow('rl:a', 120)).resolves.toBeUndefined();
  });
});
```
Run: `pnpm --filter api exec vitest run test/cache-incr-window.test.ts` → FAIL (`incrWindow` is not a function).

- [ ] **Step 2: Implement** — add to `CacheService` after `set`:

```ts
  /**
   * Increment a counter that expires `ttlSeconds` after its first increment.
   * Returns the new value, or undefined when Redis is unavailable — callers
   * that rate-limit on it decide what "unknown" means. INCR then EXPIRE is
   * not atomic, which is harmless here: the key names a single time window,
   * and the TTL exists only to clean it up.
   */
  async incrWindow(key: string, ttlSeconds: number): Promise<number | undefined> {
    if (!this.client) return undefined;
    try {
      const k = this.keyPrefix + key;
      const count = await this.client.incr(k);
      if (count === 1) await this.client.expire(k, Math.max(1, Math.floor(ttlSeconds)));
      return count;
    } catch (err) {
      this.logger.debug(`cache.incrWindow(${key}) failed: ${msg(err)}`);
      return undefined;
    }
  }
```

- [ ] **Step 3: Test and commit**

Run the test → PASS (2).
```bash
git add apps/api/src/common/cache.service.ts apps/api/test/cache-incr-window.test.ts
git commit -F <msg>   # feat(api): windowed counter on CacheService
```

---

### Task 11: `ApiKeyGuard`

**Files:**
- Create: `apps/api/src/external/api-key.guard.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/api-key-guard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '@kku/shared';

const mocks = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  touchApiKeyUsage: vi.fn().mockResolvedValue(undefined),
  recordApiRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kku/db', () => mocks);

import { API_KEY_AUTH_META, ApiKeyGuard } from '../src/external/api-key.guard';
import type { CacheService } from '../src/common/cache.service';

const client = {
  id: 'c1',
  status: 'ACTIVE',
  ipAllowlist: [] as string[],
  rateLimitPerMinute: 2,
};

function ctx(req: Record<string, unknown>, enabled = true) {
  const handler = function h() {};
  if (enabled) Reflect.defineMetadata(API_KEY_AUTH_META, true, handler);
  const res = { setHeader: vi.fn() };
  const c = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { c, res };
}

function guardWith(counts: Array<number | undefined>) {
  const cache = { incrWindow: vi.fn() } as unknown as CacheService;
  for (const n of counts) (cache.incrWindow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(n);
  return new ApiKeyGuard(new Reflector(), cache);
}

async function thrown(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected a throw');
}

beforeEach(() => {
  mocks.resolveApiKey.mockReset();
  mocks.recordApiRequest.mockClear();
  client.ipAllowlist = [];
});

describe('ApiKeyGuard', () => {
  it('does nothing on routes without @ApiKeyAuth()', async () => {
    const { c } = ctx({ headers: {} }, false);
    await expect(guardWith([]).canActivate(c)).resolves.toBe(true);
    expect(mocks.resolveApiKey).not.toHaveBeenCalled();
  });

  it('attaches the client on a valid key', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer kpl_live_abc' }, ip: '10.0.0.1' };
    await expect(guardWith([1]).canActivate(ctx(req).c)).resolves.toBe(true);
    expect(req.apiClient).toEqual({ client, keyId: 'k1' });
  });

  it('gives one identical 401 for a missing header, a non-bearer header and an unusable key', async () => {
    mocks.resolveApiKey.mockResolvedValue(null);
    const errors = await Promise.all([
      thrown(guardWith([]).canActivate(ctx({ headers: {} }).c)),
      thrown(guardWith([]).canActivate(ctx({ headers: { authorization: 'Basic abc' } }).c)),
      thrown(guardWith([]).canActivate(ctx({ headers: { authorization: 'Bearer kpl_live_wrong' } }).c)),
    ]);
    const shapes = errors.map((e) => JSON.stringify({ code: e.code, message: e.message, details: e.details }));
    expect(new Set(shapes).size).toBe(1);
    expect(errors[0]!.code).toBe('UNAUTHORIZED');
  });

  it('refuses a caller outside the allowlist with 403 ip_not_allowed and logs it', async () => {
    client.ipAllowlist = ['10.101.0.0/16'];
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const e = await thrown(
      guardWith([]).canActivate(ctx({ headers: { authorization: 'Bearer kpl_live_abc' }, ip: '192.168.1.5' }).c),
    );
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details).toEqual({ reason: 'ip_not_allowed' });
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c1', status: 403 }));
  });

  it('returns 429 with Retry-After past the per-client limit', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const { c, res } = ctx({ headers: { authorization: 'Bearer kpl_live_abc' }, ip: '10.0.0.1' });
    const e = await thrown(guardWith([3]).canActivate(c));
    expect(e.code).toBe('RATE_LIMITED');
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }));
  });

  it('allows the call when the rate-limit store is unavailable', async () => {
    mocks.resolveApiKey.mockResolvedValue({ client, keyId: 'k1' });
    const req = { headers: { authorization: 'Bearer kpl_live_abc' }, ip: '10.0.0.1' };
    await expect(guardWith([undefined]).canActivate(ctx(req).c)).resolves.toBe(true);
  });
});
```
Run: `pnpm --filter api exec vitest run test/api-key-guard.test.ts` → FAIL.

- [ ] **Step 2: Implement `apps/api/src/external/api-key.guard.ts`**

```ts
// Authenticates machine clients of the external API by per-client API key.
//
// Like every guard in this app it is a global APP_GUARD that no-ops unless
// its route metadata is present: @ApiKeyAuth() sets that metadata AND marks
// the route @Public(), because JwtAuthGuard reads any `Authorization: Bearer`
// as a JWT and would reject an API key before this guard ran.
import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { recordApiRequest, resolveApiKey, touchApiKeyUsage, type ResolvedApiKey } from '@kku/db';
import { ApiError, ipAllowed } from '@kku/shared';
import { Public } from '../common/decorators';
import { CacheService } from '../common/cache.service';

export const API_KEY_AUTH_META = Symbol('api-key-auth');

export const ApiKeyAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Public(), SetMetadata(API_KEY_AUTH_META, true));

export interface ApiClientRequest extends Request {
  apiClient?: ResolvedApiKey;
}

/** One message for every authentication failure: a caller must not be able
 *  to tell an unknown key from a revoked, expired or disabled one. */
const UNAUTHENTICATED_MESSAGE = 'Invalid or missing API key';

export function requestIdOf(req: Request): string | null {
  const id = (req as { id?: unknown }).id ?? req.headers['x-request-id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function readBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private lastRedisWarnMinute = -1;

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const enabled = this.reflector.getAllAndOverride<boolean>(API_KEY_AUTH_META, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!enabled) return true;

    const started = Date.now();
    const req = ctx.switchToHttp().getRequest<ApiClientRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const presented = readBearer(req);
    const resolved = presented ? await resolveApiKey(presented) : null;
    if (!resolved) throw new ApiError('UNAUTHORIZED', UNAUTHENTICATED_MESSAGE);
    const { client, keyId } = resolved;

    if (!ipAllowed(req.ip, client.ipAllowlist)) {
      this.log(req, resolved, 403, started);
      throw new ApiError('FORBIDDEN', 'Caller address is not permitted for this client', {
        reason: 'ip_not_allowed',
      });
    }

    const minute = Math.floor(Date.now() / 60_000);
    const count = await this.cache.incrWindow(`api-rl:${client.id}:${minute}`, 120);
    if (count === undefined) {
      // Fail open, like CacheService everywhere else; nginx's zone is the backstop.
      if (this.lastRedisWarnMinute !== minute) {
        this.lastRedisWarnMinute = minute;
        this.logger.warn('API rate limit unavailable (Redis down) — allowing calls this minute');
      }
    } else if (count > client.rateLimitPerMinute) {
      res.setHeader('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
      this.log(req, resolved, 429, started);
      throw new ApiError('RATE_LIMITED', 'Rate limit exceeded for this client');
    }

    req.apiClient = resolved;
    touchApiKeyUsage(keyId, client.id).catch((err: unknown) =>
      this.logger.warn(`could not record key usage: ${(err as Error).message}`),
    );
    return true;
  }

  private log(req: ApiClientRequest, r: ResolvedApiKey, status: number, started: number): void {
    recordApiRequest({
      clientId: r.client.id,
      keyId: r.keyId,
      lookupType: null,
      facultyMemberId: null,
      status,
      sectionsReturned: [],
      latencyMs: Date.now() - started,
      ip: req.ip ?? null,
      requestId: requestIdOf(req),
    }).catch((err: unknown) => this.logger.warn(`could not log API request: ${(err as Error).message}`));
  }
}
```

- [ ] **Step 3: Register it**

In `apps/api/src/app.module.ts`, import `ApiKeyGuard` from `'./external/api-key.guard'` and add to `providers` directly after `{ provide: APP_GUARD, useClass: JwtAuthGuard },`:
```ts
    // External machine clients (POST /api/v1/external/*): no-ops unless the
    // route carries @ApiKeyAuth(). Must run before AccessControlGuard.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
```

- [ ] **Step 4: Test, verify by mutation, commit**

Run: `pnpm --filter api exec vitest run test/api-key-guard.test.ts` → PASS (6).
Mutation: change the 401 for a missing header to `new ApiError('UNAUTHORIZED', 'Missing key')` (a separate `if (!presented) throw …` line) → the identical-401 test must FAIL; revert.
Run: `pnpm --filter api typecheck` → clean.
```bash
git add apps/api/src/external/api-key.guard.ts apps/api/src/app.module.ts apps/api/test/api-key-guard.test.ts
git commit -F <msg>   # feat(api): API-key guard for external machine clients
```

---

### Task 12: Response mapper and section filter

**Files:**
- Create: `apps/api/src/external/staff-profile.mapper.ts`
- Test: `apps/api/test/staff-profile-mapper.test.ts`, fixture `apps/api/test/fixtures/staff-profile.ts`

- [ ] **Step 1: Write the fixture and the failing test**

`apps/api/test/fixtures/staff-profile.ts`:
```ts
import type { StaffProfile } from '@kku/db';

export function staffProfileFixture(over: Partial<StaffProfile> = {}): StaffProfile {
  return {
    facultyMemberId: 'fm1',
    isActive: true,
    rank: 'ASSOC_PROF',
    nameTh: 'สมชาย ใจดี',
    nameEn: 'Somchai Jaidee',
    kkuEmail: 'somchai@kku.ac.th',
    basic: {
      fullNameTh: 'รศ. ดร. สมชาย ใจดี',
      fullNameEn: 'Assoc. Prof. Dr. Somchai Jaidee',
      rankLabelTh: 'รองศาสตราจารย์',
      rankLabelEn: 'Associate Professor',
      facultyNameTh: 'คณะวิทยาศาสตร์',
      facultyNameEn: 'Faculty of Science',
      departmentNameTh: null,
      departmentNameEn: null,
      orcid: null,
      scopusAuthorId: '123',
      openalexAuthorId: null,
      scholarProfileId: null,
    },
    education: [
      { qualification: 'Ph.D.', level: 'ปริญญาเอก', major: 'Chemistry', institute: 'MIT', countryCode: 'US', year: 2548, source: 'unicon-ds2003' },
    ],
    research: {
      totalPapers: 3, totalCitations: 30, hIndex: 2, peakYear: 2024, peakYearCount: 2,
      topVenues: [{ venue: 'J. Chem', count: 2 }], earliestYear: 2020, latestYear: 2024, yearsActive: 5,
    },
    researchBasis: 'library',
    curriculum: [
      { programId: 'p1', code: 'KKU-SEQ-0001', nameTh: 'เคมี', nameEn: 'Chemistry', level: 'BACHELOR', facultyNameTh: 'คณะวิทยาศาสตร์', facultyNameEn: 'Faculty of Science', role: 'CORE' },
    ],
    publications: [
      { id: 'a', year: 2020, title: 'Beta', venue: null, citations: 5, doi: null, scopusId: null, pmid: null, openalexId: null, type: 'article', kkuAuthors: [], authors: [{ family: 'Jaidee', given: 'Somchai', initials: null }], authorsAreComplete: true, source: 'kku-publications:scopus', scholarPaperId: null },
      { id: 'b', year: 2024, title: 'Alpha', venue: 'J. Chem', citations: 3, doi: '10.1/x', scopusId: null, pmid: null, openalexId: null, type: 'article', kkuAuthors: [], authors: [], authorsAreComplete: false, source: 'live:scopus', scholarPaperId: null },
      { id: 'c', year: 2024, title: 'Gamma', venue: 'J. Chem', citations: 22, doi: null, scopusId: null, pmid: null, openalexId: null, type: 'article', kkuAuthors: [], authors: [], authorsAreComplete: false, source: 'google-scholar', scholarPaperId: 'sp1' },
    ],
    publicationsCache: 'hit',
    publicationsFetchedAt: '2026-09-29T02:10:00.000Z',
    teaching: {
      available: true,
      windowYearsBE: { from: 2565, to: 2569 },
      kpis: { totalSections: 4, totalDistinctCourses: 2, activeSemesters: 3, avgContactHrsPerWeek: 6, totalStudentsTaught: 180 },
      byYear: [{ acadYearBE: 2569, sections: 2, contactHrsPerWeekTotal: 12, studentsTaught: 90 }],
      topCourses: [{ courseCode: 'SC101', courseNameTh: 'เคมี 1', courseNameEn: 'Chem 1', sections: 3, studentsTaught: 150, firstYearBE: 2565, lastYearBE: 2569 }],
      expertiseAreas: [],
    },
    talent: null,
    ...over,
  };
}
```
(If `TeachingProfile.kpis` or other shapes differ from this fixture, match the real type — the compiler will say.)

`apps/api/test/staff-profile-mapper.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { StaffProfileResponseDataSchema } from '@kku/shared';
import { toStaffProfileResponse } from '../src/external/staff-profile.mapper';
import { staffProfileFixture } from './fixtures/staff-profile';

const ALL = ['affiliation', 'education', 'teaching', 'research', 'publications'];
const grant = (allowedSections: string[], allowEmailLookup = true) => ({ allowedSections, allowEmailLookup });

describe('toStaffProfileResponse', () => {
  it('produces a body that satisfies the v1 wire schema', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(ALL));
    expect(StaffProfileResponseDataSchema.safeParse(data).success).toBe(true);
  });

  it('always returns person; returns only granted sections; lists the rest as withheld', () => {
    const r = toStaffProfileResponse(staffProfileFixture(), grant(['education']));
    expect(Object.keys(r.data).sort()).toEqual(['education', 'person']);
    expect(r.included).toEqual(['person', 'education']);
    expect(r.withheld).toEqual(['affiliation', 'teaching', 'research', 'publications']);
  });

  it('withholds the staff email unless the client holds email lookup', () => {
    expect(toStaffProfileResponse(staffProfileFixture(), grant([], false)).data.person.email).toBeNull();
    expect(toStaffProfileResponse(staffProfileFixture(), grant([], true)).data.person.email).toBe('somchai@kku.ac.th');
  });

  it('sorts publications by year desc, then citations desc, then title', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['publications']));
    expect(data.publications!.map((p) => p.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('carries each paper source, the research basis and an APA string', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['publications', 'research']));
    expect(data.publications![0]).toMatchObject({ source: 'google-scholar', scholarPaperId: 'sp1' });
    expect(data.publications![2]!.apa).toContain('Jaidee');
    expect(data.research!.basis).toBe('library');
  });

  it('maps teaching totals and every course', () => {
    const { data } = toStaffProfileResponse(staffProfileFixture(), grant(['teaching']));
    expect(data.teaching!.totals.studentsTaught).toBe(180);
    expect(data.teaching!.courses).toHaveLength(1);
    expect(data.teaching!.byYear[0]).toEqual({ yearBE: 2569, sections: 2, studentsTaught: 90, contactHrsPerWeek: 12 });
  });
});
```
Run: `pnpm --filter api exec vitest run test/staff-profile-mapper.test.ts` → FAIL.

- [ ] **Step 2: Implement `apps/api/src/external/staff-profile.mapper.ts`**

```ts
// StaffProfile (the builder's shape, shared with /profile) → the staff-profile.v1
// wire shape, filtered to what this client was granted. Pure: no I/O.
import type { StaffProfile } from '@kku/db';
import {
  formatApa,
  STAFF_PROFILE_SECTIONS,
  type StaffProfileResponseData,
  type StaffProfileSection,
} from '@kku/shared';

const RANK_ABBREV: Record<StaffProfile['rank'], { th: string; en: string }> = {
  PROF: { th: 'ศ.', en: 'Prof.' },
  ASSOC_PROF: { th: 'รศ.', en: 'Assoc. Prof.' },
  ASST_PROF: { th: 'ผศ.', en: 'Asst. Prof.' },
  LECTURER: { th: 'อ.', en: 'Lect.' },
};

export interface StaffProfileGrant {
  allowedSections: readonly string[];
  allowEmailLookup: boolean;
}

export interface MappedStaffProfile {
  data: StaffProfileResponseData;
  included: Array<'person' | StaffProfileSection>;
  withheld: StaffProfileSection[];
}

export function toStaffProfileResponse(p: StaffProfile, grant: StaffProfileGrant): MappedStaffProfile {
  const granted = new Set(grant.allowedSections);
  const data: StaffProfileResponseData = {
    person: {
      facultyMemberId: p.facultyMemberId,
      isActive: p.isActive,
      title: {
        th: p.basic.rankLabelTh,
        en: p.basic.rankLabelEn,
        abbrevTh: RANK_ABBREV[p.rank].th,
        abbrevEn: RANK_ABBREV[p.rank].en,
      },
      name: { th: p.nameTh, en: p.nameEn },
      displayName: { th: p.basic.fullNameTh, en: p.basic.fullNameEn },
      email: grant.allowEmailLookup ? p.kkuEmail : null,
      identifiers: {
        orcid: p.basic.orcid,
        scopusAuthorId: p.basic.scopusAuthorId,
        openalexAuthorId: p.basic.openalexAuthorId,
        scholarProfileId: p.basic.scholarProfileId,
      },
    },
  };

  if (granted.has('affiliation')) {
    data.affiliation = {
      faculty: { th: p.basic.facultyNameTh, en: p.basic.facultyNameEn },
      department: { th: p.basic.departmentNameTh, en: p.basic.departmentNameEn },
      programmes: p.curriculum.map((c) => ({
        code: c.code,
        nameTh: c.nameTh,
        nameEn: c.nameEn,
        level: c.level,
        role: c.role,
      })),
    };
  }

  if (granted.has('education')) {
    data.education = p.education.map((e) => ({
      qualification: e.qualification,
      level: e.level,
      major: e.major,
      institute: e.institute,
      countryCode: e.countryCode,
      yearBE: e.year,
      source: e.source,
    }));
  }

  if (granted.has('teaching')) {
    const t = p.teaching;
    data.teaching = {
      available: t.available,
      windowYearsBE: t.windowYearsBE,
      totals: {
        studentsTaught: t.kpis.totalStudentsTaught,
        sections: t.kpis.totalSections,
        distinctCourses: t.kpis.totalDistinctCourses,
        activeSemesters: t.kpis.activeSemesters,
        avgContactHrsPerWeek: t.kpis.avgContactHrsPerWeekActive,
      },
      byYear: t.byYear.map((y) => ({
        yearBE: y.acadYearBE,
        sections: y.sections,
        studentsTaught: y.studentsTaught,
        contactHrsPerWeek: y.contactHrsPerWeekTotal,
      })),
      courses: t.topCourses.map((c) => ({
        code: c.courseCode,
        nameTh: c.courseNameTh,
        nameEn: c.courseNameEn,
        sections: c.sections,
        studentsTaught: c.studentsTaught,
        firstYearBE: c.firstYearBE,
        lastYearBE: c.lastYearBE,
      })),
    };
  }

  if (granted.has('research')) {
    data.research = { basis: p.researchBasis, ...p.research };
  }

  if (granted.has('publications')) {
    data.publications = [...p.publications]
      .sort(
        (a, b) =>
          b.year - a.year ||
          b.citations - a.citations ||
          (a.title < b.title ? -1 : a.title > b.title ? 1 : 0),
      )
      .map((pub) => ({
        year: pub.year,
        title: pub.title,
        venue: pub.venue,
        type: pub.type,
        citations: pub.citations,
        source: pub.source ?? null,
        doi: pub.doi,
        scopusId: pub.scopusId,
        pmid: pub.pmid,
        scholarPaperId: pub.scholarPaperId ?? null,
        authors: pub.authors.map((a) => ({ family: a.family, given: a.given, initials: a.initials })),
        authorsComplete: pub.authorsAreComplete,
        apa: formatApa(pub),
      }));
  }

  const included = STAFF_PROFILE_SECTIONS.filter((s) => granted.has(s));
  return {
    data,
    included: ['person', ...included],
    withheld: STAFF_PROFILE_SECTIONS.filter((s) => !granted.has(s)),
  };
}
```
`data.research = { basis, ...p.research }` relies on `ResearchSummary`'s keys matching the schema's `research` keys exactly; the schema-parse test proves they do.

- [ ] **Step 3: Test and commit**

Run the test → PASS (6). `pnpm --filter api typecheck` → clean.
```bash
git add apps/api/src/external/staff-profile.mapper.ts apps/api/test/staff-profile-mapper.test.ts apps/api/test/fixtures/staff-profile.ts
git commit -F <msg>   # feat(api): staff-profile.v1 response mapping and section grants
```

---

### Task 13: Staff-profile endpoint

**Files:**
- Create: `apps/api/src/external/staff-profile.service.ts`, `staff-profile.controller.ts`, `external.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/test/staff-profile-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, hashCitizenId } from '@kku/shared';
import { staffProfileFixture } from './fixtures/staff-profile';

const mocks = vi.hoisted(() => ({
  resolveStaffForLookup: vi.fn(),
  buildStaffProfile: vi.fn(),
  recordApiRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kku/db', () => mocks);

import { StaffProfileService } from '../src/external/staff-profile.service';

const RAW_ID = '1101700203883';
const baseClient = {
  id: 'c1',
  allowedSections: ['education', 'publications'],
  allowCitizenIdLookup: true,
  allowEmailLookup: false,
  includeInactive: false,
};
const req = (client = baseClient) =>
  ({ apiClient: { client, keyId: 'k1' }, ip: '10.0.0.1', headers: {} }) as never;

async function thrown(p: Promise<unknown>): Promise<ApiError> {
  try { await p; } catch (e) { return e as ApiError; }
  throw new Error('expected a throw');
}

const svc = new StaffProfileService();

beforeEach(() => {
  mocks.resolveStaffForLookup.mockReset();
  mocks.buildStaffProfile.mockReset();
  mocks.recordApiRequest.mockClear();
});

describe('StaffProfileService.lookup', () => {
  it('returns granted sections with integration meta and logs a 200', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    const out = await svc.lookup(req(), { citizenId: RAW_ID });
    expect(Object.keys(out.data).sort()).toEqual(['education', 'person', 'publications']);
    expect(out.meta.integration).toMatchObject({
      apiVersion: 'staff-profile.v1',
      publicationsCache: 'hit',
      sectionsWithheld: ['affiliation', 'teaching', 'research'],
    });
    expect(mocks.buildStaffProfile).toHaveBeenCalledWith('fm1', { courseLimit: null });
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, lookupType: 'CITIZEN_ID', facultyMemberId: 'fm1' }),
    );
  });

  it('refuses a lookup type the client was not granted, with 403 lookup_not_permitted', async () => {
    const e = await thrown(svc.lookup(req(), { email: 'a@kku.ac.th' }));
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details).toEqual({ reason: 'lookup_not_permitted' });
    expect(mocks.resolveStaffForLookup).not.toHaveBeenCalled();
  });

  it('gives one identical 404 whichever identifier missed', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue(null);
    const both = { ...baseClient, allowEmailLookup: true };
    const a = await thrown(svc.lookup(req(both), { citizenId: RAW_ID }));
    const b = await thrown(svc.lookup(req(both), { email: 'nobody@kku.ac.th' }));
    expect(a.code).toBe('NOT_FOUND');
    expect(JSON.stringify([a.code, a.message, a.details])).toBe(JSON.stringify([b.code, b.message, b.details]));
  });

  it('returns 400 for a bad body, without echoing the value', async () => {
    const e = await thrown(svc.lookup(req(), { citizenId: '1101700203884' }));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(e.details)).not.toContain('1101700203884');
  });

  it('passes includeInactive through to the lookup', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue(null);
    await thrown(svc.lookup(req({ ...baseClient, includeInactive: true }), { citizenId: RAW_ID }));
    expect(mocks.resolveStaffForLookup).toHaveBeenCalledWith({ citizenId: RAW_ID }, { includeInactive: true });
  });

  it('never writes the citizen id, its hash, or the email to the call log', async () => {
    const both = { ...baseClient, allowEmailLookup: true };
    mocks.resolveStaffForLookup.mockResolvedValueOnce('fm1').mockResolvedValue(null);
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    await svc.lookup(req(both), { citizenId: RAW_ID });
    await thrown(svc.lookup(req(both), { citizenId: RAW_ID }));
    await thrown(svc.lookup(req(both), { email: 'secret.person@kku.ac.th' }));
    await thrown(svc.lookup(req(both), { citizenId: '1101700203884' }));
    const logged = JSON.stringify(mocks.recordApiRequest.mock.calls);
    expect(mocks.recordApiRequest).toHaveBeenCalledTimes(4);
    for (const secret of [RAW_ID, hashCitizenId(RAW_ID)!, 'secret.person', '1101700203884']) {
      expect(logged).not.toContain(secret);
    }
  });
});
```
Run: `pnpm --filter api exec vitest run test/staff-profile-service.test.ts` → FAIL.

- [ ] **Step 2: Implement the service**

`apps/api/src/external/staff-profile.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { buildStaffProfile, recordApiRequest, resolveStaffForLookup } from '@kku/db';
import {
  ApiError,
  STAFF_PROFILE_API_VERSION,
  StaffProfileLookupSchema,
  type ApiMeta,
  type StaffProfileResponseData,
} from '@kku/shared';
import type { ApiLookupType } from '@prisma/client';
import { requestIdOf, type ApiClientRequest } from './api-key.guard';
import { toStaffProfileResponse } from './staff-profile.mapper';

const CAVEATS = [
  'teaching.totals.studentsTaught is the sum of enrolled seats across sections over the window: a student taking two of this person\'s courses is counted twice.',
  'research.hIndex and totalCitations are computed from the per-paper citation counts in the publication list; papers without an indexed citation count contribute 0.',
  'research.basis is google-scholar once any Google Scholar import exists for this person; the list is then Scholar papers plus library papers Scholar matched.',
];

@Injectable()
export class StaffProfileService {
  private readonly logger = new Logger(StaffProfileService.name);

  async lookup(
    req: ApiClientRequest,
    body: unknown,
  ): Promise<{ data: StaffProfileResponseData; meta: Partial<ApiMeta> }> {
    const started = Date.now();
    // ApiKeyGuard guarantees this on every @ApiKeyAuth() route.
    const { client, keyId } = req.apiClient!;
    let lookupType: ApiLookupType | null = null;
    let facultyMemberId: string | null = null;
    let sectionsReturned: string[] = [];
    let status = 500;

    try {
      const parsed = StaffProfileLookupSchema.safeParse(body);
      if (!parsed.success) {
        status = 400;
        // Paths and messages only — never the received value.
        throw new ApiError('VALIDATION_FAILED', 'Request validation failed', {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      const lookup = parsed.data;
      lookupType = 'citizenId' in lookup ? 'CITIZEN_ID' : 'EMAIL';
      const permitted = lookupType === 'CITIZEN_ID' ? client.allowCitizenIdLookup : client.allowEmailLookup;
      if (!permitted) {
        status = 403;
        throw new ApiError('FORBIDDEN', 'This client may not look staff up by that identifier', {
          reason: 'lookup_not_permitted',
        });
      }

      facultyMemberId = await resolveStaffForLookup(lookup, { includeInactive: client.includeInactive });
      const profile = facultyMemberId ? await buildStaffProfile(facultyMemberId, { courseLimit: null }) : null;
      if (!profile) {
        status = 404;
        facultyMemberId = null;
        throw new ApiError('NOT_FOUND', 'Staff member not found');
      }

      const mapped = toStaffProfileResponse(profile, client);
      status = 200;
      sectionsReturned = mapped.included;
      return {
        data: mapped.data,
        meta: {
          freshnessDate: profile.publicationsFetchedAt,
          methodologyVersion: STAFF_PROFILE_API_VERSION,
          sources: [
            { id: 'kku-hr', name: 'KKU HR (staff record)' },
            { id: 'unicon-ds2003', name: 'UNICON DS2003 (education history)' },
            { id: 'kku-registry', name: 'KKU Registrar (class offerings)' },
            { id: 'kku-publications', name: 'KKU Publications mirror (Scopus, PubMed)' },
            { id: 'google-scholar', name: 'Google Scholar (on-demand import)' },
          ],
          caveats: CAVEATS,
          integration: {
            apiVersion: STAFF_PROFILE_API_VERSION,
            generatedAt: new Date().toISOString(),
            publicationsCache: profile.publicationsCache,
            sectionsIncluded: mapped.included,
            sectionsWithheld: mapped.withheld,
          },
        },
      };
    } finally {
      recordApiRequest({
        clientId: client.id,
        keyId,
        lookupType,
        facultyMemberId,
        status,
        sectionsReturned,
        latencyMs: Date.now() - started,
        ip: req.ip ?? null,
        requestId: requestIdOf(req),
      }).catch((err: unknown) =>
        this.logger.warn(`could not log API request: ${(err as Error).message}`),
      );
    }
  }
}
```
The `finally` logs every outcome the service produces, including an unexpected throw (status stays `500`).

- [ ] **Step 3: Controller and module**

`apps/api/src/external/staff-profile.controller.ts`:
```ts
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { ApiMeta, StaffProfileResponseData } from '@kku/shared';
import { ApiKeyAuth, type ApiClientRequest } from './api-key.guard';
import { StaffProfileService } from './staff-profile.service';

/**
 * POST /api/v1/external/staff-profile — staff-profile.v1.
 * POST, not GET: a citizen id in a query string would land in every proxy
 * and access log on the way. Consumer guide: docs/integrations/staff-profile-api.md
 */
@Controller('/external/staff-profile')
export class StaffProfileController {
  constructor(private readonly service: StaffProfileService) {}

  @Post()
  @HttpCode(200)
  @ApiKeyAuth()
  lookup(
    @Req() req: ApiClientRequest,
    @Body() body: unknown,
  ): Promise<{ data: StaffProfileResponseData; meta: Partial<ApiMeta> }> {
    return this.service.lookup(req, body);
  }
}
```

`apps/api/src/external/external.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { StaffProfileController } from './staff-profile.controller';
import { StaffProfileService } from './staff-profile.service';

@Module({
  controllers: [StaffProfileController],
  providers: [StaffProfileService],
})
export class ExternalModule {}
```

In `apps/api/src/app.module.ts`: `import { ExternalModule } from './external/external.module';` and add `ExternalModule,` at the end of `imports`.

- [ ] **Step 4: Test, verify by mutation, commit**

Run: `pnpm --filter api exec vitest run test/staff-profile-service.test.ts` → PASS (6).
Mutation: change the 400 details to `{ issues: parsed.error.issues }` (which carry the received value for some issue types) and, separately, add `citizenId` to the `recordApiRequest` object via a spread of `lookup` — each must make a test FAIL. Revert.
Run: `pnpm --filter api test` → full suite PASS. `pnpm --filter api typecheck` → clean.
```bash
git add apps/api/src/external apps/api/src/app.module.ts apps/api/test/staff-profile-service.test.ts
git commit -F <msg>   # feat(api): POST /external/staff-profile
```

---

### Task 14: Admin API for clients and keys

**Files:**
- Create: `apps/api/src/admin/api-clients/api-clients.controller.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Test: `apps/api/test/api-clients-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const mocks = vi.hoisted(() => ({
  createApiClient: vi.fn(),
  listApiClients: vi.fn(),
  getApiClientDetail: vi.fn(),
  updateApiClient: vi.fn(),
  issueApiClientKey: vi.fn(),
  revokeApiClientKey: vi.fn(),
}));
vi.mock('@kku/db', async () => {
  const real = await vi.importActual<Record<string, unknown>>('../../../packages/db/src/api-clients');
  return {
    ...mocks,
    ApiClientInputSchema: real.ApiClientInputSchema,
    ApiClientPatchSchema: real.ApiClientPatchSchema,
    IssueKeySchema: real.IssueKeySchema,
    RevokeKeySchema: real.RevokeKeySchema,
  };
});

import { AccessControlGuard, AUDIT_LOG_META } from '../src/common';
import { ApiClientsController } from '../src/admin/api-clients/api-clients.controller';

const MUTATIONS = ['create', 'update', 'issueKey', 'revokeKey'] as const;
const READS = ['list', 'detail'] as const;

function ctxFor(method: string, role: string): ExecutionContext {
  const handler = (ApiClientsController.prototype as unknown as Record<string, unknown>)[method];
  return {
    getHandler: () => handler,
    getClass: () => ApiClientsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'u1', role, effectiveRole: role } }) }),
  } as unknown as ExecutionContext;
}

describe('ApiClientsController', () => {
  it('lets SYSTEM_ADMIN and SUPER_ADMIN in, and refuses every other role, on every route', async () => {
    const guard = new AccessControlGuard(new Reflector());
    for (const m of [...MUTATIONS, ...READS]) {
      for (const role of ['SUPER_ADMIN', 'SYSTEM_ADMIN']) {
        await expect(Promise.resolve(guard.canActivate(ctxFor(m, role)))).resolves.toBe(true);
      }
      for (const role of ['UNIVERSITY_USER', 'FACULTY_USER', 'PROGRAM_USER']) {
        await expect(Promise.resolve().then(() => guard.canActivate(ctxFor(m, role)))).rejects.toBeDefined();
      }
    }
  });

  it('audit-logs every mutation', () => {
    for (const m of MUTATIONS) {
      const handler = (ApiClientsController.prototype as unknown as Record<string, object>)[m]!;
      expect(Reflect.getMetadata(AUDIT_LOG_META, handler)).toBeDefined();
    }
  });

  it('returns the key plaintext from create — and the body it audits cannot carry one', async () => {
    mocks.createApiClient.mockResolvedValue({ id: 'c1', client: { id: 'c1' }, key: { id: 'k1', prefix: 'kpl_live_abcdefg', key: 'kpl_live_SECRET', expiresAt: null } });
    const ctl = new ApiClientsController();
    const body = {
      name: 'HR portal', allowedSections: [], allowCitizenIdLookup: true, allowEmailLookup: false,
      includeInactive: false, ipAllowlist: [], rateLimitPerMinute: 60,
    };
    const out = await ctl.create({ userId: 'u1' } as never, body);
    expect(out.key.key).toBe('kpl_live_SECRET');
    // @AuditLog stores the REQUEST body; the input schema is strict, so a key never gets in.
    expect(JSON.stringify(body)).not.toContain('kpl_live_');
  });
});
```
(If `AccessControlGuard.canActivate` throws synchronously rather than returning false for a denied role, the `rejects` form above catches both. If it returns `false` instead of throwing, change the denied assertion to `.resolves.toBe(false)` — read `apps/api/src/common/access.guard.ts` first and match it.)

Run: `pnpm --filter api exec vitest run test/api-clients-controller.test.ts` → FAIL.

- [ ] **Step 2: Implement the controller**

`apps/api/src/admin/api-clients/api-clients.controller.ts`:
```ts
// Admin API for external staff-profile API clients and their keys.
// Backs /admin/external/api-clients. Key plaintext appears in exactly two
// responses — create and issue — and never in a request body, so @AuditLog
// (which records the request body) never sees one.
import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import {
  ApiClientInputSchema,
  ApiClientPatchSchema,
  createApiClient,
  getApiClientDetail,
  issueApiClientKey,
  IssueKeySchema,
  listApiClients,
  revokeApiClientKey,
  RevokeKeySchema,
  updateApiClient,
  type ApiClientDetail,
  type ApiClientInput,
  type ApiClientKeyView,
  type ApiClientPatch,
  type ApiClientSummary,
  type ApiClientView,
  type IssuedApiKey,
} from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { z } from 'zod';
import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../../common';

@Controller('/admin/api-clients')
export class ApiClientsController {
  @Get()
  @Authorized('api_clients:admin')
  list(): Promise<ApiClientSummary[]> {
    return listApiClients();
  }

  @Get(':id')
  @Authorized('api_clients:admin')
  async detail(@Param('id') id: string): Promise<ApiClientDetail> {
    const d = await getApiClientDetail(id);
    if (!d) throw new NotFoundException('API client not found');
    return d;
  }

  @Post()
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.create', entityType: 'ApiClient' })
  create(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(ApiClientInputSchema)) body: ApiClientInput,
  ): Promise<{ id: string; client: ApiClientView; key: IssuedApiKey }> {
    return createApiClient(body, user.userId);
  }

  @Patch(':id')
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.update', entityType: 'ApiClient' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApiClientPatchSchema)) body: ApiClientPatch,
  ): Promise<ApiClientView> {
    const c = await updateApiClient(id, body);
    if (!c) throw new NotFoundException('API client not found');
    return c;
  }

  @Post(':id/keys')
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.key.issue', entityType: 'ApiClient' })
  async issueKey(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IssueKeySchema)) body: z.infer<typeof IssueKeySchema>,
  ): Promise<IssuedApiKey> {
    const k = await issueApiClientKey(id, user.userId, body.expiresAt ? new Date(body.expiresAt) : null);
    if (!k) throw new NotFoundException('API client not found');
    return k;
  }

  @Post(':id/keys/:keyId/revoke')
  @Authorized('api_clients:admin')
  @AuditLog({ action: 'api_client.key.revoke', entityType: 'ApiClient' })
  async revokeKey(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body(new ZodValidationPipe(RevokeKeySchema)) body: z.infer<typeof RevokeKeySchema>,
  ): Promise<ApiClientKeyView> {
    const k = await revokeApiClientKey(id, keyId, body.reason);
    if (!k) throw new NotFoundException('API key not found');
    return k;
  }
}
```
Disabling a client is `PATCH { "status": "DISABLED" }`.

Register it: in `apps/api/src/admin/admin.module.ts` import `ApiClientsController` from `'./api-clients/api-clients.controller'` and add it to `controllers`.

- [ ] **Step 3: Test and commit**

Run the test → PASS (3). `pnpm --filter api test` and `pnpm --filter api typecheck` → clean.
```bash
git add apps/api/src/admin/api-clients apps/api/src/admin/admin.module.ts apps/api/test/api-clients-controller.test.ts
git commit -F <msg>   # feat(api): admin API for staff-profile API clients and keys
```

---

### Task 15: Retention — delete call-log rows after 365 days

**Files:**
- Modify: `packages/db/src/retention.ts`, `apps/ingestion/src/scripts/retention-sweep.ts`, `packages/db/test/retention.test.ts`

- [ ] **Step 1: Write the failing test** — add to `packages/db/test/retention.test.ts`, following the file's existing fake-prisma helper (extend that helper with an `apiRequestLog: { deleteMany: vi.fn().mockResolvedValue({ count: 7 }) }` delegate):

```ts
describe('api request log retention', () => {
  it('cuts off at 365 days by default', () => {
    const now = new Date('2026-09-30T00:00:00Z');
    expect(computeRetentionCutoffs(now).apiRequestLogDeleteBefore.toISOString()).toBe('2025-09-30T00:00:00.000Z');
  });

  it('hard-deletes rows older than the cutoff and reports the count', async () => {
    const prisma = fakePrisma(); // the file's existing helper, now with apiRequestLog
    const now = new Date('2026-09-30T00:00:00Z');
    const r = await runRetentionSweep({ prisma, now });
    expect(prisma.apiRequestLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: r.cutoffs.apiRequestLogDeleteBefore } },
    });
    expect(r.apiRequestLogDeleted).toBe(7);
  });

  it('touches nothing on a dry run', async () => {
    const prisma = fakePrisma();
    const r = await runRetentionSweep({ prisma, now: new Date(), dryRun: true });
    expect(prisma.apiRequestLog.deleteMany).not.toHaveBeenCalled();
    expect(r.apiRequestLogDeleted).toBe(0);
  });
});
```
(Use the helper's real name in the file.) Run: `pnpm --filter @kku/db exec vitest run test/retention.test.ts` → FAIL.

- [ ] **Step 2: Implement** — in `packages/db/src/retention.ts`:

- `RetentionWindowsDays`: add
```ts
  /** Hard-delete ApiRequestLog rows (external API call log) older than this. */
  apiRequestLogRetention: number;
```
- `DEFAULT_WINDOWS`: add `apiRequestLogRetention: 365,`
- `RetentionCutoffs`: add `apiRequestLogDeleteBefore: Date;`
- `computeRetentionCutoffs` return: add
```ts
    apiRequestLogDeleteBefore: new Date(now.getTime() - ms(windows.apiRequestLogRetention)),
```
- `RetentionPrismaLike`: add
```ts
  apiRequestLog: {
    deleteMany(args: { where: Prisma.ApiRequestLogWhereInput }): Promise<{ count: number }>;
  };
```
- `RetentionResult`: add `apiRequestLogDeleted: number;`
- dry-run return: add `apiRequestLogDeleted: 0,`
- after the `scholarArchiveDeleted` step:
```ts
  const apiRequestLogDeleted = (
    await prisma.apiRequestLog.deleteMany({
      where: { createdAt: { lt: cutoffs.apiRequestLogDeleteBefore } },
    })
  ).count;
```
  and include `apiRequestLogDeleted` in the final returned object.

In `apps/ingestion/src/scripts/retention-sweep.ts`: in the dry-run counts block add a `prisma.apiRequestLog.count({ where: { createdAt: { lt: cutoffs.apiRequestLogDeleteBefore } } })` alongside `scholarFetchArchive.count(…)`, print it with the others (key `apiRequestLog`), print `apiRequestLogDeleteBefore` with the other cutoffs, and add `apiRequestLog: prisma.apiRequestLog,` to the delegates object passed to `runRetentionSweep`.

- [ ] **Step 3: Test, dry-run the real script, commit**

Run: `pnpm --filter @kku/db exec vitest run test/retention.test.ts` → PASS. `pnpm --filter ingestion typecheck` → clean.
Run: `pnpm exec tsx apps/ingestion/src/scripts/retention-sweep.ts` (no `--apply` — dry run). Expected: output includes `apiRequestLog: 0`.
Confirm `retention-sweep` is still in the esbuild TARGETS (`apps/ingestion/scripts/bundle-pipeline-scripts.ts`) — it already is; no change.
```bash
git add packages/db/src/retention.ts packages/db/test/retention.test.ts apps/ingestion/src/scripts/retention-sweep.ts
git commit -F <msg>   # feat(retention): delete external API call-log rows after 365 days
```

---

### Task 16: nginx — a separate zone for external API traffic

**Files:**
- Modify: `infra/nginx/nginx.conf`, `infra/nginx/conf.d/program-landscape.conf`
- Test: `apps/api/test/build-release.test.ts` (extend)

- [ ] **Step 1: Write the failing assertion** — in `apps/api/test/build-release.test.ts`, following its existing nginx regex checks, add:
```ts
  it('routes /api/v1/external/ through its own rate-limit zone', () => {
    const main = readFileSync(path.join(ROOT, 'infra', 'nginx', 'nginx.conf'), 'utf8');
    const site = readFileSync(path.join(ROOT, 'infra', 'nginx', 'conf.d', 'program-landscape.conf'), 'utf8');
    expect(main).toMatch(/limit_req_zone\s+\$binary_remote_addr\s+zone=external_zone:/);
    const block = site.slice(site.indexOf('location /api/v1/external/'));
    expect(block).toMatch(/limit_req zone=external_zone/);
    expect(site.indexOf('location /api/v1/external/')).toBeGreaterThan(-1);
  });
```
(Use the file's existing name for the repo-root constant instead of `ROOT` if it differs.) Run: `pnpm --filter api exec vitest run test/build-release.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`infra/nginx/nginx.conf`, after the `heavy_zone` line:
```nginx
  # Machine clients of /api/v1/external/* — their own budget, so an integration
  # cannot drain api_zone for interactive users. Per-client limits are enforced
  # in the api (ApiKeyGuard); this is the per-address backstop.
  limit_req_zone $binary_remote_addr zone=external_zone:10m rate=5r/s;
```

`infra/nginx/conf.d/program-landscape.conf`, directly **before** `location /api/v1/ {` (a longer prefix wins regardless of order, but keep it adjacent for readers):
```nginx
  location /api/v1/external/ {
    limit_req zone=external_zone burst=20 nodelay;
    proxy_pass http://api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_x_forwarded_host;
    proxy_set_header X-Request-Id $req_id;
    # A cold publications cache can take ~45 s to build.
    proxy_read_timeout 90s;
  }
```

- [ ] **Step 3: Test and commit**

Run the test → PASS. Validate syntax without touching the running stack:
```bash
docker run --rm -v "$PWD/infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$PWD/infra/nginx/conf.d:/etc/nginx/conf.d:ro" nginx:alpine nginx -t
```
Expected: `syntax is ok`. (If `nginx -t` fails only on the missing certificate files or upstream host resolution, that is environmental, not this change — note it and move on; the regex test is the gate.)
```bash
git add infra/nginx apps/api/test/build-release.test.ts
git commit -F <msg>   # feat(nginx): separate rate-limit zone for external API clients
```

---

### Task 17: Admin console page

**Files:**
- Create: `apps/web/src/lib/actions/api-clients.ts`, `apps/web/app/admin/external/api-clients/page.tsx`, `apps/web/app/admin/external/api-clients/client.tsx`
- Modify: `apps/web/app/admin/page.tsx`

Invoke the `frontend-design` skill before writing the UI (CLAUDE.md: UI work). Follow `apps/web/app/admin/external/ai-search/` for layout, and the evidence-page conventions: tokens only, no hex, arbitrary values for pixel sizes (the spacing scale is half-scale), and border colours from the preset's `border-subtle` / `border-default` / `border-strong` only (`border-border-*` emits nothing).

- [ ] **Step 1: Server actions**

`apps/web/src/lib/actions/api-clients.ts`:
```ts
'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { can, type SessionUser } from '@kku/shared';
import type {
  ApiClientDetail,
  ApiClientInput,
  ApiClientKeyView,
  ApiClientPatch,
  ApiClientView,
  IssuedApiKey,
} from '@kku/db';

const PAGE = '/admin/external/api-clients';
type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function guard(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  return user && can(user, 'api_clients:admin') ? null : 'Not permitted';
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  try {
    const data = await fn();
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function createApiClientAction(
  input: ApiClientInput,
): Promise<Result<{ id: string; client: ApiClientView; key: IssuedApiKey }>> {
  return run(() => apiFetch('/admin/api-clients', { method: 'POST', body: JSON.stringify(input) }));
}

export async function updateApiClientAction(id: string, patch: ApiClientPatch): Promise<Result<ApiClientView>> {
  return run(() => apiFetch(`/admin/api-clients/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }));
}

export async function issueApiKeyAction(id: string, expiresAt: string | null): Promise<Result<IssuedApiKey>> {
  return run(() =>
    apiFetch(`/admin/api-clients/${encodeURIComponent(id)}/keys`, { method: 'POST', body: JSON.stringify({ expiresAt }) }),
  );
}

export async function revokeApiKeyAction(id: string, keyId: string, reason: string): Promise<Result<ApiClientKeyView>> {
  return run(() =>
    apiFetch(`/admin/api-clients/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  );
}

export async function getApiClientDetailAction(id: string): Promise<Result<ApiClientDetail>> {
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  try {
    return { ok: true, data: await apiFetch(`/admin/api-clients/${encodeURIComponent(id)}`) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
```
(`import type` from `@kku/db` is erased — this file is server-only anyway.)

- [ ] **Step 2: Page (server component)**

`apps/web/app/admin/external/api-clients/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
import { can, type SessionUser } from '@kku/shared';
import type { ApiClientSummary } from '@kku/db';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AdminBackNav } from '@/components/admin-back-nav';
import { ApiClientsClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'API clients — Admin' };

export default async function AdminApiClientsPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!can(user, 'api_clients:admin')) redirect('/no-access');

  let clients: ApiClientSummary[] = [];
  let loadError: string | null = null;
  try {
    clients = await apiFetch<ApiClientSummary[]>('/admin/api-clients');
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <AuthedAppShell user={user}>
      <AdminBackNav current="API clients" />
      <ApiClientsClient initial={clients} loadError={loadError} />
    </AuthedAppShell>
  );
}
```

- [ ] **Step 3: Client component**

`apps/web/app/admin/external/api-clients/client.tsx` — a `'use client'` component. It takes the view types (`ApiClientSummary`, `ApiClientDetail`, `ApiClientKeyView`, `IssuedApiKey`) with **`import type` from `'@kku/db'` only** — a runtime import of either barrel from a client component crashes the build via `node:crypto`. It contains:

1. **Header:** title "API clients", one line: "Other KKU systems call `POST /api/v1/external/staff-profile` with a key issued here. Keys are shown once." A "New client" button.
2. **List table** of `initial` rows — columns Name, Status (`Badge`), Sections (comma list, "person only" when empty), Lookups (`citizen id` / `email`), Last used (relative, exact on hover), Requests 24 h / 30 d, 404 rate over 30 d (`notFound30d / requests30d`, `—` when 0 requests; tone warning above 20 %). Clicking a row opens the detail panel.
3. **Create dialog** (`Dialog`): name, contact, description, section checkboxes over `STAFF_PROFILE_SECTIONS` (import the constant from `'@kku/shared/src/staff-profile/api-schema'` — deep path; the barrel pulls `node:crypto`), two lookup checkboxes, include-inactive checkbox, IP ranges (textarea, one per line → array, trimmed, blanks dropped), rate limit (number, 1–600, default 60). Submit calls `createApiClientAction`; on `ok:false` show `message` inline; on success switch the dialog to the **key reveal** state.
4. **Key reveal** (shared by create and issue): the key in a monospace read-only field, a Copy button (`navigator.clipboard.writeText`), the warning "Copy this key now. It will not be shown again.", and a Done button. The key lives only in component state and is cleared on close.
5. **Detail side panel** (`Drawer` or `RightPanel` from `@kku/ui`): loads `getApiClientDetailAction(id)`.
   - Settings form (same fields as create) → `updateApiClientAction`.
   - Disable / Enable button → `updateApiClientAction(id, { status })`.
   - **Keys** table: prefix + `…`, created, expires, last used, status (active / expired / revoked with reason). "Issue key" with optional expiry date → `issueApiKeyAction` → key reveal. "Revoke" per active key → prompts for a reason (min 3 chars) → `revokeApiKeyAction`.
   - **Usage (30 days):** `statusCounts30d` as a row of labelled counts (200 / 400 / 403 / 404 / 429 / 500).
   - **Recent calls:** last 100 — time, lookup type, staff name (or "no match"), status, latency ms.
   - **How to call:** a `<pre>` with
     ```
     curl -sS https://program-landscape.kku.ac.th/api/v1/external/staff-profile \
       -H "Authorization: Bearer <your key>" \
       -H "Content-Type: application/json" \
       -d '{"email":"someone@kku.ac.th"}'
     ```
     and a link to the integration guide path.
6. After any mutation, `router.refresh()`.

Use `useTransition` for pending states, skeletons not spinners, toasts are not required (inline success/error text is fine). Every value in a table cell that combines a number and a unit gets an explicit separator (memory: adjacent values render run-together).

- [ ] **Step 4: Console tile**

In `apps/web/app/admin/page.tsx`, in the `external` tile array, after the `/admin/external/ai-search` tile, add:
```tsx
    {
      href: '/admin/external/api-clients',
      label: 'API clients',
      description: 'Keys and section grants for systems that read staff profiles through the external API.',
      icon: <KeyRound className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
```
and add `KeyRound` to the file's `lucide-react` import.

- [ ] **Step 5: Typecheck, test, look at it**

Run: `pnpm --filter web typecheck && pnpm --filter web test` → clean.
Restart dev servers, sign in as a SYSTEM_ADMIN dev user, open `/admin/external/api-clients`, create a client named `dev-test` with all sections and both lookups, copy the key into `$SCRATCH/dev-key.txt` (a file in the scratchpad, never echoed), issue a second key, revoke the first with a reason. Check both light and dark themes. Sign in as a non-admin: the page redirects to `/no-access` and the console tile is absent.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/actions/api-clients.ts apps/web/app/admin/external/api-clients apps/web/app/admin/page.tsx
git commit -F <msg>   # feat(admin): console for staff-profile API clients and keys
```

---

### Task 18: Documentation

**Files:**
- Create: `docs/integrations/staff-profile-api.md`
- Modify: `docs/pdpa.md`, `CLAUDE.md`

- [ ] **Step 1: Integration guide** — `docs/integrations/staff-profile-api.md`, for the teams building the calling systems. Sections, in order:
  1. **What it returns** — the six sections, one line each; `person` always present.
  2. **Getting a key** — ask a Program Landscape system admin; state which sections and lookup types you need and your server's IP range.
  3. **Request** — the `curl` example from Task 17; POST only; exactly one of `citizenId` (13 digits, checksum validated; dashes and spaces accepted) or `email`.
  4. **Response** — the full JSON example from spec §4 and a field table; the publication sort order; what `research.basis` and each paper's `source` mean; `meta.integration.sectionsWithheld`.
  5. **Errors** — the status table from spec §3, including `details.reason`.
  6. **Performance** — first call for a person can take up to ~45 s (publications built live); later calls within 24 h are fast; set a client timeout of at least 60 s; don't loop over every staff member (each cold call spends the university's Scopus quota of 20,000 requests a week).
  7. **Limits** — per-client rate limit (default 60/min, `Retry-After` on 429); nginx per-address backstop 5 r/s, burst 20.
  8. **Versioning** — `staff-profile.v1`; additive changes keep v1.
  9. **Privacy** — what is logged (client, staff record matched, status, time, IP) and what is never logged (the citizen id, its hash, the email); 365-day retention; PDPA basis is the calling system's own.

- [ ] **Step 2: PDPA** — in `docs/pdpa.md`:
  - Under `## Audit log retention`, add: ``- `ApiRequestLog` table: **365 days**, then hard-deleted. Never stores the citizen id, its hash or the email a caller sent — only the staff record matched.``
  - Add a subsection `### External staff-profile API (from v1.9.9)` after the page-view subsection: what the API discloses per section, that section grants are per client and set by an admin, that citizen-id lookups arrive in a POST body and are redacted from logs, that the unsalted citizen-id hash is deliberately not logged (and why), and that the data-sharing basis must be recorded per calling system before its key is issued.

- [ ] **Step 3: CLAUDE.md** — in "Current status", add after the v1.9.8 line:
```markdown
- [x] Staff Profile API  *(built 2026-09-30, NOT deployed. `POST /api/v1/external/staff-profile` keyed by citizen id or email, per-client API keys managed at `/admin/external/api-clients` (`api_clients:admin`). The /profile builder moved to `packages/db/src/staff-profile/` as `buildStaffProfile(facultyMemberId)`; publications cache moved to `staff_publications_cache` (old `user_publications_cache` has no reader — drop it next release). Spec `docs/superpowers/specs/2026-09-30-staff-profile-api-design.md`; consumer guide `docs/integrations/staff-profile-api.md`. **Before deploy: confirm the api container reaches `10.130.2.151:5432`.**)*
```

- [ ] **Step 4: Check naming, commit**

Run: `grep -rn -i -E "curriculum compass|ทักษทัศน์|kku curriculum landscape" docs/integrations docs/pdpa.md` → no output.
```bash
git add docs/integrations/staff-profile-api.md docs/pdpa.md CLAUDE.md
git commit -F <msg>   # docs: staff profile API — consumer guide, PDPA entry, status
```

---

### Task 19: End-to-end verification on dev

No code. Proves the whole path against the real dev database and a real key.

- [ ] **Step 1: Full checks**

```bash
pnpm check
```
Expected: lint + typecheck + tests green (lint may report the known repo-wide backlog; confirm no NEW errors in files this plan touched: `pnpm exec eslint <each touched file>`).

- [ ] **Step 2: Live calls** (dev servers restarted; key from Task 17 in `$SCRATCH/dev-key.txt`; pick a real dev staff email with `SELECT kku_email FROM faculty_members WHERE is_active AND kku_email IS NOT NULL LIMIT 1;`)

```bash
KEY="$(cat "$SCRATCH/dev-key.txt")"
URL=http://localhost:4000/api/v1/external/staff-profile   # the api dev port — check `ss -ltnp`
curl -sS -o "$SCRATCH/r1.json" -w '%{http_code} %{time_total}s\n' -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"email":"<staff email>"}' "$URL"
curl -sS -o "$SCRATCH/r2.json" -w '%{http_code} %{time_total}s\n' -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"email":"<staff email>"}' "$URL"
```
Expected: both `200`; the first may be slow (`publicationsCache: "miss"`), the second fast (`"hit"`). Inspect `r2.json`: all six sections present, publications newest first, `meta.integration.sectionsWithheld` empty.

Then, each expecting the status shown:
- no `Authorization` header → `401`
- revoked key from Task 17 → `401`, body identical to the previous
- `{"citizenId":"1101700203884"}` → `400`
- `{"email":"nobody-here@kku.ac.th"}` → `404`
- in the console, untick email lookup for `dev-test`, repeat the email call → `403` with `details.reason = lookup_not_permitted`
- set the rate limit to 1/min, call twice quickly → second is `429` with a `Retry-After` header

- [ ] **Step 3: Page ↔ API parity**

Sign in to the web app as the dev user whose email you used; compare `/profile`'s research summary (papers, citations, h-index, years active, peak year) with `r2.json`'s `research`. They must match exactly.

- [ ] **Step 4: The log never holds the identifier**

```sql
SELECT count(*) FROM api_request_logs;
SELECT * FROM api_request_logs ORDER BY created_at DESC LIMIT 20;
```
Confirm each call above has a row with the expected status, and that no column anywhere in the table contains the email you sent (`SELECT count(*) FROM api_request_logs WHERE row_to_json(api_request_logs)::text ILIKE '%<local part of the email>%';` → `0`).

- [ ] **Step 5: Clean up and report**

Disable the `dev-test` client in the console. Delete `$SCRATCH/dev-key.txt` and `$SCRATCH/r*.json` by name. Report results — including anything that did not match — to the user. **Do not run `pnpm build:release`.**

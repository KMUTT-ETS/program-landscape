# Usage Analytics (Access Log + Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record page views (plus existing sign-ins and audit actions) and show who uses which parts of the platform — aggregates for leadership at `/usage`, per-user drill-down for admins, three tiles on `/admin` — with 120-day raw retention rolled up to Bangkok-day counts.

**Architecture:** A no-UI client component in the app shell beacons `{path, scope, scopeId, programId}` to `POST /api/v1/usage/page-views`; the API takes identity from the session, normalises the path with a pure function shared with tests, and inserts a `page_views` row. All reads go through one SQL CTE (`usage_days`) that unions raw rows (last 120 days, sessions derived by window function) with `page_view_daily` roll-ups and `audit_logs` sign-ins, so every aggregate — summary, modules, programmes, roles, faculties — is one query over the same shape. A retention rule in `@kku/db/retention` rolls days older than 120 into the daily table before deleting them; a new systemd timer runs the sweep nightly on prod (there is none today).

**Tech Stack:** Prisma (`$queryRaw` + Zod-validated rows per CLAUDE.md), NestJS (`@Authorized`, named throttler buckets, `CacheService`), Next.js 14 App Router, `@kku/ui` (`TrendLine`, `Sparkline`, `RightPanel`, `ProvenanceButton`, `FreshnessBadge`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-acknowledgements-and-usage-analytics-design.md`, Part B.

**Rules that apply (CLAUDE.md + memory):** no `any`; Zod on I/O; no hardcoded colours; client components `import type` only from `@kku/shared` (runtime imports from `@kku/shared/src/...` subpaths are fine on the server); never `git add -A`; commit messages via `git commit -F <file>` (the dev-safety hook blocks command strings that mention env files); migrations hand-written, additive, linted with `pnpm tsx scripts/migration-linter.ts <file>`; after any change under `packages/`, restart `pnpm dev` before checking the api or ingestion; **never `prisma migrate dev`/`reset`** — apply with `npx prisma migrate deploy` from `packages/db`; take a dev snapshot first (`bash scripts/dev-guard/dev-backup.sh`).

Attribution to append to every commit message:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
```

Scratch directory for commit-message files: `/tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad` (referred to below as `$S`; set `S=` to that path at the start of a shell).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/usage/normalise-path.ts` (create) | Pure: raw pathname → `{ path, module }`. |
| `packages/shared/src/usage/sessions.ts` (create) | Pure: session and dwell derivation over ordered timestamps; audit action → family. |
| `packages/shared/src/usage/index.ts` (create) | Barrel for the two above + constants. |
| `packages/shared/src/auth/permissions.ts` (modify) | Two permissions. |
| `packages/db/prisma/schema.prisma` (modify) | `PageView`, `PageViewDaily`, `User` relations. |
| `packages/db/prisma/migrations/20260914100000_page_views/migration.sql` (create) | Both tables, indexes, NULLS NOT DISTINCT unique. |
| `packages/db/src/usage.ts` (create) | `recordPageView`, the `usage_days` CTE, every read query. |
| `packages/db/src/usage-retention.ts` (create) | Roll-up + delete rule; pure planner + executor. |
| `packages/db/src/retention.ts` (modify) | Call the rule from the sweep. |
| `scripts/pdpa/retention-sweep.ts` (modify) | Report the new rule's counts. |
| `apps/api/src/usage/{usage.module,usage.controller,usage.service}.ts` (create) | POST + nine GETs. |
| `apps/api/src/app.module.ts` (modify) | Register `UsageModule`. |
| `apps/web/src/components/usage-recorder.tsx` (create) | The beacon. |
| `apps/web/src/lib/usage-recorder-policy.ts` (create) | Pure: should this event be sent? (dedupe, exclusions). |
| `apps/web/src/components/shell/app-shell-server.tsx` (modify) | Mount the recorder. |
| `apps/web/app/usage/{page,client,types}.tsx` (create) | Dashboard. |
| `apps/web/src/lib/app-nav.tsx`, `apps/web/app/admin/page.tsx` (modify) | Nav entry, tile, hero tiles. |
| `infra/systemd/program-landscape-retention.{service,timer}` (create), `DEPLOYMENT.md` (modify) | Nightly sweep on prod. |
| `docs/pdpa.md`, `apps/web/src/components/legal/legal-page.tsx`, `apps/web/app/changelog/page.tsx` (modify) | Privacy notice, changelog. |

---

### Task 1: Path normalisation (pure) + route-coverage test

**Files:**
- Create: `packages/shared/src/usage/normalise-path.ts`, `packages/shared/src/usage/index.ts`
- Test: `packages/shared/test/usage-normalise-path.test.ts`, `packages/shared/test/usage-route-coverage.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/test/usage-normalise-path.test.ts
import { describe, expect, it } from 'vitest';
import { normalisePath, USAGE_MODULES } from '../src/usage';

// The recorder sends the raw pathname; the server turns it into a bounded
// route pattern so ids and query strings never make page_views unbounded.

describe('normalisePath', () => {
  it('replaces a cuid segment with [id]', () => {
    expect(normalisePath('/programs/cmtzdam3m0001fd72f65igks4')).toEqual({ path: '/programs/[id]', module: 'deep-dive' });
  });
  it('replaces a KKU-SEQ programme code', () => {
    expect(normalisePath('/programs/KKU-SEQ-0062/print').path).toBe('/programs/[id]/print');
  });
  it('replaces a UUID', () => {
    expect(normalisePath('/decisions/3f2b1c4d-1111-4222-8333-444455556666').path).toBe('/decisions/[id]');
  });
  it('drops the query string and hash, including Thai-encoded values', () => {
    expect(normalisePath('/cockpit?scope=faculty&scopeId=abc&q=%E0%B8%A7%E0%B8%B4#top').path).toBe('/cockpit');
  });
  it('collapses trailing slashes and lower-cases', () => {
    expect(normalisePath('/Gap-Analysis/Opportunities/').path).toBe('/gap-analysis/opportunities');
    expect(normalisePath('/Gap-Analysis/Opportunities/').module).toBe('gap');
  });
  it('maps the home page', () => {
    expect(normalisePath('/')).toEqual({ path: '/', module: 'home' });
  });
  it('maps every known first segment to its module', () => {
    const cases: Array<[string, string]> = [
      ['/cockpit', 'cockpit'], ['/programs/x', 'deep-dive'], ['/gap-analysis', 'gap'],
      ['/benchmarking', 'benchmarking'], ['/scenarios', 'scenarios'], ['/decisions', 'decisions'],
      ['/analyst', 'analyst'], ['/trends', 'trends'], ['/risks', 'risk'], ['/education/recruitment', 'education'],
      ['/staff/workforce', 'staff'], ['/skills', 'skills'], ['/admin/jobthai', 'admin'], ['/docs/methodology', 'docs'],
      ['/changelog', 'docs'], ['/profile', 'profile'], ['/inbox', 'inbox'], ['/teaching-learning', 'teaching-learning'],
      ['/dashboards', 'dashboards'], ['/usage', 'usage'], ['/p/some-slug', 'public-profile'], ['/upload', 'admin'],
      ['/styleguide', 'other'],
    ];
    for (const [input, module] of cases) expect(normalisePath(input).module, input).toBe(module);
  });
  it('caps the pattern length', () => {
    expect(normalisePath('/' + 'a/'.repeat(400)).path.length).toBeLessThanOrEqual(200);
  });
  it('exports the module list the dashboard labels come from', () => {
    expect(USAGE_MODULES).toContain('deep-dive');
    expect(USAGE_MODULES).toContain('other');
  });
});
```

```ts
// packages/shared/test/usage-route-coverage.test.ts
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalisePath } from '../src/usage';

// A new page that lands in `other` is invisible in the usage dashboard.
// This walks the web app's top-level route folders and fails until each
// is classified — the cost of adding a page is one entry in MODULE_BY_SEGMENT.

const APP_DIR = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'app');
// Not user-facing pages, or excluded from recording by design.
const IGNORED = new Set(['api', 'signin', 'no-access', '(legal)', 'styleguide']);

describe('every web route folder maps to a usage module', () => {
  const folders = readdirSync(APP_DIR).filter(
    (f) => statSync(path.join(APP_DIR, f)).isDirectory() && !IGNORED.has(f) && !f.startsWith('_'),
  );
  it('has route folders to check', () => expect(folders.length).toBeGreaterThan(10));
  for (const f of folders) {
    it(`/${f} is classified`, () => {
      expect(normalisePath(`/${f}/x`).module).not.toBe('other');
    });
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/shared && npx vitest run test/usage-normalise-path.test.ts test/usage-route-coverage.test.ts`
Expected: FAIL — cannot resolve `../src/usage`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/usage/normalise-path.ts

// ─────────────────────────────────────────────────────────────────────────────
// Raw pathname → bounded route pattern + module.
//
// The client sends what the browser saw; nothing user-controlled reaches
// page_views unbounded. Ids become `[id]` generically (cuid, KKU-SEQ code,
// UUID) rather than from a hardcoded route list — a list goes stale the first
// time a page is added. The module comes from the first segment; the
// route-coverage test fails CI when a new top-level folder is unclassified.
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_MODULES = [
  'home', 'cockpit', 'deep-dive', 'gap', 'benchmarking', 'scenarios', 'decisions',
  'analyst', 'trends', 'risk', 'education', 'staff', 'skills', 'teaching-learning',
  'dashboards', 'admin', 'docs', 'profile', 'public-profile', 'inbox', 'usage', 'other',
] as const;
export type UsageModule = (typeof USAGE_MODULES)[number];

const MODULE_BY_SEGMENT: Record<string, UsageModule> = {
  '': 'home',
  cockpit: 'cockpit',
  programs: 'deep-dive',
  'gap-analysis': 'gap',
  benchmarking: 'benchmarking',
  scenarios: 'scenarios',
  decisions: 'decisions',
  analyst: 'analyst',
  trends: 'trends',
  risks: 'risk',
  education: 'education',
  staff: 'staff',
  skills: 'skills',
  'teaching-learning': 'teaching-learning',
  dashboards: 'dashboards',
  admin: 'admin',
  upload: 'admin',
  docs: 'docs',
  changelog: 'docs',
  profile: 'profile',
  p: 'public-profile',
  inbox: 'inbox',
  usage: 'usage',
};

const ID_SEGMENT = /^(c[a-z0-9]{24}|kku-seq-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const MAX_PATH_PATTERN_LENGTH = 200;

export interface NormalisedPath {
  path: string;
  module: UsageModule;
}

export function normalisePath(raw: string): NormalisedPath {
  const noQuery = raw.split(/[?#]/)[0] ?? '';
  const segments = noQuery
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => (ID_SEGMENT.test(s) ? '[id]' : s.toLowerCase()));
  const path = ('/' + segments.join('/')).slice(0, MAX_PATH_PATTERN_LENGTH);
  const first = segments[0] ?? '';
  const module = MODULE_BY_SEGMENT[first] ?? 'other';
  return { path, module };
}
```

```ts
// packages/shared/src/usage/index.ts
export * from './normalise-path';
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/shared && npx vitest run test/usage-normalise-path.test.ts test/usage-route-coverage.test.ts`
Expected: all pass (9 + ~25 per-folder cases).

- [ ] **Step 5: Commit**

```bash
S=/tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad
cat > $S/u1.txt <<'EOF'
feat(usage): pure path normalisation with a route-coverage guard

Raw pathname -> bounded route pattern + module. Ids are replaced generically
(cuid, KKU-SEQ, UUID) rather than from a route list that would go stale; a
test walks apps/web/app and fails until every top-level folder is classified.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add packages/shared/src/usage packages/shared/test/usage-normalise-path.test.ts packages/shared/test/usage-route-coverage.test.ts
git commit -F $S/u1.txt
```

---

### Task 2: Sessions, dwell and action families (pure)

**Files:**
- Create: `packages/shared/src/usage/sessions.ts`
- Modify: `packages/shared/src/usage/index.ts`
- Test: `packages/shared/test/usage-sessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/usage-sessions.test.ts
import { describe, expect, it } from 'vitest';
import { actionFamily, groupSessions, medianDwellMs, SESSION_GAP_MS } from '../src/usage';

const t = (min: number) => new Date(Date.UTC(2026, 8, 14, 0, min));

describe('groupSessions', () => {
  it('starts a new session after a gap of more than 30 minutes', () => {
    expect(SESSION_GAP_MS).toBe(30 * 60_000);
    const views = [t(0), t(5), t(20), t(60), t(65)].map((at, i) => ({ at, path: `/p${i}` }));
    const sessions = groupSessions(views);
    expect(sessions.map((s) => s.views.length)).toEqual([3, 2]);
    expect(sessions[0]!.startedAt).toEqual(t(0));
    expect(sessions[1]!.startedAt).toEqual(t(60));
  });
  it('treats exactly 30 minutes as the same session', () => {
    expect(groupSessions([{ at: t(0), path: '/a' }, { at: t(30), path: '/b' }])).toHaveLength(1);
  });
  it('sorts unsorted input by time', () => {
    const s = groupSessions([{ at: t(65), path: '/b' }, { at: t(0), path: '/a' }]);
    expect(s).toHaveLength(2);
    expect(s[0]!.views[0]!.path).toBe('/a');
  });
  it('returns nothing for no views', () => {
    expect(groupSessions([])).toEqual([]);
  });
});

describe('medianDwellMs', () => {
  it('is the median time-to-next-view within a session, last view excluded', () => {
    // gaps: 5, 15 min in session 1; session 2 has one view -> no dwell
    const views = [t(0), t(5), t(20), t(60)].map((at) => ({ at, path: '/x' }));
    expect(medianDwellMs(groupSessions(views))).toBe(10 * 60_000);
  });
  it('is null when no view has a successor', () => {
    expect(medianDwellMs(groupSessions([{ at: t(0), path: '/x' }]))).toBeNull();
  });
});

describe('actionFamily', () => {
  it('maps audit actions to the families the dashboard shows', () => {
    expect(actionFamily('program.export_detail_pdf')).toBe('export');
    expect(actionFamily('pdf.generate')).toBe('export');
    expect(actionFamily('cockpit.brief')).toBe('ai-brief');
    expect(actionFamily('scenario.run')).toBe('scenario');
    expect(actionFamily('decision.approve')).toBe('decision');
    expect(actionFamily('program.run_pipeline_bulk')).toBe('pipeline');
    expect(actionFamily('jobthai.batch.upload')).toBe('upload');
    expect(actionFamily('trend_document.upload')).toBe('upload');
  });
  it('returns null for housekeeping actions that are not usage', () => {
    expect(actionFamily('auth.signin.ok')).toBeNull();
    expect(actionFamily('update_theme')).toBeNull();
    expect(actionFamily('impersonation_start')).toBeNull();
  });
  it('buckets anything else as other', () => {
    expect(actionFamily('ai_model_override.set')).toBe('other');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/shared && npx vitest run test/usage-sessions.test.ts`
Expected: FAIL — `groupSessions` is not exported.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/usage/sessions.ts

// Sessions and dwell are DERIVED from timestamps, never captured. A session is
// a run of one user's views with no gap over 30 minutes; dwell is the time to
// the next view inside a session (the last view has none).

export const SESSION_GAP_MS = 30 * 60_000;

export interface ViewLike {
  at: Date;
  path: string;
}
export interface Session<V extends ViewLike = ViewLike> {
  startedAt: Date;
  endedAt: Date;
  views: V[];
}

export function groupSessions<V extends ViewLike>(views: ReadonlyArray<V>): Session<V>[] {
  const sorted = [...views].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Session<V>[] = [];
  for (const v of sorted) {
    const cur = out[out.length - 1];
    if (cur && v.at.getTime() - cur.endedAt.getTime() <= SESSION_GAP_MS) {
      cur.views.push(v);
      cur.endedAt = v.at;
    } else {
      out.push({ startedAt: v.at, endedAt: v.at, views: [v] });
    }
  }
  return out;
}

export function medianDwellMs(sessions: ReadonlyArray<Session>): number | null {
  const gaps: number[] = [];
  for (const s of sessions) {
    for (let i = 0; i + 1 < s.views.length; i++) {
      gaps.push(s.views[i + 1]!.at.getTime() - s.views[i]!.at.getTime());
    }
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

export const ACTION_FAMILIES = ['export', 'ai-brief', 'scenario', 'decision', 'pipeline', 'upload', 'other'] as const;
export type ActionFamily = (typeof ACTION_FAMILIES)[number];

/** Audit actions that are platform housekeeping, not usage. */
const NOT_USAGE = [/^auth\./, /^update_theme$/, /^impersonation_/, /^update_public_profile$/, /^regenerate_public_profile_slug$/];

const FAMILY_RULES: Array<[RegExp, ActionFamily]> = [
  [/export|^pdf\.generate$/, 'export'],
  [/\.brief$/, 'ai-brief'],
  [/^scenario\./, 'scenario'],
  [/^decision/, 'decision'],
  [/run_pipeline|^ingestion\.run_now$|refresh_/, 'pipeline'],
  [/upload$/, 'upload'],
];

export function actionFamily(action: string): ActionFamily | null {
  if (NOT_USAGE.some((r) => r.test(action))) return null;
  for (const [re, family] of FAMILY_RULES) if (re.test(action)) return family;
  return 'other';
}
```

Append to `packages/shared/src/usage/index.ts`:

```ts
export * from './sessions';
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/shared && npx vitest run test/usage-sessions.test.ts`
Expected: `Tests  9 passed (9)`.

- [ ] **Step 5: Commit**

```bash
cat > $S/u2.txt <<'EOF'
feat(usage): sessions, dwell and audit action families as pure functions

A session is a run of one user's views with no gap over 30 minutes; dwell is
the time to the next view inside a session. Both derived, never captured.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add packages/shared/src/usage packages/shared/test/usage-sessions.test.ts
git commit -F $S/u2.txt
```

---

### Task 3: Permissions

**Files:**
- Modify: `packages/shared/src/auth/permissions.ts` (the `PERMISSIONS` list near line 83; `UNIVERSITY_USER_PERMS` near line 161)
- Test: `packages/shared/test/usage-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/usage-permissions.test.ts
import { describe, expect, it } from 'vitest';
import { can } from '../src/auth';

const user = (role: string) => ({
  userId: 'u', email: 'u@kku.ac.th', name: null, role, facultyId: null, departmentId: null, programId: null,
}) as never;

describe('usage permissions', () => {
  it('aggregate: admin-grade and University users', () => {
    for (const r of ['SUPER_ADMIN', 'SYSTEM_ADMIN', 'UNIVERSITY_USER']) expect(can(user(r), 'usage:read:aggregate'), r).toBe(true);
    for (const r of ['FACULTY_USER', 'PROGRAM_USER']) expect(can(user(r), 'usage:read:aggregate'), r).toBe(false);
  });
  it('detail: admin-grade only — per-person browsing is sensitive', () => {
    for (const r of ['SUPER_ADMIN', 'SYSTEM_ADMIN']) expect(can(user(r), 'usage:read:detail'), r).toBe(true);
    for (const r of ['UNIVERSITY_USER', 'FACULTY_USER', 'PROGRAM_USER']) expect(can(user(r), 'usage:read:detail'), r).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/shared && npx vitest run test/usage-permissions.test.ts`
Expected: FAIL (TypeScript/`can` rejects the unknown permission, or returns false for UNIVERSITY_USER).

- [ ] **Step 3: Add the permissions**

In `PERMISSIONS`, after the `queues:manage` entry:

```ts
  // Platform usage — aggregate = counts by module / programme / role /
  // faculty, no names (leadership question); detail = the per-user access
  // log and timelines (admin question, PDPA-sensitive).
  'usage:read:aggregate',
  'usage:read:detail',
```

In `UNIVERSITY_USER_PERMS`, after `'institution:read:dashboard',`:

```ts
  'usage:read:aggregate',
```

`SYSTEM_ADMIN_PERMS` and `SUPER_ADMIN_PERMS` derive from `PERMISSIONS`, so admin-grade gets both automatically.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/shared && npx vitest run && npx tsc --noEmit -p .`
Expected: all pass (the existing RBAC matrix test still passes; if it enumerates permission counts, update the count).

- [ ] **Step 5: Commit**

```bash
cat > $S/u3.txt <<'EOF'
feat(auth): usage:read:aggregate and usage:read:detail permissions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add packages/shared/src/auth/permissions.ts packages/shared/test/usage-permissions.test.ts
git commit -F $S/u3.txt
```

---

### Task 4: Schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add models after `AiInference`; add `pageViews PageView[]` and `pageViewDays PageViewDaily[]` to `User` after `aiInferences AiInference[]`)
- Create: `packages/db/prisma/migrations/20260914100000_page_views/migration.sql`
- Test: `packages/db/test/page-view-schema.test.ts`

- [ ] **Step 1: Write the failing structural test**

```ts
// packages/db/test/page-view-schema.test.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The daily roll-up is what survives past 120 days. It must never grow a
// timestamp or an IP column — that would turn a count back into a browsing
// record. This reads schema.prisma so the guard holds without a DB.

const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
const model = (name: string) => {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1]!;
};

describe('PageViewDaily', () => {
  it('exists and maps to page_view_daily', () => {
    expect(model('PageViewDaily')).toContain('@@map("page_view_daily")');
  });
  it('has exactly one DateTime column — the DATE-typed day — and no IP column', () => {
    const body = model('PageViewDaily');
    expect((body.match(/DateTime/g) ?? []).length).toBe(1);
    expect(body).toMatch(/day\s+DateTime\s+@db\.Date/);
    expect(body).not.toMatch(/ipAddress|ip_address/);
  });
});

describe('PageView', () => {
  it('has no IP column and no raw URL column', () => {
    const body = model('PageView');
    expect(body).not.toMatch(/ipAddress|ip_address|rawUrl|url\s/);
    expect(body).toContain('@@map("page_views")');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/db && npx vitest run test/page-view-schema.test.ts`
Expected: FAIL — `model PageViewDaily not found`.

- [ ] **Step 3: Add the models**

Append after `model AiInference { … }`:

```prisma
/// One recorded page view. Written by POST /usage/page-views; identity comes
/// from the session, never the body. No IP, no raw URL, no query string.
/// Raw rows live 120 days (docs/pdpa.md) then roll up into PageViewDaily.
model PageView {
  id              String   @id @default(cuid())
  userId          String?  @map("user_id")
  /// Effective role at the time — under impersonation, the impersonated role.
  role            String
  impersonated    Boolean  @default(false)
  viewerFacultyId String?  @map("viewer_faculty_id")
  /// Normalised route pattern, e.g. /programs/[id].
  path            String
  module          String
  programId       String?  @map("program_id")
  facultyId       String?  @map("faculty_id")
  departmentId    String?  @map("department_id")
  createdAt       DateTime @default(now()) @map("created_at")

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([createdAt])
  @@index([userId, createdAt])
  @@index([programId, createdAt])
  @@index([module, createdAt])
  @@map("page_views")
}

/// Daily roll-up of PageView beyond 120 days, keyed by Asia/Bangkok day. Counts
/// only. A structural test forbids timestamp and IP columns here. The unique
/// index is NULLS NOT DISTINCT in the migration (Prisma cannot express it), so
/// upserts are idempotent on nullable key columns.
model PageViewDaily {
  id              String  @id @default(cuid())
  day             DateTime @db.Date
  userId          String? @map("user_id")
  role            String
  viewerFacultyId String? @map("viewer_faculty_id")
  module          String
  path            String
  programId       String? @map("program_id")
  facultyId       String? @map("faculty_id")
  views           Int     @default(0)
  sessions        Int     @default(0)
  signins         Int     @default(0)

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([day, userId, role, viewerFacultyId, module, path, programId, facultyId])
  @@index([day])
  @@index([userId, day])
  @@index([programId, day])
  @@map("page_view_daily")
}
```

In `model User`, after `aiInferences             AiInference[]`:

```prisma
  pageViews                PageView[]
  pageViewDays             PageViewDaily[]
```

- [ ] **Step 4: Write the migration**

```sql
-- packages/db/prisma/migrations/20260914100000_page_views/migration.sql
-- Page-view recording and its daily roll-up. Additive only.
--
-- Hand-written; no generated drift copied (see 20260913140000).
--
-- page_views holds raw views for 120 days (docs/pdpa.md). page_view_daily is
-- the roll-up beyond that: Asia/Bangkok day, counts only, no timestamps, no
-- IP. Its unique index is NULLS NOT DISTINCT so an upsert on a key with NULL
-- user/programme/faculty matches the existing row instead of inserting a
-- duplicate every night. Prisma cannot express NULLS NOT DISTINCT; the
-- schema declares the same columns with @@unique so the client is typed, and
-- a future `prisma migrate diff` will report this index as drift — expected.

CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "role" TEXT NOT NULL,
    "impersonated" BOOLEAN NOT NULL DEFAULT false,
    "viewer_faculty_id" TEXT,
    "path" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "program_id" TEXT,
    "faculty_id" TEXT,
    "department_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "page_views_created_at_idx" ON "page_views"("created_at");
CREATE INDEX "page_views_user_id_created_at_idx" ON "page_views"("user_id", "created_at");
CREATE INDEX "page_views_program_id_created_at_idx" ON "page_views"("program_id", "created_at");
CREATE INDEX "page_views_module_created_at_idx" ON "page_views"("module", "created_at");
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "page_view_daily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "user_id" TEXT,
    "role" TEXT NOT NULL,
    "viewer_faculty_id" TEXT,
    "module" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "program_id" TEXT,
    "faculty_id" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "signins" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "page_view_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "page_view_daily_key" ON "page_view_daily"
  ("day", "user_id", "role", "viewer_faculty_id", "module", "path", "program_id", "faculty_id")
  NULLS NOT DISTINCT;
CREATE INDEX "page_view_daily_day_idx" ON "page_view_daily"("day");
CREATE INDEX "page_view_daily_user_id_day_idx" ON "page_view_daily"("user_id", "day");
CREATE INDEX "page_view_daily_program_id_day_idx" ON "page_view_daily"("program_id", "day");
ALTER TABLE "page_view_daily" ADD CONSTRAINT "page_view_daily_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Lint, snapshot, apply, generate**

```bash
pnpm tsx scripts/migration-linter.ts packages/db/prisma/migrations/20260914100000_page_views/migration.sql
bash scripts/dev-guard/dev-backup.sh
cd packages/db && npx prisma migrate deploy && npx prisma generate && cd ../..
```

Expected: linter `0 unannotated destructive migration(s)`; migrate lists the new migration as applied; generate succeeds. Confirm the NULLS NOT DISTINCT index landed:

```bash
docker exec -i program-landscape-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select indexdef from pg_indexes where indexname='"'"'page_view_daily_key'"'"'"'
```
Expected: the definition ends with `NULLS NOT DISTINCT`.

- [ ] **Step 6: Run the structural test and db typecheck**

Run: `cd packages/db && npx vitest run test/page-view-schema.test.ts && npx tsc --noEmit -p .`
Expected: `Tests  4 passed`; tsc silent.

- [ ] **Step 7: Commit**

```bash
cat > $S/u4.txt <<'EOF'
feat(db): page_views and page_view_daily — page-view recording and its roll-up

Raw views for 120 days; counts only beyond that, keyed by Asia/Bangkok day.
No IP, no raw URL. The daily unique index is NULLS NOT DISTINCT so nightly
upserts are idempotent on nullable key columns; a structural test forbids
timestamp and IP columns on the daily table.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260914100000_page_views packages/db/test/page-view-schema.test.ts
git commit -F $S/u4.txt
```

---

### Task 5: `@kku/db` usage queries

**Files:**
- Create: `packages/db/src/usage.ts`
- Modify: `packages/db/src/index.ts` (add `export * from './usage';`)
- Test: `packages/db/test/usage-queries.test.ts`

This module has two pure parts that are unit-tested (`bangkokDay`, `windowFor`) and a set of Prisma queries built on one CTE. The queries are exercised by the API tests in Task 7 against mocked Prisma and by the manual dev check.

- [ ] **Step 1: Write the failing test for the pure parts**

```ts
// packages/db/test/usage-queries.test.ts
import { describe, expect, it } from 'vitest';
import { bangkokDay, windowFor, RAW_RETENTION_DAYS } from '../src/usage';

describe('bangkokDay', () => {
  it('buckets by Asia/Bangkok, not UTC', () => {
    // 2026-09-13 20:30 UTC is 2026-09-14 03:30 in Bangkok.
    expect(bangkokDay(new Date('2026-09-13T20:30:00Z'))).toBe('2026-09-14');
    expect(bangkokDay(new Date('2026-09-13T16:59:59Z'))).toBe('2026-09-13');
    expect(bangkokDay(new Date('2026-09-13T17:00:00Z'))).toBe('2026-09-14');
  });
});

describe('windowFor', () => {
  const now = new Date('2026-09-14T09:00:00Z');
  it('returns the current and previous windows of equal length', () => {
    const w = windowFor(7, now);
    expect(w.to).toEqual(now);
    expect((w.to.getTime() - w.from.getTime()) / 86_400_000).toBe(7);
    expect((w.from.getTime() - w.prevFrom.getTime()) / 86_400_000).toBe(7);
  });
  it('reports where roll-ups begin when the window is longer than raw retention', () => {
    expect(RAW_RETENTION_DAYS).toBe(120);
    expect(windowFor(30, now).rollupFrom).toBeNull();
    const w = windowFor(365, now);
    expect(w.rollupFrom).not.toBeNull();
    expect(bangkokDay(w.rollupFrom!)).toBe(bangkokDay(new Date(now.getTime() - 120 * 86_400_000)));
  });
  it('rejects unsupported windows', () => {
    expect(() => windowFor(45 as never, now)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/db && npx vitest run test/usage-queries.test.ts`
Expected: FAIL — cannot resolve `../src/usage`.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/usage.ts
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { actionFamily, groupSessions, medianDwellMs, normalisePath, type ActionFamily } from '@kku/shared/src/usage';
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Platform usage — recording and every read.
//
// ONE shape underlies every aggregate: `usage_days`, a CTE that unions
//   - raw page_views (last RAW_RETENTION_DAYS), bucketed to Asia/Bangkok days,
//     sessions derived by a window function (30-minute gap);
//   - page_view_daily roll-ups (older);
//   - audit_logs sign-ins, as module='signin' rows.
// Summary, modules, programmes, roles and faculties all group that CTE, so
// they cannot disagree with each other. Day bucketing is Bangkok everywhere:
// a 20:30 UTC view is the next Bangkok day.
//
// These tables never feed a Council-facing metric, so realDataWhere() does not
// apply and there is no ingestion_run_id — a deliberate decision recorded in
// the spec.
// ─────────────────────────────────────────────────────────────────────────────

export const RAW_RETENTION_DAYS = 120;
export const USAGE_WINDOWS = [7, 30, 90, 365] as const;
export type UsageWindowDays = (typeof USAGE_WINDOWS)[number];
export const ADMIN_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN'] as const;
const BKK = 'Asia/Bangkok';
const DAY_MS = 86_400_000;

const bkkFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BKK, year: 'numeric', month: '2-digit', day: '2-digit' });
/** YYYY-MM-DD in Asia/Bangkok. */
export function bangkokDay(at: Date): string {
  return bkkFormat.format(at);
}

export interface UsageWindow {
  days: UsageWindowDays;
  from: Date;
  to: Date;
  prevFrom: Date;
  /** First instant served from roll-ups, or null when the window is entirely raw. */
  rollupFrom: Date | null;
}
export function windowFor(days: UsageWindowDays, now = new Date()): UsageWindow {
  if (!(USAGE_WINDOWS as readonly number[]).includes(days)) throw new Error(`unsupported usage window: ${days}`);
  const from = new Date(now.getTime() - days * DAY_MS);
  const prevFrom = new Date(from.getTime() - days * DAY_MS);
  const rawFrom = new Date(now.getTime() - RAW_RETENTION_DAYS * DAY_MS);
  return { days, from, to: now, prevFrom, rollupFrom: from < rawFrom ? rawFrom : null };
}

// ── Recording ────────────────────────────────────────────────────────────

export interface RecordPageViewInput {
  userId: string;
  role: string;
  impersonated: boolean;
  viewerFacultyId: string | null;
  rawPath: string;
  scope?: 'university' | 'faculty' | 'department' | 'program';
  scopeId?: string | null;
  programId?: string | null;
}

export async function recordPageView(input: RecordPageViewInput): Promise<void> {
  const { path, module } = normalisePath(input.rawPath);
  const facultyId = input.scope === 'faculty' ? input.scopeId ?? null : null;
  const departmentId = input.scope === 'department' ? input.scopeId ?? null : null;
  const programId = input.programId ?? (input.scope === 'program' ? input.scopeId ?? null : null);
  await prisma.pageView.create({
    data: {
      userId: input.userId,
      role: input.role,
      impersonated: input.impersonated,
      viewerFacultyId: input.viewerFacultyId,
      path,
      module,
      programId,
      facultyId,
      departmentId,
    },
  });
}

// ── The shared CTE ───────────────────────────────────────────────────────

/**
 * `usage_days` — one row per (day, user, role, viewer faculty, module, path,
 * programme, faculty) with views, sessions, signins. Raw rows are bucketed
 * and sessionised here; daily rows pass through; sign-ins come from
 * audit_logs for the whole window (audit retention is 7 years).
 */
function usageDaysCte(w: UsageWindow, excludeAdmins: boolean, extra: Prisma.Sql = Prisma.empty): Prisma.Sql {
  const adminFilter = excludeAdmins ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty;
  const rawFrom = new Date(Math.max(w.from.getTime(), w.to.getTime() - RAW_RETENTION_DAYS * DAY_MS));
  return Prisma.sql`
    WITH raw AS (
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date AS day,
             user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, created_at,
             CASE WHEN created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) > interval '30 minutes'
                  OR LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) IS NULL THEN 1 ELSE 0 END AS session_start
      FROM page_views
      WHERE created_at >= ${rawFrom} AND created_at < ${w.to} AND impersonated = false ${adminFilter} ${extra}
    ),
    usage_days AS (
      SELECT day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id,
             COUNT(*)::int AS views, SUM(session_start)::int AS sessions, 0::int AS signins
      FROM raw GROUP BY 1,2,3,4,5,6,7,8
      UNION ALL
      SELECT day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, views, sessions, signins
      FROM page_view_daily
      WHERE day >= (${w.from} AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date
        AND day < (${rawFrom} AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date
        ${excludeAdmins ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty}
      UNION ALL
      SELECT (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date, a.user_id, u.role::text, u.faculty_id,
             'signin', '/signin', NULL, NULL, 0, 0, COUNT(*)::int
      FROM audit_logs a JOIN users u ON u.id = a.user_id
      WHERE a.action = 'auth.signin.ok' AND a.created_at >= ${rawFrom} AND a.created_at < ${w.to}
        ${excludeAdmins ? Prisma.sql`AND u.role::text NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty}
      GROUP BY 1,2,3,4
    )`;
}

const Int = z.coerce.number().int();
const Num = z.coerce.number();

// ── Summary ──────────────────────────────────────────────────────────────

const TotalsRow = z.object({ users: Int, views: Int, sessions: Int, signins: Int });
const DayRow = z.object({ day: z.string(), users: Int, signins: Int });

export interface UsageSummary {
  window: UsageWindow;
  recordedSince: string | null;
  current: { activeUsers: number; views: number; sessions: number; signins: number; aiCalls: number };
  previous: { activeUsers: number; views: number; sessions: number; signins: number; aiCalls: number };
  signinsToday: number;
  /** Last 30 Bangkok days, oldest first. */
  dailyActiveUsers: Array<{ day: string; users: number; signins: number }>;
}

async function totals(w: UsageWindow, excludeAdmins: boolean, from: Date, to: Date) {
  const sub = { ...w, from, to };
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(sub, excludeAdmins)}
    SELECT COUNT(DISTINCT user_id) FILTER (WHERE views > 0 OR signins > 0)::int AS users,
           COALESCE(SUM(views),0)::int AS views, COALESCE(SUM(sessions),0)::int AS sessions, COALESCE(SUM(signins),0)::int AS signins
    FROM usage_days`);
  return TotalsRow.parse(rows[0] ?? {});
}

export async function usageSummary(days: UsageWindowDays, excludeAdmins: boolean, now = new Date()): Promise<UsageSummary> {
  const w = windowFor(days, now);
  const adminWhere = excludeAdmins ? { user: { role: { notIn: [...ADMIN_ROLES] } } } : {};
  const [cur, prev, aiCur, aiPrev, first, todayRows, dau] = await Promise.all([
    totals(w, excludeAdmins, w.from, w.to),
    totals(w, excludeAdmins, w.prevFrom, w.from),
    prisma.aiInference.count({ where: { createdAt: { gte: w.from, lt: w.to }, ...adminWhere } }),
    prisma.aiInference.count({ where: { createdAt: { gte: w.prevFrom, lt: w.from }, ...adminWhere } }),
    prisma.pageView.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    prisma.$queryRaw<unknown[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM audit_logs a JOIN users u ON u.id=a.user_id
      WHERE a.action='auth.signin.ok' AND (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date = (${now} AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date
      ${excludeAdmins ? Prisma.sql`AND u.role::text NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty}`),
    prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(windowFor(30, now), excludeAdmins)}
      SELECT day::text AS day, COUNT(DISTINCT user_id) FILTER (WHERE views > 0)::int AS users, COALESCE(SUM(signins),0)::int AS signins
      FROM usage_days GROUP BY day ORDER BY day`),
  ]);
  return {
    window: w,
    recordedSince: first ? bangkokDay(first.createdAt) : null,
    current: { activeUsers: cur.users, views: cur.views, sessions: cur.sessions, signins: cur.signins, aiCalls: aiCur },
    previous: { activeUsers: prev.users, views: prev.views, sessions: prev.sessions, signins: prev.signins, aiCalls: aiPrev },
    signinsToday: z.object({ n: Int }).parse(todayRows[0] ?? { n: 0 }).n,
    dailyActiveUsers: z.array(DayRow).parse(dau),
  };
}

// ── Modules ──────────────────────────────────────────────────────────────

const ModuleRow = z.object({ module: z.string(), views: Int, users: Int, sessions: Int });
const DwellRow = z.object({ module: z.string(), median_ms: Num.nullable() });

export interface ModuleUsage { module: string; views: number; users: number; sessions: number; medianDwellMs: number | null }

export async function usageByModule(days: UsageWindowDays, excludeAdmins: boolean, now = new Date()): Promise<ModuleUsage[]> {
  const w = windowFor(days, now);
  const [rows, dwell] = await Promise.all([
    prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
      SELECT module, SUM(views)::int AS views, COUNT(DISTINCT user_id)::int AS users, SUM(sessions)::int AS sessions
      FROM usage_days WHERE module <> 'signin' GROUP BY module ORDER BY views DESC`),
    // Dwell needs timestamps, so raw rows only (the last RAW_RETENTION_DAYS).
    prisma.$queryRaw<unknown[]>(Prisma.sql`
      WITH v AS (
        SELECT module, user_id, created_at,
               LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS next_at
        FROM page_views WHERE created_at >= ${w.from} AND created_at < ${w.to} AND impersonated = false
        ${excludeAdmins ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty})
      SELECT module, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (next_at - created_at)) * 1000) AS median_ms
      FROM v WHERE next_at IS NOT NULL AND next_at - created_at <= interval '30 minutes' GROUP BY module`),
  ]);
  const dwellBy = new Map(z.array(DwellRow).parse(dwell).map((d) => [d.module, d.median_ms]));
  return z.array(ModuleRow).parse(rows).map((r) => ({ ...r, medianDwellMs: dwellBy.get(r.module) ?? null }));
}

// ── Programmes, roles, faculties ─────────────────────────────────────────

const ProgramRow = z.object({ program_id: z.string(), code: z.string().nullable(), name_en: z.string().nullable(), name_th: z.string().nullable(), faculty_th: z.string().nullable(), views: Int, users: Int });
export interface ProgramUsage { programId: string; code: string | null; nameEn: string | null; nameTh: string | null; facultyTh: string | null; views: number; users: number }

export async function usageByProgram(days: UsageWindowDays, excludeAdmins: boolean, facultyId: string | null, now = new Date(), limit = 50): Promise<ProgramUsage[]> {
  const w = windowFor(days, now);
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
    SELECT d.program_id, p.code, p.name_en, p.name_th, f.name_th AS faculty_th,
           SUM(d.views)::int AS views, COUNT(DISTINCT d.user_id)::int AS users
    FROM usage_days d
    LEFT JOIN programs p ON p.id = d.program_id
    LEFT JOIN faculties f ON f.id = p.faculty_id
    WHERE d.program_id IS NOT NULL ${facultyId ? Prisma.sql`AND p.faculty_id = ${facultyId}` : Prisma.empty}
    GROUP BY 1,2,3,4,5 ORDER BY views DESC LIMIT ${limit}`);
  return z.array(ProgramRow).parse(rows).map((r) => ({ programId: r.program_id, code: r.code, nameEn: r.name_en, nameTh: r.name_th, facultyTh: r.faculty_th, views: r.views, users: r.users }));
}

const RoleRow = z.object({ role: z.string(), users: Int, views: Int, sessions: Int, signins: Int });
export async function usageByRole(days: UsageWindowDays, excludeAdmins: boolean, now = new Date()) {
  const w = windowFor(days, now);
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
    SELECT role, COUNT(DISTINCT user_id)::int AS users, SUM(views)::int AS views, SUM(sessions)::int AS sessions, SUM(signins)::int AS signins
    FROM usage_days GROUP BY role ORDER BY views DESC`);
  return z.array(RoleRow).parse(rows);
}

const FacultyRow = z.object({ faculty_id: z.string().nullable(), name_th: z.string().nullable(), name_en: z.string().nullable(), users: Int, views: Int });
export async function usageByViewerFaculty(days: UsageWindowDays, excludeAdmins: boolean, now = new Date()) {
  const w = windowFor(days, now);
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
    SELECT d.viewer_faculty_id AS faculty_id, f.name_th, f.name_en, COUNT(DISTINCT d.user_id)::int AS users, SUM(d.views)::int AS views
    FROM usage_days d LEFT JOIN faculties f ON f.id = d.viewer_faculty_id
    WHERE d.module <> 'signin' GROUP BY 1,2,3 ORDER BY views DESC`);
  return z.array(FacultyRow).parse(rows).map((r) => ({ facultyId: r.faculty_id, nameTh: r.name_th, nameEn: r.name_en, users: r.users, views: r.views }));
}

// ── Actions (audit_logs) ─────────────────────────────────────────────────

export interface ActionUsage { family: ActionFamily; count: number; users: number }
export async function usageActions(days: UsageWindowDays, excludeAdmins: boolean, now = new Date()): Promise<ActionUsage[]> {
  const w = windowFor(days, now);
  const rows = await prisma.auditLog.findMany({
    where: { createdAt: { gte: w.from, lt: w.to }, ...(excludeAdmins ? { user: { role: { notIn: [...ADMIN_ROLES] } } } : {}) },
    select: { action: true, userId: true },
  });
  const acc = new Map<ActionFamily, { count: number; users: Set<string> }>();
  for (const r of rows) {
    const fam = actionFamily(r.action);
    if (!fam) continue;
    const e = acc.get(fam) ?? { count: 0, users: new Set<string>() };
    e.count += 1;
    if (r.userId) e.users.add(r.userId);
    acc.set(fam, e);
  }
  return [...acc.entries()].map(([family, e]) => ({ family, count: e.count, users: e.users.size })).sort((a, b) => b.count - a.count);
}

// ── Detail (admin-grade only) ────────────────────────────────────────────

const UserRow = z.object({ user_id: z.string(), name: z.string().nullable(), email: z.string(), role: z.string(), faculty_th: z.string().nullable(), last_seen: z.date().nullable(), views: Int, sessions: Int, signins: Int });
export interface UserUsageRow { userId: string; name: string | null; email: string; role: string; facultyTh: string | null; lastSeen: Date | null; views: number; sessions: number; signins: number; actions: number }

export async function usageUsers(days: UsageWindowDays, excludeAdmins: boolean, q: string | null, now = new Date()): Promise<UserUsageRow[]> {
  const w = windowFor(days, now);
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
    SELECT u.id AS user_id, u.name, u.email, u.role::text AS role, f.name_th AS faculty_th,
           (SELECT MAX(created_at) FROM page_views pv WHERE pv.user_id = u.id) AS last_seen,
           COALESCE(SUM(d.views),0)::int AS views, COALESCE(SUM(d.sessions),0)::int AS sessions, COALESCE(SUM(d.signins),0)::int AS signins
    FROM usage_days d JOIN users u ON u.id = d.user_id LEFT JOIN faculties f ON f.id = u.faculty_id
    ${q ? Prisma.sql`WHERE (u.name ILIKE ${'%' + q + '%'} OR u.email ILIKE ${'%' + q + '%'})` : Prisma.empty}
    GROUP BY u.id, u.name, u.email, u.role, f.name_th ORDER BY views DESC LIMIT 500`);
  const users = z.array(UserRow).parse(rows);
  const actions = await prisma.auditLog.groupBy({
    by: ['userId'], where: { createdAt: { gte: w.from, lt: w.to }, userId: { in: users.map((u) => u.user_id) } }, _count: { _all: true },
  });
  const actionsBy = new Map(actions.map((a) => [a.userId, a._count._all]));
  return users.map((u) => ({ userId: u.user_id, name: u.name, email: u.email, role: u.role, facultyTh: u.faculty_th, lastSeen: u.last_seen, views: u.views, sessions: u.sessions, signins: u.signins, actions: actionsBy.get(u.user_id) ?? 0 }));
}

export interface TimelineEvent { at: Date; kind: 'view' | 'signin' | 'action'; label: string; path?: string; programId?: string | null; action?: string }
export interface UserTimeline { user: { id: string; name: string | null; email: string; role: string }; days: Array<{ day: string; sessions: Array<{ startedAt: Date; endedAt: Date; events: TimelineEvent[] }> }> }

const PATH_LABEL: Record<string, string> = {
  '/': 'Home', '/cockpit': 'Portfolio Cockpit', '/programs/[id]': 'Program Deep-Dive', '/programs/[id]/print': 'Program Deep-Dive · print',
  '/gap-analysis': 'Gap Analyzer', '/benchmarking': 'Benchmarking', '/scenarios': 'Scenarios', '/decisions': 'Decisions',
  '/analyst': 'AI Analyst', '/trends': 'Trends Radar', '/skills': 'Skills', '/usage': 'Platform usage', '/docs/methodology': 'Methodology',
};
function labelFor(path: string, programName: string | null): string {
  const base = PATH_LABEL[path] ?? path;
  return programName ? `${base} · ${programName}` : base;
}

export async function usageUserTimeline(userId: string, days: UsageWindowDays, now = new Date()): Promise<UserTimeline | null> {
  const w = windowFor(days, now);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } });
  if (!user) return null;
  const [views, audits] = await Promise.all([
    prisma.pageView.findMany({ where: { userId, createdAt: { gte: w.from, lt: w.to } }, select: { createdAt: true, path: true, programId: true }, orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({ where: { userId, createdAt: { gte: w.from, lt: w.to } }, select: { createdAt: true, action: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const programIds = [...new Set(views.map((v) => v.programId).filter((x): x is string => !!x))];
  const programs = programIds.length ? await prisma.program.findMany({ where: { id: { in: programIds } }, select: { id: true, nameEn: true, nameTh: true } }) : [];
  const nameBy = new Map(programs.map((p) => [p.id, p.nameEn ?? p.nameTh]));

  const events: TimelineEvent[] = [
    ...views.map((v) => ({ at: v.createdAt, kind: 'view' as const, label: labelFor(v.path, v.programId ? nameBy.get(v.programId) ?? null : null), path: v.path, programId: v.programId })),
    ...audits.map((a) => ({ at: a.createdAt, kind: a.action === 'auth.signin.ok' ? ('signin' as const) : ('action' as const), label: a.action === 'auth.signin.ok' ? 'Signed in' : a.action, action: a.action })).filter((e) => e.kind === 'signin' || actionFamily(e.action!) !== null),
  ];
  const sessions = groupSessions(events.map((e) => ({ ...e, path: e.path ?? e.label })));
  const byDay = new Map<string, UserTimeline['days'][number]['sessions']>();
  for (const s of sessions) {
    const day = bangkokDay(s.startedAt);
    const list = byDay.get(day) ?? [];
    list.push({ startedAt: s.startedAt, endedAt: s.endedAt, events: s.views as TimelineEvent[] });
    byDay.set(day, list);
  }
  return { user: { ...user, role: String(user.role) }, days: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, sessions]) => ({ day, sessions })) };
}

export async function usageProgramViewers(programId: string, days: UsageWindowDays, now = new Date()) {
  const w = windowFor(days, now);
  const rows = await prisma.pageView.groupBy({
    by: ['userId'], where: { programId, createdAt: { gte: w.from, lt: w.to }, impersonated: false, userId: { not: null } },
    _count: { _all: true }, _max: { createdAt: true },
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId!).filter(Boolean) } }, select: { id: true, name: true, email: true, role: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ userId: r.userId!, name: by.get(r.userId!)?.name ?? null, email: by.get(r.userId!)?.email ?? '', role: String(by.get(r.userId!)?.role ?? ''), views: r._count._all, lastSeen: r._max.createdAt })).sort((a, b) => b.views - a.views);
}

/** Median dwell across the whole window, for the summary strip caveat. Raw rows only. */
export async function usageMedianDwell(days: UsageWindowDays, excludeAdmins: boolean, now = new Date()): Promise<number | null> {
  const w = windowFor(days, now);
  const rows = await prisma.pageView.findMany({ where: { createdAt: { gte: w.from, lt: w.to }, impersonated: false, ...(excludeAdmins ? { role: { notIn: [...ADMIN_ROLES] } } : {}) }, select: { userId: true, createdAt: true, path: true }, orderBy: { createdAt: 'asc' }, take: 200_000 });
  const byUser = new Map<string, Array<{ at: Date; path: string }>>();
  for (const r of rows) { const k = r.userId ?? ''; const l = byUser.get(k) ?? []; l.push({ at: r.createdAt, path: r.path }); byUser.set(k, l); }
  const sessions = [...byUser.values()].flatMap((v) => groupSessions(v));
  return medianDwellMs(sessions);
}
```

Add to `packages/db/src/index.ts` after the `demand-match-sources` export:

```ts
export * from './usage';
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd packages/db && npx vitest run test/usage-queries.test.ts && npx tsc --noEmit -p .`
Expected: `Tests  5 passed`; tsc silent. If `@kku/shared/src/usage` fails to resolve from `@kku/db`, check how `packages/db/src/jobthai-bridge.ts` imports `@kku/shared/src/jobthai` and match it.

- [ ] **Step 5: Smoke the CTE against the dev DB (it has no page views yet, so counts are zero — the point is that the SQL parses)**

```bash
cat > apps/ingestion/src/scripts/_probe-usage.ts <<'EOF'
import 'dotenv/config';
import { prisma, usageSummary, usageByModule, usageByProgram, usageByRole, usageByViewerFaculty, usageActions } from '@kku/db';
async function main() {
  console.log(JSON.stringify(await usageSummary(30, true)).slice(0, 400));
  console.log((await usageByModule(30, true)).length, (await usageByProgram(30, true, null)).length, (await usageByRole(30, true)).length, (await usageByViewerFaculty(30, true)).length, (await usageActions(30, true)).length);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
EOF
pnpm tsx apps/ingestion/src/scripts/_probe-usage.ts; rm apps/ingestion/src/scripts/_probe-usage.ts
```

Expected: a summary JSON with `signins` > 0 (sign-ins exist since April) and `dailyActiveUsers` of up to 30 days; no SQL error. (`dotenv/config` works under tsx on dev; the probe is deleted afterwards and never bundled.)

- [ ] **Step 6: Commit**

```bash
cat > $S/u5.txt <<'EOF'
feat(db): usage queries over one usage_days CTE

recordPageView, summary, by module / programme / role / viewer faculty,
audit actions, per-user table and timeline, programme viewers. Every
aggregate groups the same CTE (raw views bucketed to Asia/Bangkok days and
sessionised by window function, daily roll-ups, audit sign-ins), so they
cannot disagree. Rows validated with Zod per the $queryRaw rule.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add packages/db/src/usage.ts packages/db/src/index.ts packages/db/test/usage-queries.test.ts
git commit -F $S/u5.txt
```

---

### Task 6: Retention rule — roll up, then delete

**Files:**
- Create: `packages/db/src/usage-retention.ts`
- Modify: `packages/db/src/retention.ts` (add `pageViewRawRetention` to windows/cutoffs; call the rule), `scripts/pdpa/retention-sweep.ts` (print the new counts)
- Test: `packages/db/test/usage-retention.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/test/usage-retention.test.ts
import { describe, expect, it, vi } from 'vitest';
import { planRollupDays, rollupPageViews } from '../src/usage-retention';

describe('planRollupDays', () => {
  it('lists every Bangkok day strictly older than the cutoff that still has raw rows', () => {
    const cutoff = new Date('2026-09-14T00:00:00Z'); // now - 120d, say
    const days = planRollupDays(['2026-05-10', '2026-05-11', '2026-09-14', '2026-09-15'], cutoff);
    expect(days).toEqual(['2026-05-10', '2026-05-11']);
  });
  it('is empty when nothing is old enough', () => {
    expect(planRollupDays(['2026-09-14'], new Date('2026-09-14T00:00:00Z'))).toEqual([]);
  });
});

describe('rollupPageViews', () => {
  function fakeClient(days: string[]) {
    const calls: string[] = [];
    const client = {
      $queryRaw: vi.fn(async () => days.map((day) => ({ day }))),
      $executeRaw: vi.fn(async (q: { strings?: string[] }) => { calls.push((q.strings ?? []).join('?')); return 1; }),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    };
    return { client, calls };
  }
  it('upserts a day into page_view_daily BEFORE deleting its raw rows, one transaction per day', async () => {
    const { client, calls } = fakeClient(['2026-05-10', '2026-05-11']);
    const r = await rollupPageViews({ prisma: client as never, cutoff: new Date('2026-09-14T00:00:00Z'), dryRun: false });
    expect(r.daysRolledUp).toBe(2);
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    // For each day: INSERT ... ON CONFLICT, then DELETE. Never the reverse.
    const kinds = calls.map((c) => (/INSERT INTO "?page_view_daily/i.test(c) ? 'insert' : /DELETE FROM "?page_views/i.test(c) ? 'delete' : 'other'));
    expect(kinds).toEqual(['insert', 'delete', 'insert', 'delete']);
  });
  it('dry run touches nothing', async () => {
    const { client } = fakeClient(['2026-05-10']);
    const r = await rollupPageViews({ prisma: client as never, cutoff: new Date('2026-09-14T00:00:00Z'), dryRun: true });
    expect(r.daysRolledUp).toBe(1);
    expect(client.$executeRaw).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/db && npx vitest run test/usage-retention.test.ts`
Expected: FAIL — cannot resolve `../src/usage-retention`.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/usage-retention.ts
import { Prisma } from '@prisma/client';
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// page_views retention: roll a Bangkok day into page_view_daily, THEN delete
// its raw rows, one transaction per day. Idempotent — the daily unique index
// is NULLS NOT DISTINCT and the INSERT is ON CONFLICT DO UPDATE, so re-running
// after a crash rewrites the same counts. Sign-ins for the day are rolled up
// too (module='signin'), so a sign-in trend survives audit_logs retention.
// ─────────────────────────────────────────────────────────────────────────────

const BKK = 'Asia/Bangkok';

/** Minimum Prisma surface, so tests inject a fake. */
export interface RollupPrismaLike {
  $queryRaw(query: Prisma.Sql): Promise<unknown>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
  $transaction<T>(fn: (tx: RollupPrismaLike) => Promise<T>): Promise<T>;
}

/** Days (YYYY-MM-DD, Bangkok) strictly before the cutoff's Bangkok day. */
export function planRollupDays(candidateDays: ReadonlyArray<string>, cutoff: Date): string[] {
  const cutoffDay = new Intl.DateTimeFormat('en-CA', { timeZone: BKK, year: 'numeric', month: '2-digit', day: '2-digit' }).format(cutoff);
  return [...candidateDays].filter((d) => d < cutoffDay).sort();
}

const DayRows = z.array(z.object({ day: z.string() }));

export interface RollupResult { daysRolledUp: number; days: string[]; dryRun: boolean }

export async function rollupPageViews(opts: { prisma: RollupPrismaLike; cutoff: Date; dryRun: boolean }): Promise<RollupResult> {
  const raw = await opts.prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date::text AS day
    FROM page_views WHERE created_at < ${opts.cutoff} ORDER BY 1`);
  const days = planRollupDays(DayRows.parse(raw).map((r) => r.day), opts.cutoff);
  if (opts.dryRun) return { daysRolledUp: days.length, days, dryRun: true };

  for (const day of days) {
    await opts.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO page_view_daily (id, day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, views, sessions, signins)
        SELECT md5(random()::text || clock_timestamp()::text), x.day, x.user_id, x.role, x.viewer_faculty_id, x.module, x.path, x.program_id, x.faculty_id, x.views, x.sessions, x.signins
        FROM (
          WITH raw AS (
            SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date AS day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id,
                   CASE WHEN created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) > interval '30 minutes'
                        OR LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) IS NULL THEN 1 ELSE 0 END AS session_start
            FROM page_views WHERE impersonated = false
              AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date = ${day}::date)
          SELECT day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, COUNT(*)::int AS views, SUM(session_start)::int AS sessions, 0 AS signins
          FROM raw GROUP BY 1,2,3,4,5,6,7,8
          UNION ALL
          SELECT ${day}::date, a.user_id, u.role::text, u.faculty_id, 'signin', '/signin', NULL, NULL, 0, 0, COUNT(*)::int
          FROM audit_logs a JOIN users u ON u.id = a.user_id
          WHERE a.action = 'auth.signin.ok' AND (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date = ${day}::date
          GROUP BY 2,3,4
        ) x
        ON CONFLICT (day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id)
        DO UPDATE SET views = EXCLUDED.views, sessions = EXCLUDED.sessions, signins = EXCLUDED.signins`);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM page_views WHERE (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date = ${day}::date`);
    });
  }
  return { daysRolledUp: days.length, days, dryRun: false };
}
```

- [ ] **Step 4: Wire into the sweep**

In `packages/db/src/retention.ts`:
- `RetentionWindowsDays` gains `/** Roll page_views into page_view_daily, then delete, past this many days. */ pageViewRawRetention: number;` and `DEFAULT_WINDOWS` gains `pageViewRawRetention: 120,`.
- `RetentionCutoffs` gains `pageViewRollupBefore: Date;` computed as `new Date(now.getTime() - ms(windows.pageViewRawRetention))`.
- `RetentionPrismaLike` gains the three members of `RollupPrismaLike` (`$queryRaw`, `$executeRaw`, `$transaction`) — import the type from `./usage-retention`.
- `RetentionResult` gains `pageViewDaysRolledUp: number;`.
- In `runRetentionSweep`, dry-run branch: add `pageViewDaysRolledUp: 0`. After step 4 (Scholar), add:

```ts
  // 5. Page views: roll each Bangkok day older than the window into
  //    page_view_daily, then delete its raw rows. See usage-retention.ts.
  const pageViewDaysRolledUp = (
    await rollupPageViews({ prisma, cutoff: cutoffs.pageViewRollupBefore, dryRun: false })
  ).daysRolledUp;
```

and include it in the returned object.

In `scripts/pdpa/retention-sweep.ts`, where the result is printed, add a line `page views rolled up: <n> day(s)`; in the dry-run branch call `rollupPageViews({ prisma, cutoff, dryRun: true })` and print the days it would roll.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd packages/db && npx vitest run test/usage-retention.test.ts test/retention*.test.ts && npx tsc --noEmit -p .`
Expected: new tests pass; any existing retention test that constructs a `RetentionPrismaLike` fake needs the three new members added (`$queryRaw: async () => []`, `$executeRaw: async () => 0`, `$transaction: async (fn) => fn(fake)`), and any that snapshot `DEFAULT_WINDOWS`/result shape gains the new field.

- [ ] **Step 6: Dry-run the sweep on dev**

Run: `pnpm tsx scripts/pdpa/retention-sweep.ts --dry-run`
Expected: prints the existing rule counts plus `page views rolled up: 0 day(s)` (no raw rows yet).

- [ ] **Step 7: Commit**

```bash
cat > $S/u6.txt <<'EOF'
feat(db): page-view retention — roll each Bangkok day up, then delete it

One transaction per day: INSERT ... ON CONFLICT into page_view_daily (views,
sessions, and that day's sign-ins), then DELETE the raw rows. A test asserts
the order and that dry-run writes nothing. Wired into the PDPA sweep as rule 5.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add packages/db/src/usage-retention.ts packages/db/src/retention.ts packages/db/test/usage-retention.test.ts scripts/pdpa/retention-sweep.ts
git commit -F $S/u6.txt
```

---

### Task 7: API — `UsageModule`

**Files:**
- Create: `apps/api/src/usage/usage.module.ts`, `apps/api/src/usage/usage.controller.ts`, `apps/api/src/usage/usage.service.ts`
- Modify: `apps/api/src/app.module.ts` (import + register, next to `JobThaiModule`)
- Test: `apps/api/test/usage.controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/usage.controller.test.ts
import { describe, expect, it, vi } from 'vitest';
import { UsageController } from '../src/usage/usage.controller';
import type { UsageService } from '../src/usage/usage.service';

// Identity comes from the session, never the body; the body only ever
// carries what the browser saw. These are unit tests around the controller
// with a stubbed service — permission gating is asserted separately via
// can() in packages/shared, and the decorators are asserted by reflection.

const user = { userId: 'u1', role: 'FACULTY_USER', facultyId: 'f1', departmentId: null, programId: null, email: 'x@kku.ac.th', name: null } as never;

describe('UsageController.recordPageView', () => {
  it('ignores identity fields in the body and passes the session identity', async () => {
    const record = vi.fn(async () => undefined);
    const c = new UsageController({ record } as unknown as UsageService);
    await c.recordPageView({ path: '/programs/cmtzdam3m0001fd72f65igks4', userId: 'attacker', role: 'SUPER_ADMIN' } as never, user, { header: () => undefined, cookies: {} } as never);
    expect(record).toHaveBeenCalledTimes(1);
    const arg = (record.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg.userId).toBe('u1');
    expect(arg.role).toBe('FACULTY_USER');
    expect(arg.viewerFacultyId).toBe('f1');
    expect(arg.impersonated).toBe(false);
    expect(arg.rawPath).toBe('/programs/cmtzdam3m0001fd72f65igks4');
  });

  it('marks the view impersonated when the request carries the impersonation cookie', async () => {
    const record = vi.fn(async () => undefined);
    const c = new UsageController({ record } as unknown as UsageService);
    await c.recordPageView({ path: '/cockpit' } as never, { ...user, role: 'UNIVERSITY_USER' }, { header: () => undefined, cookies: { 'kku-impersonate': 'x' } } as never);
    expect((record.mock.calls[0] as unknown as [Record<string, unknown>])[0].impersonated).toBe(true);
  });

  it('never throws to the client when the write fails', async () => {
    const c = new UsageController({ record: vi.fn(async () => { throw new Error('db down'); }) } as unknown as UsageService);
    await expect(c.recordPageView({ path: '/cockpit' } as never, user, { header: () => undefined, cookies: {} } as never)).resolves.toBeUndefined();
  });
});

describe('UsageController permissions (by reflection)', () => {
  const perm = (method: string) => Reflect.getMetadata('kku:permission', UsageController.prototype[method as keyof UsageController]);
  it('aggregate endpoints require usage:read:aggregate', () => {
    for (const m of ['summary', 'modules', 'programs', 'roles', 'faculties', 'actions']) expect(perm(m), m).toBe('usage:read:aggregate');
  });
  it('detail endpoints require usage:read:detail', () => {
    for (const m of ['users', 'userTimeline', 'programViewers']) expect(perm(m), m).toBe('usage:read:detail');
  });
  it('the beacon endpoint is throttled at 60/min on the default bucket', () => {
    // @nestjs/throttler stores its options under this key; the per-route
    // override is what keeps a runaway tab from writing unbounded rows.
    const opts = Reflect.getMetadata('THROTTLER:OPTIONS', UsageController.prototype.recordPageView) as Record<string, { limit: number; ttl: number }> | undefined;
    expect(opts?.default).toEqual({ limit: 60, ttl: 60_000 });
  });
});
```

Check the metadata key `Authorized`/`RequirePermission` uses in `apps/api/src/common/decorators.ts` (`grep -n "SetMetadata(" apps/api/src/common/decorators.ts`) and use that constant instead of the literal `'kku:permission'` if it differs.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && npx vitest run test/usage.controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// apps/api/src/usage/usage.service.ts
import { Injectable } from '@nestjs/common';
import {
  recordPageView, usageSummary, usageByModule, usageByProgram, usageByRole, usageByViewerFaculty,
  usageActions, usageUsers, usageUserTimeline, usageProgramViewers, usageMedianDwell,
  type RecordPageViewInput, type UsageWindowDays,
} from '@kku/db';
import { CacheService } from '../common/cache.service';

const AGG_TTL_S = 300;

@Injectable()
export class UsageService {
  constructor(private readonly cache: CacheService) {}

  record(input: RecordPageViewInput): Promise<void> {
    return recordPageView(input);
  }

  private cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    return this.cache.get<T>(key).then(async (hit) => {
      if (hit !== undefined) return hit;
      const v = await compute();
      await this.cache.set(key, v, AGG_TTL_S);
      return v;
    });
  }

  summary(days: UsageWindowDays, excludeAdmins: boolean) {
    return this.cached(`usage:summary:${days}:${excludeAdmins}`, async () => ({
      ...(await usageSummary(days, excludeAdmins)),
      medianDwellMs: await usageMedianDwell(days, excludeAdmins),
    }));
  }
  modules(days: UsageWindowDays, excludeAdmins: boolean) { return this.cached(`usage:modules:${days}:${excludeAdmins}`, () => usageByModule(days, excludeAdmins)); }
  programs(days: UsageWindowDays, excludeAdmins: boolean, facultyId: string | null) { return this.cached(`usage:programs:${days}:${excludeAdmins}:${facultyId ?? ''}`, () => usageByProgram(days, excludeAdmins, facultyId)); }
  roles(days: UsageWindowDays, excludeAdmins: boolean) { return this.cached(`usage:roles:${days}:${excludeAdmins}`, () => usageByRole(days, excludeAdmins)); }
  faculties(days: UsageWindowDays, excludeAdmins: boolean) { return this.cached(`usage:faculties:${days}:${excludeAdmins}`, () => usageByViewerFaculty(days, excludeAdmins)); }
  actions(days: UsageWindowDays, excludeAdmins: boolean) { return this.cached(`usage:actions:${days}:${excludeAdmins}`, () => usageActions(days, excludeAdmins)); }
  // Detail is never cached.
  users(days: UsageWindowDays, excludeAdmins: boolean, q: string | null) { return usageUsers(days, excludeAdmins, q); }
  userTimeline(userId: string, days: UsageWindowDays) { return usageUserTimeline(userId, days); }
  programViewers(programId: string, days: UsageWindowDays) { return usageProgramViewers(programId, days); }
}
```

- [ ] **Step 4: Implement the controller**

```ts
// apps/api/src/usage/usage.controller.ts
import { Body, Controller, Get, HttpCode, Logger, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ApiError, IMPERSONATION_COOKIE, type SessionUser } from '@kku/shared';
import { USAGE_WINDOWS, RAW_RETENTION_DAYS } from '@kku/db';

import { AuthSession, Authorized, Provenance, ZodValidationPipe } from '../common';
import { UsageService } from './usage.service';

// ─────────────────────────────────────────────────────────────────────────────
// Platform usage.
//
// POST /usage/page-views   — the browser beacon. Identity from the session,
//                            never the body. 204. NOT @AuditLog: a view is
//                            not a mutation, and auditing it would write two
//                            rows per view.
// GET  /usage/*            — aggregate (usage:read:aggregate) and detail
//                            (usage:read:detail) reads. Aggregate responses
//                            carry no user ids or names.
// ─────────────────────────────────────────────────────────────────────────────

const PageViewBody = z.object({
  path: z.string().min(1).max(512),
  scope: z.enum(['university', 'faculty', 'department', 'program']).optional(),
  scopeId: z.string().max(64).optional().nullable(),
  programId: z.string().max(64).optional().nullable(),
});

const WindowQuery = z.object({
  days: z.coerce.number().refine((d): d is (typeof USAGE_WINDOWS)[number] => (USAGE_WINDOWS as readonly number[]).includes(d)).default(30),
  excludeAdmins: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  facultyId: z.string().optional(),
  q: z.string().max(80).optional(),
});
type WindowQueryT = z.infer<typeof WindowQuery>;

const USAGE_SOURCES = [
  { id: 'page_views', name: 'Page views recorded in-app' },
  { id: 'audit_logs', name: 'Sign-ins and actions from the audit log' },
];
const USAGE_CAVEATS = [
  `Raw page views are kept ${RAW_RETENTION_DAYS} days, then rolled up to daily counts per user and page (Asia/Bangkok days).`,
  'A session is a run of views with no gap over 30 minutes; dwell is the time to the next view and excludes the last view of a session.',
  'Admin-grade accounts are excluded by default (excludeAdmins=true); impersonated sessions are never counted.',
];

/** True when the request carries an impersonation override (cookie or header). */
function isImpersonated(req: Request): boolean {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
  return Boolean(req.header('x-kku-impersonate') ?? cookies[IMPERSONATION_COOKIE]);
}

@Controller('/usage')
export class UsageController {
  private readonly logger = new Logger(UsageController.name);
  constructor(private readonly service: UsageService) {}

  @Post('page-views')
  @HttpCode(204)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async recordPageView(
    @Body(new ZodValidationPipe(PageViewBody)) body: z.infer<typeof PageViewBody>,
    @AuthSession() user: SessionUser,
    @Req() req: Request,
  ): Promise<void> {
    try {
      await this.service.record({
        userId: user.userId,
        role: user.role,
        impersonated: isImpersonated(req),
        viewerFacultyId: user.facultyId ?? null,
        rawPath: body.path,
        scope: body.scope,
        scopeId: body.scopeId ?? null,
        programId: body.programId ?? null,
      });
    } catch (e) {
      // Recording must never break a page.
      this.logger.warn(`page view not recorded: ${(e as Error).message}`);
    }
  }

  @Get('summary') @Authorized('usage:read:aggregate') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  summary(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.summary(q.days, q.excludeAdmins); }

  @Get('modules') @Authorized('usage:read:aggregate') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  modules(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.modules(q.days, q.excludeAdmins); }

  @Get('programs') @Authorized('usage:read:aggregate') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  programs(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.programs(q.days, q.excludeAdmins, q.facultyId ?? null); }

  @Get('roles') @Authorized('usage:read:aggregate') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  roles(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.roles(q.days, q.excludeAdmins); }

  @Get('faculties') @Authorized('usage:read:aggregate') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  faculties(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.faculties(q.days, q.excludeAdmins); }

  @Get('actions') @Authorized('usage:read:aggregate') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  actions(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.actions(q.days, q.excludeAdmins); }

  @Get('users') @Authorized('usage:read:detail') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  users(@Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.users(q.days, q.excludeAdmins, q.q ?? null); }

  @Get('users/:id') @Authorized('usage:read:detail') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  async userTimeline(@Param('id') id: string, @Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) {
    const t = await this.service.userTimeline(id, q.days);
    if (!t) throw new ApiError('NOT_FOUND', `User ${id} not found.`);
    return t;
  }

  @Get('programs/:id/viewers') @Authorized('usage:read:detail') @Provenance({ sources: USAGE_SOURCES, caveats: USAGE_CAVEATS })
  programViewers(@Param('id') id: string, @Query(new ZodValidationPipe(WindowQuery)) q: WindowQueryT) { return this.service.programViewers(id, q.days); }
}
```

```ts
// apps/api/src/usage/usage.module.ts
import { Module } from '@nestjs/common';
import { CacheService } from '../common/cache.service';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({ controllers: [UsageController], providers: [UsageService, CacheService] })
export class UsageModule {}
```

If `CacheService` is already provided by a shared module (check `grep -rn "CacheService" apps/api/src/app.module.ts apps/api/src/common/*.module.ts`), import that module instead of re-providing.

Register in `apps/api/src/app.module.ts`: `import { UsageModule } from './usage/usage.module';` and add `UsageModule,` after `JobThaiModule,`.

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/api && npx vitest run test/usage.controller.test.ts && npx tsc --noEmit -p .`
Expected: `Tests  6 passed`; tsc silent. If the throttler metadata key differs in the installed version, read it with `Reflect.getMetadataKeys(UsageController.prototype.recordPageView)` and use the key that contains `THROTTLER`. If the `@Provenance` decorator's `caveats` field is rejected, drop `caveats` from the decorator call and keep `sources` (the ApiMeta schema has `caveats` optional; confirm `Provenance` accepts `Partial<ApiMeta>` — it does per `decorators.ts:45`).

- [ ] **Step 6: Live check against the dev api (restart it first — `packages/` changed)**

Restart `pnpm dev`. Then, with a signed-in browser session, open DevTools → Console on any page and run:

```js
fetch('/api/v1/usage/page-views', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: location.pathname }) }).then(r => r.status)
```
Expected: `204`. Then:

```bash
docker exec -i program-landscape-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select path, module, role, impersonated, viewer_faculty_id is not null from page_views order by created_at desc limit 3"'
```
Expected: one row with the normalised pattern, your role, `f`.

Open `http://localhost:3000/api/v1/usage/summary?days=7` in the same browser: JSON with `current.views ≥ 1`. (nginx is not in the dev path; the web dev server proxies `/api/v1` — same as every other client call.)

- [ ] **Step 7: Commit**

```bash
cat > $S/u7.txt <<'EOF'
feat(api): UsageModule — page-view beacon endpoint and usage reads

POST /usage/page-views takes identity from the session, marks impersonated
requests, is throttled 60/min/user, and never fails the client. Aggregate
reads (usage:read:aggregate) are cached 5 min and carry no names; detail
reads (usage:read:detail) are per-user and uncached. Not @AuditLog: a view is
not a mutation.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/api/src/usage apps/api/src/app.module.ts apps/api/test/usage.controller.test.ts
git commit -F $S/u7.txt
```

---

### Task 8: Client recorder

**Files:**
- Create: `apps/web/src/lib/usage-recorder-policy.ts`, `apps/web/src/components/usage-recorder.tsx`
- Modify: `apps/web/src/components/shell/app-shell-server.tsx` (render `<UsageRecorder />` as the first child inside the shell body)
- Test: `apps/web/test/usage-recorder-policy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/usage-recorder-policy.test.ts
import { describe, expect, it } from 'vitest';
import { buildEvent, RecorderDedupe, DEDUPE_MS } from '../src/lib/usage-recorder-policy';

describe('buildEvent', () => {
  it('lifts programme id from the path and scope from the query', () => {
    expect(buildEvent('/programs/KKU-SEQ-0062', new URLSearchParams('scope=faculty&scopeId=f1'))).toEqual({
      path: '/programs/KKU-SEQ-0062', scope: 'faculty', scopeId: 'f1', programId: 'KKU-SEQ-0062',
    });
  });
  it('returns null for excluded paths', () => {
    for (const p of ['/signin', '/no-access', '/api/v1/x']) expect(buildEvent(p, new URLSearchParams())).toBeNull();
  });
  it('ignores an invalid scope', () => {
    expect(buildEvent('/cockpit', new URLSearchParams('scope=galaxy&scopeId=x'))?.scope).toBeUndefined();
  });
});

describe('RecorderDedupe', () => {
  it('sends the first event, suppresses an identical one within the window, allows it after', () => {
    expect(DEDUPE_MS).toBe(5000);
    const d = new RecorderDedupe();
    const e = { path: '/cockpit', scope: 'faculty' as const, scopeId: 'f1' };
    expect(d.shouldSend(e, 1000)).toBe(true);
    expect(d.shouldSend(e, 3000)).toBe(false);
    expect(d.shouldSend(e, 6001)).toBe(true);
  });
  it('a different scope on the same path is a new event', () => {
    const d = new RecorderDedupe();
    expect(d.shouldSend({ path: '/cockpit', scope: 'faculty', scopeId: 'f1' }, 1000)).toBe(true);
    expect(d.shouldSend({ path: '/cockpit', scope: 'faculty', scopeId: 'f2' }, 1001)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/usage-recorder-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the policy and the component**

```ts
// apps/web/src/lib/usage-recorder-policy.ts

// Pure decisions for the page-view recorder, kept out of the component so
// they are testable without a DOM.

export const DEDUPE_MS = 5000;
const EXCLUDED = [/^\/signin/, /^\/no-access/, /^\/api\//];
const SCOPES = ['university', 'faculty', 'department', 'program'] as const;
type Scope = (typeof SCOPES)[number];

export interface UsageEvent {
  path: string;
  scope?: Scope;
  scopeId?: string;
  programId?: string;
}

export function buildEvent(pathname: string, params: URLSearchParams): UsageEvent | null {
  if (EXCLUDED.some((r) => r.test(pathname))) return null;
  const e: UsageEvent = { path: pathname };
  const scope = params.get('scope');
  if (scope && (SCOPES as readonly string[]).includes(scope)) {
    e.scope = scope as Scope;
    const id = params.get('scopeId');
    if (id) e.scopeId = id;
  }
  const m = pathname.match(/^\/programs\/([^/]+)/);
  if (m?.[1]) e.programId = m[1];
  return e;
}

/** Suppresses an identical event within DEDUPE_MS (StrictMode, shell re-mounts). */
export class RecorderDedupe {
  private lastKey = '';
  private lastAt = -Infinity;
  shouldSend(e: UsageEvent, nowMs: number): boolean {
    const key = `${e.path}|${e.scope ?? ''}|${e.scopeId ?? ''}|${e.programId ?? ''}`;
    if (key === this.lastKey && nowMs - this.lastAt < DEDUPE_MS) return false;
    this.lastKey = key;
    this.lastAt = nowMs;
    return true;
  }
}
```

```tsx
// apps/web/src/components/usage-recorder.tsx
'use client';

// Records a page view whenever the route, scope or programme changes. No UI,
// no React state, never throws. Sent as a same-origin beacon so it costs the
// page nothing; identity is added by the API from the session cookie.

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { buildEvent, RecorderDedupe } from '@/lib/usage-recorder-policy';

const ENDPOINT = '/api/v1/usage/page-views';

function send(payload: object): void {
  const json = JSON.stringify(payload);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // A JSON Blob so NestJS parses the body; sendBeacon cannot set headers.
      if (navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }))) return;
    }
    void fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, keepalive: true }).catch(() => undefined);
  } catch {
    // never surface
  }
}

export function UsageRecorder() {
  const pathname = usePathname();
  const params = useSearchParams();
  const dedupe = useRef(new RecorderDedupe());
  const scope = params?.get('scope') ?? '';
  const scopeId = params?.get('scopeId') ?? '';

  useEffect(() => {
    if (!pathname) return;
    const e = buildEvent(pathname, new URLSearchParams({ ...(scope ? { scope } : {}), ...(scopeId ? { scopeId } : {}) }));
    if (!e) return;
    if (!dedupe.current.shouldSend(e, Date.now())) return;
    send(e);
  }, [pathname, scope, scopeId]);

  return null;
}
```

In `apps/web/src/components/shell/app-shell-server.tsx`, import `UsageRecorder` from `@/components/usage-recorder` and render `<UsageRecorder />` immediately before `{children}` inside the shell's content area. (`useSearchParams` in a client component under the App Router needs a Suspense boundary during static rendering; every shell page is `force-dynamic`, but wrap it anyway: `<Suspense fallback={null}><UsageRecorder /></Suspense>` with `Suspense` from `react`.)

- [ ] **Step 4: Run tests and typecheck**

Run: `cd apps/web && npx vitest run test/usage-recorder-policy.test.ts && npx tsc --noEmit -p .`
Expected: `Tests  5 passed`; tsc silent.

- [ ] **Step 5: Manual check on dev (the spec's B.10 manual list)**

With the dev stack running: open `/`, `/cockpit`, switch the Cockpit scope to a faculty, open `/programs/KKU-SEQ-0062`, `/skills`, `/docs/methodology`. Then:

```bash
docker exec -i program-landscape-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select to_char(created_at,'"'"'HH24:MI:SS'"'"'), path, module, faculty_id is not null as has_faculty, program_id is not null as has_program from page_views order by created_at desc limit 8"'
```
Expected: six rows for six navigations: `/` home, `/cockpit` (twice — once plain, once with `has_faculty = t`), `/programs/[id]` with `has_program = t`, `/skills`, `/docs/methodology`. Reload one page twice quickly: only one extra row (dedupe). Impersonate a Faculty user from the admin console, open `/cockpit`: the new row has `impersonated = t` and `role = FACULTY_USER`.

- [ ] **Step 6: Commit**

```bash
cat > $S/u8.txt <<'EOF'
feat(web): page-view recorder — beacon on route, scope or programme change

A no-UI client component in the app shell; dedupe and exclusions are pure
functions under test. JSON Blob via sendBeacon (fetch keepalive fallback);
identity is never sent — the API takes it from the session cookie.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/web/src/lib/usage-recorder-policy.ts apps/web/src/components/usage-recorder.tsx apps/web/src/components/shell/app-shell-server.tsx apps/web/test/usage-recorder-policy.test.ts
git commit -F $S/u8.txt
```

---

### Task 9: `/usage` dashboard

**Files:**
- Create: `apps/web/app/usage/types.ts`, `apps/web/app/usage/page.tsx`, `apps/web/app/usage/client.tsx`
- Modify: `apps/web/src/lib/app-nav.tsx` (Dashboards section), `apps/web/app/admin/page.tsx` (tile in the Application group)
- Test: `apps/web/test/usage-page-render.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// apps/web/test/usage-page-render.test.tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UsageSections } from '../app/usage/client';
import type { UsageData } from '../app/usage/types';

const meta = { freshnessDate: null, sources: [], caveats: [] };
const data: UsageData = {
  days: 30, excludeAdmins: true, canSeeDetail: false,
  summary: { data: { window: { days: 30, from: '2026-08-15', to: '2026-09-14', prevFrom: '2026-07-16', rollupFrom: null }, recordedSince: '2026-09-14', signinsToday: 3, medianDwellMs: 42000,
    current: { activeUsers: 12, views: 340, sessions: 40, signins: 25, aiCalls: 7 }, previous: { activeUsers: 8, views: 200, sessions: 30, signins: 20, aiCalls: 3 },
    dailyActiveUsers: [{ day: '2026-09-13', users: 5, signins: 4 }, { day: '2026-09-14', users: 7, signins: 3 }] }, meta },
  modules: { data: [{ module: 'deep-dive', views: 200, users: 10, sessions: 20, medianDwellMs: 60000 }], meta },
  programs: { data: [{ programId: 'p1', code: 'KKU-SEQ-0062', nameEn: 'Mechanical Engineering', nameTh: null, facultyTh: 'วิศวกรรมศาสตร์', views: 50, users: 6 }], meta },
  roles: { data: [{ role: 'FACULTY_USER', users: 6, views: 100, sessions: 12, signins: 10 }], meta },
  faculties: { data: [{ facultyId: 'f1', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', users: 6, views: 100 }], meta },
  actions: { data: [{ family: 'export', count: 4, users: 2 }], meta },
  users: null,
};

describe('UsageSections', () => {
  it('renders every aggregate section and the recorded-since line', () => {
    const html = renderToStaticMarkup(<UsageSections data={data} />);
    for (const s of ['Active users', 'Page views', 'Sign-ins', 'By module', 'By programme', 'By faculty', 'By role', 'Actions']) expect(html).toContain(s);
    expect(html).toContain('KKU-SEQ-0062');
    expect(html).toContain('recorded since 2026-09-14');
  });
  it('omits the access log when the viewer cannot see detail', () => {
    expect(renderToStaticMarkup(<UsageSections data={data} />)).not.toContain('Access log');
  });
  it('renders the access log when detail rows are present', () => {
    const html = renderToStaticMarkup(<UsageSections data={{ ...data, canSeeDetail: true, users: { data: [{ userId: 'u1', name: 'A', email: 'a@kku.ac.th', role: 'FACULTY_USER', facultyTh: null, lastSeen: '2026-09-14T01:00:00Z', views: 9, sessions: 2, signins: 1, actions: 0 }], meta } }} />);
    expect(html).toContain('Access log');
    expect(html).toContain('a@kku.ac.th');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && npx vitest run test/usage-page-render.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Types**

```ts
// apps/web/app/usage/types.ts
// Shape-only mirrors of the API responses (dates arrive as ISO strings).
import type { ApiMeta } from '@kku/shared';

export interface Enveloped<T> { data: T; meta: ApiMeta }
export interface UsageWindowT { days: number; from: string; to: string; prevFrom: string; rollupFrom: string | null }
export interface Totals { activeUsers: number; views: number; sessions: number; signins: number; aiCalls: number }
export interface UsageSummaryT { window: UsageWindowT; recordedSince: string | null; signinsToday: number; medianDwellMs: number | null; current: Totals; previous: Totals; dailyActiveUsers: Array<{ day: string; users: number; signins: number }> }
export interface ModuleUsageT { module: string; views: number; users: number; sessions: number; medianDwellMs: number | null }
export interface ProgramUsageT { programId: string; code: string | null; nameEn: string | null; nameTh: string | null; facultyTh: string | null; views: number; users: number }
export interface RoleUsageT { role: string; users: number; views: number; sessions: number; signins: number }
export interface FacultyUsageT { facultyId: string | null; nameTh: string | null; nameEn: string | null; users: number; views: number }
export interface ActionUsageT { family: string; count: number; users: number }
export interface UserUsageT { userId: string; name: string | null; email: string; role: string; facultyTh: string | null; lastSeen: string | null; views: number; sessions: number; signins: number; actions: number }
export interface TimelineEventT { at: string; kind: 'view' | 'signin' | 'action'; label: string; path?: string; action?: string }
export interface UserTimelineT { user: { id: string; name: string | null; email: string; role: string }; days: Array<{ day: string; sessions: Array<{ startedAt: string; endedAt: string; events: TimelineEventT[] }> }> }

export interface UsageData {
  days: number;
  excludeAdmins: boolean;
  canSeeDetail: boolean;
  summary: Enveloped<UsageSummaryT> | null;
  modules: Enveloped<ModuleUsageT[]> | null;
  programs: Enveloped<ProgramUsageT[]> | null;
  roles: Enveloped<RoleUsageT[]> | null;
  faculties: Enveloped<FacultyUsageT[]> | null;
  actions: Enveloped<ActionUsageT[]> | null;
  users: Enveloped<UserUsageT[]> | null;
}
```

- [ ] **Step 4: Server page**

```tsx
// apps/web/app/usage/page.tsx
import { redirect } from 'next/navigation';
import { can, type SessionUser } from '@kku/shared';
import { PageHeader } from '@kku/ui';
import { auth } from '@/lib/auth';
import { apiFetchEnvelope } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { UsageClient } from './client';
import type {
  ActionUsageT, Enveloped, FacultyUsageT, ModuleUsageT, ProgramUsageT, RoleUsageT, UsageData, UsageSummaryT, UserUsageT,
} from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Platform usage — Program Landscape' };

const WINDOWS = [7, 30, 90, 365];

export default async function UsagePage({ searchParams }: { searchParams: { days?: string; excludeAdmins?: string } }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!can(user, 'usage:read:aggregate')) redirect('/no-access');
  const canSeeDetail = can(user, 'usage:read:detail');

  const days = WINDOWS.includes(Number(searchParams.days)) ? Number(searchParams.days) : 30;
  const excludeAdmins = searchParams.excludeAdmins !== 'false';
  const qs = `days=${days}&excludeAdmins=${excludeAdmins}`;
  const get = <T,>(path: string) => apiFetchEnvelope<T>(path).then((e) => ({ data: e.data, meta: e.meta }) as Enveloped<T>).catch(() => null);

  const [summary, modules, programs, roles, faculties, actions, users] = await Promise.all([
    get<UsageSummaryT>(`/usage/summary?${qs}`),
    get<ModuleUsageT[]>(`/usage/modules?${qs}`),
    get<ProgramUsageT[]>(`/usage/programs?${qs}`),
    get<RoleUsageT[]>(`/usage/roles?${qs}`),
    get<FacultyUsageT[]>(`/usage/faculties?${qs}`),
    get<ActionUsageT[]>(`/usage/actions?${qs}`),
    canSeeDetail ? get<UserUsageT[]>(`/usage/users?${qs}`) : Promise.resolve(null),
  ]);

  return (
    <AuthedAppShell user={user}>
      <PageHeader title="Platform usage" subtitle="Who uses which parts of the platform. Aggregates for leadership; the per-person access log is admin-only." />
      <UsageClient data={{ days, excludeAdmins, canSeeDetail, summary, modules, programs, roles, faculties, actions, users }} />
    </AuthedAppShell>
  );
}
```

- [ ] **Step 5: Client — sections and controls**

```tsx
// apps/web/app/usage/client.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Badge, Card, FreshnessBadge, ProvenanceButton, RightPanel, Segmented, SegmentedList, SegmentedTrigger, TrendLine } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';
import type { ProgramUsageT, UsageData, UserTimelineT, UserUsageT } from './types';

interface ViewerRow { userId: string; name: string | null; email: string; role: string; views: number; lastSeen: string | null }

const MODULE_LABEL: Record<string, string> = {
  home: 'Home', cockpit: 'Portfolio Cockpit', 'deep-dive': 'Program Deep-Dive', gap: 'Gap Analyzer', benchmarking: 'Benchmarking',
  scenarios: 'Scenarios', decisions: 'Decisions', analyst: 'AI Analyst', trends: 'Trends Radar', risk: 'Risk', education: 'Education',
  staff: 'Staff', skills: 'Skills', 'teaching-learning': 'Teaching & Learning', dashboards: 'Dashboards', admin: 'Admin', docs: 'Reference',
  profile: 'Profile', 'public-profile': 'Public profile', inbox: 'Inbox', usage: 'Platform usage', other: 'Other',
};
const FAMILY_LABEL: Record<string, string> = { export: 'PDF exports', 'ai-brief': 'AI briefs', scenario: 'Scenarios', decision: 'Decisions', pipeline: 'Pipeline runs', upload: 'Uploads', other: 'Other' };

function delta(cur: number, prev: number): string {
  if (prev === 0) return cur === 0 ? '±0' : 'new';
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}% vs previous`;
}
function fmtDwell(ms: number | null): string {
  if (ms === null) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Pure render of every section from already-fetched data. */
/** Card title with the provenance drawer for that card's own response. */
function CardTitle({ title, meta }: { title: string; meta: ApiMeta | undefined }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {meta && <ProvenanceButton title={title} meta={meta} size="xs" />}
    </div>
  );
}

export function UsageSections({
  data, onOpenUser, onOpenProgram,
}: { data: UsageData; onOpenUser?: (u: UserUsageT) => void; onOpenProgram?: (p: ProgramUsageT) => void }) {
  const s = data.summary?.data;
  const meta = data.summary?.meta;
  return (
    <div className="flex flex-col gap-6">
      {/* 1. Summary strip */}
      <Card padding="md">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          {s?.recordedSince ? <span>Page views recorded since {s.recordedSince}; sign-ins since April 2026.</span> : <span>No page views recorded yet.</span>}
          {s?.window.rollupFrom && <span>· days before {s.window.rollupFrom.slice(0, 10)} come from daily roll-ups</span>}
          {meta && <ProvenanceButton title="Platform usage" meta={meta} size="xs" />}
          {meta && <FreshnessBadge freshnessDate={new Date().toISOString()} label="computed" />}
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          {s && [
            ['Active users', s.current.activeUsers, s.previous.activeUsers],
            ['Page views', s.current.views, s.previous.views],
            ['Sessions', s.current.sessions, s.previous.sessions],
            ['Sign-ins', s.current.signins, s.previous.signins],
            ['AI calls', s.current.aiCalls, s.previous.aiCalls],
          ].map(([label, cur, prev]) => (
            <div key={String(label)} className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
              <span className="font-tabular text-2xl font-semibold text-text-primary">{Number(cur).toLocaleString()}</span>
              <span className="text-[11px] text-text-tertiary">{delta(Number(cur), Number(prev))}</span>
            </div>
          ))}
        </div>
        {s && <p className="mt-2 text-[11px] text-text-tertiary">Sign-ins today: {s.signinsToday} · median dwell {fmtDwell(s.medianDwellMs)} (time to the next view; last view of a session excluded) · <Link href="/admin/ai-cost" className="underline">AI cost</Link></p>}
      </Card>

      {/* 2. DAU */}
      <Card padding="md">
        <CardTitle title="Daily active users · last 30 days" meta={meta} />
        <div className="h-56">
          {s && <TrendLine data={s.dailyActiveUsers.map((d) => ({ x: d.day.slice(5), 'Active users': d.users, 'Sign-ins': d.signins }))} series={['Active users', 'Sign-ins']} ariaLabel="Daily active users" />}
        </div>
      </Card>

      {/* 3. Modules */}
      <Card padding="md">
        <CardTitle title="By module" meta={data.modules?.meta} />
        <table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-text-tertiary"><tr><th className="py-1">Module</th><th className="text-right">Views</th><th className="text-right">Users</th><th className="text-right">Sessions</th><th className="text-right">Median dwell</th></tr></thead>
          <tbody>{(data.modules?.data ?? []).map((m) => {
            const max = Math.max(1, ...(data.modules?.data ?? []).map((x) => x.views));
            return (<tr key={m.module} className="border-t border-border-subtle"><td className="py-1.5"><div className="flex items-center gap-2"><span className="w-40 truncate">{MODULE_LABEL[m.module] ?? m.module}</span><div className="h-1.5 flex-1 rounded bg-surface-2"><div className="h-1.5 rounded bg-accent" style={{ width: `${(m.views / max) * 100}%` }} /></div></div></td>
              <td className="text-right font-tabular">{m.views.toLocaleString()}</td><td className="text-right font-tabular">{m.users}</td><td className="text-right font-tabular">{m.sessions}</td><td className="text-right font-tabular text-text-tertiary">{fmtDwell(m.medianDwellMs)}</td></tr>);
          })}</tbody></table>
      </Card>

      {/* 4. Programmes */}
      <Card padding="md">
        <CardTitle title="By programme · top 20" meta={data.programs?.meta} />
        <ul className="flex flex-col gap-1 text-sm">{(data.programs?.data ?? []).slice(0, 20).map((p) => (
          <li key={p.programId} className="flex items-center justify-between gap-2 border-t border-border-subtle py-1 first:border-0">
            <Link href={`/programs/${p.programId}`} className="min-w-0 truncate hover:underline"><span className="font-mono text-xs text-text-tertiary">{p.code ?? p.programId}</span> {p.nameEn ?? p.nameTh ?? '(programme removed)'}{p.facultyTh && <span className="text-xs text-text-tertiary"> · {p.facultyTh}</span>}</Link>
            <span className="flex shrink-0 items-center gap-2 font-tabular text-xs">{p.views.toLocaleString()} views · {p.users} users
              {data.canSeeDetail && onOpenProgram && <button type="button" onClick={() => onOpenProgram(p)} className="rounded border border-border-subtle px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-2">Who viewed</button>}
            </span>
          </li>))}</ul>
      </Card>

      {/* 5 + 6. Faculties and roles */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card padding="md"><CardTitle title="By faculty · who is using it" meta={data.faculties?.meta} />
          <ul className="text-sm">{(data.faculties?.data ?? []).map((f) => <li key={f.facultyId ?? 'none'} className="flex justify-between border-t border-border-subtle py-1 first:border-0"><span className="truncate">{f.nameTh ?? f.nameEn ?? 'No faculty'}</span><span className="font-tabular text-xs">{f.users} users · {f.views} views</span></li>)}</ul></Card>
        <Card padding="md"><CardTitle title="By role" meta={data.roles?.meta} />
          <ul className="text-sm">{(data.roles?.data ?? []).map((r) => <li key={r.role} className="flex justify-between border-t border-border-subtle py-1 first:border-0"><span>{r.role}</span><span className="font-tabular text-xs">{r.users} users · {r.views} views · {r.signins} sign-ins</span></li>)}</ul></Card>
      </div>

      {/* 7. Actions */}
      <Card padding="md"><CardTitle title="Actions" meta={data.actions?.meta} />
        <ul className="flex flex-wrap gap-2 text-sm">{(data.actions?.data ?? []).map((a) => <li key={a.family}><Badge tone="neutral">{FAMILY_LABEL[a.family] ?? a.family}: {a.count} by {a.users}</Badge></li>)}</ul></Card>

      {/* 8. Access log (detail only) */}
      {data.canSeeDetail && data.users && (
        <Card padding="md">
          <CardTitle title="Access log" meta={data.users.meta} />
          <p className="mb-2 text-xs text-text-tertiary">Per person, over the selected window. Click a row for their timeline.</p>
          <table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wide text-text-tertiary"><tr><th className="py-1">Person</th><th>Role</th><th>Faculty</th><th className="text-right">Views</th><th className="text-right">Sessions</th><th className="text-right">Sign-ins</th><th className="text-right">Actions</th><th>Last seen</th></tr></thead>
            <tbody>{data.users.data.map((u) => (
              <tr key={u.userId} className="cursor-pointer border-t border-border-subtle hover:bg-surface-2" onClick={() => onOpenUser?.(u)}>
                <td className="py-1.5"><div className="truncate">{u.name ?? u.email}</div><div className="text-xs text-text-tertiary">{u.email}</div></td>
                <td className="text-xs">{u.role}</td><td className="text-xs">{u.facultyTh ?? '—'}</td>
                <td className="text-right font-tabular">{u.views}</td><td className="text-right font-tabular">{u.sessions}</td><td className="text-right font-tabular">{u.signins}</td><td className="text-right font-tabular">{u.actions}</td>
                <td className="text-xs text-text-tertiary">{u.lastSeen ? new Date(u.lastSeen).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' }) : '—'}</td>
              </tr>))}</tbody></table>
        </Card>
      )}
    </div>
  );
}

export function UsageClient({ data }: { data: UsageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openUser, setOpenUser] = useState<UserUsageT | null>(null);
  const [timeline, setTimeline] = useState<UserTimelineT | null>(null);
  const [openProgram, setOpenProgram] = useState<ProgramUsageT | null>(null);
  const [viewers, setViewers] = useState<ViewerRow[] | null>(null);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params?.toString() ?? '');
    p.set(k, v);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const open = async (u: UserUsageT) => {
    setOpenUser(u);
    setTimeline(null);
    const res = await fetch(`/api/v1/usage/users/${u.userId}?days=${data.days}`).then((r) => r.json()).catch(() => null);
    setTimeline((res?.data as UserTimelineT | undefined) ?? null);
  };
  const openProg = async (p: ProgramUsageT) => {
    setOpenProgram(p);
    setViewers(null);
    const res = await fetch(`/api/v1/usage/programs/${p.programId}/viewers?days=${data.days}`).then((r) => r.json()).catch(() => null);
    setViewers((res?.data as ViewerRow[] | undefined) ?? []);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={String(data.days)} onValueChange={(v) => setParam('days', v)}>
          <SegmentedList aria-label="Window">{[7, 30, 90, 365].map((d) => <SegmentedTrigger key={d} value={String(d)}>{d}d</SegmentedTrigger>)}</SegmentedList>
        </Segmented>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input type="checkbox" checked={data.excludeAdmins} onChange={(e) => setParam('excludeAdmins', String(e.target.checked))} />
          Exclude admin accounts
        </label>
      </div>
      <UsageSections data={data} onOpenUser={open} onOpenProgram={openProg} />
      <RightPanel open={openProgram !== null} onOpenChange={(o) => { if (!o) setOpenProgram(null); }} title={openProgram ? `Who viewed · ${openProgram.nameEn ?? openProgram.code ?? ''}` : ''}>
        {!viewers ? <p className="text-sm text-text-tertiary">Loading…</p> : viewers.length === 0 ? <p className="text-sm text-text-tertiary">No views in this window.</p> : (
          <ul className="flex flex-col gap-1 text-sm">{viewers.map((v) => <li key={v.userId} className="flex justify-between border-t border-border-subtle py-1 first:border-0"><span className="truncate">{v.name ?? v.email} <span className="text-xs text-text-tertiary">{v.role}</span></span><span className="font-tabular text-xs">{v.views} views</span></li>)}</ul>)}
      </RightPanel>
      <RightPanel open={openUser !== null} onOpenChange={(o) => { if (!o) setOpenUser(null); }} title={openUser ? (openUser.name ?? openUser.email) : ''}>
        {!timeline ? <p className="text-sm text-text-tertiary">Loading…</p> : timeline.days.length === 0 ? <p className="text-sm text-text-tertiary">No activity in this window.</p> : (
          <div className="flex flex-col gap-4 text-sm">{timeline.days.map((d) => (
            <div key={d.day}><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{d.day}</div>
              {d.sessions.map((sess, i) => (<div key={i} className="mb-2 rounded border border-border-subtle p-2">
                <div className="mb-1 text-[11px] text-text-tertiary">{new Date(sess.startedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} – {new Date(sess.endedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} · {sess.events.length} events</div>
                <ul className="flex flex-col gap-0.5">{sess.events.map((e, j) => <li key={j} className="flex gap-2"><span className="w-12 shrink-0 font-tabular text-[11px] text-text-tertiary">{new Date(e.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })}</span><Badge tone={e.kind === 'signin' ? 'success' : e.kind === 'action' ? 'accent' : 'neutral'} size="sm">{e.kind}</Badge><span className="truncate">{e.label}</span></li>)}</ul>
              </div>))}
            </div>))}</div>)}
      </RightPanel>
    </div>
  );
}
```

- [ ] **Step 6: Nav and admin tile**

In `apps/web/src/lib/app-nav.tsx`, add `Activity` to the lucide imports and, in `dashboardsSectionFor`, append an item when the user holds the permission. The nav file only `import type`s from `@kku/shared`, so it cannot call `can()`; use the role list instead:

```ts
const usageItem = {
  href: '/usage',
  label: 'Platform usage',
  icon: createElement(Activity),
  moduleKey: 'neutral' as const,
};
// inside dashboardsSectionFor, build items then:
const canSeeUsage = role === 'SUPER_ADMIN' || role === 'SYSTEM_ADMIN' || role === 'UNIVERSITY_USER';
return { label: 'Dashboards', items: [...(canSeeProgramAwareDashboards(role) ? [...dashboardItemsBase, ...dashboardItemsFacultyAware] : dashboardItemsBase), ...(canSeeUsage ? [usageItem] : [])] };
```

In `apps/web/app/admin/page.tsx`, add a tile to the **Application** group (the one holding "Application topology"):

```ts
    {
      href: '/usage',
      label: 'Usage & access',
      description: 'Who uses which parts of the platform — active users, modules, programmes, faculties — and the per-person access log.',
      icon: <Activity className="size-icon-xl" />,
    },
```

(add `Activity` to that file's lucide import).

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit -p . && npx eslint app/usage src/lib/app-nav.tsx app/admin/page.tsx`
Expected: all pass; tsc silent; eslint 0 errors. If `Segmented`, `RightPanel`, `ProvenanceButton`, `FreshnessBadge`, `Sparkline` or `TrendLine` are not re-exported from `@kku/ui`'s root, import them from the subpaths `packages/ui/src/index.ts` exports (check with `grep -n "Segmented\|RightPanel\|Sparkline" packages/ui/src/index.ts`).

- [ ] **Step 8: Manual check**

Open `/usage` as an admin: summary strip shows today's views, DAU chart, module bars, programmes, faculties, roles, actions, and the access log; every card has a provenance button; click your own row → the panel shows today's session with the pages just visited; "Who viewed" on a programme row lists viewers. Impersonate a University user: same page without the access log; a Faculty user is redirected to `/no-access`.

- [ ] **Step 9: Commit**

```bash
cat > $S/u9.txt <<'EOF'
feat(web): /usage dashboard — aggregates for leadership, access log for admins

Summary strip with change vs previous window, daily active users, by module
(with median dwell), by programme, by faculty, by role, actions from the
audit log; window and admin-exclusion in the URL; per-user timeline in a side
panel for usage:read:detail. Nav entry under Dashboards, tile on /admin.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/web/app/usage apps/web/src/lib/app-nav.tsx apps/web/app/admin/page.tsx apps/web/test/usage-page-render.test.tsx
git commit -F $S/u9.txt
```

---

### Task 10: `/admin` hero tiles

**Files:**
- Modify: `apps/web/app/admin/page.tsx` (`AdminConsolePage` fetches; `buildHeroStats`)

- [ ] **Step 1: Fetch the 7-day summary with a 2-second timeout**

In `AdminConsolePage`, add to the `Promise.all`:

```ts
    apiFetch<UsageSummaryT & { medianDwellMs: number | null }>('/usage/summary?days=7&excludeAdmins=true', { signal: AbortSignal.timeout(2000) }).catch(() => null),
```

(import `type { UsageSummaryT } from '../usage/types'`), bind it to `usage`, and call `buildHeroStats(dataStats, sysStatus, usage)`.

- [ ] **Step 2: Add the tiles**

Extend `buildHeroStats(data, sys, usage: (UsageSummaryT & { medianDwellMs: number | null }) | null)`; before the "both failed" fallback add:

```ts
  if (usage) {
    const d = (cur: number, prev: number) => (prev === 0 ? '' : ` · ${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)}% vs prior 7d`);
    stats.push({
      label: 'Active users · 7d',
      value: (
        <span className="flex items-center gap-3">
          {usage.current.activeUsers.toLocaleString()}
          <span className="h-6 w-20"><Sparkline data={usage.dailyActiveUsers.map((x) => x.users)} /></span>
        </span>
      ),
      hint: `excl. admin accounts${d(usage.current.activeUsers, usage.previous.activeUsers)}`,
      icon: <Activity className="size-icon-sm" />,
    });
    stats.push({ label: 'Page views · 7d', value: usage.current.views.toLocaleString(), hint: `${usage.current.sessions} sessions${d(usage.current.views, usage.previous.views)}`, icon: <Eye className="size-icon-sm" /> });
    stats.push({ label: 'Sign-ins today', value: usage.signinsToday.toLocaleString(), hint: `${usage.current.signins} this week`, icon: <LogIn className="size-icon-sm" /> });
  }
```

Import `Sparkline` from `@kku/ui` and `Eye`, `LogIn` from lucide. Wrap the whole hero `stats` area so it links: simplest is to leave tiles as-is and make the "Usage & access" tile the link (Task 9 added it); the spec's "tiles link to /usage" is satisfied by setting the tile's `hint` to a `Link` — `hint` is a string in `HeroBannerStat`, so instead add `href?: string` to `HeroBannerStat` in `apps/web/src/components/hero-banner.tsx` and render the stat inside a `Link` when present (a 6-line change: wrap the stat body in `href ? <Link href={href}>…</Link> : …`). Set `href: '/usage'` on the three tiles.

- [ ] **Step 3: Typecheck, lint, manual check**

Run: `cd apps/web && npx tsc --noEmit -p . && npx eslint app/admin/page.tsx src/components/hero-banner.tsx`
Then open `/admin`: three new tiles with a sparkline; clicking one opens `/usage`. Stop the api briefly and reload `/admin`: the page renders with the old tiles only, within ~2 s.

- [ ] **Step 4: Commit**

```bash
cat > $S/u10.txt <<'EOF'
feat(admin): usage tiles on the console hero — active users, views, sign-ins

Best-effort with a 2 s timeout; the console renders without them if the
usage call fails. Tiles link to /usage.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/web/app/admin/page.tsx apps/web/src/components/hero-banner.tsx
git commit -F $S/u10.txt
```

---

### Task 11: Nightly retention timer for prod

**Files:**
- Create: `infra/systemd/program-landscape-retention.service`, `infra/systemd/program-landscape-retention.timer`
- Modify: `DEPLOYMENT.md` (first-boot step 7 list; a note in the release checklist)

There is **no** unit running the PDPA sweep on prod today (only backup timers). Without one, page views accumulate past 120 days and the retention promise in `docs/pdpa.md` is false.

- [ ] **Step 1: Write the units**

```ini
# infra/systemd/program-landscape-retention.service
[Unit]
Description=Program Landscape PDPA retention sweep (audit, AI payloads, Scholar, page views)
Documentation=file:///opt/program-landscape/current/DEPLOYMENT.md
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/program-landscape/current
# Runs inside the ingestion image, which bundles the sweep with esbuild
# (apps/ingestion/scripts/bundle-pipeline-scripts.ts). DB-only; no AI spend.
ExecStart=/usr/bin/docker compose exec -T ingestion node dist/scripts/retention-sweep.js
SuccessExitStatus=0
Nice=10
```

```ini
# infra/systemd/program-landscape-retention.timer
[Unit]
Description=Program Landscape — nightly PDPA retention sweep
Documentation=file:///opt/program-landscape/current/DEPLOYMENT.md

[Timer]
# 03:00 Asia/Bangkok, after the 02:00 backup so the dump precedes the delete.
OnCalendar=*-*-* 03:00:00 Asia/Bangkok
RandomizedDelaySec=120
Persistent=true
Unit=program-landscape-retention.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Make the sweep runnable inside the image**

`scripts/pdpa/retention-sweep.ts` runs under `tsx` on dev; nothing under `scripts/` is compiled into any image. The ingestion image is the one that bundles operator scripts (`apps/ingestion/scripts/bundle-pipeline-scripts.ts`, files under `apps/ingestion/src/scripts/`), so:
  - **move** the body of `scripts/pdpa/retention-sweep.ts` to `apps/ingestion/src/scripts/retention-sweep.ts` (same code; replace any top-level `import 'dotenv/config'` with the inline env-file loader used by `jobthai-derive.ts`, since `dotenv` is not a dependency);
  - make `scripts/pdpa/retention-sweep.ts` a two-line shim: `// Moved so it can be bundled for the prod image; see apps/ingestion/src/scripts/retention-sweep.ts` + `import '../../apps/ingestion/src/scripts/retention-sweep';` so `pnpm tsx scripts/pdpa/retention-sweep.ts` keeps working on dev;
  - add `'retention-sweep.ts'` to `TARGETS` with the comment `// PDPA retention sweep — run nightly on prod by program-landscape-retention.timer`;
  - the unit's `ExecStart` (Step 1) runs it in the `ingestion` service.

- [ ] **Step 3: DEPLOYMENT.md**

In first-boot step 7, add after the verify-backup line:

```bash
sudo systemctl enable --now program-landscape-retention.timer      # nightly PDPA sweep 03:00
sudo systemctl list-timers 'program-landscape-*' --no-pager         # confirm all four
```

and a new subsection under Backups:

```markdown
### PDPA retention sweep

`program-landscape-retention.timer` runs the sweep nightly at 03:00 Bangkok
(after the backup). It hard-deletes / redacts per `docs/pdpa.md` and rolls
page views older than 120 days into daily counts. **Installing the timer is
a manual step** — `deploy.sh` does not install units. If
`systemctl list-timers 'program-landscape-*'` does not show it, copy the two
files from `infra/systemd/` and enable it. Dry-run by hand:
`docker compose exec -T ingestion node dist/scripts/retention-sweep.js --dry-run`.
```

- [ ] **Step 4: Verify locally that the bundled sweep loads**

Run: `cd apps/ingestion && npx tsx scripts/bundle-pipeline-scripts.ts | grep retention-sweep && node dist/scripts/retention-sweep.js --dry-run`
Expected: `✓ retention-sweep.ts → retention-sweep.js`; the dry run prints counts against the dev DB.

- [ ] **Step 5: Commit**

```bash
cat > $S/u11.txt <<'EOF'
feat(infra): nightly PDPA retention timer — prod had none

Only backup timers existed, so no retention rule had ever run on prod. Adds
program-landscape-retention.{service,timer} (03:00 Bangkok, after the
backup), bundles the sweep into the ingestion image, documents the manual
enable step in DEPLOYMENT.md.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add infra/systemd/program-landscape-retention.service infra/systemd/program-landscape-retention.timer DEPLOYMENT.md apps/ingestion/src/scripts/retention-sweep.ts apps/ingestion/scripts/bundle-pipeline-scripts.ts scripts/pdpa/retention-sweep.ts
git commit -F $S/u11.txt
```

---

### Task 12: Privacy notice, PDPA doc, changelog, release audit

**Files:**
- Modify: `docs/pdpa.md` (new section after "Audit log retention"), `apps/web/src/components/legal/legal-page.tsx` (one paragraph EN/TH in the privacy section — find the section by `grep -n "audit\|Audit" apps/web/src/components/legal/legal-page.tsx`), `apps/web/app/changelog/page.tsx` (extend the v1.9.6 entry created by Plan A, or create it)

- [ ] **Step 1: docs/pdpa.md**

Add after `## Audit log retention`:

```markdown
## Page-view recording (from v1.9.6)

**What:** for every page a signed-in user opens, the platform records the
route pattern (e.g. `/programs/[id]`), the programme or faculty in view, the
user's id, role and faculty at the time, and the time. **Not** recorded: IP
address, the full URL or query string, or anything before sign-in.
Impersonated sessions are flagged and excluded from all figures.

**Why:** platform adoption and support — which modules and programmes are used,
by which roles and faculties, and whether a person's reported problem matches
what the platform saw. Legal basis: legitimate interest in operating the
service (§24(5)).

**Retention:** raw rows 120 days, then rolled up nightly into daily counts per
user, page and programme (Asia/Bangkok days) with no timestamps; the roll-up
keeps the count of days a person used the platform, not what they looked at
minute by minute. On account deletion `user_id` is set to null on both tables
(same posture as the audit log).

**Who can see it:** aggregates (no names) — admin-grade and University users;
the per-person access log — admin-grade only, `usage:read:detail`.
```

- [ ] **Step 2: In-app notice**

In the privacy section of `legal-page.tsx`, add (EN and TH, matching the file's existing bilingual pattern):

> EN: "When you are signed in, the platform records which pages you open (as route patterns, with the programme or faculty in view), your role and faculty, and the time — not your IP address or full URLs. Raw records are kept for 120 days, then reduced to daily counts. Administrators can see individual records; university leadership sees only aggregates."
>
> TH: "เมื่อคุณลงชื่อเข้าใช้ ระบบจะบันทึกว่าคุณเปิดหน้าใด (ในรูปแบบเส้นทาง พร้อมหลักสูตรหรือคณะที่กำลังดู) บทบาทและคณะของคุณ และเวลา โดยไม่บันทึกที่อยู่ IP หรือ URL เต็ม ข้อมูลดิบเก็บไว้ 120 วัน จากนั้นลดรูปเป็นจำนวนนับรายวัน ผู้ดูแลระบบเห็นข้อมูลรายบุคคลได้ ส่วนผู้บริหารมหาวิทยาลัยเห็นเฉพาะภาพรวม"

- [ ] **Step 3: Changelog**

Add to the v1.9.6 entry's `bullets` (audience already includes Admin; add 'Executive' if missing):

```ts
      'A new Platform usage page (Dashboards → Platform usage, and a tile on the admin console) shows who uses which parts of the platform: active users, page views, sign-ins, usage by module, programme, faculty and role, and the actions people take. University leadership sees aggregates; administrators can also open a per-person access log with each session’s pages. Admin accounts are excluded from the figures by default.',
      'Page views are recorded from this release on, so the first week will look sparse — that is the start date, not low adoption. Sign-in history goes back to April. Raw records are kept for 120 days and then reduced to daily counts; the privacy notice describes exactly what is and is not recorded.',
```

- [ ] **Step 4: Full verification**

```bash
for f in packages/shared packages/db apps/api apps/ingestion apps/web; do (cd $f && npx tsc --noEmit -p .) && echo "$f ok"; done
pnpm --filter @kku/shared test 2>&1 | grep -E "Tests "; pnpm --filter @kku/db test 2>&1 | grep -E "Tests "; pnpm --filter api test 2>&1 | grep -E "Tests "; pnpm --filter ingestion test 2>&1 | grep -E "Tests "; pnpm --filter web test 2>&1 | grep -E "Tests "
```
Expected: five `ok`; every suite passes with the new tests added (shared +~40, db +12, api +5, web +16).

- [ ] **Step 5: Release audit (before any build is requested — see memory `feedback_prod_script_bundling`)**

- Migration: `20260914100000_page_views` — additive; applied on dev; prod applies it via `deploy.sh`.
- Env / compose / buckets: none.
- Scripts: `retention-sweep.js` bundled; verify inside the built ingestion image with `docker run --rm --network none -e DATABASE_URL=postgresql://x:x@127.0.0.1:1/x --entrypoint sh <image> -c "cd /app && node dist/scripts/retention-sweep.js --dry-run"` → must reach "Can't reach database", not a module error.
- Prod manual step: enable `program-landscape-retention.timer` (Task 11). Record it in the deploy notes handed to the operator.
- Nothing is copied from dev to prod; page views start at deploy.

- [ ] **Step 6: Commit and push**

```bash
cat > $S/u12.txt <<'EOF'
docs: page-view recording — PDPA section, in-app privacy notice, changelog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add docs/pdpa.md apps/web/src/components/legal/legal-page.tsx apps/web/app/changelog/page.tsx
git commit -F $S/u12.txt
git push origin main
```

---

## Deploy notes for the release that carries this

1. Standard scp → extract → `./scripts/deploy.sh` (applies the migration).
2. **Manual, once:** `sudo cp /opt/program-landscape/current/infra/systemd/program-landscape-retention.* /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now program-landscape-retention.timer && systemctl list-timers 'program-landscape-*'`.
3. Nothing else. Page views begin immediately; `/usage` shows "recorded since <deploy day>".

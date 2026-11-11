# Health Zone Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared function decides which zone a health score falls in (danger / needs attention / healthy), and every place that colours or counts health scores calls it instead of hard-coding `< 40` / `< 65`.

**Architecture:** A new pure module `packages/shared/src/health/zones.ts` owns the two cut-offs and `healthZone(score)`. It is exported through a dedicated subpath (`@kku/shared/health/zones`) so client components can import it without pulling the server-side `@kku/shared` index into the browser bundle. Each call site keeps its own literal Tailwind class map keyed by zone; only the decision moves.

**Tech Stack:** TypeScript strict, Vitest, pnpm workspaces (`@kku/shared`, `@kku/db`, `@kku/ui`, `apps/api`, `apps/web`, `apps/ingestion`).

**Spec:** No separate spec. The decision came out of a working session on 2026-11-11: the zones are currently copied into ~10 places, so an adopter who wants "healthy from 60" has to find all of them. Zone definition today (from `docs/methodologies/health-score.md`): below 40 = danger zone, 40 up to but not including 65 = needs attention, 65 and above = healthy.

## Global Constraints

- **Runs on top of `refactor/health-score-structure`** (commits `ef2b6631`, `90edf408`), which split `packages/db/src/health-score.ts` into the `packages/db/src/health-score/` folder and added `tuning.ts` plus the adopter guide's "Where to change what" table. Zones are presentation, not the score formula: do not edit the scorers or `tuning.ts` values, and do not touch the tuning pin test.
- **No `HEALTH_SCORE_VERSION` bump.** The score formula does not change; only where the cut-offs live.
- Behaviour must be identical before and after at every migrated site (except the one decision in Task 4, which the owner must answer first).
- Zone is decided on the **raw, unrounded** score, as every site does today.
- `null` score → `null` zone. Sites keep rendering their existing "no score" state (`—`, `text-text-tertiary`, `bg-border-subtle/40`, `'unknown'`, `'neutral'`).
- Tailwind classes must stay **literal strings** at each site (`'text-danger'`, not `` `text-${tone}` ``) or the JIT drops them. Map zone → class with an object or switch per site.
- Colours via existing tokens only; no hex (CLAUDE.md).
- TypeScript strict, no `any`. Conventional commits. Run `pnpm check` before the final commit.
- Docs impact rule (CLAUDE.md): update `docs/methodologies/health-score.md` in the same branch; run `pnpm docs:build`.

## Review Focus

1. **Score exactly 40 or 65.** 40 must be "attention" (not danger), 65 must be "healthy". Pinned in Task 1 tests.
2. **A displayed "65" that is really 64.6.** Sites print `Math.round(score)` but zone on the raw value, so 64.6 shows "65" in amber. That is today's behaviour and must be preserved, not "fixed" silently. Pinned in Task 1 (`64.6 → 'attention'`); mention it in the docs note (Task 5).
3. **Null / missing overall score in the danger-zone KPI.** `cockpit.service.ts` treats null as *not* danger (`?? 100`). After migration a null score must still not count. Pinned in Task 2.
4. **NaN or Infinity reaching the helper** (bad upstream division). Must not be classified as danger or healthy. Return `null`. Pinned in Task 1.
5. **Client bundle pulling server code.** Importing from the `@kku/shared` root in a `'use client'` file can drag Node-only modules into the browser. Client files must import from `@kku/shared/health/zones`. Checked by `pnpm --filter web build` in Task 4.

## Out of scope (looks similar, is not a health zone — do not migrate)

- `apps/web/app/programs/[id]/client.tsx:2691` — `jt.matchScore` (job-title match score).
- `apps/web/app/benchmarking/programs/[id]/page.tsx:564` — distinctiveness `>= 60`.
- `packages/db/src/program-deep-dive.ts:1635`, `:1689` — verdict contributions and trajectory `RISING`.
- `packages/ui/src/viz/score-grid.tsx:39` — generic grid, used by the Executive Landscape *future* chapter for scorecard nodes, not health scores. Leave as is.
- The stale "five dimensions" table in `health-score.md` (separate docs fix).

---

### Task 1: Shared zone helper

**Files:**
- Create: `packages/shared/src/health/zones.ts`
- Modify: `packages/shared/package.json` (`exports`: add `"./health/zones": "./src/health/zones.ts"` and `"./src/health/zones": "./src/health/zones.ts"`, matching the existing pairs)
- Modify: `packages/shared/src/index.ts` (add `export * from './health/zones';`)
- Test: `packages/shared/test/health-zones.test.ts`

**Interfaces:**
- Produces:
  - `export const HEALTH_DANGER_BELOW = 40;`
  - `export const HEALTH_HEALTHY_FROM = 65;`
  - `export type HealthZone = 'danger' | 'attention' | 'healthy';`
  - `export function healthZone(score: number | null | undefined): HealthZone | null;`
  - `export const HEALTH_ZONE_LABEL: Readonly<Record<HealthZone, string>> = { danger: 'Danger zone', attention: 'Needs attention', healthy: 'Healthy' };`

- [ ] **Step 1: Write the failing test** `packages/shared/test/health-zones.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { HEALTH_DANGER_BELOW, HEALTH_HEALTHY_FROM, healthZone } from '../src/health/zones';

describe('healthZone', () => {
  it('uses the documented cut-offs', () => {
    expect(HEALTH_DANGER_BELOW).toBe(40);
    expect(HEALTH_HEALTHY_FROM).toBe(65);
  });
  it.each([
    [0, 'danger'], [39.99, 'danger'],
    [40, 'attention'], [64.6, 'attention'], [64.99, 'attention'],
    [65, 'healthy'], [100, 'healthy'],
  ])('%d → %s', (score, zone) => {
    expect(healthZone(score)).toBe(zone);
  });
  it('returns null for missing or non-finite scores', () => {
    expect(healthZone(null)).toBeNull();
    expect(healthZone(undefined)).toBeNull();
    expect(healthZone(Number.NaN)).toBeNull();
    expect(healthZone(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @kku/shared exec vitest run test/health-zones.test.ts`
Expected: FAIL, cannot resolve `../src/health/zones`.

- [ ] **Step 3: Implement `packages/shared/src/health/zones.ts`** with the Interfaces above. Header comment: cites `docs/methodologies/health-score.md` and says the cut-offs are presentation, not formula (no version bump when changed). Add the two `exports` entries and the index re-export.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @kku/shared exec vitest run test/health-zones.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/health/zones.ts packages/shared/src/index.ts packages/shared/package.json packages/shared/test/health-zones.test.ts
git commit -m "feat(shared): add healthZone helper for health-score zones"
```

### Task 2: Server-side and script call sites

**Files:**
- Modify: `apps/api/src/cockpit/cockpit.service.ts:93` (danger-zone KPI count)
- Modify: `apps/api/src/cockpit/cockpit.controller.ts:501` (export cell tone) and `:554` (healthy count)
- Modify: `packages/db/src/landscape-atlas/types.ts:11-15` (`HEALTH_SPLIT`, `HEALTH_DANGER_BELOW`)
- Modify: `packages/db/src/landscape-atlas/scales.ts:34` (`healthTone`)
- Modify: `apps/ingestion/src/scripts/verdicts-diff.ts:31,65-70` (`HEALTH_BAND_BOUNDARIES`, `healthBand`)
- Test: `packages/db/test/landscape-atlas-scales.test.ts` (extend), `packages/shared/test/health-zones.test.ts` (no change)

**Interfaces:**
- Consumes: `healthZone`, `HEALTH_DANGER_BELOW`, `HEALTH_HEALTHY_FROM` from `@kku/shared` (server code may use the root import).
- Produces: `landscape-atlas/types.ts` keeps exporting `HEALTH_SPLIT` and `HEALTH_DANGER_BELOW` (now `= HEALTH_HEALTHY_FROM` / re-export) so `position.ts` and existing tests need no change.

- [ ] **Step 1: Add the failing boundary test** to `packages/db/test/landscape-atlas-scales.test.ts`

```ts
it('healthTone follows the shared zones at the boundaries', () => {
  expect(healthTone(39.99)).toBe('negative');
  expect(healthTone(40)).toBe('warning');
  expect(healthTone(64.99)).toBe('warning');
  expect(healthTone(65)).toBe('positive');
  expect(healthTone(null)).toBe('neutral');
  expect(healthTone(Number.NaN)).toBe('neutral');
});
```

- [ ] **Step 2: Run it and confirm only the NaN assertion fails** (today `NaN < 40` is false, so it returns `'positive'`)

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-scales.test.ts`
Expected: FAIL on `healthTone(Number.NaN)`.

- [ ] **Step 3: Migrate the five sites.**
  - `scales.ts`: `healthTone` maps `healthZone(score)`: `null → 'neutral'`, `danger → 'negative'`, `attention → 'warning'`, `healthy → 'positive'`.
  - `types.ts`: `HEALTH_SPLIT` and `HEALTH_DANGER_BELOW` become re-exports of the shared constants. Keep the names and doc comments.
  - `cockpit.service.ts:93`: count `healthZone(s.overall.score) === 'danger'`. Null still does not count (Review Focus 3).
  - `cockpit.controller.ts:501`: zone → `'danger' | 'warning' | 'success'` via a local literal map. `:554`: `healthZone(r.overall.score) === 'healthy'`. The Thai copy `(คะแนน ≥ 65)` and `(คะแนนรวม < 40)` at `:544`/`:556` interpolates `HEALTH_HEALTHY_FROM` / `HEALTH_DANGER_BELOW`. Do the same for the English line in `cockpit.service.ts:593`.
  - `verdicts-diff.ts`: delete `HEALTH_BAND_BOUNDARIES`. `healthBand` returns `healthZone(score) ?? 'unknown'` (the zone names already match).

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @kku/db exec vitest run test/landscape-atlas-scales.test.ts test/landscape-atlas-position.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/cockpit packages/db/src/landscape-atlas apps/ingestion/src/scripts/verdicts-diff.ts packages/db/test/landscape-atlas-scales.test.ts
git commit -m "refactor: route server-side health zones through healthZone"
```

### Task 3: `@kku/ui` heatmap

**Files:**
- Modify: `packages/ui/src/viz/heatmap.tsx:134` (cell tint) and `:194` (score text tone)

**Interfaces:**
- Consumes: `healthZone` from `@kku/shared/health/zones` (subpath; this component renders client-side).

- [ ] **Step 1: Migrate both ternaries** to `healthZone(cell.score)` plus a module-level literal map `{ danger: 'danger', attention: 'warning', healthy: 'success' }` for `:134` and `{ danger: 'text-danger', attention: 'text-warning', healthy: 'text-success' }` for `:194`. Both sites already handle `null` before the ternary; keep that branch.

- [ ] **Step 2: Typecheck and build the package**

Run: `pnpm --filter @kku/ui exec tsc --noEmit && pnpm --filter @kku/ui test`
Expected: no errors. The test passes (the package uses `--passWithNoTests`).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/viz/heatmap.tsx
git commit -m "refactor(ui): heatmap uses healthZone"
```

### Task 4: `apps/web` call sites

> **Decided 2026-11-11 by the owner: option (b).** `apps/web/src/components/dashboard/health-by-faculty.tsx:49-54` bands at **45** (`>= 65 good`, `>= 45 fair`, else `poor`), not 40. It stays as it is and does NOT use `healthZone`. Add a comment above `band()` saying the bands deliberately differ from the shared health zones (`@kku/shared/health/zones`) and that a score of 40-44 therefore reads "poor" here but "needs attention" in the cockpit. No behaviour change.

**Files:**
- Modify: `apps/web/app/programs/[id]/client.tsx:677` (Overall number) and `:5063` (`scoreToneClass`)
- Modify: `apps/web/app/programs/[id]/print/page.tsx:337` (`overallTone`) and `:595`
- Modify: `apps/web/app/cockpit/client.tsx:682`
- Modify: `apps/web/src/components/dashboard/health-by-faculty.tsx:49` (comment only, per the decision above)
- Modify: `apps/web/app/dashboards/executive-landscape/chapters/shape-section.tsx:41` (description string: build the numbers from the constants)

**Interfaces:**
- Consumes: `healthZone`, `HEALTH_DANGER_BELOW`, `HEALTH_HEALTHY_FROM` from `@kku/shared/health/zones` (subpath, since `client.tsx` files are `'use client'`).

- [ ] **Step 1: Make `scoreToneClass` (client.tsx:5063) the single text-tone helper in that file.** Rewrite it over `healthZone` with a literal map (`null → 'text-text-tertiary'`). Replace the inline ternary at `:677` with a call to it.

- [ ] **Step 2: Migrate the print page (`:337`, `:595`) and `cockpit/client.tsx:682`** the same way, each with its own literal class map. Interpolate the constants into the `shape-section.tsx` description.

- [ ] **Step 3: Add the exception comment to `health-by-faculty.tsx`** (decision (b) above; logic unchanged).

- [ ] **Step 4: Confirm no health-zone literals remain**

Run: `grep -rnE "(<|>=) ?(40|65)\b" --include=*.ts --include=*.tsx apps packages | grep -v node_modules | grep -vE "\.test\.|/test/"`
Expected: only the out-of-scope lines listed above, `health-by-faculty.tsx` (exception (b)), the in-app methodology paper's prose (`apps/web/app/docs/methodology/content-{en,th}.tsx`), lifecycle `RISING`/`STABLE` bands, and AI-readiness `>= 45` bands.

- [ ] **Step 5: Typecheck and build web** (catches a server-only import leaking into a client bundle)

Run: `pnpm typecheck && pnpm --filter web build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "refactor(web): health score colours use healthZone"
```

### Task 5: Docs

**Files:**
- Modify: `docs/methodologies/health-score.md` (near `## Data completeness`, line ~952: add a short `## Zones` section)
- Modify: `docs/guides/adapt-a-methodology.md` (one row in the "Where to change what" table)
- Modify: `docs/th/guides/adapt-a-methodology.md` (Thai twin; mirror the row). `health-score.md` has no Thai twin.
- Modify: `packages/db/src/health-score/tuning.ts` (header comment only: add zones to "What is NOT here") and `packages/db/src/health-score/README.md` (one line). Comment-only, so the tuning pin is unaffected.

- [ ] **Step 1: Write the `## Zones` section.** It covers the three zones and their cut-offs, says the code lives in `packages/shared/src/health/zones.ts`, and notes that zones are decided on the unrounded score (so 64.6 displays "65" in amber). It also says that changing the cut-offs is a presentation change: no `HEALTH_SCORE_VERSION` bump or `INSTITUTION_REVISION`, but update this doc and the in-app methodology pages (`apps/web/app/docs/methodology/content-{en,th}.tsx`). Say why that is safe for the Council-facing danger-zone count: its label prints the cut-off it used (Task 2 interpolates the constants), so the published figure documents itself. Mention the `health-by-faculty.tsx` exception.

- [ ] **Step 2: Add the adopter row** to the "Where to change what" table in `adapt-a-methodology.md` (EN and TH): *Zone cut-offs (danger / needs attention / healthy) → `packages/shared/src/health/zones.ts` → No: presentation, not formula.* Add zones to the "What is NOT here" list in `tuning.ts`'s header and one line to the health-score `README.md`.

- [ ] **Step 3: Build the docs site**

Run: `pnpm docs:build`
Expected: succeeds, no dead links.

- [ ] **Step 4: Full check and commit**

Run: `pnpm check`
Expected: lint, typecheck and tests pass, apart from the known pre-existing failures listed in CLAUDE.md.

```bash
git add docs
git commit -m "docs: document health-score zones and where to change them"
```

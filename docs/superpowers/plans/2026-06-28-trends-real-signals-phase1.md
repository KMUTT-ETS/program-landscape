# Trends Real Signals (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Trends Radar's mock-connector signals with real ones — flip all 9 external-signal connectors to real (dev + prod), purge the accumulated mock signals, fix the document-fetch UA + dead catalog URLs, and let admins remove any signal.

**Architecture:** The 9 connectors (`world-bank` + 8 curated-report sources) are registered with real implementations; flipping is `mocked:false` in the catalog (→ `data_sources.status`) + `CONNECTOR_<SLUG>_MODE=real` in env (→ connector execution) — both must flip together (drift-audit rule). All curated connectors emit a real signal per catalog entry even when the document download fails (signal-only degrade), so URL/UA fixes are quality, not blocking. A new `DELETE /trends/signals/:id` + `/trends` Remove UI handle any-origin removal.

**Tech Stack:** Prisma/Postgres, NestJS (api), Next.js (web), ingestion connectors, Vitest.

---

## File Structure

**Modify:**
- `packages/shared/src/ingestion/catalog.ts` — `mocked: true → false` for the 9 slugs.
- `.env.example` + `.env.prod.example` — add 9 `CONNECTOR_<SLUG>_MODE=real`.
- `apps/ingestion/src/connectors/sources/external-reports/curated-report-connector.ts:106` — browser User-Agent.
- `.../external-reports/catalogs/{adb-gms,nxpo-reports,eeco-reports}.json` — refresh dead URLs.
- `packages/db/prisma/seed.ts` — delete the dead `trendSignalSeeds` block.
- `apps/api/src/trends/trends.controller.ts` (+ service if present) — `DELETE /trends/signals/:id`.
- `apps/web/app/trends/client.tsx` — admin Remove action + recurrence note.

**Create:**
- `apps/ingestion/src/scripts/purge-mock-signals.ts` — one-shot purge (+ `pnpm trends:purge-mock`).
- `apps/web/app/api/trends-signals/[id]/route.ts` — web DELETE proxy.

---

## Task 1: Flip the 9 connectors real (catalog + env)

**Files:** `packages/shared/src/ingestion/catalog.ts`; `.env.example`; `.env.prod.example`

The 9 slugs + env keys (upper, `-`→`_`, prefix `CONNECTOR_`, suffix `_MODE`):
`world-bank`→`CONNECTOR_WORLD_BANK_MODE`, `mhesi-policy`→`CONNECTOR_MHESI_POLICY_MODE`, `nesdc-reports`→`CONNECTOR_NESDC_REPORTS_MODE`, `nxpo-reports`→`CONNECTOR_NXPO_REPORTS_MODE`, `boi-sectoral`→`CONNECTOR_BOI_SECTORAL_MODE`, `eeco-reports`→`CONNECTOR_EECO_REPORTS_MODE`, `wef-future-of-jobs`→`CONNECTOR_WEF_FUTURE_OF_JOBS_MODE`, `oecd-reports`→`CONNECTOR_OECD_REPORTS_MODE`, `adb-gms`→`CONNECTOR_ADB_GMS_MODE`.

- [ ] **Step 1: Catalog — flip `mocked` for the 9.** In `catalog.ts`, for each of the 9 slug entries, change `mocked: true` → `mocked: false`. (The seed sets `data_sources.status = entry.mocked ? 'mocked' : 'active'`, so this keeps status+mocked atomic — drift-audit rule.) Leave all OTHER slugs unchanged.

- [ ] **Step 2: env — add the 9 real-mode flags.** In BOTH `.env.example` and `.env.prod.example`, in the connector-mode section (after the existing `CONNECTOR_KKU_*_MODE=real` lines), add (uncommented):
```
CONNECTOR_WORLD_BANK_MODE=real
CONNECTOR_MHESI_POLICY_MODE=real
CONNECTOR_NESDC_REPORTS_MODE=real
CONNECTOR_NXPO_REPORTS_MODE=real
CONNECTOR_BOI_SECTORAL_MODE=real
CONNECTOR_EECO_REPORTS_MODE=real
CONNECTOR_WEF_FUTURE_OF_JOBS_MODE=real
CONNECTOR_OECD_REPORTS_MODE=real
CONNECTOR_ADB_GMS_MODE=real
```
Also add the same 9 lines to the **live dev `.env`** (the symlinked root `.env`) so dev runs them real — append them (the file is gitignored; this is a local change, still do it so verification works).

- [ ] **Step 3: Typecheck shared.** `pnpm --filter @kku/shared typecheck` → clean.

- [ ] **Step 4: Commit.**
```bash
git add packages/shared/src/ingestion/catalog.ts .env.example .env.prod.example
git commit -m "feat(trends): flip 9 external-signal connectors to real (catalog + env)"
```

---

## Task 2: Browser User-Agent for curated fetch

**Files:** `apps/ingestion/src/connectors/sources/external-reports/curated-report-connector.ts:105-107`

- [ ] **Step 1: Replace the bot UA with a browser UA.** Change:
```ts
const FETCH_USER_AGENT =
  'KKU-Curriculum-Landscape/1.0 (research; contact: denpong@kku.ac.th)';
```
to:
```ts
// Several upstreams (MHESI, WEF, OECD) 403/refuse a bot UA. A real browser
// UA is required to download their public reports. (Verified: mhesi/wef PDFs
// return 403/000 with the old UA, 200 with this one.)
const FETCH_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
```

- [ ] **Step 2: Typecheck.** `pnpm --filter ingestion typecheck` → clean.

- [ ] **Step 3: Commit.**
```bash
git add apps/ingestion/src/connectors/sources/external-reports/curated-report-connector.ts
git commit -m "fix(trends): browser User-Agent so curated reports download (mhesi/wef)"
```

---

## Task 3: Refresh dead catalog URLs

**Files:** `.../external-reports/catalogs/{adb-gms,nxpo-reports,eeco-reports}.json`

All probed with a browser UA; these entries 404. Refresh each to the current canonical URL (verify HTTP 200 with `curl -sIL -A "Mozilla/5.0 ..." <url>` before committing). The connector degrades to signal-only if a URL still fails, so this is link-quality, not signal-blocking — but every URL committed must be live.

- [ ] **Step 1: adb-gms.json — all 3 entries are dead.** Replace the 3 `sourceUrl`s:
  - `adb-gms-strategic-framework-2030`: → `https://www.adb.org/sites/default/files/institutional-document/678631/gms-economic-cooperation-strategic-framework-2030.pdf` (verified 200).
  - `adb-thailand-country-partnership-2023-2027` + `adb-asia-skills-shortages-2024`: use WebSearch to find each report's current ADB URL (the `/documents/...` and `/publications/...` paths moved). Verify 200. If a report is genuinely gone, point at the org's current equivalent and update `title`/`summaryEn` to match.

- [ ] **Step 2: nxpo-reports.json — refresh the 404 entry.** The `policy-strategy` entry (`https://www.nxpo.or.th/th/policy-strategy/`, 404) → `https://www.nxpo.or.th/th/en/43052/` (NXPO Annual Report 2025, verified 200) or another current NXPO policy page; update `title`/`summary` to match the target. Leave the `bcg-economy-model` entry (200) as-is.

- [ ] **Step 3: eeco-reports.json — refresh the 404 entry.** The `master-plan` entry (`https://www.eeco.or.th/en/master-plan`, 404) → a current EECO page (e.g. `https://www.eeco.or.th/en/home/`, verified 200) or the current EEC master-plan URL if found via WebSearch; update `title`/`summary` to match. Leave the working entry as-is.

- [ ] **Step 4: Verify all refreshed URLs are 200.** For each changed URL: `curl -s -o /dev/null -L -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" -w "%{http_code}\n" -m 25 "<url>"` → expect 200 (or a 3xx that resolves). Note: `oecd-reports` (all 3 anti-bot 403) is intentionally NOT changed — it stays signal-only.

- [ ] **Step 5: Commit.**
```bash
git add apps/ingestion/src/connectors/sources/external-reports/catalogs/adb-gms.json apps/ingestion/src/connectors/sources/external-reports/catalogs/nxpo-reports.json apps/ingestion/src/connectors/sources/external-reports/catalogs/eeco-reports.json
git commit -m "fix(trends): refresh dead curated report URLs (adb, nxpo, eeco)"
```

---

## Task 4: Remove the dead seed-mock-signal block

**Files:** `packages/db/prisma/seed.ts`

The `trendSignalSeeds` array + its `if (SEED_MOCKS)` loop (~lines 758–1107) only run under `SEED_MOCKS=true` (never set) and are the no-mock policy's "capability to create fakes." Delete them.

- [ ] **Step 1: Read the block first.** Open `packages/db/prisma/seed.ts` and confirm the exact span: the `const trendSignalSeeds: SignalSeed[] = [ ... ]` declaration (~758) through the `for (const s of trendSignalSeeds) { ... } // end if (SEED_MOCKS) — trend signals` loop (~1107), including the opening `if (SEED_MOCKS) {` that wraps the loop. Confirm nothing AFTER the block references `trendSignalSeeds` or any variable defined only inside it (`grep -n "trendSignalSeeds\|SignalSeed" packages/db/prisma/seed.ts`).

- [ ] **Step 2: Delete the block** (the `trendSignalSeeds` array, its `if (SEED_MOCKS)` wrapper, and the create loop). If the `SignalSeed` type is now unused, remove its definition too. Leave all other `SEED_MOCKS` blocks (peer programs, scenarios, etc.) untouched — out of Phase 1 scope.

- [ ] **Step 3: Seed still runs clean.** `pnpm db:seed` → completes without error (it will NOT create trend signals now). `pnpm --filter @kku/db typecheck` → clean.

- [ ] **Step 4: Commit.**
```bash
git add packages/db/prisma/seed.ts
git commit -m "chore(seed): remove dead mock trend-signal seed block (no-mock policy)"
```

---

## Task 5: Purge script for accumulated mock-connector signals

**Files:** Create `apps/ingestion/src/scripts/purge-mock-signals.ts`; register `trends:purge-mock` in `apps/ingestion/package.json` scripts (mirror an existing script entry's form).

Predicate: a signal is purgeable iff it has **no** backing `TrendDocument` **AND** `externalAiSourceId IS NULL` (connector/monitor/seed origin — all currently mock because the connectors run mock until Task 1's env flips take effect). Keeps the real external-AI + document-backed signals.

- [ ] **Step 1: Write the script.** Create `apps/ingestion/src/scripts/purge-mock-signals.ts`:
```ts
import { prisma } from '@kku/db';

// One-shot: delete connector/monitor/seed-origin TrendSignals (all mock while
// the 9 signal connectors still run in mock mode) so the real connector runs
// repopulate the radar with real signals. Keeps real external-AI-source signals
// and document-backed signals. Dry-run by default; pass --apply to delete.
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const docSignalIds = (
    await prisma.trendDocument.findMany({
      where: { trendSignalId: { not: null } },
      select: { trendSignalId: true },
    })
  )
    .map((d) => d.trendSignalId)
    .filter((v): v is string => v !== null);

  const where = {
    externalAiSourceId: null as string | null,
    id: { notIn: docSignalIds.length ? docSignalIds : ['__none__'] },
  };

  const victims = await prisma.trendSignal.findMany({
    where,
    select: { id: true, title: true, sourceUrl: true },
  });

  console.log(`Purgeable (no TrendDocument + no externalAiSourceId): ${victims.length}`);
  for (const v of victims.slice(0, 10)) {
    console.log(`  - ${v.title.slice(0, 60)}  [${v.sourceUrl ?? 'no url'}]`);
  }
  if (victims.length > 10) console.log(`  … and ${victims.length - 10} more`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete these signals + their notifications.');
    await prisma.$disconnect();
    return;
  }

  const ids = victims.map((v) => v.id);
  const notif = await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  const del = await prisma.trendSignal.deleteMany({ where: { id: { in: ids } } });
  console.log(`Deleted ${del.count} signals + ${notif.count} notifications.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the pnpm script.** In `apps/ingestion/package.json` `scripts`, add `"trends:purge-mock": "tsx src/scripts/purge-mock-signals.ts"` (match the file's existing script style/path; verify other `src/scripts/*.ts` entries use `tsx`).

- [ ] **Step 3: Dry-run + verify count.** `pnpm --filter ingestion trends:purge-mock` → prints ~79 purgeable (the connector-mock signals), keeps external-AI + doc-backed. Confirm the count looks right (≈ total − external-AI − doc-backed).

- [ ] **Step 4: Typecheck.** `pnpm --filter ingestion typecheck` → clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/ingestion/src/scripts/purge-mock-signals.ts apps/ingestion/package.json
git commit -m "feat(trends): purge-mock-signals script (drops connector-mock signals)"
```

---

## Task 6: `DELETE /trends/signals/:id` API

**Files:** `apps/api/src/trends/trends.controller.ts` (read it first to see whether it uses an injected service or inline `prisma`/`S3Storage`; match that). Reuse the deletion logic from `apps/api/src/trend-documents/trend-documents.service.ts :: remove`.

- [ ] **Step 1: Read the controller + the reference remove().** Open `trends.controller.ts` (note its constructor/DI — does it inject a service? `S3Storage`?) and `trend-documents.service.ts` lines ~170-200 (the `remove` body: deletes notifications by `entityId`, the signal, the doc's MinIO object if `storageUrl` starts `s3://`, then the doc row). The new endpoint deletes a signal by id, plus any TrendDocument pointing at it + that doc's object.

- [ ] **Step 2: Add the endpoint.** Add to `TrendsController` (and a service method if the controller delegates to one — match the existing structure). Signature + behavior:
```ts
@Delete('signals/:id')
@Authorized('pdf:upload')
@AuditLog({ action: 'trend_signal.delete', entityType: 'TrendSignal' })
async deleteSignal(@Param('id') id: string): Promise<{ removed: true; hadDocument: boolean }> {
  // 1. signal must exist (else ApiError NOT_FOUND)
  // 2. delete Notification where entityId = id
  // 3. find TrendDocument where trendSignalId = id; if present, best-effort
  //    delete its MinIO object (storageUrl s3://bucket/key) then the doc row
  // 4. delete the TrendSignal
  // return { removed: true, hadDocument }
}
```
Use the SAME imports/decorators the controller already uses (`Delete`, `Param` from `@nestjs/common`; `Authorized`, `AuditLog`, `ApiError` from the common module — verify names against the file). For MinIO, inject/obtain the same `S3Storage` the trend-documents service uses (if `TrendsController` has no storage, add it to its constructor the way `TrendDocumentsService` does, or factor the deletion into a small service). Keep it minimal and consistent with the file's existing style.

- [ ] **Step 3: Typecheck.** `pnpm --filter api typecheck` → clean.

- [ ] **Step 4: Lint the changed file(s).** `pnpm exec eslint apps/api/src/trends/trends.controller.ts <any new service file>` → 0 errors.

- [ ] **Step 5: Commit.**
```bash
git add apps/api/src/trends/
git commit -m "feat(trends): DELETE /trends/signals/:id (remove any radar signal)"
```

---

## Task 7: `/trends` Remove UI + web proxy

**Files:** Create `apps/web/app/api/trends-signals/[id]/route.ts`; modify `apps/web/app/trends/client.tsx`. Mirror the existing patterns in `apps/web/app/api/admin-trend-documents/[id]/route.ts` (DELETE proxy) and `apps/web/app/admin/trend-documents/client.tsx` (two-step-confirm Remove + toast).

- [ ] **Step 1: Read the references.** Open `apps/web/app/api/admin-trend-documents/[id]/route.ts` (proxy auth/cookie/forward mechanics), `apps/web/app/admin/trend-documents/client.tsx` (the inline two-step-confirm Remove + success toast pattern + tokens used), and `apps/web/app/trends/client.tsx` (how signals are rendered; whether it already has the user's role — if not, thread `isAdminGrade`/the role from the server page that renders this client, the way other admin-gated client components do).

- [ ] **Step 2: Web DELETE proxy.** Create `apps/web/app/api/trends-signals/[id]/route.ts` — a `DELETE` handler mirroring `admin-trend-documents/[id]/route.ts` exactly (same `requireSession({ minRole: ... })` gate it uses, same cookie-name logic, same `API_BASE`), forwarding to `${API_BASE}/api/v1/trends/signals/${id}`. Use the same min-role the API gate implies (`pdf:upload` ≈ analyst+; match what trend-documents proxy uses).

- [ ] **Step 3: Remove action in the trends client.** In `apps/web/app/trends/client.tsx`, add — visible only to admin/analyst-grade users — a **Remove** affordance per signal (e.g. in the signal detail panel/row), with a **two-step inline confirm** and a short **recurrence note**: "Connector- or monitor-sourced signals may reappear on the next ingestion run; document signals stay removed." On confirm: `fetch('/api/trends-signals/' + id, { method: 'DELETE' })`; on success show a toast and remove the signal from the local view; on failure show an error. Tokens only — no raw hex (verify classes resolve, e.g. `text-danger`, `text-text-secondary`, `border-border-default`).

- [ ] **Step 4: Lint + typecheck.** `pnpm exec eslint apps/web/app/trends/client.tsx apps/web/app/api/trends-signals/[id]/route.ts` → 0 errors; `pnpm --filter web typecheck` → clean.

- [ ] **Step 5: Commit.**
```bash
git add apps/web/app/trends/client.tsx apps/web/app/api/trends-signals
git commit -m "feat(trends): admin Remove any radar signal + recurrence note"
```

---

## Task 8: Verify end-to-end + PR

- [ ] **Step 1: Regenerate dev state with the real connectors.**
```bash
# reseed so data_sources.mocked flips for the 9 (Task 1) — db:seed is upsert, safe
pnpm db:seed
# purge the existing mock-connector signals
pnpm --filter ingestion trends:purge-mock --apply
# run all 9 real connectors (env now has CONNECTOR_<SLUG>_MODE=real)
for s in world-bank mhesi-policy nesdc-reports nxpo-reports boi-sectoral eeco-reports wef-future-of-jobs oecd-reports adb-gms; do
  echo "=== $s ==="; pnpm --filter ingestion connector:run "$s" || echo "FAILED: $s";
done
```
Expected: each connector SUCCEEDS and creates real signals (or signal-only). Capture per-connector record counts; note any that error (triage — but signal-only is success).

- [ ] **Step 2: Confirm the radar is real + clean.**
```bash
pnpm --filter @kku/db exec tsx -e "import {prisma} from './src/index'; (async()=>{const t=await prisma.trendSignal.count(); const ex=await prisma.trendSignal.count({where:{OR:[{sourceUrl:{contains:'example.'}}]}}); console.log('signals',t,'example-url',ex); await prisma.\$disconnect();})()"
```
Expected: `example-url 0`; total > 0 from real runs.

- [ ] **Step 3: Verify data_sources atomicity (drift audit).** Confirm the 9 slugs now have `status='active'`/non-mocked. Run the project's data-sources drift audit (per [[feedback_data_sources_drift_audit]]) and confirm no new drift for the 9 (intentional exemptions unchanged).

- [ ] **Step 4: Full gate.**
```bash
pnpm typecheck
pnpm exec eslint $(git diff --name-only main...HEAD | grep -E '^(apps|packages)/.*\.(ts|tsx)$' | tr '\n' ' ')
pnpm test
```
Expected: typecheck clean; eslint 0 errors on changed files; tests pass. Fix anything surfaced.

- [ ] **Step 5: Manual smoke (dev server).** On `/trends`: real signals render; an admin sees Remove on a signal → two-step confirm → it disappears + toast. `/admin/trend-documents` still works.

- [ ] **Step 6: Push + PR.**
```bash
git push -u origin feat/trends-real-signals
gh pr create --base main --title "feat: real Trends Radar signals (Phase 1) + remove-any-signal" --body "Implements docs/superpowers/specs/2026-06-28-trends-real-signals-phase1-design.md. Flips the 9 external-signal connectors real (catalog+env), browser UA + refreshed dead URLs, purges accumulated mock-connector signals, removes the dead seed-mock block, and adds DELETE /trends/signals/:id + admin Remove on /trends. No mock signals remain; OECD stays signal-only."
```

- [ ] **Step 7: Confirm CI green.** Address any failures.

---

## Notes for the implementer
- **Recurrence is by design** — connectors dedup by existence and recreate, so a removed connector signal reappears on the next run; the UI warns. Durable suppression is explicitly out of scope.
- **Signal-only is success** — a curated connector that can't download its PDF still emits a real signal from the (real) catalog metadata. OECD (anti-bot) is permanently signal-only — do not treat as failure.
- **Prod rollout** (separate, operator): after deploy, run `pnpm trends:purge-mock --apply` once + let the real connectors run (or trigger them). `SEED_MOCKS` must stay unset.
- **Don't touch** the other `SEED_MOCKS` blocks or non-signal connectors — that's the broader no-mock-on-dev sweep, not Phase 1.

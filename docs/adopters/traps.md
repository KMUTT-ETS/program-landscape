# Traps that will cost you days

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/adopters/traps.md)

**Outcome.** You can recognise the eight failures that cost KKU the most time, and fix each in minutes.

These are hard-won. Each one caused real defects in this repository.

## Trap 1: The Tailwind spacing scale is HALF Tailwind's, and missing keys emit nothing

`packages/design/src/tokens/spacing.ts` **replaces** Tailwind's spacing scale, and its `1` is **2px, not 4px**. Read the file — its header comment is the best explanation you will get.

Two independent consequences:

- **Every spacing utility is half what a Tailwind-fluent developer expects.** `h-4 w-4` on a lucide icon renders at **8px**, not 16px.
- **A utility whose key is not in the scale emits NO CSS AT ALL.** Not a fallback — nothing. `pl-9` is zero padding. `gap-1.5` was silently zero gap until `1.5` was added. `h-3.5 w-3.5` emits nothing, so those icons fall back to the SVG's intrinsic 24×24.

`3.5` is **deliberately absent and must not be "completed"**. 333 of its 338 uses are `h-3.5 w-3.5` on icons; defining it would shrink ~167 elements to 7×7 in a single commit.

The remedy for icons is the separate `iconSize` scale in `packages/design/src/tokens/icon.ts`, exposed as one-class utilities `size-icon-xs` … `size-icon-xl` (12/14/16/20/24px). **Use `size-icon-*` on icons; use the spacing scale only on layout boxes.**

Two more things about the preset:

- **It does not hot-reload.** Changing a token means restarting the dev server.
- **Next caches compiled CSS in `.next/cache/webpack` across restarts.** If a token change appears to have no effect, clear that directory before you debug anything else. You will otherwise chase a phantom for an afternoon.

## Trap 2: `realDataWhere()` — empty sections with rows in the database

`packages/db/src/data-quality.ts` exports `realDataWhere()`, currently `data-quality.v2` in **STRICT** mode. A metric row counts as real if and only if its linked `IngestionRun`'s `DataSource` has `mocked = false`. Rows with `ingestion_run_id IS NULL` are treated as suspect and **excluded**.

So a UI section renders empty despite visible SQL rows for either of two independent reasons:

1. `data_sources.mocked = true` — and note that `mocked` is a **separate column from `status`**. `status='real'` does not imply `mocked=false`. Flip both, always, atomically.
2. `ingestion_run_id IS NULL` — a write path forgot to thread `ctx.runId` through.

Triage SQL:

```sql
SELECT COUNT(*) FILTER (WHERE t.ingestion_run_id IS NOT NULL) AS tagged,
       COUNT(*) FILTER (WHERE ds.mocked = false)              AS pass
  FROM <table> t
  LEFT JOIN ingestion_runs ir ON ir.id = t.ingestion_run_id
  LEFT JOIN data_sources  ds ON ds.id = ir.data_source_id
 WHERE t.program_id = '...';
```

`pnpm provenance:backfill` (dry-run by default) reports orphan counts per table. `pnpm data-sources:audit` catches the `status`/`mocked` drift. Run both after every connector flip and every database reset.

## Trap 3: Oracle accounts lock on connection storms

KKU's registrar Oracle account locks the user when a script opens a connection per call in a loop. Use one session per run — the codebase has `OracleSession` for exactly this, and `apps/ingestion/src/lib/oracle-client.ts` wraps the lifecycle. Do not use `withConnection` inside a loop.

This generalises: every institutional database you touch will have a connection-rate policy you find out about by violating it. Batch first, ask later is the wrong order here — a locked service account is a conversation with an infrastructure team, not a retry.

## Trap 4: Per-app `.env` files and the silent Edge-middleware failure

Next.js loads `.env` from `apps/web/`, **never** from the monorepo root. When it is missing, the Edge-runtime middleware bundle compiles with `NEXTAUTH_SECRET` undefined and **every protected route 307s back to `/signin`** — while the Node runtime, where sign-in itself runs, works fine. The symptom looks like an auth bug. It is an env-loading bug.

Fix: `pnpm link-env`. Re-run it after every root `.env` edit on Windows, where it copies rather than symlinks.

Related architectural constraint: `apps/web/middleware.ts` verifies the session cookie with `jose` directly and **must not import `@/lib/auth`** (which pulls in Prisma and is Node-only). Adding a Prisma call to middleware breaks the Edge build.

## Trap 5: A score of 0 does not mean zero

In the DQ export a module score of `0` means **the module was not taken**. Treat it as a real zero
and every module mean is dragged toward the floor by students who never sat that module, which looks
exactly like a genuine competency problem and will survive review because the number is plausible.

The codebase defends against this with a single exported predicate, `dqScoreWasTaken()`, precisely
so that consumers cannot each write `> 0` until one of them eventually writes `>= 0`. Zeros are
excluded from both `scoreSum` and `takenCount`.

The general lesson, which is not specific to DQ: whenever a source encodes a *status* inside a
*measure*, convert it at the boundary and export one predicate for the rest of the system to share.
Do not let the encoding travel.

Two related reporting rules ride along with it — cells below **6 scored students** are suppressed,
and only bachelor-level programmes are in scope. A blank cell means "too few students to report";
an absent postgraduate row is not a data gap. Both will be read as defects by someone unless the UI
says otherwise, so say it in the UI.

## Trap 6: The `@kku/shared` barrel leaks `node:crypto`

`packages/shared/src/index.ts` re-exports subpaths that import `node:crypto` (`pdf/hash.ts`, `ingestion/kmitl-token.ts`, `ai/providers/google-ai.ts`). A **client component must use `import type` only** from `@kku/shared`; a runtime import crashes the build.

If you need a runtime value in a client component, import it from the specific subpath rather than the barrel, or move it to a client-safe module.

## Trap 7: Stale dev servers, twice over

Two distinct staleness bugs with an identical symptom — "a `tsx` script works but the running app does not":

- **`next dev` keeps the OLD Prisma client after a schema change.** If a fresh `pnpm tsx` query succeeds and the dev route fails, restart the dev server. Do not keep debugging.
- **`nest start --watch` only watches `apps/api/src`.** Edits to `packages/db`, `packages/shared`, etc. do not trigger a reload. Restart the API.

In both cases the instinct to keep investigating is what costs the time.

## Trap 8: Non-root container images and volume ownership

Production MinIO runs as UID 65532 (Chainguard rebuild — upstream `minio/minio` is EOL). The data volume must be chowned to 65532 **on the host**, because a compose-run `chown` hits EPERM under `cap_drop`; the file-based secrets must be mode 0644 or MinIO crash-loops with "Invalid credentials". Dev never reproduces this because dev uses env-var credentials and an already-correct volume. `scripts/deploy.sh` handles both — read it before you write your own deploy path.

Separately, the ingestion container runs as UID **1010**, while web and api run as 1001. Any compose-level `user:` directive for ingestion must say `1010:1010`.

## Next step

Continue with [Getting started](../tutorials/getting-started.md).

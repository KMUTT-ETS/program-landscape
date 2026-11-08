# Fork and take upstream fixes

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/upstream-fixes.md)

**Outcome.** You can fork the repository so that future upstream fixes still merge cheaply, and you know where merges will hurt.

## Access

The canonical repository is `https://github.com/khon-kaen-university/program-landscape`. Access is granted by KKU's Office of the Vice President for Education and Digital. You will receive the repository only — no credentials and no data (see [Scope and effort](../adopters/scope-and-effort.md#what-you-are-not-getting)).

## Fork, don't diverge

Adopt as a **git fork with `upstream` configured**, not as a one-time copy. You will want KKU's bug fixes; the codebase is still under active development, and several subsystems (the prompt standard, the health-score methodology, the data-quality provenance chain) have moved substantially in the last few months.

```bash
git clone git@github.com:<your-university>/program-landscape.git
cd program-landscape
git remote add upstream https://github.com/khon-kaen-university/program-landscape.git
git fetch upstream
```

## Structure your changes so merges stay cheap

The single biggest determinant of whether you can still merge upstream in a year is **where you put your institution-specific code**. Recommendations, in descending order of payoff:

| Change type | Do this | Not this |
|---|---|---|
| Your connectors | New directories under `apps/ingestion/src/connectors/sources/<your-slug>/`, added as new `SOURCE_CATALOG` entries and new registry rows | Editing KKU's connector files in place |
| Your faculty/department/programme data | Spreadsheet upload at `/admin/data-setup` — it lives in your database, not your fork. See [Importing from spreadsheets](../data-import.md) | Editing KKU's faculty array in `packages/db/prisma/seed.ts` |
| Branding | Replace asset files and token *values*; keep token *names* | Renaming tokens or restructuring `tailwind-preset.ts` |
| Methodology weights | Bump the version constant and add your variant alongside; see [Adapt a methodology to your institution](./adapt-a-methodology.md) | Editing the KKU formula in place |
| Your `CLAUDE.md` | Rewrite freely — this file is *meant* to diverge | — |

Files you should expect to conflict on every merge, and should therefore keep your edits in as few hunks as possible:

- `packages/shared/src/ingestion/catalog.ts` (append your entries at the end of the array)
- `apps/ingestion/src/connectors/registry.ts` (same)
- `packages/db/prisma/seed.ts`
- `packages/design/src/tokens/*.ts`
- `.env.example`

## Migrations will conflict, and that is the sharp edge

Prisma migrations are timestamp-named directories under `packages/db/prisma/migrations/`. If you add a migration and KKU adds a migration, both apply — but if you both edit the *same table*, you will have to reconcile by hand. Two mitigations:

- Prefix your migration names distinctly (`20260901120000_yourthuni_registrar_bridge`) so the history is readable.
- Prefer **additive** schema changes (new nullable columns, new tables) over altering KKU's. The repo already has this policy for itself; see `docs/migration-policy.md`, and note `scripts/migration-linter.ts`, which CI runs to flag destructive DDL.

## A merge cadence that works

Merge upstream **quarterly, not continuously**. Continuous merging means you re-litigate the same conflicts weekly. Quarterly means you read the intervening `docs/` changes and the `/changelog` page (`apps/web/app/changelog/page.tsx` is the authoritative release history — CLAUDE.md's log is explicitly best-effort and has known gaps) and make one deliberate pass.

## Next step

Continue with [Testing and CI](./testing-and-ci.md).

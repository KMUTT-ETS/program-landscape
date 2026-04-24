# Prompt 14-N · Real-data integration session · `<slug>`

> Use this template for each per-source mini-session that flips a single
> connector from `mocked: true` to `mocked: false`. Copy, rename to
> `14-<slug>-<date>.md`, fill in, then start a Claude session with it.
>
> Every session ships or blocks exactly **one** connector. Not two, not
> half. If you want to wire two connectors at once, run two sessions in
> parallel — don't bundle.

---

## Connector under wire

- **Slug**: `<slug>` — matches the `SOURCE_CATALOG` entry and the
  `docs/data-sources/<slug>.md` spec
- **Owner**: `<name / role>` — who signs off on "this is the real data"
- **Access route**: ☐ API key · ☐ OAuth · ☐ DB read-only · ☐ SFTP ·
  ☐ Web scrape · ☐ PDF bulk-load · ☐ Manual CSV upload
- **Phase**: A (internal) · B (national) · C (international) — see
  `docs/data-sources/README.md`
- **Target environment**: ☐ dev only · ☐ dev + staging · ☐ full prod

## Pre-session checklist (owner completes)

- [ ] Spec at `docs/data-sources/<slug>.md` is filled in beyond the
      stub. The session will be blocked if the spec doesn't describe
      the endpoint, rate limit, PDPA posture, and known issues.
- [ ] Credentials available in the target environment's secret store.
      Credentials live in `docker secrets` (prod) or `.env`
      (dev); they are NEVER committed to git.
- [ ] Sample payload (or sample PDF) captured and committed to
      `apps/ingestion/test/fixtures/<slug>/`. At minimum: one happy
      path and one edge case (empty / malformed).
- [ ] Data owner has confirmed the endpoint is stable (not "in
      migration", not "changing next quarter").
- [ ] PDPA posture is clear. If the connector carries personal data,
      the DPO has counter-signed the spec's PDPA section.

## What this session produces

1. **Real connector class** at
   `apps/ingestion/src/connectors/<slug>/<slug>.connector.ts`
   implementing fetch → transform → load.
2. **Registry wiring** — registry entry's `real?` factory points at
   the new class. The mock stays in place as a fallback.
3. **Ingestion history** — the session ends with at least **3 successful
   runs** visible in `/admin/data-sources/<slug>` and zero failed runs
   across 10 attempts.
4. **Updated spec** — the spec at `docs/data-sources/<slug>.md` is
   filled in with the final endpoint shape, any transforms applied,
   observed quirks, and the "session log" section dated and signed.
5. **Drift fingerprint** — row counts + key field distributions
   captured in the spec. Future runs that deviate > 2σ trigger a
   data-quality flag.

## What this session does NOT do

- **Methodology bumps.** If this connector changes how a metric is
  computed (e.g., finance data replacing the flat overhead proxy),
  that is a separate methodology-bump session.
- **Materialising into domain tables.** Connectors write to the
  raw-data / PDF table. Rollup recomputation into `mv_*_metrics` is a
  downstream session.
- **UI changes.** Connector work does not touch `apps/web`. Any UI
  impact is a follow-up session.
- **Multiple connectors.** One slug per session.

## Standard implementation order

1. **Extend the spec.** Make `docs/data-sources/<slug>.md` specific.
   Endpoint, auth, rate limit, pagination, PDPA posture, backfill
   strategy, monitoring thresholds.
2. **Contract test first.** Write
   `apps/ingestion/test/<slug>.contract.test.ts` that hits the real
   endpoint (in CI: skip; locally: opt-in) and asserts the payload
   shape matches your zod schema. If it fails before you touch any
   code, the spec was wrong.
3. **Fetch layer.** Auth, pagination, retry, timeout. Use the standard
   `fetchWithRetry` helper from `@kku/shared/ingestion` — do NOT roll
   your own.
4. **Transform layer.** Zod-schema validated. Rejected records go to
   `IngestionRun.metadata.rejected[]` with a reason, not silently
   dropped. Schema version recorded in `metadata.schemaVersion`.
5. **Load layer.** Use existing Prisma helpers and patterns from other
   connectors. Upsert on natural keys, never delete-then-insert. Every
   row written is attributed to the current `IngestionRun.id` (add a
   column if the domain table doesn't have one).
6. **Flip the registry.** Set `real: () => new <Slug>Connector(...)`
   in `apps/ingestion/src/connectors/registry.ts`.
7. **Dry-run in `mocked` mode first.** Confirm the old mock still runs
   after your changes. Regression protection.
8. **Flip `CONNECTOR_<SLUG>_MODE=real` in dev `.env`.** Run manually:
   `pnpm --filter @kku/ingestion run-connector <slug>`. Watch the
   logs.
9. **Let the scheduler pick it up.** Restart the ingestion worker; let
   cron fire the job. Confirm the run history.
10. **Update the readiness checklist.** `docs/readiness-checklist.md`
    gate 11 requires a ≥ 30-day green history before this connector
    drives a Council-facing number. Note the date here so the analyst
    on duty knows when to start the countdown.

## Runbook after the session

- Daily: the analyst on duty glances at `/admin/data-sources/<slug>`.
- Weekly: digest review of error codes. Anything new gets a spec entry.
- Monthly: drift-fingerprint comparison. Counts and distributions
  within 2σ of the 30-day baseline.
- On any incident: roll back by flipping
  `CONNECTOR_<SLUG>_MODE=mocked` and redeploying. No data loss —
  mock seed data is the fallback. Postmortem within 3 business days.

## Session template ends here

Paste-in starter for the Claude session:

```
Objective: flip the `<slug>` connector from mocked to real. See
`docs/data-sources/<slug>.md` for the contract and
`prompts/14-integration-session-template.md` for the procedure.

What's already done: [list]
What's blocked on: [list — e.g., "finance team hasn't confirmed field
semantics for `allocated_overhead`"]

Session output must be: real connector class + registry entry + updated
spec + ≥3 green runs. No UI, no methodology bump.
```

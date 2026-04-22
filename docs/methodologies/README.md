# Methodologies

Every metric in the system carries a `methodologyVersion` field. When the
formula or data source changes, the version is bumped, the old doc is kept
in git history, and charts display the version on the provenance drawer.

Docs land here as metrics are implemented:

- `health-score.md` — program health score (prompt 05)
- `cost-allocation.md` — program-level cost methodology (prompt 05 / 08)
- `forecasting.md` — demand-supply forecasting (prompt 08)
- `bcg-position.md` — BCG matrix position (prompt 05)
- `demographic-ceiling.md` — cohort ceiling model (prompt 08)
- …

Filename convention: `<metric-slug>.md`. Every doc begins with a version
history table.

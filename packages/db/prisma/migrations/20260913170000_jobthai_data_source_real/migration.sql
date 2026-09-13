-- JobThai becomes a real source in the data_sources inventory. Data-only, idempotent.
--
-- Hand-written. On dev this row was flipped by `pnpm db:seed` (it writes status
-- AND mocked from SOURCE_CATALOG). deploy.sh never runs the seed, so on prod the
-- row kept its 2026-05-01 deprecated state — and realDataWhere() requires
-- data_sources.mocked = false, so every JobThai row loaded on prod would have
-- been silently invisible. status and mocked are set together, per the
-- data_sources drift audit. Values mirror SOURCE_CATALOG's 'jobthai' entry.

INSERT INTO "data_sources" (
  "id", "name", "kind", "status", "mocked", "slug", "input_format",
  "schedule_enabled", "cadence_cron", "owner_contact", "accepts_pdf_uploads", "created_at", "updated_at"
) VALUES (
  'ds_jobthai', 'JobThai (Job postings)', 'CSV', 'active', false, 'jobthai', 'XLSX',
  false, NULL, 'KKU Data Office', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO UPDATE SET
  "status" = 'active',
  "mocked" = false,
  "input_format" = 'XLSX',
  "schedule_enabled" = false,
  "updated_at" = CURRENT_TIMESTAMP;

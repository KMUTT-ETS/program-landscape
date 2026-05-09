-- Track when each materialized view was last refreshed.
-- Pure additive — new table, no changes to existing tables.
-- Surfaces at /admin/data-quality so ops can see MV staleness.

CREATE TABLE "mv_refresh_log" (
  "view_name"      TEXT        PRIMARY KEY,
  "refreshed_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "duration_ms"    INTEGER     NOT NULL DEFAULT 0,
  "row_count"      BIGINT,
  "trigger"        TEXT        NOT NULL DEFAULT 'manual'
);

-- Pre-seed rows so /admin/data-quality always returns a row per MV
-- (even before the first refresh). `refreshed_at = epoch` signals
-- "never refreshed yet".
INSERT INTO "mv_refresh_log" ("view_name", "refreshed_at", "duration_ms", "row_count", "trigger")
VALUES
  ('mv_program_metrics',    'epoch'::timestamptz, 0, NULL, 'never'),
  ('mv_department_metrics', 'epoch'::timestamptz, 0, NULL, 'never'),
  ('mv_faculty_metrics',    'epoch'::timestamptz, 0, NULL, 'never'),
  ('mv_university_metrics', 'epoch'::timestamptz, 0, NULL, 'never');

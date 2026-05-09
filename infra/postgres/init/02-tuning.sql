-- Postgres tuning + observability for the Program Landscape prod stack.
-- Runs ONCE at first volume init (Postgres docker-entrypoint behaviour).
-- For changes after first boot, set via `ALTER SYSTEM` or update this
-- file + recreate the volume.

-- ── Slow query log ──────────────────────────────────────────────────
-- Log every statement that takes ≥250 ms. Captured by the json-file
-- log driver (compose) with 50m × 5 rotation per service. The 250 ms
-- threshold matches our SLA target for cockpit + deep-dive reads —
-- anything slower needs investigation, not silent acceptance.
ALTER SYSTEM SET log_min_duration_statement = 250;

-- ── Connection observability ────────────────────────────────────────
-- Cheap (one log per (dis)connect) + invaluable for diagnosing pool
-- exhaustion. Captures who connected, from where, and when they left.
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;

-- ── Lock + temp-file diagnostics ───────────────────────────────────
-- Surface long lock waits + spilled-to-disk sorts (both common causes
-- of a stuck Council Pack export).
ALTER SYSTEM SET log_lock_waits = on;
ALTER SYSTEM SET deadlock_timeout = '1s';
ALTER SYSTEM SET log_temp_files = 0;  -- log every temp file created

-- ── Vacuum / autovacuum visibility ──────────────────────────────────
-- We have a few hot tables (audit_logs, ai_inferences) that need
-- regular vacuum to keep query planner stats fresh + reclaim space.
-- Default autovacuum is fine, but logging long autovac runs lets ops
-- see when one runs and how long.
ALTER SYSTEM SET log_autovacuum_min_duration = '5s';

-- ── Apply ───────────────────────────────────────────────────────────
-- ALTER SYSTEM only takes effect after a config reload. The
-- docker-entrypoint runs all *.sql in init/ before serving connections,
-- so trigger a reload here.
SELECT pg_reload_conf();

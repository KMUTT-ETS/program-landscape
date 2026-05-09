-- Composite indexes for hot-path queries identified in
-- docs/hardening/15-db-perf.report.md.
--
-- Both indexes are pure additions — additive migration, idempotent
-- (CREATE INDEX IF NOT EXISTS). The single-column variants
-- (ai_inferences_user_id_idx, ai_inferences_created_at_idx,
-- audit_logs_user_id_idx, audit_logs_created_at_idx) stay because
-- they're still used by other query shapes.

-- ── AiInference: AiQuotaGuard per-user 24h window ─────────────────
-- Hot query (apps/api/src/common/ai-quota.guard.ts):
--   WHERE user_id = ? AND created_at >= ?
-- Postgres can only use ONE single-column index per scan; a composite
-- (user_id, created_at) lets the planner do an index range scan
-- without a heap fetch on the userId match.
CREATE INDEX IF NOT EXISTS "ai_inferences_user_created_idx"
  ON "ai_inferences" ("user_id", "created_at");

-- ── AuditLog: sign-in lockout per-account 15-min window ──────────
-- Hot query (packages/db/src/sign-in-lockout.ts):
--   WHERE user_id = ? AND action = 'auth.signin.fail' AND created_at >= ?
-- Three-column composite covers the full predicate; the existing
-- single-column indexes still cover other AuditLog reads (e.g.
-- DSAR by user_id alone).
CREATE INDEX IF NOT EXISTS "audit_logs_user_action_created_idx"
  ON "audit_logs" ("user_id", "action", "created_at");

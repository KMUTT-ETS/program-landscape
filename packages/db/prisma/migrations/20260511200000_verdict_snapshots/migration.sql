-- Migration: 20260511200000_verdict_snapshots
--
-- Closes evaluation-pipeline.md §13 gap #6 — verdict back-test loop. A
-- VerdictSnapshot row is the union of all three verdict axes (Health
-- Score · Lifecycle Verdict · Risk Tier) at a point in time, stamped with
-- the methodology bundle that produced them. Quarterly snapshots feed
-- `pnpm verdicts:diff` which produces an analyst worklist of programs
-- whose verdicts flipped or whose drivers moved 20+ pts without flipping.
--
-- Why a unified table (not three separate snapshot tables): the back-test
-- question is always "did the verdict hold for THIS program over THIS
-- window" — joining 3 snapshot tables every time is friction. The
-- payloadJson column retains the full structures (HealthScoreRow,
-- ProgramLifecycleResult, ProgramRiskResult) so analysts can grep through
-- history without a schema migration when they want a new view.
--
-- Pure additive. No data destruction.

CREATE TABLE "verdict_snapshots" (
  "id"                      TEXT        PRIMARY KEY,
  "program_id"              TEXT        NOT NULL,
  "snapshot_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Methodology stamp at snapshot time. Comparing snapshots taken under
  -- different bundle versions is meaningful but the diff tool flags it
  -- explicitly so movement isn't misread as "the world changed" when
  -- really "the formula changed".
  "bundle_tag"              TEXT        NOT NULL,
  "bundle_fingerprint"      TEXT        NOT NULL,
  -- Health Score — overall + 5 dimensions + data-completeness percentage.
  -- NULL when the dimension couldn't be computed (rare; happens when the
  -- whole metric universe is mocked for a program).
  "health_overall"          DOUBLE PRECISION,
  "health_attractiveness"   DOUBLE PRECISION,
  "health_financial"        DOUBLE PRECISION,
  "health_capability"       DOUBLE PRECISION,
  "health_outcomes"         DOUBLE PRECISION,
  "health_relevance"        DOUBLE PRECISION,
  "health_completeness_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  -- Lifecycle verdict — see ProgramLifecycleVerdict enum. NULL when the
  -- verdict couldn't be computed for this program.
  "lifecycle_verdict"       TEXT,
  "lifecycle_trajectory"    DOUBLE PRECISION,
  -- Risk Score — composite + L1/L2/L3 + tier from the latest RiskAssessment
  -- row at snapshot time. Risk is BACHELOR-only by design; NULL on non-
  -- BACHELOR programs (Master / Doctoral / Higher Grad Diploma).
  "risk_tier"               TEXT,
  "risk_composite"          DOUBLE PRECISION,
  "risk_l1"                 DOUBLE PRECISION,
  "risk_l2"                 DOUBLE PRECISION,
  "risk_l3"                 DOUBLE PRECISION,
  -- Full per-axis payload. Lets analysts grep through historical state
  -- without needing a migration for every new field they care about.
  "payload_json"            JSONB       NOT NULL,
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "verdict_snapshots"
  ADD CONSTRAINT "verdict_snapshots_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "verdict_snapshots_program_id_snapshot_at_idx"
  ON "verdict_snapshots" ("program_id", "snapshot_at" DESC);
CREATE INDEX "verdict_snapshots_snapshot_at_idx"
  ON "verdict_snapshots" ("snapshot_at" DESC);
CREATE INDEX "verdict_snapshots_bundle_fingerprint_idx"
  ON "verdict_snapshots" ("bundle_fingerprint");

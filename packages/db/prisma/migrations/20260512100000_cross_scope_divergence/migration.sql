-- Migration: 20260512100000_cross_scope_divergence
--
-- Closes evaluation-pipeline.md §13 gap #7. Faculty overall health
-- score and the enrolment-weighted mean of its programs' overall scores
-- are computed independently (each scope reads its own materialised
-- view). The methodology doc acknowledges divergence is "typically small"
-- but never measured it.
--
-- A CrossScopeDivergenceSnapshot row records that measurement for one
-- faculty at one point in time. Quarterly snapshots feed a trend view
-- (+ `/admin/data-quality` once that lands). Divergence > 10 pts flags
-- the faculty for methodology review.
--
-- Pure additive. No data destruction.

CREATE TABLE "cross_scope_divergence_snapshots" (
  "id"                 TEXT        PRIMARY KEY,
  "computed_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "bundle_tag"         TEXT        NOT NULL,
  "bundle_fingerprint" TEXT        NOT NULL,
  "faculty_id"         TEXT        NOT NULL,
  -- Faculty-scope health overall (from computeHealthScores('university')).
  -- NULL when no dimension could be computed at faculty scope.
  "faculty_overall"    DOUBLE PRECISION,
  -- Σ(programOverall × enrolled) / Σ(enrolled) across canonical-and-active
  -- programs in this faculty whose overall score is non-null. NULL when
  -- no program contributed (rare; usually a faculty with no canonical
  -- programs after the `sequence_no_from_sheet IS NOT NULL` filter).
  "bottom_up_weighted" DOUBLE PRECISION,
  "program_count"      INTEGER     NOT NULL DEFAULT 0,
  "programs_with_score" INTEGER    NOT NULL DEFAULT 0,
  "total_enrolled"     INTEGER     NOT NULL DEFAULT 0,
  -- abs(facultyOverall - bottomUpWeighted). NULL when either side is null.
  "divergence"         DOUBLE PRECISION,
  -- divergence > threshold (default 10 pts). Pre-computed so the analyst
  -- worklist query stays cheap.
  "exceeds_threshold"  BOOLEAN     NOT NULL DEFAULT false,
  -- Per-program contributions (programId, overall, enrolled, contribution).
  -- JSONB so analysts can drill in without a follow-up query.
  "payload_json"       JSONB       NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "cross_scope_divergence_snapshots"
  ADD CONSTRAINT "cross_scope_divergence_snapshots_faculty_id_fkey"
  FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "cross_scope_divergence_snapshots_computed_at_idx"
  ON "cross_scope_divergence_snapshots" ("computed_at" DESC);
CREATE INDEX "cross_scope_divergence_snapshots_faculty_id_computed_at_idx"
  ON "cross_scope_divergence_snapshots" ("faculty_id", "computed_at" DESC);
CREATE INDEX "cross_scope_divergence_snapshots_exceeds_threshold_idx"
  ON "cross_scope_divergence_snapshots" ("exceeds_threshold") WHERE "exceeds_threshold" = true;

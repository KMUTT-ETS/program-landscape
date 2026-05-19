-- risk-management.v2 — automated breach → measure link
-- Adds optional trigger fields to risk_measures so the UI can show
-- which indicator + severity prompted a rule-derived measure.
-- All fields nullable; existing rows unaffected.

ALTER TABLE "risk_measures"
  ADD COLUMN "trigger_indicator_slug" TEXT,
  ADD COLUMN "trigger_severity" "RiskIndicatorSeverity";

CREATE INDEX "risk_measures_trigger_indicator_slug_idx"
  ON "risk_measures" ("trigger_indicator_slug");

-- Risk Management v1.6: time horizons on recommended measures
-- Lets Council scan a program profile by what's actionable now (short term)
-- vs longer commitments (medium / long).
-- Additive only.

-- CreateEnum
CREATE TYPE "RiskMeasureHorizon" AS ENUM ('SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM');

-- AlterTable
ALTER TABLE "risk_measures"
  ADD COLUMN "horizon" "RiskMeasureHorizon" NOT NULL DEFAULT 'MEDIUM_TERM';

CREATE INDEX "risk_measures_horizon_idx" ON "risk_measures"("horizon");

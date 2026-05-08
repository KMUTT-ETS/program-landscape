-- KKU 5-level institutional risk matrix (risk-scoring.v1.4)
-- Adds a 5x5 likelihood × impact matrix view on top of the existing
-- composite tier. KKU ERM colour rule:
--   1-4   → LOW (Green)
--   5-9   → MODERATE (Yellow)
--   10-15 → HIGH (Orange)
--   16-25 → VERY_HIGH (Red)
-- Additive only.

-- CreateEnum
CREATE TYPE "KkuRiskLevel" AS ENUM ('NEEDS_DATA', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH');

-- AlterTable
ALTER TABLE "risk_assessments"
  ADD COLUMN "likelihood_bin"   INTEGER,
  ADD COLUMN "impact_bin"       INTEGER,
  ADD COLUMN "kku_matrix_score" INTEGER,
  ADD COLUMN "kku_risk_level"   "KkuRiskLevel" NOT NULL DEFAULT 'NEEDS_DATA';

-- Helpful index for the heatmap query (filters by level + groups by L×I).
CREATE INDEX "risk_assessments_kku_risk_level_idx" ON "risk_assessments"("kku_risk_level");

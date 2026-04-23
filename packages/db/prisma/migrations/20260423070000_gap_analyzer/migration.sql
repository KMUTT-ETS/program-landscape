-- CreateEnum SectorFamily
CREATE TYPE "SectorFamily" AS ENUM ('BCG', 'SCURVE', 'CUSTOM');

-- CreateEnum ForecastKind
CREATE TYPE "ForecastKind" AS ENUM ('DEMAND', 'SUPPLY');

-- CreateTable sectors
CREATE TABLE "sectors" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "family" "SectorFamily" NOT NULL,
    "name_th" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "description_th" TEXT,
    "description_en" TEXT,
    "demand_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "methodology_version" TEXT NOT NULL DEFAULT 'sectors.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sectors_code_key" ON "sectors"("code");
CREATE INDEX "sectors_family_idx" ON "sectors"("family");

-- CreateTable skill_sectors
CREATE TABLE "skill_sectors" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "sector_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_sectors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_sectors_skill_id_sector_id_key" ON "skill_sectors"("skill_id", "sector_id");
CREATE INDEX "skill_sectors_skill_id_idx" ON "skill_sectors"("skill_id");
CREATE INDEX "skill_sectors_sector_id_idx" ON "skill_sectors"("sector_id");

ALTER TABLE "skill_sectors" ADD CONSTRAINT "skill_sectors_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_sectors" ADD CONSTRAINT "skill_sectors_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable forecast_runs
CREATE TABLE "forecast_runs" (
    "id" TEXT NOT NULL,
    "kind" "ForecastKind" NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'TH',
    "target_year" INTEGER NOT NULL,
    "projected_value" DOUBLE PRECISION NOT NULL,
    "ci_50_low" DOUBLE PRECISION,
    "ci_50_high" DOUBLE PRECISION,
    "ci_80_low" DOUBLE PRECISION,
    "ci_80_high" DOUBLE PRECISION,
    "ci_95_low" DOUBLE PRECISION,
    "ci_95_high" DOUBLE PRECISION,
    "actual_value" DOUBLE PRECISION,
    "error_pct" DOUBLE PRECISION,
    "methodology_version" TEXT NOT NULL DEFAULT 'forecasting.v1',
    "notes" TEXT,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forecast_runs_kind_idx" ON "forecast_runs"("kind");
CREATE INDEX "forecast_runs_subject_type_subject_id_idx" ON "forecast_runs"("subject_type", "subject_id");
CREATE INDEX "forecast_runs_region_idx" ON "forecast_runs"("region");
CREATE INDEX "forecast_runs_target_year_idx" ON "forecast_runs"("target_year");

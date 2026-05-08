-- Risk Management module — risk-scoring.v1
-- Adds: AutomationRisk enum on Skill (drives L2 AI-disruption);
--       RiskAssessment + RiskIndicator + RiskIndicatorBreach + RiskMeasure tables;
--       five new enums (RiskTier, RiskMeasureKind, RiskMeasureStatus,
--       RiskIndicatorSeverity, AutomationRisk).
-- Additive — no destructive changes.

-- CreateEnum
CREATE TYPE "AutomationRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskMeasureKind" AS ENUM ('CURRICULUM_MODERNIZE', 'CURRICULUM_DIFFERENTIATE', 'RECRUITMENT_CHANNEL', 'RECRUITMENT_TARGETING', 'COHORT_REDUCTION', 'PROGRAM_MERGE', 'PROGRAM_PHASE_OUT', 'PARTNERSHIP_INDUSTRY', 'FACULTY_HIRE', 'TUITION_ADJUST');

-- CreateEnum
CREATE TYPE "RiskMeasureStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RiskIndicatorSeverity" AS ENUM ('OK', 'WARN', 'CRITICAL');

-- AlterTable: Skill.automation_risk
ALTER TABLE "skills" ADD COLUMN "automation_risk" "AutomationRisk" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable: risk_assessments
CREATE TABLE "risk_assessments" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "assessed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "l1_recruitment_score" DOUBLE PRECISION,
    "l1_recruitment_confidence" DOUBLE PRECISION,
    "l2_ai_disruption_score" DOUBLE PRECISION,
    "l2_ai_disruption_confidence" DOUBLE PRECISION,
    "l3_demographic_score" DOUBLE PRECISION,
    "l3_demographic_confidence" DOUBLE PRECISION,
    "composite_score" DOUBLE PRECISION,
    "tier" "RiskTier" NOT NULL,
    "direct_revenue_at_risk_thb" DECIMAL(16,2),
    "stranded_cost_thb" DECIMAL(16,2),
    "impact_score" DOUBLE PRECISION,
    "methodology_version" TEXT NOT NULL DEFAULT 'risk-scoring.v1',
    "ai_inference_id" TEXT,
    "confidence" DOUBLE PRECISION,
    "narrative_th" TEXT,
    "narrative_en" TEXT,
    "data_gaps_json" JSONB,
    "payload_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: risk_indicators
CREATE TABLE "risk_indicators" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label_th" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "description_th" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "warn_threshold" DOUBLE PRECISION NOT NULL,
    "critical_threshold" DOUBLE PRECISION NOT NULL,
    "alarm_direction" TEXT NOT NULL DEFAULT 'low',
    "methodology_version" TEXT NOT NULL DEFAULT 'risk-scoring.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable: risk_indicator_breaches
CREATE TABLE "risk_indicator_breaches" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "indicator_slug" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "severity" "RiskIndicatorSeverity" NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'risk-scoring.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_indicator_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: risk_measures
CREATE TABLE "risk_measures" (
    "id" TEXT NOT NULL,
    "assessment_id" TEXT NOT NULL,
    "kind" "RiskMeasureKind" NOT NULL,
    "title_th" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "rationale_th" TEXT NOT NULL,
    "rationale_en" TEXT,
    "cost_class" TEXT,
    "expected_delta_thb" DECIMAL(16,2),
    "priority" INTEGER NOT NULL DEFAULT 99,
    "status" "RiskMeasureStatus" NOT NULL DEFAULT 'PROPOSED',
    "decision_id" TEXT,
    "evidence_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_measures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_assessments_program_id_assessed_at_idx" ON "risk_assessments"("program_id", "assessed_at" DESC);

-- CreateIndex
CREATE INDEX "risk_assessments_tier_idx" ON "risk_assessments"("tier");

-- CreateIndex
CREATE INDEX "risk_assessments_assessed_at_idx" ON "risk_assessments"("assessed_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_indicators_slug_key" ON "risk_indicators"("slug");

-- CreateIndex
CREATE INDEX "risk_indicator_breaches_program_id_observed_at_idx" ON "risk_indicator_breaches"("program_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "risk_indicator_breaches_indicator_slug_observed_at_idx" ON "risk_indicator_breaches"("indicator_slug", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "risk_indicator_breaches_severity_idx" ON "risk_indicator_breaches"("severity");

-- CreateIndex
CREATE INDEX "risk_measures_assessment_id_idx" ON "risk_measures"("assessment_id");

-- CreateIndex
CREATE INDEX "risk_measures_status_idx" ON "risk_measures"("status");

-- CreateIndex
CREATE INDEX "risk_measures_decision_id_idx" ON "risk_measures"("decision_id");

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_indicator_breaches" ADD CONSTRAINT "risk_indicator_breaches_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_indicator_breaches" ADD CONSTRAINT "risk_indicator_breaches_indicator_slug_fkey" FOREIGN KEY ("indicator_slug") REFERENCES "risk_indicators"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_measures" ADD CONSTRAINT "risk_measures_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_measures" ADD CONSTRAINT "risk_measures_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "council_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

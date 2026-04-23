-- CreateEnum ScenarioType
CREATE TYPE "ScenarioType" AS ENUM ('SUNSET', 'MERGE', 'LAUNCH', 'RESHAPE', 'REBALANCE');

-- CreateEnum ScenarioWorkflowStatus
CREATE TYPE "ScenarioWorkflowStatus" AS ENUM ('DRAFT', 'SHARED', 'COUNCIL_REVIEWED', 'DECIDED', 'ARCHIVED');

-- AlterTable scenarios — add prompt 09 columns.
ALTER TABLE "scenarios"
  ADD COLUMN "scenario_type" "ScenarioType" NOT NULL DEFAULT 'RESHAPE',
  ADD COLUMN "workflow_status" "ScenarioWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "is_template" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "affected_program_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "horizon_years" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "interventions_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "collaborator_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "parent_scenario_id" TEXT,
  ADD COLUMN "methodology_version" TEXT NOT NULL DEFAULT 'scenario-engine.v1';

CREATE INDEX "scenarios_scenario_type_idx" ON "scenarios"("scenario_type");
CREATE INDEX "scenarios_workflow_status_idx" ON "scenarios"("workflow_status");
CREATE INDEX "scenarios_is_template_idx" ON "scenarios"("is_template");

ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_parent_scenario_id_fkey"
  FOREIGN KEY ("parent_scenario_id") REFERENCES "scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable scenario_runs
CREATE TABLE "scenario_runs" (
    "id" TEXT NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assumptions_snapshot" JSONB NOT NULL,
    "interventions_snapshot" JSONB NOT NULL,
    "projection_json" JSONB NOT NULL,
    "sensitivity_json" JSONB NOT NULL,
    "risk_register_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "brief_ai_inference_id" TEXT,
    "methodology_version" TEXT NOT NULL DEFAULT 'scenario-engine.v1',
    "monte_carlo_n" INTEGER NOT NULL DEFAULT 100,
    "seed" BIGINT NOT NULL DEFAULT 42,

    CONSTRAINT "scenario_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "scenario_runs_scenario_id_idx" ON "scenario_runs"("scenario_id");
CREATE INDEX "scenario_runs_run_at_idx" ON "scenario_runs"("run_at");

ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_scenario_id_fkey"
  FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scenario_runs" ADD CONSTRAINT "scenario_runs_brief_ai_inference_id_fkey"
  FOREIGN KEY ("brief_ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

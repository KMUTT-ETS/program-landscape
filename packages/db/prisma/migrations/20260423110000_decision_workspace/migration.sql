-- Expand DecisionStatus enum with the 4 new values from prompt 12 spec.
ALTER TYPE "DecisionStatus" ADD VALUE IF NOT EXISTS 'COUNCIL_REVIEWED';
ALTER TYPE "DecisionStatus" ADD VALUE IF NOT EXISTS 'IN_IMPLEMENTATION';
ALTER TYPE "DecisionStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "DecisionStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- CreateEnum DecisionMilestoneStatus
CREATE TYPE "DecisionMilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED');

-- CreateEnum AnnotationVisibility
CREATE TYPE "AnnotationVisibility" AS ENUM ('PRIVATE', 'TEAM', 'COUNCIL');

-- CreateEnum OutcomeReviewHorizon
CREATE TYPE "OutcomeReviewHorizon" AS ENUM ('SIX_MONTHS', 'ONE_YEAR', 'THREE_YEARS');

-- AlterTable council_decisions — add prompt 12 columns.
-- Default title from decision_type + first affected program id; editable after.
ALTER TABLE "council_decisions"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "faculty_id" TEXT,
  ADD COLUMN "dissenting_views_th" TEXT,
  ADD COLUMN "council_session_ref" TEXT,
  ADD COLUMN "snapshot_json" JSONB,
  ADD COLUMN "snapshot_captured_at" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "superseded_by_id" TEXT,
  ADD COLUMN "resolution_pdf_id" TEXT;

-- Backfill title for any pre-existing rows — there aren't any in v1 (this
-- is a fresh DB), but the SQL keeps the column non-null.
UPDATE "council_decisions" SET "title" = CONCAT(decision_type::text, ' decision') WHERE "title" = '';

CREATE INDEX "council_decisions_faculty_id_idx" ON "council_decisions"("faculty_id");
CREATE INDEX "council_decisions_superseded_by_id_idx" ON "council_decisions"("superseded_by_id");

ALTER TABLE "council_decisions" ADD CONSTRAINT "council_decisions_superseded_by_id_fkey"
  FOREIGN KEY ("superseded_by_id") REFERENCES "council_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "council_decisions" ADD CONSTRAINT "council_decisions_resolution_pdf_id_fkey"
  FOREIGN KEY ("resolution_pdf_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable annotations — add visibility.
ALTER TABLE "annotations"
  ADD COLUMN "visibility" "AnnotationVisibility" NOT NULL DEFAULT 'PRIVATE';
CREATE INDEX "annotations_visibility_idx" ON "annotations"("visibility");

-- CreateTable decision_milestones
CREATE TABLE "decision_milestones" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description_th" TEXT,
    "owner_id" TEXT,
    "target_date" DATE,
    "completed_date" DATE,
    "status" "DecisionMilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "evidence_url" TEXT,
    "order_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_milestones_decision_id_order_idx_idx" ON "decision_milestones"("decision_id", "order_idx");
CREATE INDEX "decision_milestones_owner_id_idx" ON "decision_milestones"("owner_id");
CREATE INDEX "decision_milestones_status_idx" ON "decision_milestones"("status");
CREATE INDEX "decision_milestones_target_date_idx" ON "decision_milestones"("target_date");

ALTER TABLE "decision_milestones" ADD CONSTRAINT "decision_milestones_decision_id_fkey"
  FOREIGN KEY ("decision_id") REFERENCES "council_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_milestones" ADD CONSTRAINT "decision_milestones_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable decision_approvers
CREATE TABLE "decision_approvers" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'approver',
    "signature_ref" TEXT,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note_th" TEXT,

    CONSTRAINT "decision_approvers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_approvers_decision_id_user_id_key" ON "decision_approvers"("decision_id", "user_id");
CREATE INDEX "decision_approvers_decision_id_idx" ON "decision_approvers"("decision_id");
CREATE INDEX "decision_approvers_user_id_idx" ON "decision_approvers"("user_id");

ALTER TABLE "decision_approvers" ADD CONSTRAINT "decision_approvers_decision_id_fkey"
  FOREIGN KEY ("decision_id") REFERENCES "council_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_approvers" ADD CONSTRAINT "decision_approvers_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable decision_outcome_reviews
CREATE TABLE "decision_outcome_reviews" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "horizon" "OutcomeReviewHorizon" NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "narrative_th" TEXT NOT NULL,
    "narrative_en" TEXT,
    "what_worked_json" JSONB NOT NULL,
    "what_didnt_work_json" JSONB NOT NULL,
    "lessons_json" JSONB NOT NULL,
    "ai_inference_id" TEXT,
    "methodology_version" TEXT NOT NULL DEFAULT 'outcome-review.v1',

    CONSTRAINT "decision_outcome_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_outcome_reviews_decision_id_horizon_key" ON "decision_outcome_reviews"("decision_id", "horizon");
CREATE INDEX "decision_outcome_reviews_decision_id_idx" ON "decision_outcome_reviews"("decision_id");
CREATE INDEX "decision_outcome_reviews_horizon_idx" ON "decision_outcome_reviews"("horizon");

ALTER TABLE "decision_outcome_reviews" ADD CONSTRAINT "decision_outcome_reviews_decision_id_fkey"
  FOREIGN KEY ("decision_id") REFERENCES "council_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "decision_outcome_reviews" ADD CONSTRAINT "decision_outcome_reviews_ai_inference_id_fkey"
  FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Actual recruitment campaigns (POWERBI.ADMISSION_STAT) + PROGRAMID→program bridge.
-- Additive only.

-- CreateTable
CREATE TABLE "admission_campaign_stats" (
    "id" TEXT NOT NULL,
    "w_program_id" TEXT NOT NULL,
    "recruitment_program_id" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "source_faculty_id" INTEGER,
    "faculty_name_th" TEXT NOT NULL,
    "faculty_id" TEXT,
    "acad_year_be" INTEGER NOT NULL,
    "round" TEXT NOT NULL,
    "enroll_seats" INTEGER,
    "plan_per_year" INTEGER,
    "total_applicants" INTEGER,
    "total_passed" INTEGER,
    "send_clearinghouse" INTEGER,
    "confirm_clearinghouse" INTEGER,
    "send_reg_reported" INTEGER,
    "reg_reported" INTEGER,
    "freshness_date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kku-admission-campaigns',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ingestion_run_id" TEXT,

    CONSTRAINT "admission_campaign_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_stat_program_mappings" (
    "id" TEXT NOT NULL,
    "recruitment_program_id" TEXT NOT NULL,
    "sample_campaign_name" TEXT,
    "faculty_name_th" TEXT,
    "program_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "method" TEXT NOT NULL DEFAULT 'llm-assisted',
    "notes" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admission_stat_program_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admission_campaign_stats_w_program_id_key" ON "admission_campaign_stats"("w_program_id");

-- CreateIndex
CREATE INDEX "admission_campaign_stats_recruitment_program_id_idx" ON "admission_campaign_stats"("recruitment_program_id");

-- CreateIndex
CREATE INDEX "admission_campaign_stats_faculty_id_idx" ON "admission_campaign_stats"("faculty_id");

-- CreateIndex
CREATE INDEX "admission_campaign_stats_acad_year_be_idx" ON "admission_campaign_stats"("acad_year_be");

-- CreateIndex
CREATE INDEX "admission_campaign_stats_ingestion_run_id_idx" ON "admission_campaign_stats"("ingestion_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_stat_program_mappings_recruitment_program_id_key" ON "admission_stat_program_mappings"("recruitment_program_id");

-- CreateIndex
CREATE INDEX "admission_stat_program_mappings_program_id_idx" ON "admission_stat_program_mappings"("program_id");

-- AddForeignKey
ALTER TABLE "admission_campaign_stats" ADD CONSTRAINT "admission_campaign_stats_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_campaign_stats" ADD CONSTRAINT "admission_campaign_stats_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_stat_program_mappings" ADD CONSTRAINT "admission_stat_program_mappings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

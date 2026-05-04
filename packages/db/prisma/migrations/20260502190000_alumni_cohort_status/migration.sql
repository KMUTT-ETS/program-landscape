-- Bucketed alumni status counts per (program × entry-year cohort).
-- Rolls up the Oracle registrar's 30+ raw STUDENTSTATUS values into 8
-- funnel-relevant buckets. Together with `student_cohort_distributions`
-- (still-enrolled students), it covers every student of every cohort.

CREATE TABLE "alumni_cohort_statuses" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "entry_year_be" INTEGER NOT NULL,
    "status_bucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alumni_cohort_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alumni_cohort_statuses_program_id_entry_year_be_status_bucket_key"
  ON "alumni_cohort_statuses"("program_id", "entry_year_be", "status_bucket");
CREATE INDEX "alumni_cohort_statuses_program_id_idx" ON "alumni_cohort_statuses"("program_id");
CREATE INDEX "alumni_cohort_statuses_entry_year_be_idx" ON "alumni_cohort_statuses"("entry_year_be");

ALTER TABLE "alumni_cohort_statuses"
  ADD CONSTRAINT "alumni_cohort_statuses_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

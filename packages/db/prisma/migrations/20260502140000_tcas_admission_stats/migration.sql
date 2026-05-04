-- TCAS admission statistics — annual maxmin xlsx published by CUPT/mytcas.com.
-- One row per (TCAS course code × entry year BE × round). KKU rows resolve
-- to programs.id when faculty + programme name match; peer institution rows
-- keep program_id NULL and are kept for cross-institution benchmarking.

CREATE TABLE "tcas_admission_stats" (
    "id" TEXT NOT NULL,
    "program_id" TEXT,
    "tcas_course_code" TEXT NOT NULL,
    "institution_name" TEXT NOT NULL,
    "campus_name" TEXT,
    "faculty_name" TEXT,
    "programme_name" TEXT NOT NULL,
    "major_name" TEXT,
    "entry_year_be" INTEGER NOT NULL,
    "round" TEXT NOT NULL,
    "quota" INTEGER NOT NULL,
    "applicants" INTEGER NOT NULL,
    "admitted_pass1" INTEGER NOT NULL,
    "admitted_pass2" INTEGER NOT NULL,
    "max_score_pass1" DOUBLE PRECISION,
    "min_score_pass1" DOUBLE PRECISION,
    "max_score_pass2" DOUBLE PRECISION,
    "min_score_pass2" DOUBLE PRECISION,
    "source_url" TEXT NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'tcas-stat.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tcas_admission_stats_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tcas_admission_stats_program_id_idx" ON "tcas_admission_stats"("program_id");
CREATE INDEX "tcas_admission_stats_entry_year_be_round_idx" ON "tcas_admission_stats"("entry_year_be", "round");
CREATE INDEX "tcas_admission_stats_institution_name_idx" ON "tcas_admission_stats"("institution_name");
CREATE INDEX "tcas_admission_stats_faculty_name_idx" ON "tcas_admission_stats"("faculty_name");
CREATE UNIQUE INDEX "tcas_admission_stats_tcas_course_code_entry_year_be_round_key"
  ON "tcas_admission_stats"("tcas_course_code", "entry_year_be", "round");

ALTER TABLE "tcas_admission_stats"
  ADD CONSTRAINT "tcas_admission_stats_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

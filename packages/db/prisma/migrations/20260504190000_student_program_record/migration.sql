-- DS1001 — student-level snapshot, one row per (student × AY × sem).
-- Direct identifiers (name, full DOB, address, passport) are DROPPED at
-- ingestion-time projection. Citizen ID + student ID are stored hashed.
CREATE TABLE "student_program_record" (
    "id" TEXT NOT NULL,
    "citizen_id_hash" TEXT NOT NULL,
    "student_code_hash" TEXT,
    "program_id" TEXT,
    "mhesi_curr_id" TEXT NOT NULL,
    "fac_id" TEXT,
    "academic_year" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "univ_id" TEXT,

    "gender_id" TEXT,
    "nationality_id" TEXT,
    "birth_year" INTEGER,
    "admit_year" INTEGER,

    "study_type_id" TEXT,
    "study_time_id" TEXT,
    "study_reg_id" TEXT,
    "class_year" TEXT,
    "degree_num" INTEGER,
    "graduation_status_id" TEXT,
    "student_status_id" TEXT,
    "terminate_cause" TEXT,

    "gpa" DOUBLE PRECISION,
    "gpax" DOUBLE PRECISION,
    "num_credit" INTEGER,
    "acc_credit" INTEGER,

    "fund_status_id" TEXT,
    "fund_name" TEXT,
    "deform_id" TEXT,
    "talent_id" TEXT,

    "ingestion_run_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_program_record_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_student_record_natural" ON "student_program_record"("academic_year", "semester", "citizen_id_hash");
CREATE INDEX "student_program_record_citizen_id_hash_idx" ON "student_program_record"("citizen_id_hash");
CREATE INDEX "student_program_record_program_id_idx" ON "student_program_record"("program_id");
CREATE INDEX "student_program_record_mhesi_curr_id_idx" ON "student_program_record"("mhesi_curr_id");
CREATE INDEX "student_program_record_fac_id_idx" ON "student_program_record"("fac_id");
CREATE INDEX "student_program_record_student_status_id_idx" ON "student_program_record"("student_status_id");

ALTER TABLE "student_program_record"
  ADD CONSTRAINT "student_program_record_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_program_record"
  ADD CONSTRAINT "student_program_record_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

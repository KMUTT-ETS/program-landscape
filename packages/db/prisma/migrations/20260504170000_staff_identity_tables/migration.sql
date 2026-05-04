-- Cross-system identity column on FacultyMember (lazily populated by
-- the connectors that observe a matching SHA-256(citizen_id) value).
ALTER TABLE "faculty_members" ADD COLUMN "citizen_id_hash" TEXT;
CREATE UNIQUE INDEX "faculty_members_citizen_id_hash_key" ON "faculty_members"("citizen_id_hash");

-- DS2003 — Education qualifications of all employees.
CREATE TABLE "staff_education_history" (
    "id" TEXT NOT NULL,
    "citizen_id_hash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "academic_year" TEXT,
    "semester" TEXT,
    "univ_id" TEXT,
    "grad_year" TEXT,
    "grad_level_id" TEXT,
    "grad_level_name" TEXT,
    "grad_curriculum" TEXT,
    "grad_isced_id" TEXT,
    "grad_program" TEXT,
    "grad_institute" TEXT,
    "grad_country_id" TEXT,
    "ingestion_run_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_education_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_education_history_citizen_id_hash_idx" ON "staff_education_history"("citizen_id_hash");
CREATE INDEX "staff_education_history_grad_country_id_idx" ON "staff_education_history"("grad_country_id");
CREATE INDEX "staff_education_history_grad_level_id_idx" ON "staff_education_history"("grad_level_id");

ALTER TABLE "staff_education_history"
  ADD CONSTRAINT "staff_education_history_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- DS2004 — Academic staff per program (curriculum).
CREATE TABLE "staff_program_assignment" (
    "id" TEXT NOT NULL,
    "citizen_id_hash" TEXT NOT NULL,
    "program_id" TEXT,
    "mhesi_curr_id" TEXT NOT NULL,
    "fac_id" TEXT,
    "teach_type_id" INTEGER NOT NULL,
    "academic_year" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "univ_id" TEXT,
    "ingestion_run_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_program_assignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_program_assignment_citizen_id_hash_idx" ON "staff_program_assignment"("citizen_id_hash");
CREATE INDEX "staff_program_assignment_program_id_idx" ON "staff_program_assignment"("program_id");
CREATE INDEX "staff_program_assignment_mhesi_curr_id_idx" ON "staff_program_assignment"("mhesi_curr_id");
CREATE UNIQUE INDEX "uq_staff_prog_natural" ON "staff_program_assignment"("academic_year", "semester", "citizen_id_hash", "mhesi_curr_id", "teach_type_id");

ALTER TABLE "staff_program_assignment"
  ADD CONSTRAINT "staff_program_assignment_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_program_assignment"
  ADD CONSTRAINT "staff_program_assignment_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

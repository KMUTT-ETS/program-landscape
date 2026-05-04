CREATE TABLE "staff_master_record" (
    "id" TEXT NOT NULL,
    "citizen_id_hash" TEXT NOT NULL,
    "prefix_name_id" TEXT,
    "first_name" TEXT,
    "middle_name" TEXT,
    "last_name" TEXT,
    "first_name_en" TEXT,
    "middle_name_en" TEXT,
    "last_name_en" TEXT,
    "gender_id" TEXT,
    "birth_year" INTEGER,
    "nationality_id" TEXT,
    "staff_type_id" TEXT,
    "sub_staff_type_id" TEXT,
    "time_contact_id" TEXT,
    "budget_id" TEXT,
    "admin_position_id" TEXT,
    "position_work" TEXT,
    "academic_standing_id" TEXT,
    "position_level_id" TEXT,
    "department_raw_id" TEXT,
    "faculty_id" TEXT,
    "date_in_work" DATE,
    "date_start_this_u" DATE,
    "movement_type_id" TEXT,
    "movement_date" DATE,
    "special_name_id_1" TEXT,
    "special_name_id_2" TEXT,
    "academic_standing_subject_id" TEXT,
    "academic_standing_subject_other" TEXT,
    "teach_level_id" TEXT,
    "income_id" TEXT,
    "deform_id" TEXT,
    "researcher_status_id" TEXT,
    "academic_year" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "univ_id" TEXT,
    "ingestion_run_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_master_record_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_staff_master_natural" ON "staff_master_record"("academic_year", "semester", "citizen_id_hash");
CREATE INDEX "staff_master_record_citizen_id_hash_idx" ON "staff_master_record"("citizen_id_hash");
CREATE INDEX "staff_master_record_faculty_id_idx" ON "staff_master_record"("faculty_id");
CREATE INDEX "staff_master_record_staff_type_id_idx" ON "staff_master_record"("staff_type_id");
CREATE INDEX "staff_master_record_sub_staff_type_id_idx" ON "staff_master_record"("sub_staff_type_id");
CREATE INDEX "staff_master_record_academic_standing_id_idx" ON "staff_master_record"("academic_standing_id");
CREATE INDEX "staff_master_record_position_level_id_idx" ON "staff_master_record"("position_level_id");

ALTER TABLE "staff_master_record"
  ADD CONSTRAINT "staff_master_record_faculty_id_fkey"
  FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_master_record"
  ADD CONSTRAINT "staff_master_record_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "staff_compensation_cube" (
    "id" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "faculty_id" TEXT,
    "is_academic" BOOLEAN NOT NULL,
    "level" TEXT,
    "sal_type" TEXT,
    "headcount" INTEGER NOT NULL,
    "mean_salary" DOUBLE PRECISION NOT NULL,
    "min_salary" DOUBLE PRECISION NOT NULL,
    "max_salary" DOUBLE PRECISION NOT NULL,
    "sum_salary" DOUBLE PRECISION NOT NULL,
    "ingestion_run_id" TEXT,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_compensation_cube_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_staff_comp_natural" ON "staff_compensation_cube"("fiscal_year", "faculty_name", "is_academic", "level", "sal_type");
CREATE INDEX "staff_compensation_cube_faculty_id_idx" ON "staff_compensation_cube"("faculty_id");
CREATE INDEX "staff_compensation_cube_fiscal_year_idx" ON "staff_compensation_cube"("fiscal_year");
CREATE INDEX "staff_compensation_cube_is_academic_idx" ON "staff_compensation_cube"("is_academic");

ALTER TABLE "staff_compensation_cube"
  ADD CONSTRAINT "staff_compensation_cube_faculty_id_fkey"
  FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_cube"
  ADD CONSTRAINT "staff_compensation_cube_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

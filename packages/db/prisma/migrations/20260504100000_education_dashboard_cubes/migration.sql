-- Education dashboard cubes — pre-aggregated student / finance roll-ups
-- drawn from the KKU Registrar Oracle warehouse (POWERBI views) on
-- demand via a manual fetch button. No per-student rows ever land here.

-- CreateTable
CREATE TABLE "education_student_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "program_level" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "major" TEXT,
    "major_norm" TEXT NOT NULL DEFAULT '',
    "cohort_year_be" INTEGER NOT NULL,
    "status_code" INTEGER NOT NULL,
    "status_name" TEXT,
    "gender" TEXT,
    "gender_norm" TEXT NOT NULL DEFAULT '',
    "nationality" TEXT,
    "nationality_norm" TEXT NOT NULL DEFAULT '',
    "is_thai" BOOLEAN NOT NULL,
    "entry_type" TEXT,
    "entry_type_norm" TEXT NOT NULL DEFAULT '',
    "student_count" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_student_cube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_student_location_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "program_level" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "cohort_year_be" INTEGER NOT NULL,
    "school_name" TEXT,
    "school_name_norm" TEXT NOT NULL DEFAULT '',
    "school_province_name" TEXT,
    "school_province_norm" TEXT NOT NULL DEFAULT '',
    "thai_region" TEXT,
    "status_code" INTEGER NOT NULL,
    "student_count" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_student_location_cube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_tuition_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "program_level" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "academic_year_be" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "revenue_thb" DECIMAL(18,2) NOT NULL,
    "student_count" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_tuition_cube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "education_cube_refresh" (
    "id" TEXT NOT NULL,
    "cube_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "records_loaded" INTEGER,
    "duration_ms" INTEGER,
    "triggered_by_user_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_cube_refresh_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "education_student_cube_status_code_idx" ON "education_student_cube"("status_code");
CREATE INDEX "education_student_cube_cohort_year_be_idx" ON "education_student_cube"("cohort_year_be");
CREATE INDEX "education_student_cube_faculty_name_idx" ON "education_student_cube"("faculty_name");
CREATE INDEX "education_student_cube_program_level_idx" ON "education_student_cube"("program_level");
CREATE UNIQUE INDEX "education_student_cube_faculty_name_program_level_program_n_key" ON "education_student_cube"("faculty_name", "program_level", "program_name", "major_norm", "cohort_year_be", "status_code", "gender_norm", "nationality_norm", "is_thai", "entry_type_norm");

-- CreateIndex
CREATE INDEX "education_student_location_cube_cohort_year_be_idx" ON "education_student_location_cube"("cohort_year_be");
CREATE INDEX "education_student_location_cube_thai_region_idx" ON "education_student_location_cube"("thai_region");
CREATE INDEX "education_student_location_cube_faculty_name_idx" ON "education_student_location_cube"("faculty_name");
CREATE UNIQUE INDEX "education_student_location_cube_faculty_name_program_level__key" ON "education_student_location_cube"("faculty_name", "program_level", "program_name", "cohort_year_be", "school_name_norm", "school_province_norm", "status_code");

-- CreateIndex
CREATE INDEX "education_tuition_cube_academic_year_be_idx" ON "education_tuition_cube"("academic_year_be");
CREATE INDEX "education_tuition_cube_faculty_name_idx" ON "education_tuition_cube"("faculty_name");
CREATE UNIQUE INDEX "education_tuition_cube_faculty_name_program_level_program_n_key" ON "education_tuition_cube"("faculty_name", "program_level", "program_name", "academic_year_be", "semester");

-- CreateIndex
CREATE INDEX "education_cube_refresh_cube_name_started_at_idx" ON "education_cube_refresh"("cube_name", "started_at");
CREATE INDEX "education_cube_refresh_status_idx" ON "education_cube_refresh"("status");

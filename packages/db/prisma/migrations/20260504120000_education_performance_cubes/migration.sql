-- Two new cubes for the undergraduate-performance dashboard.
--   1. education_performance_cube — per (faculty × program × school ×
--      province × region × status) GPA aggregates from VIEW_STUDENT_DETAIL.
--   2. education_entry_score_cube — per (faculty × program × subject)
--      entry test scores from AVSREG.VIEW_STUDENT_SCORE.

-- CreateTable
CREATE TABLE "education_performance_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "program_level" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "school_name" TEXT,
    "school_name_norm" TEXT NOT NULL DEFAULT '',
    "school_province_name" TEXT,
    "school_province_norm" TEXT NOT NULL DEFAULT '',
    "thai_region" TEXT,
    "status_name" TEXT,
    "status_name_norm" TEXT NOT NULL DEFAULT '',
    "student_count" INTEGER NOT NULL,
    "entry_gpa_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entry_gpa_count" INTEGER NOT NULL DEFAULT 0,
    "gpa_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gpa_count" INTEGER NOT NULL DEFAULT 0,
    "english_gpa_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "english_gpa_count" INTEGER NOT NULL DEFAULT 0,
    "refreshed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_performance_cube_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "education_performance_cube_faculty_name_idx" ON "education_performance_cube"("faculty_name");
CREATE INDEX "education_performance_cube_program_level_idx" ON "education_performance_cube"("program_level");
CREATE INDEX "education_performance_cube_thai_region_idx" ON "education_performance_cube"("thai_region");
CREATE UNIQUE INDEX "education_performance_cube_faculty_name_program_level_progr_key" ON "education_performance_cube"("faculty_name", "program_level", "program_name", "school_name_norm", "school_province_norm", "status_name_norm");

-- CreateTable
CREATE TABLE "education_entry_score_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "program_level" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "subject_code" TEXT NOT NULL,
    "subject_name" TEXT,
    "student_count" INTEGER NOT NULL,
    "score_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score_count" INTEGER NOT NULL DEFAULT 0,
    "score_min" DOUBLE PRECISION,
    "score_max" DOUBLE PRECISION,
    "refreshed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "education_entry_score_cube_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "education_entry_score_cube_faculty_name_idx" ON "education_entry_score_cube"("faculty_name");
CREATE INDEX "education_entry_score_cube_subject_code_idx" ON "education_entry_score_cube"("subject_code");
CREATE UNIQUE INDEX "education_entry_score_cube_faculty_name_program_level_progr_key" ON "education_entry_score_cube"("faculty_name", "program_level", "program_name", "subject_code");

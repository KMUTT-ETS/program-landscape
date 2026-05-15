-- ════════════════════════════════════════════════════════════════════════
-- class_offerings + class_offering_teachers + program_courses
-- and faculty_members.kku_email
--
-- Powers two new dashboards:
--   - /education/class-offerings — subject offerings & seat fulfilment
--   - /staff/teaching-workload   — contact hours per teacher
--
-- Source: POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER (registrar's class-section
-- list with KKUMAIL teacher emails attached). Refreshed by
-- `pnpm programs:link-class-offerings`. PROGRAM_DIGEST course payloads
-- materialise into program_courses via `programs:materialise-program-courses`.
-- HCM EmployeeDetail.EMAIL backfills faculty_members.kku_email via the
-- existing kku-hr connector.
-- ════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "faculty_members" ADD COLUMN "kku_email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "faculty_members_kku_email_key" ON "faculty_members"("kku_email");

-- CreateTable
CREATE TABLE "class_offerings" (
    "id" TEXT NOT NULL,
    "acad_year_be" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_code_raw" TEXT NOT NULL,
    "course_name_th" TEXT,
    "course_name_en" TEXT,
    "section" INTEGER NOT NULL,
    "class_id" BIGINT NOT NULL,
    "credit_total" INTEGER,
    "course_unit" TEXT,
    "lecture_hrs_per_week" INTEGER,
    "lab_hrs_per_week" INTEGER,
    "enroll_seat" INTEGER NOT NULL,
    "total_seat" INTEGER NOT NULL,
    "level_name" TEXT NOT NULL,
    "registry_faculty_id" TEXT NOT NULL,
    "registry_faculty_name" TEXT NOT NULL,
    "faculty_id" TEXT,
    "is_general_education" BOOLEAN NOT NULL DEFAULT false,
    "description_th" TEXT,
    "description_en" TEXT,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestion_run_id" TEXT,

    CONSTRAINT "class_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_offerings_class_id_key" ON "class_offerings"("class_id");

-- CreateIndex
CREATE INDEX "class_offerings_faculty_id_acad_year_be_semester_idx" ON "class_offerings"("faculty_id", "acad_year_be", "semester");

-- CreateIndex
CREATE INDEX "class_offerings_acad_year_be_semester_idx" ON "class_offerings"("acad_year_be", "semester");

-- CreateIndex
CREATE INDEX "class_offerings_course_code_idx" ON "class_offerings"("course_code");

-- CreateIndex
CREATE INDEX "class_offerings_level_name_idx" ON "class_offerings"("level_name");

-- CreateIndex
CREATE INDEX "class_offerings_is_general_education_acad_year_be_semester_idx" ON "class_offerings"("is_general_education", "acad_year_be", "semester");

-- CreateIndex
CREATE INDEX "class_offerings_ingestion_run_id_idx" ON "class_offerings"("ingestion_run_id");

-- AddForeignKey
ALTER TABLE "class_offerings" ADD CONSTRAINT "class_offerings_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_offerings" ADD CONSTRAINT "class_offerings_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "class_offering_teachers" (
    "id" TEXT NOT NULL,
    "class_offering_id" TEXT NOT NULL,
    "kku_email" TEXT NOT NULL,
    "faculty_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_offering_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_offering_teachers_class_offering_id_kku_email_key" ON "class_offering_teachers"("class_offering_id", "kku_email");

-- CreateIndex
CREATE INDEX "class_offering_teachers_faculty_member_id_idx" ON "class_offering_teachers"("faculty_member_id");

-- CreateIndex
CREATE INDEX "class_offering_teachers_kku_email_idx" ON "class_offering_teachers"("kku_email");

-- AddForeignKey
ALTER TABLE "class_offering_teachers" ADD CONSTRAINT "class_offering_teachers_class_offering_id_fkey" FOREIGN KEY ("class_offering_id") REFERENCES "class_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_offering_teachers" ADD CONSTRAINT "class_offering_teachers_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "program_courses" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_code_raw" TEXT NOT NULL,
    "course_name_th" TEXT,
    "course_name_en" TEXT,
    "credits" INTEGER,
    "method_version" TEXT NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingestion_run_id" TEXT,

    CONSTRAINT "program_courses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "program_courses_program_id_course_code_key" ON "program_courses"("program_id", "course_code");

-- CreateIndex
CREATE INDEX "program_courses_course_code_idx" ON "program_courses"("course_code");

-- CreateIndex
CREATE INDEX "program_courses_ingestion_run_id_idx" ON "program_courses"("ingestion_run_id");

-- AddForeignKey
ALTER TABLE "program_courses" ADD CONSTRAINT "program_courses_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_courses" ADD CONSTRAINT "program_courses_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

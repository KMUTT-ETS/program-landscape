-- ─────────────────────────────────────────────────────────────────────
-- Prompt 14 / kku-hr: per-source schema additions.
--
-- Adds:
--   1. hr_org_mappings — bridge from HCMEmployee BU codes to our
--      Faculty/Department FKs. Same allowlist pattern as
--      registry_program_mappings (no fuzzy match).
--   2. faculty_compensation — aggregate-only salary roll-ups
--      from kku-hr Q2 (HEADCOUNT >= 5 suppression at the source).
--   3. HrOrgKind enum (FACULTY | DEPARTMENT | UNRESOLVED).
--
-- Additive — no existing rows touched, no data loss.
-- ─────────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "HrOrgKind" AS ENUM ('FACULTY', 'DEPARTMENT', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "hr_org_mappings" (
    "id" TEXT NOT NULL,
    "hr_code" TEXT NOT NULL,
    "hr_label_th" TEXT,
    "hr_org_kind" "HrOrgKind" NOT NULL,
    "faculty_id" TEXT,
    "department_id" TEXT,
    "is_resolved" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hr_org_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_compensation" (
    "id" TEXT NOT NULL,
    "faculty_id" TEXT NOT NULL,
    "department_id" TEXT,
    "rank" "FacultyRank" NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "headcount" INTEGER NOT NULL,
    "sum_salary" DECIMAL(14,2) NOT NULL,
    "mean_salary" DECIMAL(14,2) NOT NULL,
    "min_salary" DECIMAL(14,2) NOT NULL,
    "max_salary" DECIMAL(14,2) NOT NULL,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'kku-hr.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hr_org_mappings_hr_code_key" ON "hr_org_mappings"("hr_code");

-- CreateIndex
CREATE INDEX "hr_org_mappings_faculty_id_idx" ON "hr_org_mappings"("faculty_id");

-- CreateIndex
CREATE INDEX "hr_org_mappings_department_id_idx" ON "hr_org_mappings"("department_id");

-- CreateIndex
CREATE INDEX "hr_org_mappings_hr_org_kind_idx" ON "hr_org_mappings"("hr_org_kind");

-- CreateIndex
CREATE INDEX "faculty_compensation_faculty_id_idx" ON "faculty_compensation"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_compensation_fiscal_year_idx" ON "faculty_compensation"("fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_compensation_faculty_id_department_id_rank_fiscal_y_key" ON "faculty_compensation"("faculty_id", "department_id", "rank", "fiscal_year");

-- AddForeignKey
ALTER TABLE "hr_org_mappings" ADD CONSTRAINT "hr_org_mappings_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_org_mappings" ADD CONSTRAINT "hr_org_mappings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_compensation" ADD CONSTRAINT "faculty_compensation_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_compensation" ADD CONSTRAINT "faculty_compensation_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ResearchServiceProjectType" AS ENUM ('RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER');

-- CreateEnum
CREATE TYPE "ResearchServiceMemberRole" AS ENUM ('LEAD', 'CO_INVESTIGATOR');

-- CreateTable
CREATE TABLE "research_service_projects" (
    "id" TEXT NOT NULL,
    "source_proposal_id" INTEGER NOT NULL,
    "source_proposal_key" TEXT NOT NULL,
    "title_th" TEXT NOT NULL,
    "title_en" TEXT,
    "type" "ResearchServiceProjectType" NOT NULL,
    "type_raw" TEXT NOT NULL,
    "fiscal_year_be" INTEGER NOT NULL,
    "project_budget_year_be" INTEGER,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "budget_thb" BIGINT,
    "funder_name" TEXT,
    "keywords" TEXT,
    "workflow_status" TEXT NOT NULL,
    "lead_unit_name" TEXT NOT NULL,
    "lead_faculty_name" TEXT NOT NULL,
    "faculty_id" TEXT,
    "acro_raw" TEXT,
    "pmu_okr_raw" TEXT,
    "submitted_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "ingestion_run_id" TEXT NOT NULL,

    CONSTRAINT "research_service_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_service_project_members" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "role" "ResearchServiceMemberRole" NOT NULL,
    "faculty_member_id" TEXT,
    "display_name" TEXT,
    "source_person_key" TEXT,
    "citizen_id_hash" TEXT,
    "unit_name" TEXT,
    "faculty_id" TEXT,
    "faculty_name" TEXT,
    "ingestion_run_id" TEXT NOT NULL,

    CONSTRAINT "research_service_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "research_service_projects_source_proposal_id_key" ON "research_service_projects"("source_proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_service_projects_source_proposal_key_key" ON "research_service_projects"("source_proposal_key");

-- CreateIndex
CREATE INDEX "research_service_projects_fiscal_year_be_idx" ON "research_service_projects"("fiscal_year_be");

-- CreateIndex
CREATE INDEX "research_service_projects_faculty_id_idx" ON "research_service_projects"("faculty_id");

-- CreateIndex
CREATE INDEX "research_service_projects_type_idx" ON "research_service_projects"("type");

-- CreateIndex
CREATE INDEX "research_service_projects_ingestion_run_id_idx" ON "research_service_projects"("ingestion_run_id");

-- CreateIndex
CREATE INDEX "research_service_project_members_faculty_member_id_idx" ON "research_service_project_members"("faculty_member_id");

-- CreateIndex
CREATE INDEX "research_service_project_members_project_id_idx" ON "research_service_project_members"("project_id");

-- CreateIndex
CREATE INDEX "research_service_project_members_faculty_name_idx" ON "research_service_project_members"("faculty_name");

-- CreateIndex
CREATE INDEX "research_service_project_members_citizen_id_hash_idx" ON "research_service_project_members"("citizen_id_hash");

-- CreateIndex
CREATE INDEX "research_service_project_members_ingestion_run_id_idx" ON "research_service_project_members"("ingestion_run_id");

-- AddForeignKey
ALTER TABLE "research_service_projects" ADD CONSTRAINT "research_service_projects_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_service_project_members" ADD CONSTRAINT "research_service_project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "research_service_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_service_project_members" ADD CONSTRAINT "research_service_project_members_faculty_member_id_fkey" FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_service_project_members" ADD CONSTRAINT "research_service_project_members_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

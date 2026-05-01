-- KMITL Skill Mapping connector — replaces jobthai + jobsdb.
-- Three new tables capture KMITL's aggregated career → skill demand
-- intelligence (LinkedIn profiles + job postings + grad data).

-- CreateEnum
CREATE TYPE "kmitl_data_scope" AS ENUM ('GLOBAL', 'THAILAND');

-- CreateEnum
CREATE TYPE "kmitl_demand_source" AS ENUM ('PROFILES', 'JOB_POSTINGS');

-- CreateTable
CREATE TABLE "kmitl_careers" (
    "id" TEXT NOT NULL,
    "kmitl_career_id" INTEGER NOT NULL,
    "kmitl_group_id" INTEGER NOT NULL,
    "kmitl_sub_group_id" INTEGER NOT NULL,
    "group_name" TEXT NOT NULL,
    "sub_group_name" TEXT NOT NULL,
    "career_name" TEXT NOT NULL,
    "isco_code" TEXT,
    "freshness_date" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'kmitl-skill-mapping.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kmitl_careers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kmitl_career_skill_demands" (
    "id" TEXT NOT NULL,
    "career_id" TEXT NOT NULL,
    "kmitl_career_id" INTEGER NOT NULL,
    "skill_id" TEXT,
    "skill_name_raw" TEXT NOT NULL,
    "data_scope" "kmitl_data_scope" NOT NULL,
    "data_source" "kmitl_demand_source" NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "percentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshot_at" DATE NOT NULL,
    "freshness_date" DATE NOT NULL,
    "metadata" JSONB,
    "methodology_version" TEXT NOT NULL DEFAULT 'kmitl-skill-mapping.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kmitl_career_skill_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kmitl_skill_growths" (
    "id" TEXT NOT NULL,
    "skill_id" TEXT,
    "skill_name_raw" TEXT NOT NULL,
    "context_level" TEXT NOT NULL,
    "context_id" INTEGER NOT NULL,
    "context_name" TEXT NOT NULL,
    "data_scope" "kmitl_data_scope" NOT NULL,
    "growth_pct" DOUBLE PRECISION NOT NULL,
    "snapshot_at" DATE NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT 'kmitl-skill-mapping.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kmitl_skill_growths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kmitl_careers_kmitl_career_id_key" ON "kmitl_careers"("kmitl_career_id");

-- CreateIndex
CREATE INDEX "kmitl_careers_kmitl_group_id_kmitl_sub_group_id_idx" ON "kmitl_careers"("kmitl_group_id", "kmitl_sub_group_id");

-- CreateIndex
CREATE INDEX "kmitl_career_skill_demands_career_id_idx" ON "kmitl_career_skill_demands"("career_id");

-- CreateIndex
CREATE INDEX "kmitl_career_skill_demands_skill_id_idx" ON "kmitl_career_skill_demands"("skill_id");

-- CreateIndex
CREATE INDEX "kmitl_career_skill_demands_data_scope_data_source_idx" ON "kmitl_career_skill_demands"("data_scope", "data_source");

-- CreateIndex
CREATE INDEX "kmitl_career_skill_demands_snapshot_at_idx" ON "kmitl_career_skill_demands"("snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "kmitl_career_skill_demands_kmitl_career_id_skill_name_raw_d_key" ON "kmitl_career_skill_demands"("kmitl_career_id", "skill_name_raw", "data_scope", "data_source");

-- CreateIndex
CREATE INDEX "kmitl_skill_growths_skill_id_idx" ON "kmitl_skill_growths"("skill_id");

-- CreateIndex
CREATE INDEX "kmitl_skill_growths_snapshot_at_idx" ON "kmitl_skill_growths"("snapshot_at");

-- CreateIndex
CREATE UNIQUE INDEX "kmitl_skill_growths_context_level_context_id_skill_name_raw_key" ON "kmitl_skill_growths"("context_level", "context_id", "skill_name_raw", "data_scope");

-- AddForeignKey
ALTER TABLE "kmitl_career_skill_demands" ADD CONSTRAINT "kmitl_career_skill_demands_career_id_fkey" FOREIGN KEY ("career_id") REFERENCES "kmitl_careers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kmitl_career_skill_demands" ADD CONSTRAINT "kmitl_career_skill_demands_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kmitl_skill_growths" ADD CONSTRAINT "kmitl_skill_growths_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

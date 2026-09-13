-- JobThai demand extraction — additive only.
--
-- Hand-written. A generated diff against this database also emits
-- unrelated drift (DROP TABLE "mv_refresh_log", two dropped
-- verdict_snapshots columns, five DROP INDEX, several DROP DEFAULT, and
-- two CREATE INDEX for indexes added to schema.prisma without a
-- migration). None of that is copied here — see the note in
-- docs/superpowers/plans/2026-09-13-jobthai-plan-a-ingestion.md.

-- CreateEnum
CREATE TYPE "JobThaiBatchStatus" AS ENUM ('PENDING', 'PARSING', 'PARSED', 'FAILED');

-- CreateEnum
-- Separate from ProgramLevel because 26.9% of JobThai postings ask for a
-- Thai vocational certificate (ปวช/ปวส), which ProgramLevel cannot express.
CREATE TYPE "JobRequiredEducationLevel" AS ENUM ('UNSPECIFIED', 'VOCATIONAL_CERT', 'HIGHER_VOCATIONAL_CERT', 'BACHELOR', 'MASTER', 'DOCTORATE');

-- AlterEnum
-- IF NOT EXISTS so re-applying is safe, matching the prompt-12
-- DecisionStatus precedent. Two separate statements: Postgres 11 and
-- earlier cannot add multiple enum values in one transaction.
ALTER TYPE "SkillSource" ADD VALUE IF NOT EXISTS 'ALIAS_MATCHED';
ALTER TYPE "SkillSource" ADD VALUE IF NOT EXISTS 'EMBEDDING_MATCHED';

-- AlterTable
ALTER TABLE "job_postings" ADD COLUMN     "business_type" TEXT,
ADD COLUMN     "job_category" TEXT,
ADD COLUMN     "job_subcategory" TEXT,
ADD COLUMN     "jobthai_batch_id" TEXT,
ADD COLUMN     "min_education_level" "JobRequiredEducationLevel" NOT NULL DEFAULT 'UNSPECIFIED',
ADD COLUMN     "posted_date_estimated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualification_raw" TEXT,
ADD COLUMN     "required_fields_raw" TEXT[];

-- CreateTable
CREATE TABLE "jobthai_batches" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "received_date" DATE NOT NULL,
    "status" "JobThaiBatchStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "uploaded_by_user_id" TEXT,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobthai_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobthai_occupations" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "posting_count" INTEGER NOT NULL DEFAULT 0,
    "profile_th" TEXT,
    "typical_tasks_th" TEXT[],
    "embedding" vector(1536),
    "method_version" TEXT NOT NULL DEFAULT 'jobthai-occupation.v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobthai_occupations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobthai_occupation_skills" (
    "id" TEXT NOT NULL,
    "jobthai_occupation_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "posting_count" INTEGER NOT NULL,
    "share" DOUBLE PRECISION NOT NULL,
    "extracted_by" "SkillSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobthai_occupation_skills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jobthai_batches_content_hash_key" ON "jobthai_batches"("content_hash");

-- CreateIndex
CREATE INDEX "jobthai_batches_status_idx" ON "jobthai_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "jobthai_occupations_code_key" ON "jobthai_occupations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "jobthai_occupations_category_subcategory_key" ON "jobthai_occupations"("category", "subcategory");

-- CreateIndex
CREATE INDEX "jobthai_occupation_skills_skill_id_idx" ON "jobthai_occupation_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobthai_occupation_skills_jobthai_occupation_id_skill_id_key" ON "jobthai_occupation_skills"("jobthai_occupation_id", "skill_id");

-- CreateIndex
CREATE INDEX "job_postings_jobthai_batch_id_idx" ON "job_postings"("jobthai_batch_id");

-- CreateIndex
CREATE INDEX "job_postings_job_category_job_subcategory_idx" ON "job_postings"("job_category", "job_subcategory");

-- AddForeignKey
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_jobthai_batch_id_fkey" FOREIGN KEY ("jobthai_batch_id") REFERENCES "jobthai_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobthai_batches" ADD CONSTRAINT "jobthai_batches_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobthai_batches" ADD CONSTRAINT "jobthai_batches_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobthai_occupation_skills" ADD CONSTRAINT "jobthai_occupation_skills_jobthai_occupation_id_fkey" FOREIGN KEY ("jobthai_occupation_id") REFERENCES "jobthai_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobthai_occupation_skills" ADD CONSTRAINT "jobthai_occupation_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

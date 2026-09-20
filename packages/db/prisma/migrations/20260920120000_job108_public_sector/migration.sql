-- AlterTable: seats and closing date on job_postings.
-- position_count is stored and displayed but never weighted into a demand
-- share; see docs/methodologies/gap-map.md.
ALTER TABLE "job_postings" ADD COLUMN "position_count" INTEGER;
ALTER TABLE "job_postings" ADD COLUMN "application_close_date" DATE;
ALTER TABLE "job_postings" ADD COLUMN "job108_announcement_id" TEXT;

-- CreateEnum
CREATE TYPE "Job108AnnouncementStatus" AS ENUM ('PENDING', 'EXTRACTED', 'FAILED');

-- CreateTable
CREATE TABLE "job108_announcements" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "title" TEXT,
    "agency_name" TEXT,
    "published_date" DATE,
    "application_open_date" DATE,
    "application_close_date" DATE,
    "source_lastmod" DATE,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "Job108AnnouncementStatus" NOT NULL DEFAULT 'PENDING',
    "parse_error" TEXT,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job108_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job108_announcements_announcement_id_key" ON "job108_announcements"("announcement_id");
CREATE INDEX "job108_announcements_content_hash_idx" ON "job108_announcements"("content_hash");
CREATE INDEX "job108_announcements_status_idx" ON "job108_announcements"("status");
CREATE INDEX "job108_announcements_ingestion_run_id_idx" ON "job108_announcements"("ingestion_run_id");
CREATE INDEX "job_postings_job108_announcement_id_idx" ON "job_postings"("job108_announcement_id");
CREATE INDEX "job_postings_source_posted_date_idx" ON "job_postings"("source", "posted_date");

-- AddForeignKey
ALTER TABLE "job108_announcements" ADD CONSTRAINT "job108_announcements_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_job108_announcement_id_fkey" FOREIGN KEY ("job108_announcement_id") REFERENCES "job108_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

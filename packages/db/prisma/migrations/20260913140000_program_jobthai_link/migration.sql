-- Programme to JobThai-occupation bridge. Additive only.
--
-- Hand-written. A generated diff against this database also emits unrelated
-- drift (DROP TABLE "mv_refresh_log", dropped verdict_snapshots columns,
-- five DROP INDEX, two CREATE INDEX for indexes added to schema.prisma
-- without a migration). None of it is copied here.

-- CreateTable
CREATE TABLE "program_jobthai_links" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "jobthai_occupation_id" TEXT NOT NULL,
    "link_source" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "posting_count" INTEGER NOT NULL,
    "evidence_th" TEXT,
    "method_version" TEXT NOT NULL DEFAULT 'jobthai-bridge.v1',
    "ingestion_run_id" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_jobthai_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_jobthai_links_program_id_idx" ON "program_jobthai_links"("program_id");

-- CreateIndex
CREATE INDEX "program_jobthai_links_jobthai_occupation_id_idx" ON "program_jobthai_links"("jobthai_occupation_id");

-- CreateIndex
CREATE UNIQUE INDEX "program_jobthai_links_program_id_jobthai_occupation_id_key" ON "program_jobthai_links"("program_id", "jobthai_occupation_id");


-- AddForeignKey
ALTER TABLE "program_jobthai_links" ADD CONSTRAINT "program_jobthai_links_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_jobthai_links" ADD CONSTRAINT "program_jobthai_links_jobthai_occupation_id_fkey" FOREIGN KEY ("jobthai_occupation_id") REFERENCES "jobthai_occupations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_jobthai_links" ADD CONSTRAINT "program_jobthai_links_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


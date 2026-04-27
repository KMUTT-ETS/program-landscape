-- Bridge between the KKU Registrar's Oracle views (text keys only:
-- FACULTYNAME + PROGRAMNAME + PROGRAMLEVEL + MAJOR) and our Program
-- rows. Populated manually before kku-registry's real connector can
-- write any rows. Unmapped registrar rows land in IngestionRun
-- metadata for triage.
--
-- registry_major defaults to '' so the unique constraint collapses
-- programs without a major variant — Postgres treats NULL as distinct
-- in unique indexes by default.

-- CreateTable
CREATE TABLE "registry_program_mappings" (
    "id" TEXT NOT NULL,
    "registry_faculty_name" TEXT NOT NULL,
    "registry_program_name" TEXT NOT NULL,
    "registry_level" TEXT NOT NULL,
    "registry_major" TEXT NOT NULL DEFAULT '',
    "program_id" TEXT NOT NULL,
    "notes" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registry_program_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "registry_program_mappings_program_id_idx" ON "registry_program_mappings"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "registry_program_mappings_registry_faculty_name_registry_pr_key" ON "registry_program_mappings"("registry_faculty_name", "registry_program_name", "registry_level", "registry_major");

-- AddForeignKey
ALTER TABLE "registry_program_mappings" ADD CONSTRAINT "registry_program_mappings_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

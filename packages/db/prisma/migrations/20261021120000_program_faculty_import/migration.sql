-- Programme teaching staff become importable from a spreadsheet.
--
-- Additive. `program_faculties` is the link table the Deep-Dive's faculty
-- section, the Capability health drivers and per-programme publication
-- counts all read, and until now it was written only by an AI extraction
-- over the programme's curriculum PDF. An adopting university that has no
-- such PDF had no route to it at all.
--
-- Start-over deletes by import run, so the row has to carry the run that
-- wrote it. NULL is every row that existed before this migration — the AI
-- path writes none — and start-over therefore cannot touch them, which is
-- the same rule every other imported table follows.
--
-- ON DELETE SET NULL so deleting an ingestion run never cascades into
-- teaching assignments.
ALTER TABLE "program_faculties" ADD COLUMN "ingestion_run_id" TEXT;

ALTER TABLE "program_faculties"
  ADD CONSTRAINT "program_faculties_ingestion_run_id_fkey"
  FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "program_faculties_ingestion_run_id_idx"
  ON "program_faculties"("ingestion_run_id");

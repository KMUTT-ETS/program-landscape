CREATE TABLE "program_mhesi_aliases" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "mhesi_code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_mhesi_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_mhesi_aliases_mhesi_code_key" ON "program_mhesi_aliases"("mhesi_code");
CREATE INDEX "program_mhesi_aliases_program_id_idx" ON "program_mhesi_aliases"("program_id");

ALTER TABLE "program_mhesi_aliases"
  ADD CONSTRAINT "program_mhesi_aliases_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

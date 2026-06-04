-- CreateTable
CREATE TABLE "recruitment_program_overrides" (
    "id" TEXT NOT NULL,
    "recruitment_program_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NEW_PROGRAM',
    "display_name_th" TEXT,
    "display_name_en" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruitment_program_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_program_overrides_recruitment_program_id_key" ON "recruitment_program_overrides"("recruitment_program_id");

-- Seed the first known override: วิศวกรรมเซมิคอนดักเตอร์ (semiconductor) — a
-- brand-new KKU program not yet in the curriculum catalog. The TCAS feed slots
-- it under KKU-SEQ-0067's reused curr_id (25640034000456); flagging it here
-- makes the recruitment dashboard show it standalone with a "New program"
-- badge. PROGRAMID 310402601169 is stable across the POWERBI source, so this is
-- portable dev↔prod. Idempotent on re-apply.
INSERT INTO "recruitment_program_overrides"
  ("id", "recruitment_program_id", "kind", "display_name_th", "display_name_en", "notes", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, '310402601169', 'NEW_PROGRAM',
   'วศ.บ. (วิศวกรรมเซมิคอนดักเตอร์)', 'B.Eng. (Semiconductor Engineering)',
   'New program not yet catalogued; TCAS feed reuses KKU-SEQ-0067 curr_id 25640034000456.',
   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("recruitment_program_id") DO NOTHING;

-- CreateTable
CREATE TABLE "tcas_admission_funnels" (
    "id" TEXT NOT NULL,
    "program_id" TEXT,
    "mhesi_curr_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "entry_year_be" INTEGER NOT NULL,
    "enroll_seats" INTEGER,
    "total_applicants" INTEGER,
    "total_passed" INTEGER,
    "send_clearinghouse" INTEGER,
    "confirm_clearinghouse" INTEGER,
    "send_reg_reported" INTEGER,
    "reg_reported" INTEGER,
    "freshness_date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'kku-tcas-funnel',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tcas_admission_funnels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tcas_admission_funnels_program_id_idx" ON "tcas_admission_funnels"("program_id");

-- CreateIndex
CREATE INDEX "tcas_admission_funnels_entry_year_be_idx" ON "tcas_admission_funnels"("entry_year_be");

-- CreateIndex
CREATE UNIQUE INDEX "tcas_admission_funnels_mhesi_curr_id_round_entry_year_be_key" ON "tcas_admission_funnels"("mhesi_curr_id", "round", "entry_year_be");

-- AddForeignKey
ALTER TABLE "tcas_admission_funnels" ADD CONSTRAINT "tcas_admission_funnels_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Distribution of CURRENTLY ENROLLED students by their entry-year cohort.
-- Entry year is the first 2 digits of STUDENTCODE in Buddhist Era.
-- Refreshed by `pnpm programs:link-cohorts`.

-- CreateTable
CREATE TABLE "student_cohort_distributions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "entry_year_be" INTEGER NOT NULL,
    "student_count" INTEGER NOT NULL,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_cohort_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_cohort_distributions_program_id_idx" ON "student_cohort_distributions"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_cohort_distributions_program_id_entry_year_be_key" ON "student_cohort_distributions"("program_id", "entry_year_be");

-- AddForeignKey
ALTER TABLE "student_cohort_distributions" ADD CONSTRAINT "student_cohort_distributions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

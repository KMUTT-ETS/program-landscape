-- CreateTable
CREATE TABLE "dq_student_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "faculty_id" TEXT,
    "program_id" TEXT,
    "program_name" TEXT,
    "cohort_year_be" INTEGER,
    "students_tested" INTEGER NOT NULL,
    "students_with_scores" INTEGER NOT NULL,
    "students_all_passed" INTEGER NOT NULL,
    "ingestion_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dq_student_cube_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dq_module_cube" (
    "id" TEXT NOT NULL,
    "faculty_name" TEXT NOT NULL,
    "faculty_id" TEXT,
    "program_id" TEXT,
    "program_name" TEXT,
    "cohort_year_be" INTEGER,
    "module_key" TEXT NOT NULL,
    "module_no" INTEGER NOT NULL,
    "module_kind" TEXT NOT NULL,
    "taken_count" INTEGER NOT NULL,
    "score_sum" DOUBLE PRECISION NOT NULL,
    "students_in_scope" INTEGER NOT NULL,
    "ingestion_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dq_module_cube_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dq_student_cube_faculty_name_idx" ON "dq_student_cube"("faculty_name");

-- CreateIndex
CREATE INDEX "dq_student_cube_program_id_idx" ON "dq_student_cube"("program_id");

-- CreateIndex
CREATE INDEX "dq_student_cube_ingestion_run_id_idx" ON "dq_student_cube"("ingestion_run_id");

-- CreateIndex
CREATE INDEX "dq_module_cube_faculty_name_idx" ON "dq_module_cube"("faculty_name");

-- CreateIndex
CREATE INDEX "dq_module_cube_program_id_idx" ON "dq_module_cube"("program_id");

-- CreateIndex
CREATE INDEX "dq_module_cube_module_key_idx" ON "dq_module_cube"("module_key");

-- CreateIndex
CREATE INDEX "dq_module_cube_ingestion_run_id_idx" ON "dq_module_cube"("ingestion_run_id");

-- AddForeignKey
ALTER TABLE "dq_student_cube" ADD CONSTRAINT "dq_student_cube_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dq_module_cube" ADD CONSTRAINT "dq_module_cube_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

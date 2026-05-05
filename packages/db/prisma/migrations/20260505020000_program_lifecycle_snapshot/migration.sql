-- CreateEnum
CREATE TYPE "ProgramLifecycleVerdict" AS ENUM ('SUNSET', 'STABLE', 'RISING', 'FRONTIER');

-- CreateTable
CREATE TABLE "program_lifecycle_snapshots" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "verdict" "ProgramLifecycleVerdict" NOT NULL,
    "trajectory_score" DOUBLE PRECISION NOT NULL,
    "methodology_version" TEXT NOT NULL,
    "drivers_json" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_lifecycle_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "program_lifecycle_snapshots_program_id_key" ON "program_lifecycle_snapshots"("program_id");

-- CreateIndex
CREATE INDEX "program_lifecycle_snapshots_verdict_idx" ON "program_lifecycle_snapshots"("verdict");

-- AddForeignKey
ALTER TABLE "program_lifecycle_snapshots" ADD CONSTRAINT "program_lifecycle_snapshots_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

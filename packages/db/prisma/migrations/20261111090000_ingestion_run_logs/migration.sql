-- Per-run connector log lines, shown in the admin run-log modal.
-- Additive: a new enum and a new table; no existing table changes.

-- CreateEnum
CREATE TYPE "IngestionRunLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "ingestion_run_logs" (
    "id" TEXT NOT NULL,
    "ingestion_run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "IngestionRunLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,

    CONSTRAINT "ingestion_run_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_run_logs_ingestion_run_id_seq_key" ON "ingestion_run_logs"("ingestion_run_id", "seq");

-- CreateIndex
CREATE INDEX "ingestion_run_logs_ts_idx" ON "ingestion_run_logs"("ts");

-- AddForeignKey
ALTER TABLE "ingestion_run_logs" ADD CONSTRAINT "ingestion_run_logs_ingestion_run_id_fkey" FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

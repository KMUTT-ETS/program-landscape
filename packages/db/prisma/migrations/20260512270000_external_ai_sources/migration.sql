-- CreateEnum
CREATE TYPE "ExternalAiSourceKind" AS ENUM ('URL_LIST', 'WEB_SEARCH');

-- CreateEnum
CREATE TYPE "ExternalAiSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateTable
CREATE TABLE "external_ai_sources" (
    "id"                TEXT NOT NULL,
    "slug"              TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "description"       TEXT,
    "kind"              "ExternalAiSourceKind" NOT NULL,
    "status"            "ExternalAiSourceStatus" NOT NULL DEFAULT 'PAUSED',
    "config_json"       JSONB NOT NULL,
    "cadence_cron"      TEXT,
    "signal_type"       "SignalType" NOT NULL DEFAULT 'NEWS',
    "default_impact"    DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "last_fetched_at"   TIMESTAMP(3),
    "last_fetch_status" TEXT,
    "last_fetch_error"  TEXT,
    "last_signal_count" INTEGER,
    "created_by_id"     TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_ai_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_ai_sources_slug_key" ON "external_ai_sources"("slug");
CREATE INDEX "external_ai_sources_status_idx" ON "external_ai_sources"("status");
CREATE INDEX "external_ai_sources_kind_idx" ON "external_ai_sources"("kind");

-- AddForeignKey
ALTER TABLE "external_ai_sources"
  ADD CONSTRAINT "external_ai_sources_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "trend_signals" ADD COLUMN "external_ai_source_id" TEXT;

-- CreateIndex
CREATE INDEX "trend_signals_external_ai_source_id_idx" ON "trend_signals"("external_ai_source_id");

-- AddForeignKey
ALTER TABLE "trend_signals"
  ADD CONSTRAINT "trend_signals_external_ai_source_id_fkey"
  FOREIGN KEY ("external_ai_source_id") REFERENCES "external_ai_sources"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

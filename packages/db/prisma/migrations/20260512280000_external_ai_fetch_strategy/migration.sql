-- CreateEnum
CREATE TYPE "ExternalAiFetchStrategy" AS ENUM ('PLAIN', 'HEADLESS');

-- AlterTable
ALTER TABLE "external_ai_sources"
  ADD COLUMN "fetch_strategy" "ExternalAiFetchStrategy" NOT NULL DEFAULT 'PLAIN';

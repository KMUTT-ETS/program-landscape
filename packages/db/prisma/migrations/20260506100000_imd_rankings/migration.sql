-- CreateEnum
CREATE TYPE "ImdDataset" AS ENUM ('WCY', 'WTR', 'WDCR');

-- CreateTable
CREATE TABLE "imd_economies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "is_peer" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imd_economies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imd_rankings" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "dataset" "ImdDataset" NOT NULL,
    "economy_id" TEXT NOT NULL,
    "indicator_key" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "rank" INTEGER,
    "total_ranked" INTEGER,
    "raw_value" TEXT,
    "notes" TEXT,
    "methodology_version" TEXT NOT NULL DEFAULT 'imd.v1',
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imd_rankings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imd_economies_code_key" ON "imd_economies"("code");

-- CreateIndex
CREATE INDEX "imd_economies_region_idx" ON "imd_economies"("region");

-- CreateIndex
CREATE INDEX "imd_rankings_dataset_year_idx" ON "imd_rankings"("dataset", "year");

-- CreateIndex
CREATE INDEX "imd_rankings_economy_id_idx" ON "imd_rankings"("economy_id");

-- CreateIndex
CREATE UNIQUE INDEX "imd_rankings_year_dataset_economy_id_indicator_key_key" ON "imd_rankings"("year", "dataset", "economy_id", "indicator_key");

-- AddForeignKey
ALTER TABLE "imd_rankings" ADD CONSTRAINT "imd_rankings_economy_id_fkey" FOREIGN KEY ("economy_id") REFERENCES "imd_economies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

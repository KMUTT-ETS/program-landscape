-- CreateTable
CREATE TABLE "ai_model_catalog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cost_input_per_1m" DOUBLE PRECISION NOT NULL,
    "cost_output_per_1m" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "openrouter_id" TEXT,
    "source_created_at" TIMESTAMP(3),
    "context_length" INTEGER,
    "is_selectable" BOOLEAN NOT NULL DEFAULT true,
    "legacy" BOOLEAN NOT NULL DEFAULT false,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_model_catalog_source_idx" ON "ai_model_catalog"("source");

-- CreateIndex
CREATE INDEX "ai_model_catalog_is_selectable_idx" ON "ai_model_catalog"("is_selectable");

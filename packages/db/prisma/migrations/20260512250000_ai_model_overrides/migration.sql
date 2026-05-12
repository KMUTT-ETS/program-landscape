-- Per-method-prefix AI model override.
--
-- Phase 3 of the admin redesign — lets operators swap the model used
-- by a specific task (e.g. swap program-pedagogy from
-- gemini-3.1-pro-preview to gemini-2.5-pro) at runtime via the
-- admin AI-settings page, without code changes.
--
-- The dispatch chain in @kku/shared's provider classes reads this
-- table first (60s in-process cache, invalidated on write) and
-- falls back to MODEL_BY_METHOD_PREFIX → default if no override.

CREATE TABLE "ai_model_overrides" (
    "id" TEXT NOT NULL,
    "method_prefix" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "set_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_model_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_model_overrides_method_prefix_key"
    ON "ai_model_overrides"("method_prefix");

ALTER TABLE "ai_model_overrides"
    ADD CONSTRAINT "ai_model_overrides_set_by_user_id_fkey"
    FOREIGN KEY ("set_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

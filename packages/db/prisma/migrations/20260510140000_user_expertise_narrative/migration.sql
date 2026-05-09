-- Persist the AI expertise summary so the profile page can serve from
-- cache instead of re-running the LLM on every visit. One row per
-- (user, methodology version); a prompt-template upgrade writes a
-- new row alongside the older one and the page picks the latest.

-- CreateTable
CREATE TABLE "user_expertise_narratives" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method_version" TEXT NOT NULL,
    "narrative_th" TEXT NOT NULL,
    "narrative_en" TEXT NOT NULL,
    "expertise_keywords_th" TEXT[],
    "expertise_keywords_en" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "ai_inference_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_expertise_narratives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_expertise_narratives_user_id_method_version_key"
  ON "user_expertise_narratives"("user_id", "method_version");

-- CreateIndex
CREATE INDEX "user_expertise_narratives_user_id_idx"
  ON "user_expertise_narratives"("user_id");

-- AddForeignKey
ALTER TABLE "user_expertise_narratives"
  ADD CONSTRAINT "user_expertise_narratives_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

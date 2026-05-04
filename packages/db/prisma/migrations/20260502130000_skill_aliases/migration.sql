-- SkillAlias — caches every normalization decision for free-text skill
-- names emitted by connectors and AI extractors. See
-- packages/db/prisma/schema.prisma for the full rationale.

CREATE TYPE "SkillAliasStatus" AS ENUM ('PENDING', 'RESOLVED', 'NEW_PROPOSED', 'AMBIGUOUS', 'REJECTED');

CREATE TABLE "skill_aliases" (
  "id"                   TEXT             NOT NULL,
  "raw_name"             TEXT             NOT NULL,
  "raw_name_lower"       TEXT             NOT NULL,
  "source_context"       TEXT             NOT NULL,
  "status"               "SkillAliasStatus" NOT NULL DEFAULT 'PENDING',
  "resolved_skill_id"    TEXT,
  "new_name_en"          TEXT,
  "new_name_th"          TEXT,
  "new_category"         TEXT,
  "confidence"           DOUBLE PRECISION,
  "method"               TEXT             NOT NULL DEFAULT 'ai_normaliser',
  "reasoning"            TEXT,
  "method_version"       TEXT             NOT NULL DEFAULT 'skill-name-normaliser.v1',
  "ai_inference_id"      TEXT,
  "reviewed_by_user_id"  TEXT,
  "reviewed_at"          TIMESTAMP(3),
  "review_notes"         TEXT,
  "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "skill_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_aliases_raw_name_lower_source_context_key"
  ON "skill_aliases" ("raw_name_lower", "source_context");

CREATE INDEX "skill_aliases_resolved_skill_id_idx" ON "skill_aliases" ("resolved_skill_id");
CREATE INDEX "skill_aliases_status_idx"            ON "skill_aliases" ("status");
CREATE INDEX "skill_aliases_source_context_status_idx" ON "skill_aliases" ("source_context", "status");

ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_resolved_skill_id_fkey"
  FOREIGN KEY ("resolved_skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_ai_inference_id_fkey"
  FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "skill_aliases" ADD CONSTRAINT "skill_aliases_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Program.kmitlCareerIds — array of KMITL career IDs the program targets.
-- Filled by the career-kmitl-mapping AI script; used by the deep-dive
-- skills section to filter labour-market demand to careers the program
-- actually prepares graduates for, not generic top-10.
ALTER TABLE "programs" ADD COLUMN "kmitl_career_ids" INTEGER[] NOT NULL DEFAULT '{}'::integer[];

-- ExternalCareerSkillDemand — Gemini-grounded skill-demand for careers
-- KMITL doesn't cover (entrepreneurs, academics, narrow specialties).
-- Cached per (careerLabel, region, skillNameRaw); refreshable.
CREATE TABLE "external_career_skill_demands" (
  "id"                   TEXT             NOT NULL,
  "career_label"         TEXT             NOT NULL,
  "career_label_lower"   TEXT             NOT NULL,
  "region"               TEXT             NOT NULL DEFAULT 'Thailand',
  "skill_id"             TEXT,
  "skill_name_raw"       TEXT             NOT NULL,
  "rank"                 INTEGER          NOT NULL,
  "web_sources_json"     JSONB,
  "reasoning"            TEXT,
  "source"               TEXT             NOT NULL DEFAULT 'gemini-grounded',
  "method_version"       TEXT             NOT NULL DEFAULT 'career-external-skills.v1',
  "ai_inference_id"      TEXT,
  "freshness_date"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "external_career_skill_demands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_career_skill_demands_career_label_lower_region_skill_name_raw_key"
  ON "external_career_skill_demands" ("career_label_lower", "region", "skill_name_raw");
CREATE INDEX "external_career_skill_demands_career_label_lower_region_idx"
  ON "external_career_skill_demands" ("career_label_lower", "region");
CREATE INDEX "external_career_skill_demands_skill_id_idx"
  ON "external_career_skill_demands" ("skill_id");

ALTER TABLE "external_career_skill_demands" ADD CONSTRAINT "external_career_skill_demands_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "external_career_skill_demands" ADD CONSTRAINT "external_career_skill_demands_ai_inference_id_fkey"
  FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

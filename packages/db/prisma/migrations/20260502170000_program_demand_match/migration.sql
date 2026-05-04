-- ProgramDemandMatch — for each demanded skill, records whether the
-- curriculum actually teaches it (verbatim or semantically).

CREATE TABLE "program_demand_matches" (
  "id"                       TEXT             NOT NULL,
  "program_id"               TEXT             NOT NULL,
  "skill_id"                 TEXT             NOT NULL,
  "matched"                  BOOLEAN          NOT NULL DEFAULT false,
  "relatedness"              DOUBLE PRECISION NOT NULL,
  "match_source"             TEXT             NOT NULL,
  "evidence_quote"           TEXT,
  "matched_taught_skill_id"  TEXT,
  "method_version"           TEXT             NOT NULL DEFAULT 'demand-match.v1',
  "ai_inference_id"          TEXT,
  "computed_at"              TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "program_demand_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_demand_matches_program_id_skill_id_key"
  ON "program_demand_matches" ("program_id", "skill_id");
CREATE INDEX "program_demand_matches_program_id_idx"
  ON "program_demand_matches" ("program_id");
CREATE INDEX "program_demand_matches_skill_id_idx"
  ON "program_demand_matches" ("skill_id");

ALTER TABLE "program_demand_matches" ADD CONSTRAINT "program_demand_matches_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_demand_matches" ADD CONSTRAINT "program_demand_matches_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "program_demand_matches" ADD CONSTRAINT "program_demand_matches_ai_inference_id_fkey"
  FOREIGN KEY ("ai_inference_id") REFERENCES "ai_inferences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable peer_programs — add subject_area.
ALTER TABLE "peer_programs" ADD COLUMN "subject_area" TEXT;
CREATE INDEX "peer_programs_subject_area_idx" ON "peer_programs"("subject_area");

-- CreateTable peer_sets
CREATE TABLE "peer_sets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description_th" TEXT,
    "description_en" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "subject_area" TEXT,
    "region" TEXT NOT NULL DEFAULT 'CUSTOM',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "peer_sets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "peer_sets_is_system_idx" ON "peer_sets"("is_system");
CREATE INDEX "peer_sets_region_idx" ON "peer_sets"("region");
CREATE INDEX "peer_sets_subject_area_idx" ON "peer_sets"("subject_area");

ALTER TABLE "peer_sets" ADD CONSTRAINT "peer_sets_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable peer_set_members
CREATE TABLE "peer_set_members" (
    "id" TEXT NOT NULL,
    "peer_set_id" TEXT NOT NULL,
    "peer_program_id" TEXT NOT NULL,
    "note_th" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_set_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "peer_set_members_peer_set_id_peer_program_id_key"
  ON "peer_set_members"("peer_set_id", "peer_program_id");
CREATE INDEX "peer_set_members_peer_set_id_idx" ON "peer_set_members"("peer_set_id");
CREATE INDEX "peer_set_members_peer_program_id_idx" ON "peer_set_members"("peer_program_id");

ALTER TABLE "peer_set_members" ADD CONSTRAINT "peer_set_members_peer_set_id_fkey"
  FOREIGN KEY ("peer_set_id") REFERENCES "peer_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "peer_set_members" ADD CONSTRAINT "peer_set_members_peer_program_id_fkey"
  FOREIGN KEY ("peer_program_id") REFERENCES "peer_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable peer_program_skills
CREATE TABLE "peer_program_skills" (
    "id" TEXT NOT NULL,
    "peer_program_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" "SkillSource" NOT NULL DEFAULT 'LLM_EXTRACTED',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_program_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "peer_program_skills_peer_program_id_skill_id_key"
  ON "peer_program_skills"("peer_program_id", "skill_id");
CREATE INDEX "peer_program_skills_peer_program_id_idx" ON "peer_program_skills"("peer_program_id");
CREATE INDEX "peer_program_skills_skill_id_idx" ON "peer_program_skills"("skill_id");

ALTER TABLE "peer_program_skills" ADD CONSTRAINT "peer_program_skills_peer_program_id_fkey"
  FOREIGN KEY ("peer_program_id") REFERENCES "peer_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "peer_program_skills" ADD CONSTRAINT "peer_program_skills_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable peer_rankings
CREATE TABLE "peer_rankings" (
    "id" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "subject_area" TEXT,
    "year" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "percentile" DOUBLE PRECISION,
    "url" TEXT,
    "freshness_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_rankings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "peer_rankings_institution_source_subject_area_year_key"
  ON "peer_rankings"("institution", "source", "subject_area", "year");
CREATE INDEX "peer_rankings_institution_idx" ON "peer_rankings"("institution");
CREATE INDEX "peer_rankings_source_idx" ON "peer_rankings"("source");
CREATE INDEX "peer_rankings_subject_area_idx" ON "peer_rankings"("subject_area");
CREATE INDEX "peer_rankings_year_idx" ON "peer_rankings"("year");

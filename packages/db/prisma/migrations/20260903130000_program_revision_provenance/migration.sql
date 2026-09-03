-- AlterTable: provenance column on every table the pipeline writes per programme.
ALTER TABLE "program_strategic_narratives"     ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_ai_readiness_assessments" ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_pedagogy_assessments"     ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_peer_reviews"             ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_research_expertise"       ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_curriculum_revisions"     ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_peer_selections"          ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_skills"                   ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_courses"                  ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_faculties"                ADD COLUMN "program_revision_id" TEXT;

-- CreateIndex
CREATE INDEX "program_strategic_narratives_program_revision_id_idx"     ON "program_strategic_narratives"("program_revision_id");
CREATE INDEX "program_ai_readiness_assessments_program_revision_id_idx" ON "program_ai_readiness_assessments"("program_revision_id");
CREATE INDEX "program_pedagogy_assessments_program_revision_id_idx"     ON "program_pedagogy_assessments"("program_revision_id");
CREATE INDEX "program_peer_reviews_program_revision_id_idx"             ON "program_peer_reviews"("program_revision_id");
CREATE INDEX "program_research_expertise_program_revision_id_idx"       ON "program_research_expertise"("program_revision_id");
CREATE INDEX "program_curriculum_revisions_program_revision_id_idx"     ON "program_curriculum_revisions"("program_revision_id");
CREATE INDEX "program_peer_selections_program_revision_id_idx"          ON "program_peer_selections"("program_revision_id");
CREATE INDEX "program_skills_program_revision_id_idx"                   ON "program_skills"("program_revision_id");
CREATE INDEX "program_courses_program_revision_id_idx"                  ON "program_courses"("program_revision_id");
CREATE INDEX "program_faculties_program_revision_id_idx"                ON "program_faculties"("program_revision_id");

-- AddForeignKey: SET NULL, so deleting a revision degrades its rows to the
-- pre-feature baseline rather than cascading away real analysis.
ALTER TABLE "program_strategic_narratives"     ADD CONSTRAINT "program_strategic_narratives_program_revision_id_fkey"     FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_ai_readiness_assessments" ADD CONSTRAINT "program_ai_readiness_assessments_program_revision_id_fkey" FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_pedagogy_assessments"     ADD CONSTRAINT "program_pedagogy_assessments_program_revision_id_fkey"     FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_peer_reviews"             ADD CONSTRAINT "program_peer_reviews_program_revision_id_fkey"             FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_research_expertise"       ADD CONSTRAINT "program_research_expertise_program_revision_id_fkey"       FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_curriculum_revisions"     ADD CONSTRAINT "program_curriculum_revisions_program_revision_id_fkey"     FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_peer_selections"          ADD CONSTRAINT "program_peer_selections_program_revision_id_fkey"          FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_skills"                   ADD CONSTRAINT "program_skills_program_revision_id_fkey"                   FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_courses"                  ADD CONSTRAINT "program_courses_program_revision_id_fkey"                  FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_faculties"                ADD CONSTRAINT "program_faculties_program_revision_id_fkey"                FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

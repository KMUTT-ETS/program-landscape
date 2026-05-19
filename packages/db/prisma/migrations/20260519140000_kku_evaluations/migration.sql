-- kku-evaluations connector — student-evaluations dataset
-- (POWERBI.EVALUATE_INSTRUCTOR — 1.4M rows, 21 (year,sem) buckets).
--
-- Two additive tables:
--   evaluation_questions          — canonical question catalog with
--                                   drift detection (TH + AI-EN)
--   evaluation_response_summaries — pre-aggregated per
--                                   (class × question × instructor)
--
-- PDPA gate: the connector enforces TOTAL_STUDENT >= 5 server-side, so
-- only aggregated cells with at least 5 respondents reach this table.
-- See docs/data-sources/kku-evaluations.md and Phase 0 fixtures at
-- apps/ingestion/test/fixtures/kku-evaluations/.

-- ── evaluation_questions ─────────────────────────────────────────────
CREATE TABLE "evaluation_questions" (
    "id" TEXT NOT NULL,
    "question_id_registrar" TEXT NOT NULL,
    "question_text_th" TEXT NOT NULL,
    "question_text_en" TEXT,
    "question_text_en_override" TEXT,
    "question_text_hash" TEXT NOT NULL,
    "theme_tag" TEXT,
    "first_seen_year_be" INTEGER NOT NULL,
    "last_seen_year_be" INTEGER NOT NULL,
    "semesters_used" INTEGER NOT NULL,
    "is_core" BOOLEAN NOT NULL DEFAULT false,
    "methodology_version" TEXT NOT NULL DEFAULT 'kku-evaluations.v1',
    "translated_at" TIMESTAMP(3),
    "translation_model" TEXT,
    "ingestion_run_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_questions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evaluation_questions_question_id_registrar_idx" ON "evaluation_questions"("question_id_registrar");
CREATE INDEX "evaluation_questions_is_core_idx" ON "evaluation_questions"("is_core");
CREATE INDEX "evaluation_questions_ingestion_run_id_idx" ON "evaluation_questions"("ingestion_run_id");
CREATE UNIQUE INDEX "evaluation_questions_question_id_registrar_question_text_ha_key"
    ON "evaluation_questions"("question_id_registrar", "question_text_hash");

ALTER TABLE "evaluation_questions"
    ADD CONSTRAINT "evaluation_questions_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── evaluation_response_summaries ────────────────────────────────────
CREATE TABLE "evaluation_response_summaries" (
    "id" TEXT NOT NULL,
    "acad_year_be" INTEGER NOT NULL,
    "semester" INTEGER NOT NULL,
    "faculty_id" TEXT,
    "class_offering_id" TEXT,
    "faculty_member_id" TEXT,
    "question_id" TEXT,
    "faculty_registry_id" INTEGER NOT NULL,
    "class_id_registrar" BIGINT NOT NULL,
    "officer_id_registrar" INTEGER NOT NULL,
    "question_id_registrar" TEXT NOT NULL,
    "course_code" TEXT NOT NULL,
    "course_code_raw" TEXT NOT NULL,
    "course_name_th" TEXT,
    "course_name_en" TEXT,
    "section" INTEGER NOT NULL,
    "campus_id" INTEGER NOT NULL,
    "kkumail_raw" TEXT,
    "rating_avg" DECIMAL(4,3) NOT NULL,
    "respondent_count" INTEGER NOT NULL,
    "last_update_at" TIMESTAMP(3),
    "methodology_version" TEXT NOT NULL DEFAULT 'kku-evaluations.v1',
    "ingestion_run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_response_summaries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evaluation_response_summaries_faculty_id_acad_year_be_semes_idx"
    ON "evaluation_response_summaries"("faculty_id", "acad_year_be", "semester");
CREATE INDEX "evaluation_response_summaries_faculty_member_id_acad_year_b_idx"
    ON "evaluation_response_summaries"("faculty_member_id", "acad_year_be", "semester");
CREATE INDEX "evaluation_response_summaries_class_offering_id_idx"
    ON "evaluation_response_summaries"("class_offering_id");
CREATE INDEX "evaluation_response_summaries_course_code_acad_year_be_seme_idx"
    ON "evaluation_response_summaries"("course_code", "acad_year_be", "semester");
CREATE INDEX "evaluation_response_summaries_question_id_registrar_idx"
    ON "evaluation_response_summaries"("question_id_registrar");
CREATE INDEX "evaluation_response_summaries_ingestion_run_id_idx"
    ON "evaluation_response_summaries"("ingestion_run_id");
CREATE UNIQUE INDEX "evaluation_response_summaries_acad_year_be_semester_class_i_key"
    ON "evaluation_response_summaries"("acad_year_be", "semester", "class_id_registrar", "question_id_registrar", "officer_id_registrar");

ALTER TABLE "evaluation_response_summaries"
    ADD CONSTRAINT "evaluation_response_summaries_faculty_id_fkey"
    FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_response_summaries"
    ADD CONSTRAINT "evaluation_response_summaries_class_offering_id_fkey"
    FOREIGN KEY ("class_offering_id") REFERENCES "class_offerings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_response_summaries"
    ADD CONSTRAINT "evaluation_response_summaries_faculty_member_id_fkey"
    FOREIGN KEY ("faculty_member_id") REFERENCES "faculty_members"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_response_summaries"
    ADD CONSTRAINT "evaluation_response_summaries_question_id_fkey"
    FOREIGN KEY ("question_id") REFERENCES "evaluation_questions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "evaluation_response_summaries"
    ADD CONSTRAINT "evaluation_response_summaries_ingestion_run_id_fkey"
    FOREIGN KEY ("ingestion_run_id") REFERENCES "ingestion_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

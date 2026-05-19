-- /education/performance — class-GPA trend (new in v1.2.9)
-- Adds 12 grade-distribution columns + precomputed classGpa to class_offerings,
-- backed by the newly exposed grade letters in
-- POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER.
-- All new columns are nullable or have a default of 0 / NULL so historical
-- rows stay consistent and re-ingestion is idempotent.

ALTER TABLE "class_offerings"
  ADD COLUMN "grade_a"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_b_plus"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_b"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_c_plus"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_c"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_d_plus"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_d"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_f"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_i"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_w"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_au"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "grade_s"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "graded_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "class_gpa"      DOUBLE PRECISION;

CREATE INDEX "class_offerings_acad_year_be_semester_faculty_id_class_gpa_idx"
  ON "class_offerings" ("acad_year_be", "semester", "faculty_id", "class_gpa");

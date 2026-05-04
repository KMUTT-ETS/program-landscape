-- Add age aggregation columns to the student cube. Sum + count of
-- per-student ages that fall in the realistic higher-education range
-- (16-80 inclusive); out-of-range and missing birthdates contribute
-- to neither. Default to 0 so existing rows stay valid.

ALTER TABLE "education_student_cube"
  ADD COLUMN "age_sum"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "age_count" INTEGER NOT NULL DEFAULT 0;

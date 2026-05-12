-- FacultyMember.endEmploymentDate column.
--
-- Captures HCMEmployee.ENDWORKDATE (already queried in the kku-hr
-- connector's Q1 but previously discarded). Blank for currently-active
-- staff. Non-null indicates pre-retirement separation (resignation,
-- contract end, dismissal, death) — drives turnover-rate analytics on
-- /staff/workforce.

ALTER TABLE "faculty_members"
    ADD COLUMN "end_employment_date" DATE;

CREATE INDEX "faculty_members_end_employment_date_idx"
    ON "faculty_members"("end_employment_date");

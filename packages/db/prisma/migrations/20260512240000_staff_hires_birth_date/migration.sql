-- Add BIRTHDAY to staff_hires.
--
-- staff_hires now functions as the full HCM staff demographics
-- snapshot (one row per FIRSTHIREDATE-having employee in
-- EmployeeDetail — the 10-year hire window was dropped in the same
-- commit). Adding BIRTHDAY makes it the primary source for the
-- workforce-dashboard age / retirement / cliff calcs, with
-- staff_lifecycle_dates (vw_history) demoted to fallback-only.

ALTER TABLE "staff_hires"
    ADD COLUMN "birth_date" DATE;

CREATE INDEX "staff_hires_birth_date_idx" ON "staff_hires"("birth_date");

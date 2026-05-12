-- Full-date columns for staff_lifecycle_dates.
--
-- The processed-HR connector originally pulled YEAR(retireday) etc. from
-- vw_history. The deep-dive's faculty section reads
-- FacultyMember.retirementDate which is null for active staff (MSSQL
-- HCMEmployee.RESIGNDATE is only filled POST-resignation). The MySQL
-- vw_history.retireday is the actual scheduled retirement date and the
-- authoritative source.
--
-- This migration adds full-date columns. The processed-HR connector is
-- updated in the same commit to populate them.

ALTER TABLE "staff_lifecycle_dates"
    ADD COLUMN "birth_date" DATE,
    ADD COLUMN "hire_date" DATE,
    ADD COLUMN "retire_date" DATE,
    ADD COLUMN "sixty_date" DATE;

CREATE INDEX "staff_lifecycle_dates_retire_date_idx"
    ON "staff_lifecycle_dates"("retire_date");

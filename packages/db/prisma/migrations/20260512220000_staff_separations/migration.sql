-- Staff separations table (HCMEmployee.EmployeeDetail ENDWORKDATE).
--
-- One row per separation event. Captures every academic / research
-- staff member who has left KKU (ENDWORKDATE filled) within the last
-- 10 years — regardless of current STATUS. Drives the turnover signal
-- on /staff/workforce.
--
-- The previous turnover viz drew from FacultyMember.endEmploymentDate,
-- but FacultyMember rows only land for staff that pass the kku-hr
-- connector's active-only filter (STATUS='A' + workforce_hcm_actual
-- INNER JOIN). Separated staff get filtered out of that query entirely
-- → their endEmploymentDate was never set, turnover numerator was
-- structurally wrong. This table fixes that.

CREATE TABLE "staff_separations" (
    "employee_hash" TEXT NOT NULL,
    "employee_id" TEXT,
    "citizen_id_hash" TEXT,
    "end_work_date" DATE NOT NULL,
    "status" TEXT,
    "faculty_key" TEXT,
    "position_type" TEXT,
    "faculty_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_separations_pkey" PRIMARY KEY ("employee_hash")
);

CREATE INDEX "staff_separations_end_work_date_idx"
    ON "staff_separations"("end_work_date");
CREATE INDEX "staff_separations_position_type_idx"
    ON "staff_separations"("position_type");

ALTER TABLE "staff_separations"
    ADD CONSTRAINT "staff_separations_faculty_id_fkey"
    FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

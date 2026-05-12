-- Staff hires table (HCMEmployee.EmployeeDetail FIRSTHIREDATE).
--
-- Captures every staff member (academic + research + support, no
-- STATUS or position-type filter) who joined KKU within the last 10
-- years. Drives the "New hires (last 12 months)" KPI on
-- /staff/workforce.
--
-- Parallel construction to staff_separations — both derived from the
-- full EmployeeDetail without the active-only filter that scopes Q1
-- to academic faculty. The previous DS2001 movement-code path was
-- silently broken (movement_date null on 100% of staff_master_record
-- rows).

CREATE TABLE "staff_hires" (
    "employee_hash" TEXT NOT NULL,
    "employee_id" TEXT,
    "citizen_id_hash" TEXT,
    "first_hire_date" DATE NOT NULL,
    "status" TEXT,
    "faculty_key" TEXT,
    "position_type" TEXT,
    "faculty_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_hires_pkey" PRIMARY KEY ("employee_hash")
);

CREATE INDEX "staff_hires_first_hire_date_idx"
    ON "staff_hires"("first_hire_date");
CREATE INDEX "staff_hires_position_type_idx"
    ON "staff_hires"("position_type");

ALTER TABLE "staff_hires"
    ADD CONSTRAINT "staff_hires_faculty_id_fkey"
    FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

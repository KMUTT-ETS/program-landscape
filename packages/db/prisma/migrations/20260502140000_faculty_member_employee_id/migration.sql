-- Faculty members — add un-hashed HCMEmployee.EMPLOYEEID column.
-- Per KKU 2026-05-02, EMPLOYEEID is HR-internal (not citizen ID) and not
-- PII; the existing employee_code stays as a hashed-EMPLOYEEID join key
-- prefixed with hr_ for connector-origin tagging.

ALTER TABLE "faculty_members" ADD COLUMN "employee_id" TEXT;
CREATE INDEX "faculty_members_employee_id_idx" ON "faculty_members" ("employee_id");

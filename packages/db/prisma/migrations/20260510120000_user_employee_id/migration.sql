-- Adds User.employeeId — KKU HR cleartext employment number — captured
-- from the SSONext /auth.token claim on every login. Lets us bridge
-- User → FacultyMember (which already carries employeeId from the
-- kku-hr connector) without a fragile name match. Powers the user
-- profile page (resume of education + research + curriculum + papers).
--
-- Confirmed not PII per KKU 2026-05-02 (distinct from ID_PEOPLE which
-- is the Thai citizen ID and stays hashed). No unique constraint —
-- HR rows are not 1:1 with KKU SSO accounts (some staffers don't have
-- SSO; some accounts are programmatic).

ALTER TABLE "users"
  ADD COLUMN "employee_id" TEXT;

CREATE INDEX "users_employee_id_idx" ON "users"("employee_id");

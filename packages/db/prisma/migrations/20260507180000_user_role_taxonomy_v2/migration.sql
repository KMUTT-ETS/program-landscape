-- KKU SSO role taxonomy (2026-05-07)
-- Adds five new role values: SUPER_ADMIN / SYSTEM_ADMIN / UNIVERSITY_USER /
-- FACULTY_USER / PROGRAM_USER. Existing roles (VIEWER..ADMIN) retained for
-- back-compat with seed data + scenarios/decisions referencing them.
-- Adds User.programId so PROGRAM_USER rows carry a scope FK.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SYSTEM_ADMIN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'UNIVERSITY_USER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'FACULTY_USER';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PROGRAM_USER';

ALTER TABLE "users" ADD COLUMN "program_id" TEXT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_program_id_idx" ON "users"("program_id");

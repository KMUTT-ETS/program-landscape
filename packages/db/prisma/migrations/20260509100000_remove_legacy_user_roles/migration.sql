-- Remove legacy UserRole values (VIEWER / COUNCIL / EXECUTIVE / DEAN /
-- DEPT_HEAD / ANALYST / ADMIN). Migrates existing rows to their nearest
-- v2 equivalent, then recreates the enum without the legacy values.
--
-- Mapping rationale (see docs/auth/kku-sso.md):
--   ADMIN          → SUPER_ADMIN     (legacy admin = full)
--   ANALYST        → SYSTEM_ADMIN    (cross-faculty edit, no queue mgmt)
--   EXECUTIVE      → SYSTEM_ADMIN    (preserves write capability;
--                                     queue mgmt was never theirs anyway)
--   COUNCIL        → UNIVERSITY_USER (read-all + risks:measures:edit
--                                     which UNIVERSITY_USER now carries)
--   DEAN           → FACULTY_USER    (preserves facultyId)
--   DEPT_HEAD      → FACULTY_USER    (faculty-wide is the closest v2
--                                     fit; departmentId is preserved
--                                     on User but FACULTY_USER ignores it)
--   VIEWER         → UNIVERSITY_USER (read-only across university)

-- Step 1: User table — collapse legacy roles to v2.
UPDATE "users" SET "role" = 'SUPER_ADMIN'      WHERE "role" = 'ADMIN';
UPDATE "users" SET "role" = 'SYSTEM_ADMIN'     WHERE "role" IN ('ANALYST', 'EXECUTIVE');
UPDATE "users" SET "role" = 'FACULTY_USER'     WHERE "role" IN ('DEAN', 'DEPT_HEAD');
UPDATE "users" SET "role" = 'UNIVERSITY_USER'  WHERE "role" IN ('COUNCIL', 'VIEWER');

-- Step 2: UserScope table — same mapping.
UPDATE "user_scopes" SET "role" = 'SUPER_ADMIN'     WHERE "role" = 'ADMIN';
UPDATE "user_scopes" SET "role" = 'SYSTEM_ADMIN'    WHERE "role" IN ('ANALYST', 'EXECUTIVE');
UPDATE "user_scopes" SET "role" = 'FACULTY_USER'    WHERE "role" IN ('DEAN', 'DEPT_HEAD');
UPDATE "user_scopes" SET "role" = 'UNIVERSITY_USER' WHERE "role" IN ('COUNCIL', 'VIEWER');

-- Step 3: Recreate enum without legacy values. Postgres can't ALTER
-- TYPE … DROP VALUE, so the rename-create-recast-drop pattern is the
-- canonical workaround.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'SUPER_ADMIN',
  'SYSTEM_ADMIN',
  'UNIVERSITY_USER',
  'FACULTY_USER',
  'PROGRAM_USER'
);

-- Drop the default while we recast the column type — Postgres won't
-- accept a default that references the old enum during the type swap.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole"
  USING "role"::text::"UserRole";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'UNIVERSITY_USER';

ALTER TABLE "user_scopes"
  ALTER COLUMN "role" TYPE "UserRole"
  USING "role"::text::"UserRole";

DROP TYPE "UserRole_old";

-- Add a `source` column to UserScope so we can distinguish manually-
-- assigned scopes (set by an admin via /admin/users) from auto-synced
-- ones (computed from FacultyMember ↔ ProgramFaculty on every SSO login).
--
-- The auto-sync is destructive: when an academic staffer is removed
-- from a program in HR/MIS, the next login should drop their scope for
-- that program. We must not touch manually-assigned rows during that
-- prune — hence the column.
--
-- Default MANUAL preserves existing rows' semantics; the SSO callback
-- writes ACADEMIC_STAFF for the rows it manages.

CREATE TYPE "UserScopeSource" AS ENUM ('MANUAL', 'ACADEMIC_STAFF');

ALTER TABLE "user_scopes"
  ADD COLUMN "source" "UserScopeSource" NOT NULL DEFAULT 'MANUAL';

CREATE INDEX "user_scopes_source_idx" ON "user_scopes"("source");

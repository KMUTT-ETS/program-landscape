-- Multi-scope assignments per user.
--
-- Each row in user_scopes is one (role, faculty?, program?) tuple.
-- A user can hold multiple rows: e.g. FACULTY_USER for two faculties
-- and PROGRAM_USER for three programs across other faculties.
--
-- Phase 1 (this migration): table + backfill from existing User
-- primary scope columns. Runtime can() still consults the primary
-- columns. Admin UI manages user_scopes rows.
--
-- Phase 2 (later): rewrite can() + SessionUser to consume scopes[]
-- directly; primary columns become a derived "highest" scalar.

CREATE TABLE "user_scopes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "faculty_id" TEXT,
    "program_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_scopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_scopes_unique" ON "user_scopes"("user_id", "role", "faculty_id", "program_id");
CREATE INDEX "user_scopes_user_idx" ON "user_scopes"("user_id");
CREATE INDEX "user_scopes_faculty_idx" ON "user_scopes"("faculty_id");
CREATE INDEX "user_scopes_program_idx" ON "user_scopes"("program_id");

ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one user_scopes row per existing User, mirroring their
-- current primary (role, faculty_id, program_id). One row per user
-- means no duplicate-key risk; no ON CONFLICT clause needed.
INSERT INTO "user_scopes" ("id", "user_id", "role", "faculty_id", "program_id", "created_at")
SELECT
    'usc_' || REPLACE(gen_random_uuid()::TEXT, '-', ''),
    u."id",
    u."role",
    u."faculty_id",
    u."program_id",
    NOW()
FROM "users" u;

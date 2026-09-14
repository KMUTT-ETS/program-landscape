-- packages/db/prisma/migrations/20260914100000_page_views/migration.sql
-- Page-view recording and its daily roll-up. Additive only.
--
-- Hand-written; no generated drift copied (see 20260913140000).
--
-- page_views holds raw views for 120 days (docs/pdpa.md). page_view_daily is
-- the roll-up beyond that: Asia/Bangkok day, counts only, no timestamps, no
-- IP. Its unique index is NULLS NOT DISTINCT so an upsert on a key with NULL
-- user/programme/faculty matches the existing row instead of inserting a
-- duplicate every night. Prisma cannot express NULLS NOT DISTINCT; the
-- schema declares the same columns with @@unique so the client is typed, and
-- a future `prisma migrate diff` will report this index as drift — expected.

CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "role" TEXT NOT NULL,
    "impersonated" BOOLEAN NOT NULL DEFAULT false,
    "viewer_faculty_id" TEXT,
    "path" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "program_id" TEXT,
    "faculty_id" TEXT,
    "department_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "page_views_created_at_idx" ON "page_views"("created_at");
CREATE INDEX "page_views_user_id_created_at_idx" ON "page_views"("user_id", "created_at");
CREATE INDEX "page_views_program_id_created_at_idx" ON "page_views"("program_id", "created_at");
CREATE INDEX "page_views_module_created_at_idx" ON "page_views"("module", "created_at");
ALTER TABLE "page_views" ADD CONSTRAINT "page_views_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "page_view_daily" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "user_id" TEXT,
    "role" TEXT NOT NULL,
    "viewer_faculty_id" TEXT,
    "module" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "program_id" TEXT,
    "faculty_id" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "signins" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "page_view_daily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "page_view_daily_key" ON "page_view_daily"
  ("day", "user_id", "role", "viewer_faculty_id", "module", "path", "program_id", "faculty_id")
  NULLS NOT DISTINCT;
CREATE INDEX "page_view_daily_day_idx" ON "page_view_daily"("day");
CREATE INDEX "page_view_daily_user_id_day_idx" ON "page_view_daily"("user_id", "day");
CREATE INDEX "page_view_daily_program_id_day_idx" ON "page_view_daily"("program_id", "day");
ALTER TABLE "page_view_daily" ADD CONSTRAINT "page_view_daily_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

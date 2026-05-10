-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "public_profile_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "public_profile_slug" TEXT,
  ADD COLUMN "public_profile_indexable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "public_profile_updated_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_public_profile_slug_key" ON "users"("public_profile_slug");

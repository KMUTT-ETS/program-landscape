-- Adds user-uploaded profile photo metadata. The actual bytes live in
-- MinIO under the `avatars` bucket; the DB just tracks the object key
-- + last-update timestamp (used for cache-bust query strings on the
-- served URL).

ALTER TABLE "users"
  ADD COLUMN "avatar_storage_key" TEXT,
  ADD COLUMN "avatar_updated_at" TIMESTAMP(3);

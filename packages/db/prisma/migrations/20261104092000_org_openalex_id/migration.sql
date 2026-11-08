-- The organisation profile carries the university's OpenAlex institution id,
-- which the openalex-works connector uses to pull its publications.
-- Additive and nullable; an existing row stays null (connector skipped).
ALTER TABLE "organization_profile" ADD COLUMN "openalex_institution_id" TEXT;

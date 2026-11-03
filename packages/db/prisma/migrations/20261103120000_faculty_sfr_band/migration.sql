-- Teaching mode (student:staff-ratio band) becomes data on the faculty.
--
-- It was a map of KKU's faculty codes inside health-score.ts, so any other
-- university's faculties all fell to PROFESSIONAL with no way to change that.
-- The column is nullable; null reads as PROFESSIONAL, which is what an
-- unlisted code got before.
--
-- KKU's map is backfilled only on a KKU installation, so its scores do not
-- move, and an adopter whose faculty codes happen to match (MD, EN, ...) is
-- not silently given KKU's bands.
CREATE TYPE "SfrBand" AS ENUM ('CLINICAL', 'STEM_LAB', 'STUDIO', 'PROFESSIONAL', 'HUMANITIES');

ALTER TABLE "faculties" ADD COLUMN "sfr_band" "SfrBand";

UPDATE "faculties" SET "sfr_band" = 'CLINICAL'
WHERE "sfr_band" IS NULL
  AND "code" IN ('MD', 'DT', 'VM', 'NU', 'AMS', 'PH', 'PHA')
  AND EXISTS (SELECT 1 FROM organization_profile WHERE name_en = 'Khon Kaen University');

UPDATE "faculties" SET "sfr_band" = 'STEM_LAB'
WHERE "sfr_band" IS NULL
  AND "code" IN ('AG', 'SC', 'EN', 'TC', 'COC')
  AND EXISTS (SELECT 1 FROM organization_profile WHERE name_en = 'Khon Kaen University');

UPDATE "faculties" SET "sfr_band" = 'STUDIO'
WHERE "sfr_band" IS NULL
  AND "code" IN ('AR', 'FAR')
  AND EXISTS (SELECT 1 FROM organization_profile WHERE name_en = 'Khon Kaen University');

UPDATE "faculties" SET "sfr_band" = 'PROFESSIONAL'
WHERE "sfr_band" IS NULL
  AND "code" IN ('BS', 'LAW', 'EC', 'COPA', 'IC', 'NK', 'GS', 'MBA')
  AND EXISTS (SELECT 1 FROM organization_profile WHERE name_en = 'Khon Kaen University');

UPDATE "faculties" SET "sfr_band" = 'HUMANITIES'
WHERE "sfr_band" IS NULL
  AND "code" IN ('HU', 'ED')
  AND EXISTS (SELECT 1 FROM organization_profile WHERE name_en = 'Khon Kaen University');


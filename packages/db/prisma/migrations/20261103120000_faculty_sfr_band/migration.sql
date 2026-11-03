-- Teaching mode (student:staff-ratio band) becomes data on the faculty.
--
-- It was a map of KKU's faculty codes inside health-score.ts, so any other
-- university's faculties all fell to PROFESSIONAL with no way to change that.
-- The column is nullable; null reads as PROFESSIONAL, which is what an
-- unlisted code got before.
--
-- KKU's map is backfilled only onto faculties carrying KKU's code AND KKU's
-- Thai name, so its scores do not move, and an adopter whose faculty codes
-- happen to match (MD, EN, ...) is not silently given KKU's bands. The
-- organisation profile is NOT consulted: on an upgrade it is seeded after
-- migrations run. org-seed-kku and the dev seed repeat this backfill for
-- faculties created later (backfillKkuSfrBands).
CREATE TYPE "SfrBand" AS ENUM ('CLINICAL', 'STEM_LAB', 'STUDIO', 'PROFESSIONAL', 'HUMANITIES');

ALTER TABLE "faculties" ADD COLUMN "sfr_band" "SfrBand";

UPDATE "faculties" SET "sfr_band" = 'CLINICAL'
WHERE "sfr_band" IS NULL
  AND (("code" = 'MD' AND "name_th" = 'คณะแพทยศาสตร์') OR ("code" = 'DT' AND "name_th" = 'คณะทันตแพทยศาสตร์') OR ("code" = 'VM' AND "name_th" = 'คณะสัตวแพทยศาสตร์') OR ("code" = 'NU' AND "name_th" = 'คณะพยาบาลศาสตร์') OR ("code" = 'AMS' AND "name_th" = 'คณะเทคนิคการแพทย์') OR ("code" = 'PH' AND "name_th" = 'คณะสาธารณสุขศาสตร์') OR ("code" = 'PHA' AND "name_th" = 'คณะเภสัชศาสตร์'));

UPDATE "faculties" SET "sfr_band" = 'STEM_LAB'
WHERE "sfr_band" IS NULL
  AND (("code" = 'AG' AND "name_th" = 'คณะเกษตรศาสตร์') OR ("code" = 'SC' AND "name_th" = 'คณะวิทยาศาสตร์') OR ("code" = 'EN' AND "name_th" = 'คณะวิศวกรรมศาสตร์') OR ("code" = 'TC' AND "name_th" = 'คณะเทคโนโลยี') OR ("code" = 'COC' AND "name_th" = 'วิทยาลัยการคอมพิวเตอร์'));

UPDATE "faculties" SET "sfr_band" = 'STUDIO'
WHERE "sfr_band" IS NULL
  AND (("code" = 'AR' AND "name_th" = 'คณะสถาปัตยกรรมศาสตร์') OR ("code" = 'FAR' AND "name_th" = 'คณะศิลปกรรมศาสตร์'));

UPDATE "faculties" SET "sfr_band" = 'PROFESSIONAL'
WHERE "sfr_band" IS NULL
  AND (("code" = 'BS' AND "name_th" = 'คณะบริหารธุรกิจและการบัญชี') OR ("code" = 'LAW' AND "name_th" = 'คณะนิติศาสตร์') OR ("code" = 'EC' AND "name_th" = 'คณะเศรษฐศาสตร์') OR ("code" = 'COPA' AND "name_th" = 'วิทยาลัยนโยบายและกิจการสาธารณะ') OR ("code" = 'IC' AND "name_th" = 'วิทยาลัยนานาชาติ') OR ("code" = 'NK' AND "name_th" = 'คณะสหวิทยาการ') OR ("code" = 'GS' AND "name_th" = 'บัณฑิตวิทยาลัย') OR ("code" = 'MBA' AND "name_th" = 'วิทยาลัยบัณฑิตศึกษาการจัดการ'));

UPDATE "faculties" SET "sfr_band" = 'HUMANITIES'
WHERE "sfr_band" IS NULL
  AND (("code" = 'HU' AND "name_th" = 'คณะมนุษยศาสตร์และสังคมศาสตร์') OR ("code" = 'ED' AND "name_th" = 'คณะศึกษาศาสตร์'));


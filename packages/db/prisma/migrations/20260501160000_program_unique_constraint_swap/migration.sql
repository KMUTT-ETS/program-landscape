-- mhesi_code is NOT unique per sheet — KKU's master sheet reuses some
-- codes between Bachelor + Master variants of related programs. Drop the
-- unique constraint, replace with sequence_no_from_sheet @unique
-- (which IS unique per sheet row).

DROP INDEX IF EXISTS "programs_mhesi_code_key";

CREATE UNIQUE INDEX "programs_sequence_no_from_sheet_key"
  ON "programs"("sequence_no_from_sheet");

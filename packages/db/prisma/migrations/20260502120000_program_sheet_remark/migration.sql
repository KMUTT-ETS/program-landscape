-- Additive: add Program.sheet_remark for KKU master-sheet column E preservation
-- when it disagrees with the canonical discipline parsed from column D's parens.

ALTER TABLE "programs" ADD COLUMN "sheet_remark" TEXT;

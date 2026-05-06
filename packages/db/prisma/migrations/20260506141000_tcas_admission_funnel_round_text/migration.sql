-- Round is fractional in some KKU TCAS years (1.2, 2.2, 4.2 — sub-rounds)
-- so the source view ROUND column is NUMBER. We store as TEXT to preserve
-- the source representation verbatim and avoid float-comparison surprises.
-- Table is empty at this point; safe to alter directly.
ALTER TABLE "tcas_admission_funnels" ALTER COLUMN "round" TYPE TEXT;

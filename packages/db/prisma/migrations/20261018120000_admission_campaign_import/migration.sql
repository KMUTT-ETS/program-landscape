-- Admission campaigns become importable from a spreadsheet.
--
-- Two columns are the registrar's own identifiers and an adopting
-- university has neither: W_PROGRAM_ID is Oracle's per-row surrogate, and
-- RECRUITMENT_PROGRAM_ID is the recruitment-programme code that groups
-- campaign tracks. Both drop NOT NULL so an imported row can exist without
-- inventing them.
--
-- The unique on w_program_id stays: Postgres permits any number of NULLs in
-- a unique index, so connector rows keep their constraint and imported rows
-- simply do not participate in it.
--
-- Additive and reversible: no data is read, written or moved.

ALTER TABLE "admission_campaign_stats" ALTER COLUMN "w_program_id" DROP NOT NULL;
ALTER TABLE "admission_campaign_stats" ALTER COLUMN "recruitment_program_id" DROP NOT NULL;

-- Per-affected-program job-position candidates (immediate + 1-3yr) and
-- white-space "new initiative" product/service ideas for demanded roles KKU
-- has no current supply for. Both written by trend-signal-analysis.v3.
-- Additive + nullable; the flat affected_program_ids array is unchanged.
ALTER TABLE "trend_signals" ADD COLUMN "affected_programs_json" JSONB;
ALTER TABLE "trend_signals" ADD COLUMN "new_initiatives_json" JSONB;

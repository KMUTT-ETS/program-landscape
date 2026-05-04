-- ProgramDemandMatch — add `relevant` flag for the discipline filter.
-- gaps = matched=false AND relevant=true. Skills demanded somewhere in
-- the labour market but not relevant to this program's discipline
-- (e.g., "Civil engineering" for a Mechanical Engineering BE) are
-- suppressed from the gap list.

ALTER TABLE "program_demand_matches" ADD COLUMN "relevant" BOOLEAN NOT NULL DEFAULT true;

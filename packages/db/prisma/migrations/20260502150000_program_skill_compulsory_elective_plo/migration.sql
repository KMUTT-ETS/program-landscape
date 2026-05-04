-- ProgramSkill — split weight into compulsory/elective + PLO flag +
-- evidence-quote columns. Drives the rigorous skill-coverage view in
-- the deep-dive: compulsory courses contribute MAJOR weight, electives
-- contribute MINOR, PLOs flag program-level intent.

ALTER TABLE "program_skills" ADD COLUMN "compulsory_weight" DOUBLE PRECISION;
ALTER TABLE "program_skills" ADD COLUMN "elective_weight"   DOUBLE PRECISION;
ALTER TABLE "program_skills" ADD COLUMN "picked_from_plo"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "program_skills" ADD COLUMN "evidence_quote"    TEXT;

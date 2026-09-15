-- job_field_taxonomy.synonyms defaults to an empty array. A NULL array is
-- silently excluded from the `required_fields_raw && synonyms` overlap join;
-- an empty array is honestly "absorbs nothing". Additive; follows the
-- demand_sources convention. Hand-written.
ALTER TABLE "job_field_taxonomy" ALTER COLUMN "synonyms" SET DEFAULT ARRAY[]::TEXT[];

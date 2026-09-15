-- packages/db/prisma/migrations/20260915100100_job_postings_required_fields_gin/migration.sql
-- GIN index for the Gap Analyzer's postings <-> field join
-- (job_postings.required_fields_raw && job_field_taxonomy.synonyms).
-- Additive; Prisma has no GIN attribute for String[] so a future
-- `prisma migrate diff` will report this index as drift — expected.

CREATE INDEX "job_postings_required_fields_raw_gin" ON "job_postings" USING GIN ("required_fields_raw");

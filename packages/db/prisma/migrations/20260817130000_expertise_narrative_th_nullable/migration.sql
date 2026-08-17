-- expertise-narrative.v3 (docs/prompt-standard.md): the model no longer
-- generates a Thai analysis paragraph (narrativeEn is the sole narrative
-- field going forward; the Thai KEYWORD arrays are unaffected — they're
-- the standard's documented exemption). Relax narrative_th to nullable
-- so new v3 rows can omit it. Historical v1/v2 rows keep their Thai
-- content unchanged (no data loss, no rewrite) for audit.
ALTER TABLE "user_expertise_narratives" ALTER COLUMN "narrative_th" DROP NOT NULL;

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The taxonomy rows are Council-facing (every field on /gap-analysis is one).
// They must carry provenance (ingestionRunId) so realDataWhere() admits them,
// a review status so PROPOSED rows can be labelled, and a method version so a
// prompt bump is visible per row. This reads schema.prisma so it holds without
// a database.

const schema = readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
const model = (name: string) => {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${name} not found`);
  return m[1]!;
};

describe('JobFieldTaxonomy', () => {
  const body = model('JobFieldTaxonomy');
  it('maps to job_field_taxonomy with a unique slug and a synonyms array', () => {
    expect(body).toContain('@@map("job_field_taxonomy")');
    expect(body).toMatch(/slug\s+String\s+@unique/);
    expect(body).toMatch(/synonyms\s+String\[\]/);
  });
  it('carries review status, method version and provenance', () => {
    expect(body).toMatch(/reviewStatus\s+JobFieldReviewStatus/);
    expect(body).toMatch(/methodVersion\s+String/);
    expect(body).toMatch(/ingestionRunId\s+String\?/);
    expect(body).toContain('@@index([reviewStatus])');
  });
  it('declares the GIN index the overlap join relies on, and defaults synonyms to empty', () => {
    expect(body).toContain('@@index([synonyms], type: Gin, map: "job_field_taxonomy_synonyms_gin")');
    expect(body).toMatch(/synonyms\s+String\[\]\s+@default\(\[\]\)/);
  });
});

describe('JobPosting', () => {
  it('declares the GIN index on required_fields_raw', () => {
    expect(model('JobPosting')).toContain('@@index([requiredFieldsRaw], type: Gin, map: "job_postings_required_fields_raw_gin")');
  });
});

describe('ProgramJobField', () => {
  const body = model('ProgramJobField');
  it('is unique per (programId, fieldId) and cascades from both parents', () => {
    expect(body).toContain('@@map("program_job_fields")');
    expect(body).toContain('@@unique([programId, fieldId])');
    expect((body.match(/onDelete: Cascade/g) ?? []).length).toBe(2);
  });
  it('carries source, confidence, review status and provenance', () => {
    expect(body).toMatch(/source\s+String/);
    expect(body).toMatch(/confidence\s+Float\?/);
    expect(body).toMatch(/reviewStatus\s+JobFieldReviewStatus/);
    expect(body).toMatch(/ingestionRunId\s+String\?/);
  });
});

describe('JobFieldReviewStatus', () => {
  it('has exactly PROPOSED, APPROVED, REJECTED', () => {
    const m = schema.match(/enum JobFieldReviewStatus \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const values = m![1]!.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));
    expect(values).toEqual(['PROPOSED', 'APPROVED', 'REJECTED']);
  });
});

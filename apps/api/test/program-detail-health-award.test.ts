import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRANT_AWARD_CAVEAT } from '@kku/db';
import { ProgramDetailDataSchema } from '@kku/pdf-templates';
import { grantAwardLine } from '@kku/shared/src/health/grant-award-note';
import { healthAwardForPdf } from '../src/programs/program-detail-health-award';

const computed = {
  label: 'external_grant_award' as const,
  points: 6.23,
  baseScore: 61.4,
  raw: { bahtPerStaffPerYear: 1_040_000, projects: 4, windowFyBe: [2567, 2569], caveat: GRANT_AWARD_CAVEAT },
};

describe('Program Detail PDF — external-grant award', () => {
  it('carries the web wording and the lower-bound caveat for a computed award', () => {
    const a = healthAwardForPdf(computed);
    expect(a).not.toBeNull();
    expect(a?.line).toBe(grantAwardLine(computed));
    expect(a?.line).toBe('External-grant award: +6.2 (฿1.04 M per teaching staff per year, FY 2567–2569) · base 61.4 → 67.6');
    expect(a?.caveat).toBe(GRANT_AWARD_CAVEAT);
    expect(a?.points).toBe(6.23);
    expect(a?.baseScore).toBe(61.4);
  });

  it('explains a data gap without a caveat, and drops a silent null', () => {
    const gap = healthAwardForPdf({ label: 'external_grant_award', points: null, baseScore: 50, raw: { reason: 'source-not-synced' } });
    expect(gap?.line).toBe('External-grant award: grant data has not been synced on this server yet.');
    expect(gap?.caveat).toBeNull();
    expect(healthAwardForPdf({ label: 'external_grant_award', points: null, baseScore: null, raw: { reason: 'no-base-financial-score' } })).toBeNull();
    expect(healthAwardForPdf(null)).toBeNull();
    expect(healthAwardForPdf(undefined)).toBeNull();
  });

  it('round-trips through the template schema', () => {
    const parsed = ProgramDetailDataSchema.parse({
      programCode: 'KKU-SEQ-9999',
      nameTh: 'ทดสอบ',
      nameEn: 'Test',
      level: 'Bachelor',
      status: 'ACTIVE',
      facultyTh: 'คณะทดสอบ',
      facultyEn: 'Faculty of Testing',
      dateLabel: '2026-01-01',
      generatedAtLabel: 'x',
      methodologyVersion: 'health-score.v5.4',
      healthDimensions: [
        { dimension: 'Financial', score: 68, dataCompleteness: 75, topDriverLabel: null, topDriverValue: null, award: healthAwardForPdf(computed) },
      ],
    });
    expect(parsed.healthDimensions[0].award?.caveat).toBe(GRANT_AWARD_CAVEAT);
  });

  it('the builder fills the award from the Financial cell', () => {
    const src = readFileSync(path.join(__dirname, '..', 'src/programs/program-detail-data.ts'), 'utf8');
    expect(src).toContain("award: key === 'financial' ? healthAwardForPdf(cell.award) : null");
  });
});

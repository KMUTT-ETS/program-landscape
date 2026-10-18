import { describe, expect, it } from 'vitest';

import { prisma } from '../src';
import { Prisma } from '@prisma/client';

import { campaignPlanKey, campaignPlanKeySql, campaignPlanKeySqlText } from '../src/campaign-plan-key';

// The planned-seat grouping exists in two languages: TypeScript, for the
// readers that go through Prisma, and SQL, for the three that do not. If
// they ever disagree the same installation reports two different intake
// figures depending on which page you open — so this pins them together.
//
// It matters most for an imported row, where the id is NULL: a plain
// GROUP BY folds every NULL into ONE group, so 300 campaigns of 30 seats
// would report 30 planned seats for the whole university.

describe('campaignPlanKeySql', () => {
  const cases = [
    { recruitmentProgramId: 'P100', round: 'Round 1', campaignName: 'Regular' },
    { recruitmentProgramId: null, round: 'Round 1', campaignName: 'Regular' },
    { recruitmentProgramId: null, round: 'Round 3', campaignName: 'Special' },
    { recruitmentProgramId: null, round: 'Round 1', campaignName: 'Regular|Other' },
  ];

  it('agrees with the TypeScript helper on every shape', async () => {
    for (const row of cases) {
      const [result] = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
        SELECT ${campaignPlanKeySql('c')} AS key
        FROM (SELECT
          ${row.recruitmentProgramId}::text AS recruitment_program_id,
          ${row.round}::text AS round,
          ${row.campaignName}::text AS campaign_name
        ) c
      `);
      expect(result?.key, JSON.stringify(row)).toBe(campaignPlanKey(row));
    }
  });

  it('offers the same fragment as plain text for $queryRawUnsafe', () => {
    expect(campaignPlanKeySqlText('c')).toContain('chr(31)');
    expect(campaignPlanKeySqlText('c')).toContain('c.recruitment_program_id');
  });

  it('gives two imported campaigns different keys', async () => {
    const keys = new Set<string>();
    for (const row of cases.slice(1, 3)) {
      const [result] = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
        SELECT ${campaignPlanKeySql('c')} AS key
        FROM (SELECT
          ${row.recruitmentProgramId}::text AS recruitment_program_id,
          ${row.round}::text AS round,
          ${row.campaignName}::text AS campaign_name
        ) c
      `);
      keys.add(result?.key ?? '');
    }
    expect(keys.size).toBe(2);
  });
});

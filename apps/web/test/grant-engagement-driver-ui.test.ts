import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRIVER_SOURCE_MARK } from '../src/components/data-source-mark';
import { grantDriverCaveat, grantDriverNullNote } from '../src/lib/grant-driver-note';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('external_grant_engagement in the UI', () => {
  it('has a readable label in the deep-dive and the print view', () => {
    expect(read('app/programs/[id]/client.tsx')).toContain("external_grant_engagement: 'External grant engagement (3 FY)'");
    expect(read('app/programs/[id]/print/page.tsx')).toContain("external_grant_engagement: 'External grant engagement (3 FY)'");
  });

  it('has the label in the API driver-label map too', () => {
    expect(read('../api/src/programs/program-detail-data.ts')).toContain(
      "external_grant_engagement: 'External grant engagement (3 FY)'",
    );
  });

  it('carries the grants source mark', () => {
    expect(DRIVER_SOURCE_MARK.external_grant_engagement).toBe('kku-research-services');
  });

  it('explains each gate reason in plain words', () => {
    expect(grantDriverNullNote({ reason: 'awaiting-green-history', daysOfHistory: 12 })).toBe(
      'Waiting for 30 days of grant-sync history (12 so far).',
    );
    expect(grantDriverNullNote({ reason: 'source-not-synced' })).toBe('Grant data has not been synced on this server yet.');
    expect(grantDriverNullNote({ reason: 'source-stale', lastSuccessAt: '2026-11-10T21:00:00.000Z' })).toBe(
      'Grant data is out of date (last synced 2026-11-11).',
    );
    expect(grantDriverNullNote({ reason: 'source-stale', lastSuccessAt: 'not-a-date' })).toBe(
      'Grant data is out of date (last synced unknown).',
    );
    expect(grantDriverNullNote({ reason: 'awaiting-green-history', daysOfHistory: 45, successfulDaysLast30: 21 })).toBe(
      'Waiting for steadier grant syncs (only 21 of the last 30 days synced; 25 needed).',
    );
    expect(grantDriverNullNote({ fundedStaff: 1 })).toBeNull();
    expect(grantDriverNullNote(null)).toBeNull();
  });

  it('surfaces the undercount caveat only when raw carries one', () => {
    expect(grantDriverCaveat({ caveat: 'Lower bound: x' })).toBe('Lower bound: x');
    expect(grantDriverCaveat({ fundedStaff: 1 })).toBeNull();
    expect(grantDriverCaveat({ caveat: 5 })).toBeNull();
    expect(grantDriverCaveat(null)).toBeNull();
  });
});

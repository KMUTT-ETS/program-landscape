import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRIVER_SOURCE_MARK } from '../src/components/data-source-mark';
import { grantAwardCaveat, grantAwardLine } from '../src/lib/grant-award-note';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('external-grant award in the UI', () => {
  it('describes a positive award with the measure, window and base', () => {
    expect(
      grantAwardLine({
        label: 'external_grant_award',
        points: 6.23,
        baseScore: 61.4,
        raw: { bahtPerStaffPerYear: 1_040_000, windowFyBe: [2567, 2569] },
      }),
    ).toBe('External-grant award: +6.2 (฿1.04 M per teaching staff per year, FY 2567–2569) · base 61.4 → 67.6');
  });

  it('says +0 when there was no grant in the window', () => {
    expect(
      grantAwardLine({
        label: 'external_grant_award',
        points: 0,
        baseScore: 55,
        raw: { bahtPerStaffPerYear: 0, windowFyBe: [2567, 2569] },
      }),
    ).toBe('External-grant award: +0 (no external grant in FY 2567–2569)');
  });

  it('explains each null reason in plain words', () => {
    const line = (reason: string) =>
      grantAwardLine({ label: 'external_grant_award', points: null, baseScore: 50, raw: { reason } });
    expect(line('source-not-synced')).toBe('External-grant award: grant data has not been synced on this server yet.');
    expect(line('no-active-staff')).toBe('External-grant award: no active teaching staff on record.');
    expect(line('no-base-financial-score')).toBeNull();
    expect(grantAwardLine(null)).toBeNull();
    expect(grantAwardLine(undefined)).toBeNull();
  });

  it('shows the caveat only for a computed award', () => {
    expect(grantAwardCaveat({ label: 'external_grant_award', points: 3, baseScore: 50, raw: { caveat: 'Lower bound: x' } })).toBe(
      'Lower bound: x',
    );
    expect(grantAwardCaveat({ label: 'external_grant_award', points: null, baseScore: 50, raw: { reason: 'source-not-synced' } })).toBeNull();
    expect(grantAwardCaveat(null)).toBeNull();
  });

  it('rounds the baht unit before choosing it', () => {
    const line = (v: number) =>
      grantAwardLine({ label: 'external_grant_award', points: 1, baseScore: 50, raw: { bahtPerStaffPerYear: v, windowFyBe: [2567, 2569] } });
    expect(line(999_999)).toContain('฿1 M per');
    expect(line(999_400)).toContain('฿999k per');
    expect(line(250_000)).toContain('฿250k per');
    expect(line(1_040_000)).toContain('฿1.04 M per');
  });

  it('shows arithmetic that adds up after rounding', () => {
    expect(
      grantAwardLine({ label: 'external_grant_award', points: 6.25, baseScore: 61.45, raw: { bahtPerStaffPerYear: 1_040_000, windowFyBe: [2567, 2569] } }),
    ).toContain('+6.3 (');
    expect(
      grantAwardLine({ label: 'external_grant_award', points: 6.25, baseScore: 61.45, raw: { bahtPerStaffPerYear: 1_040_000, windowFyBe: [2567, 2569] } }),
    ).toContain('· base 61.5 → 67.8');
    expect(
      grantAwardLine({ label: 'external_grant_award', points: 10, baseScore: 97.04, raw: { bahtPerStaffPerYear: 3_000_000, windowFyBe: [2567, 2569] } }),
    ).toContain('· base 97.0 → 100.0');
  });

  it('carries the grants source mark under the award label', () => {
    expect(DRIVER_SOURCE_MARK.external_grant_award).toBe('kku-research-services');
    expect(DRIVER_SOURCE_MARK.external_grant_engagement).toBeUndefined();
  });

  it('no surface still names the removed driver', () => {
    for (const f of ['app/programs/[id]/client.tsx', 'app/programs/[id]/print/page.tsx', '../api/src/programs/program-detail-data.ts']) {
      expect(read(f)).not.toContain('external_grant_engagement');
    }
  });

  it('renders the award line in the Deep-Dive and print views', () => {
    expect(read('app/programs/[id]/client.tsx')).toContain('grantAwardLine(');
    expect(read('app/programs/[id]/print/page.tsx')).toContain('grantAwardLine(');
  });
});

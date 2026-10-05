import { describe, expect, it } from 'vitest';
import { buildCapability, type CapabilityInput } from '../src/landscape-atlas/capability';

const f = (over: Partial<CapabilityInput>): CapabilityInput => ({
  facultyId: 'f',
  code: 'F',
  nameTh: 'คณะ',
  nameEn: 'Faculty',
  activeStaff: 100,
  publications3y: 300,
  grantBahtPerStaffPerYear: 500_000,
  ...over,
});

describe('buildCapability', () => {
  it('computes publications per staff per year over three years', () => {
    const out = buildCapability([f({ facultyId: 'a', activeStaff: 10, publications3y: 60 })], 'now');
    expect(out.points[0]!.values['Publications per staff per year']).toBe(2);
  });

  it('lists faculties with no staff or unsynced grants', () => {
    const out = buildCapability(
      [f({ facultyId: 'a', activeStaff: 0 }), f({ facultyId: 'b', grantBahtPerStaffPerYear: null }), f({ facultyId: 'c' })],
      'now',
    );
    expect(out.unplotted.map((u) => [u.id, u.reason])).toEqual([
      ['a', 'No active teaching staff'],
      ['b', 'Grant data not synced'],
    ]);
  });

  it('puts a zero-grant faculty on the floor of the log axis, not off the chart', () => {
    const out = buildCapability([f({ facultyId: 'a', grantBahtPerStaffPerYear: 0 }), f({ facultyId: 'b' })], 'now');
    expect(out.points.find((p) => p.id === 'a')!.y).toBe(0);
  });

  it('tones by the KKU medians and answers with faculties at ฿1M+ per staff', () => {
    const out = buildCapability(
      [
        f({ facultyId: 'hi', publications3y: 900, grantBahtPerStaffPerYear: 2_000_000 }),
        f({ facultyId: 'mid', publications3y: 300, grantBahtPerStaffPerYear: 400_000 }),
        f({ facultyId: 'lo', publications3y: 30, grantBahtPerStaffPerYear: 50_000 }),
      ],
      'now',
    );
    expect(out.points.map((p) => [p.id, p.tone])).toEqual([
      ['hi', 'positive'],
      ['mid', 'positive'],
      ['lo', 'negative'],
    ]);
    expect(out.answer).toEqual({
      figure: '1',
      sentence: 'of 3 faculties brings in ฿1M or more in external grants per teaching staff member a year.',
    });
  });
});

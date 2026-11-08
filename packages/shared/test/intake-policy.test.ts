import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_INTAKE_FLOORS,
  intakeComplianceFor,
  intakeFloors,
} from '../src/intake-policy';
import { setOrganizationForTest } from '../src/institution';

// The minimum intake a programme must recruit to be considered viable.
//
// This was two hardcoded constants — 30 and 8 — written once in
// health-score.ts and copied into risk-scoring.ts. They are a POLICY, set by
// a university council, not a property of the software: an adopting
// institution with a floor of 20 had every programme judged against another
// university's rule, and could only change it by editing two files that were
// free to drift apart.

const INSTITUTION = {
  nameTh: 'ทดสอบ',
  nameEn: 'Test University',
  shortNameEn: 'TU',
  shortNameTh: 'ทดสอบ',
  regionTh: null,
  regionEn: null,
  contactEmail: null,
  appUrl: 'https://example.test',
  intakeFloorBachelor: 30,
  intakeFloorPostgrad: 8,
  openalexInstitutionId: null,
};

afterEach(() => setOrganizationForTest(undefined));

describe('where the floors come from', () => {
  it('reads them off the configured organisation', () => {
    setOrganizationForTest({ ...INSTITUTION, intakeFloorBachelor: 20, intakeFloorPostgrad: 5 });

    expect(intakeFloors()).toEqual({ bachelor: 20, postgrad: 5 });
  });

  it('returns null when no organisation is configured', () => {
    // Deliberately null rather than 30/8. A threshold is a number that
    // decides a verdict, and the house rule for a number we do not have is
    // null — not a default borrowed from whoever wrote the code.
    setOrganizationForTest(null);

    expect(intakeFloors()).toBeNull();
  });

  it('returns null rather than throwing when the cache was never loaded', () => {
    // Identity throws here on purpose, so a white-label install cannot call
    // itself the wrong university. A scoring threshold is different: a throw
    // would blank every health score in the process.
    setOrganizationForTest(undefined);

    expect(intakeFloors()).toBeNull();
  });
});

describe('the verdict, with floors supplied', () => {
  const floors = DEFAULT_INTAKE_FLOORS;

  it('calls a bachelor programme at its floor compliant', () => {
    expect(intakeComplianceFor('BACHELOR', 30, floors)).toEqual({
      state: 'compliant',
      floor: 30,
      score: 50,
    });
  });

  it('scores a bachelor programme at twice its floor 100', () => {
    expect(intakeComplianceFor('BACHELOR', 60, floors).score).toBe(100);
  });

  it('calls a bachelor programme under its floor a breach', () => {
    // Half the floor scores 25 — the strict, closure-track curve.
    expect(intakeComplianceFor('BACHELOR', 15, floors)).toEqual({
      state: 'breach',
      floor: 30,
      score: 25,
    });
  });

  it('puts a postgraduate programme under its floor on watch, not breach', () => {
    const v = intakeComplianceFor('MASTER', 4, floors);
    expect(v.state).toBe('watch');
    expect(v.floor).toBe(8);
    expect(v.score).toBe(45);
  });

  it('treats every postgraduate level the same way', () => {
    for (const level of ['MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']) {
      expect(intakeComplianceFor(level, 8, floors).state).toBe('compliant');
    }
  });

  it('is unknown when the intake is unknown', () => {
    expect(intakeComplianceFor('BACHELOR', null, floors)).toEqual({
      state: 'unknown',
      floor: 0,
      score: null,
    });
  });
});

describe('a different university gets a different verdict', () => {
  it('passes an intake of 22 where the floor is 20 and fails it where it is 30', () => {
    // The whole point of the change: the same programme, judged by two
    // institutions' policies, must come out differently.
    expect(intakeComplianceFor('BACHELOR', 22, { bachelor: 20, postgrad: 5 }).state).toBe(
      'compliant',
    );
    expect(intakeComplianceFor('BACHELOR', 22, { bachelor: 30, postgrad: 8 }).state).toBe(
      'breach',
    );
  });

  it('is unknown when the institution has not set a floor', () => {
    expect(intakeComplianceFor('BACHELOR', 22, null)).toEqual({
      state: 'unknown',
      floor: 0,
      score: null,
    });
  });
});

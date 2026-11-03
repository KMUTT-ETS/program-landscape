import { describe, expect, it } from 'vitest';
import { driverNullNote, SKILL_LINK_HINT } from '../src/checklist-driver-notes';

const none = { kmitlRows: 0, kmitlLinked: 0 };

describe('driverNullNote', () => {
  it('names the Reported column for registration yield', () => {
    expect(driverNullNote('tcas_registration_yield', { regReported: 0, sendCh: 0 }, none)).toMatch(/Reported/);
  });
  it('explains missing seats for the competition drivers', () => {
    expect(driverNullNote('tcas_fill_rate', { passed: 3, seats: 0 }, none)).toMatch(/planned seats/);
    expect(driverNullNote('tcas_competition_ratio', null, none)).toMatch(/No admission data/);
  });
  it('maps JobThai reasons to sentences and defers the rest', () => {
    expect(driverNullNote('jobthai_demand_alignment', { reason: 'no-links' }, none)).toMatch(/No JobThai field/);
    expect(driverNullNote('jobthai_demand_alignment', { reason: 'below-floor', floor: 20 }, none)).toMatch(/Fewer than 20/);
    expect(driverNullNote('jobthai_demand_alignment', { reason: 'something else' }, none)).toBeNull();
  });
  it('tells the adopter to normalise skills when demand rows are loaded but unlinked', () => {
    const ctx = { kmitlRows: 100, kmitlLinked: 0 };
    expect(driverNullNote('labour_market_alignment', null, ctx)).toBe(SKILL_LINK_HINT);
    expect(driverNullNote('demand_match_filled', { totalRelevant: 0 }, ctx)).toBe(SKILL_LINK_HINT);
    expect(driverNullNote('labour_market_alignment', null, none)).toMatch(/No skill-demand data/);
  });
  it('returns null for drivers it does not know', () => {
    expect(driverNullNote('senior_rank_share', null, none)).toBeNull();
  });
});

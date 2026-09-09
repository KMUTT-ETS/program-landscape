import { describe, expect, it } from 'vitest';
import {
  GOOGLE_PAGE_CREDIT_COST,
  GOOGLE_SEARCH_CREDIT_COST,
  estimateScholarBulkCredits,
} from '../src/scholar';

// ────────────────────────────────────────────────────────────────────────────
// What a bulk Scholar run is quoted at.
//
// This is the only unit test of the estimator itself; apps/api asserts that the
// bulk endpoint quotes THIS function, not a second copy of the rule.
//
// Written to fail under mutation. Each assertion below breaks under at least
// one of: dropping the search term for an unlinked target (the 2026-09-08
// pricing, now wrong), charging the search to a linked one, dropping the
// profile page, charging a quota-blocked target, or swapping the two unit
// prices for each other. The prices are referenced through the exported
// constants rather than written out, so a change to a measured price moves the
// expectation with the code instead of failing here as a bare number.
// ────────────────────────────────────────────────────────────────────────────

/** 15 + 75 = 90. Named because it is the number that changed. */
const UNLINKED = GOOGLE_SEARCH_CREDIT_COST + GOOGLE_PAGE_CREDIT_COST;

describe('estimateScholarBulkCredits', () => {
  it('charges an unlinked target the SEARCH plus a page — it is no longer free', () => {
    // The reversal. Until 2026-09-08 the runner refused at the binding gate
    // before touching the network and this was 0; it now searches by name at
    // 75 credits and then walks whatever profile it resolves.
    expect(estimateScholarBulkCredits([{ profileBound: false }])).toBe(UNLINKED);
    expect(estimateScholarBulkCredits([{ profileBound: false }])).not.toBe(0);
  });

  it('charges a linked target a page and no search — it already knows the id', () => {
    expect(estimateScholarBulkCredits([{ profileBound: true }])).toBe(GOOGLE_PAGE_CREDIT_COST);
  });

  it('prices the two kinds differently, and the unlinked one dearer', () => {
    // The whole reason the transport branches. If both kinds ever price the
    // same, either the search flag is being sent on profile pages (60 credits
    // a page for nothing) or an unlinked target is being quoted as linked.
    const linked = estimateScholarBulkCredits([{ profileBound: true }]);
    const unlinked = estimateScholarBulkCredits([{ profileBound: false }]);
    expect(unlinked).toBeGreaterThan(linked);
    expect(unlinked - linked).toBe(GOOGLE_SEARCH_CREDIT_COST);
  });

  it('sums a mixed run rather than pricing it by the commonest kind', () => {
    const credits = estimateScholarBulkCredits([
      { profileBound: true },
      { profileBound: true },
      { profileBound: true },
      { profileBound: false },
      { profileBound: false },
    ]);
    expect(credits).toBe(3 * GOOGLE_PAGE_CREDIT_COST + 2 * UNLINKED);
  });

  it('is zero for an empty run, and only for a run that reaches nobody', () => {
    expect(estimateScholarBulkCredits([])).toBe(0);
    // The all-unlinked run WAS the zero case. It is now the dearest shape a
    // run can have, and it is the commonest shape at rollout.
    expect(
      estimateScholarBulkCredits([{ profileBound: false }, { profileBound: false }]),
    ).toBe(2 * UNLINKED);
  });

  it('charges nothing for a target inside its 30-day window, linked or not', () => {
    // The quota is step 2 and binding is step 4, so a quota refusal happens
    // before either the search or the walk. This is the ONE gate left that
    // still costs nothing, and it is the reason a 90-person faculty refreshed
    // three weeks ago must not quote 8,100 credits.
    expect(
      estimateScholarBulkCredits([
        { profileBound: true, quotaBlocked: true },
        { profileBound: false, quotaBlocked: true },
      ]),
    ).toBe(0);
  });

  it('still charges the targets a quota-blocked neighbour did not', () => {
    expect(
      estimateScholarBulkCredits([
        { profileBound: true, quotaBlocked: true },
        { profileBound: true, quotaBlocked: false },
        { profileBound: false, quotaBlocked: false },
      ]),
    ).toBe(GOOGLE_PAGE_CREDIT_COST + UNLINKED);
  });

  it('treats an omitted quotaBlocked as "not blocked", which over-quotes rather than under', () => {
    // A caller that has not consulted the quota must get a price, not a type
    // error — and the safe direction for a missing gate is to charge for it.
    expect(estimateScholarBulkCredits([{ profileBound: true }])).toBe(
      estimateScholarBulkCredits([{ profileBound: true, quotaBlocked: false }]),
    );
  });
});

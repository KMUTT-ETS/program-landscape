import { describe, expect, it } from 'vitest';
import {
  assertTransitionAllowed,
  assertTransitionAllowedForRole,
  dueOutcomeReviewHorizons,
} from '../src/decisions';

// Pure-function rules the Decision Workspace contract depends on:
//   1. Status graph is the single source of truth for "what's next".
//   2. COUNCIL_REVIEWED + APPROVED + ARCHIVED are role-gated.
//   3. Outcome-review horizons fire only once effectiveDate + 6mo/1yr/3yr
//      has elapsed AND no prior review at that horizon exists.

describe('assertTransitionAllowed — valid graph', () => {
  it('allows PROPOSED → COUNCIL_REVIEWED', () => {
    expect(() => assertTransitionAllowed('PROPOSED', 'COUNCIL_REVIEWED')).not.toThrow();
  });

  it('allows COUNCIL_REVIEWED → APPROVED', () => {
    expect(() => assertTransitionAllowed('COUNCIL_REVIEWED', 'APPROVED')).not.toThrow();
  });

  it('allows APPROVED → IN_IMPLEMENTATION', () => {
    expect(() => assertTransitionAllowed('APPROVED', 'IN_IMPLEMENTATION')).not.toThrow();
  });

  it('allows same-status no-op', () => {
    expect(() => assertTransitionAllowed('APPROVED', 'APPROVED')).not.toThrow();
  });
});

describe('assertTransitionAllowed — invalid graph', () => {
  it('rejects PROPOSED → APPROVED (must go through COUNCIL_REVIEWED)', () => {
    expect(() => assertTransitionAllowed('PROPOSED', 'APPROVED')).toThrow(/Invalid/);
  });

  it('rejects COMPLETED → APPROVED (no going back)', () => {
    expect(() => assertTransitionAllowed('COMPLETED', 'APPROVED')).toThrow(/Invalid/);
  });

  it('rejects ARCHIVED → anything', () => {
    expect(() => assertTransitionAllowed('ARCHIVED', 'PROPOSED')).toThrow(/Invalid/);
    expect(() => assertTransitionAllowed('ARCHIVED', 'APPROVED')).toThrow(/Invalid/);
  });

  it('rejects REJECTED → APPROVED', () => {
    expect(() => assertTransitionAllowed('REJECTED', 'APPROVED')).toThrow(/Invalid/);
  });
});

describe('assertTransitionAllowedForRole — role gating', () => {
  // v2 taxonomy (legacy roles removed 2026-05-09). Council-tier =
  // admin-grade + UNIVERSITY_USER; archive-tier = SUPER_ADMIN only.

  it('COUNCIL_REVIEWED is council-tier (admin-grade + UNIVERSITY_USER)', () => {
    expect(() => assertTransitionAllowedForRole('COUNCIL_REVIEWED', 'FACULTY_USER')).toThrow();
    expect(() => assertTransitionAllowedForRole('COUNCIL_REVIEWED', 'PROGRAM_USER')).toThrow();
    expect(() => assertTransitionAllowedForRole('COUNCIL_REVIEWED', 'UNIVERSITY_USER')).not.toThrow();
    expect(() => assertTransitionAllowedForRole('COUNCIL_REVIEWED', 'SYSTEM_ADMIN')).not.toThrow();
    expect(() => assertTransitionAllowedForRole('COUNCIL_REVIEWED', 'SUPER_ADMIN')).not.toThrow();
  });

  it('APPROVED is council-tier', () => {
    expect(() => assertTransitionAllowedForRole('APPROVED', 'FACULTY_USER')).toThrow();
    expect(() => assertTransitionAllowedForRole('APPROVED', 'PROGRAM_USER')).toThrow();
    expect(() => assertTransitionAllowedForRole('APPROVED', 'UNIVERSITY_USER')).not.toThrow();
  });

  it('ARCHIVED is SUPER_ADMIN only', () => {
    expect(() => assertTransitionAllowedForRole('ARCHIVED', 'UNIVERSITY_USER')).toThrow();
    expect(() => assertTransitionAllowedForRole('ARCHIVED', 'SYSTEM_ADMIN')).toThrow();
    expect(() => assertTransitionAllowedForRole('ARCHIVED', 'SUPER_ADMIN')).not.toThrow();
  });

  it('ungated transitions (IN_IMPLEMENTATION / COMPLETED / IMPLEMENTED) accept any role', () => {
    expect(() => assertTransitionAllowedForRole('IN_IMPLEMENTATION', 'PROGRAM_USER')).not.toThrow();
    expect(() => assertTransitionAllowedForRole('COMPLETED', 'FACULTY_USER')).not.toThrow();
  });
});

describe('dueOutcomeReviewHorizons', () => {
  it('returns empty when effectiveDate is null', () => {
    expect(dueOutcomeReviewHorizons(null, [])).toEqual([]);
  });

  it('returns SIX_MONTHS after 6 months when no review exists', () => {
    const effective = new Date('2024-01-01');
    const now = new Date('2024-08-01'); // 7 months later
    const due = dueOutcomeReviewHorizons(effective, [], now);
    expect(due).toContain('SIX_MONTHS');
    expect(due).not.toContain('ONE_YEAR');
  });

  it('does not return SIX_MONTHS if it already exists', () => {
    const effective = new Date('2024-01-01');
    const now = new Date('2024-08-01');
    const due = dueOutcomeReviewHorizons(effective, ['SIX_MONTHS'], now);
    expect(due).not.toContain('SIX_MONTHS');
  });

  it('returns both SIX_MONTHS and ONE_YEAR after 1 year', () => {
    const effective = new Date('2024-01-01');
    const now = new Date('2025-02-01');
    const due = dueOutcomeReviewHorizons(effective, [], now);
    expect(due).toContain('SIX_MONTHS');
    expect(due).toContain('ONE_YEAR');
    expect(due).not.toContain('THREE_YEARS');
  });

  it('returns all three horizons after 3 years', () => {
    const effective = new Date('2020-01-01');
    const now = new Date('2023-06-01');
    const due = dueOutcomeReviewHorizons(effective, [], now);
    expect(due).toEqual(['SIX_MONTHS', 'ONE_YEAR', 'THREE_YEARS']);
  });

  it('returns empty when all horizons already reviewed', () => {
    const effective = new Date('2020-01-01');
    const now = new Date('2023-06-01');
    const due = dueOutcomeReviewHorizons(effective, ['SIX_MONTHS', 'ONE_YEAR', 'THREE_YEARS'], now);
    expect(due).toEqual([]);
  });

  it('returns nothing when effectiveDate is in the future', () => {
    const effective = new Date('2030-01-01');
    const now = new Date('2024-01-01');
    const due = dueOutcomeReviewHorizons(effective, [], now);
    expect(due).toEqual([]);
  });
});

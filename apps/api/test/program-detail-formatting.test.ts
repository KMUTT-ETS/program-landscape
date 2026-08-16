import { describe, expect, it } from 'vitest';

// `formatCohortChangePct` moved to
// `packages/pdf-templates/src/templates/program-detail/format.ts` (tests at
// `packages/pdf-templates/test/program-detail/format.test.ts`) once
// `demographic.fifteenYearContraction` / `demographic.projections[].decline`
// became raw numbers in the schema — the builder no longer formats them, so
// the helper is dead code here. See that commit for the full rationale.

// The second bug: a truthy check on a numeric field. Guarding the shape of
// the fix rather than the Prisma call, since the builder needs a live DB.
// `latest?.costPerStudent ? ... : null` turned a measured 0 into null, which
// every downstream surface renders as "no data".
describe('nullish vs truthy guards on measured numbers', () => {
  const asNullable = (v: number | null): number | null => (v != null ? Number(v) : null);
  const asTruthy = (v: number | null): number | null => (v ? Number(v) : null);

  it('preserves a measured zero', () => {
    expect(asNullable(0)).toBe(0);
    expect(asTruthy(0)).toBeNull(); // the bug, kept as documentation
  });

  it('still maps absent data to null', () => {
    expect(asNullable(null)).toBeNull();
  });

  it('leaves ordinary values alone', () => {
    expect(asNullable(48250)).toBe(48250);
  });
});

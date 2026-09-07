import { describe, it, expect } from 'vitest';

// Pure guard — no prisma mock needed, which is the point of extracting it.
// See the module header for the incident this exists to prevent.
import { decideCourseMaterialisation } from '../src/program-courses-extract/materialisation-guard';

describe('decideCourseMaterialisation', () => {
  it('refuses to replace an existing course set with an empty one', () => {
    // The prod failure verbatim: phase2b logged "56 → 0 courses · confidence
    // 0.00" as a green tick, having deleted all 56.
    const d = decideCourseMaterialisation({ nextCount: 0, previousCount: 56 });
    expect(d.action).toBe('refuse');
    if (d.action === 'refuse') expect(d.reason).toContain('56');
  });

  it('refuses even when only one course would be lost', () => {
    expect(decideCourseMaterialisation({ nextCount: 0, previousCount: 1 }).action).toBe('refuse');
  });

  it('allows the first extraction, where there is nothing to lose', () => {
    expect(decideCourseMaterialisation({ nextCount: 42, previousCount: 0 }).action).toBe('replace');
  });

  it('allows a no-op on a programme that has never had courses', () => {
    expect(decideCourseMaterialisation({ nextCount: 0, previousCount: 0 }).action).toBe('replace');
  });

  it('allows a normal re-extraction', () => {
    expect(decideCourseMaterialisation({ nextCount: 56, previousCount: 56 }).action).toBe('replace');
  });

  it('allows a shrink that still leaves courses behind', () => {
    // Deliberately NOT guarded: a legitimate re-extraction can shrink, and a
    // ratio threshold would need evidence we do not have. Only the total-loss
    // case is unambiguous.
    expect(decideCourseMaterialisation({ nextCount: 6, previousCount: 56 }).action).toBe('replace');
  });
});

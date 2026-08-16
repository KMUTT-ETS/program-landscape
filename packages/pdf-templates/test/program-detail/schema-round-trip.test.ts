import { describe, expect, it } from 'vitest';
import { ProgramDetailDataSchema } from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

// The fixture is a real payload captured from buildProgramDetailData()
// against KKU-SEQ-0065 (Civil Engineering, id cmon1wyw1003lzh90a5cdurkf) —
// a data-rich program chosen deliberately so most sections have real data
// rather than nulls. Faculty roster names were scrubbed to 'REDACTED'
// before commit; the fixture only exercises shape, not identity.
//
// This file grows one `describe` block per converted field group as
// Task 2's per-section commits land. Each numeric field converted away
// from a pre-formatted string must be proven to:
//   1. accept a real number
//   2. accept null (data absent — the '—' placeholder case)
//   3. reject a pre-formatted string (the whole point of the refactor)
//   4. reject NaN (z.number() alone accepts NaN; .finite() is required)

describe('ProgramDetailDataSchema', () => {
  it('accepts a real captured payload', () => {
    const parsed = ProgramDetailDataSchema.safeParse(FIXTURE);
    if (!parsed.success) console.error(parsed.error.issues.slice(0, 10));
    expect(parsed.success).toBe(true);
  });

  // ── Cover: yearEstablished ─────────────────────────────────────────
  describe('cover.yearEstablished', () => {
    function fixtureWith(yearEstablished: unknown): unknown {
      return { ...FIXTURE, yearEstablished };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(1998)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('1998')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Health score: healthDimensions[].score ──────────────────────────
  describe('healthDimensions[].score', () => {
    function fixtureWith(score: unknown): unknown {
      const dims = (FIXTURE as { healthDimensions: unknown[] }).healthDimensions;
      return {
        ...FIXTURE,
        healthDimensions: [{ ...(dims[0] as object), score }, ...dims.slice(1)],
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(62)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('62')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Health score: healthDimensions[].dataCompleteness ───────────────
  describe('healthDimensions[].dataCompleteness', () => {
    function fixtureWith(dataCompleteness: unknown): unknown {
      const dims = (FIXTURE as { healthDimensions: unknown[] }).healthDimensions;
      return {
        ...FIXTURE,
        healthDimensions: [{ ...(dims[0] as object), dataCompleteness }, ...dims.slice(1)],
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(50)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('50%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Health score: healthDimensions[].topDriverValue (split field) ──
  describe('healthDimensions[].topDriverValue', () => {
    function fixtureWith(topDriverValue: unknown): unknown {
      const dims = (FIXTURE as { healthDimensions: unknown[] }).healthDimensions;
      return {
        ...FIXTURE,
        healthDimensions: [{ ...(dims[0] as object), topDriverValue }, ...dims.slice(1)],
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(72)).success).toBe(true);
    });

    it('accepts null (no top driver for this dimension)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('72')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Health score: healthDrivers[].value ─────────────────────────────
  describe('healthDrivers[].value', () => {
    function fixtureWith(value: unknown): unknown {
      const drivers = (FIXTURE as { healthDrivers: unknown[] }).healthDrivers;
      return {
        ...FIXTURE,
        healthDrivers: [{ ...(drivers[0] as object), value }, ...drivers.slice(1)],
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(41)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('41')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Lifecycle: trajectoryScore ───────────────────────────────────────
  describe('lifecycle.trajectoryScore', () => {
    function fixtureWith(trajectoryScore: unknown): unknown {
      const lifecycle = (FIXTURE as { lifecycle: object }).lifecycle;
      return { ...FIXTURE, lifecycle: { ...lifecycle, trajectoryScore } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(58)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('58')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Lifecycle: drivers[].contribution (signed) ──────────────────────
  describe('lifecycle.drivers[].contribution', () => {
    function fixtureWith(contribution: unknown): unknown {
      const lifecycle = (FIXTURE as { lifecycle: { drivers: unknown[] } }).lifecycle;
      return {
        ...FIXTURE,
        lifecycle: {
          ...lifecycle,
          drivers: [
            { ...(lifecycle.drivers[0] as object), contribution },
            ...lifecycle.drivers.slice(1),
          ],
        },
      };
    }

    it('accepts a signed number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(-3.2)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string (the old "+3.2" / "-1.5" pre-signed form)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('+3.2')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });
});

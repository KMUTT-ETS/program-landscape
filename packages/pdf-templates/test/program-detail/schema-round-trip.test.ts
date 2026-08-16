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

  // ── Strategic narrative: confidencePct ──────────────────────────────
  describe('strategicNarrative.confidencePct', () => {
    function fixtureWith(confidencePct: unknown): unknown {
      const narrative = (FIXTURE as { strategicNarrative: object }).strategicNarrative;
      return { ...FIXTURE, strategicNarrative: { ...narrative, confidencePct } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(85)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('85%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── AI readiness: overallScore ──────────────────────────────────────
  describe('aiReadiness.overallScore', () => {
    function fixtureWith(overallScore: unknown): unknown {
      const aiReadiness = (FIXTURE as { aiReadiness: object }).aiReadiness;
      return { ...FIXTURE, aiReadiness: { ...aiReadiness, overallScore } };
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

  // ── AI readiness: skillBreakdown[].count / share ────────────────────
  describe('aiReadiness.skillBreakdown[].count', () => {
    function fixtureWith(count: unknown): unknown {
      const aiReadiness = (FIXTURE as { aiReadiness: { skillBreakdown: unknown[] } }).aiReadiness;
      const breakdown = aiReadiness.skillBreakdown;
      return {
        ...FIXTURE,
        aiReadiness: {
          ...aiReadiness,
          skillBreakdown: [{ ...(breakdown[0] as object), count }, ...breakdown.slice(1)],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(4)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('4')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('aiReadiness.skillBreakdown[].share', () => {
    function fixtureWith(share: unknown): unknown {
      const aiReadiness = (FIXTURE as { aiReadiness: { skillBreakdown: unknown[] } }).aiReadiness;
      const breakdown = aiReadiness.skillBreakdown;
      return {
        ...FIXTURE,
        aiReadiness: {
          ...aiReadiness,
          skillBreakdown: [{ ...(breakdown[0] as object), share }, ...breakdown.slice(1)],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(67)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('67%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── AI readiness: subScoreValues[].score — new dedicated numeric field.
  //    KvRowSchema subScores[] stays a display-only row per the decision
  //    not to split KvRowSchema; the fixture's real payload already has
  //    a genuine null here (Pedagogical readiness — the 'no data' case)
  //    and genuine zeros (Curriculum integration, AI research presence)
  //    side by side, which is exactly the zero-vs-null distinction this
  //    refactor exists to preserve. ───────────────────────────────────
  describe('aiReadiness.subScoreValues[].score', () => {
    function fixtureWith(score: unknown): unknown {
      const aiReadiness = (FIXTURE as { aiReadiness: { subScoreValues: unknown[] } }).aiReadiness;
      const values = aiReadiness.subScoreValues;
      return {
        ...FIXTURE,
        aiReadiness: {
          ...aiReadiness,
          subScoreValues: [{ ...(values[0] as object), score }, ...values.slice(1)],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(48)).success).toBe(true);
    });

    it('accepts null (the "no data" sentinel case)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('accepts a genuine zero without collapsing it to "no data"', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(0)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('48')).success).toBe(false);
    });

    it('rejects the "no data" sentinel string itself', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('no data')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Demand funnel: anchorEntryYearBE / anchorEntryYearCE (split from
  //    the old compound "BE 2564 (CE 2021)" string) ────────────────────
  describe('demandFunnel.anchorEntryYearBE', () => {
    function fixtureWith(anchorEntryYearBE: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return { ...FIXTURE, demandFunnel: { ...demandFunnel, anchorEntryYearBE } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2564)).success).toBe(true);
    });

    it('accepts null (no completed anchor cohort yet)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old compound-label string', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWith('BE 2564 (CE 2021)')).success,
      ).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demandFunnel.anchorEntryYearCE', () => {
    function fixtureWith(anchorEntryYearCE: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return { ...FIXTURE, demandFunnel: { ...demandFunnel, anchorEntryYearCE } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2021)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('2021')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demandFunnel.programDurationYears', () => {
    function fixtureWith(programDurationYears: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return { ...FIXTURE, demandFunnel: { ...demandFunnel, programDurationYears } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(4)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('4')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // `stages` / `conversions` / `alumniBreakdown` / `cohortTrend` are empty
  // arrays in the captured fixture (this program's demand funnel has no
  // completed anchor cohort) — build a synthetic single-row array so the
  // nested numeric fields are still exercised against the schema.
  describe('demandFunnel.stages[].value', () => {
    function fixtureWith(value: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return {
        ...FIXTURE,
        demandFunnel: { ...demandFunnel, stages: [{ stage: 'Applied', value }] },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(120)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('120')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demandFunnel.conversions[].rate', () => {
    function fixtureWith(rate: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return {
        ...FIXTURE,
        demandFunnel: {
          ...demandFunnel,
          conversions: [{ from: 'applied', to: 'admitted', rate }],
        },
      };
    }

    it('accepts a percentage-scaled number (the fraction × 100 conversion is preserved, only the string formatting is dropped)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(82.4)).success).toBe(true);
    });

    it('accepts null (no prior-stage value to divide by)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('82.4%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demandFunnel.alumniBreakdown[].share', () => {
    // This field carried a real display bug pre-conversion: the builder
    // called `fmtRatePct` (a ×100-for-fractions formatter) on `b.pct`,
    // which was ALREADY on a 0–100 scale — doubling the percentage on
    // screen (a true 12.3% share rendered as "1230.0%"). The fix is
    // passing the raw number straight through with no multiplication.
    function fixtureWith(share: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return {
        ...FIXTURE,
        demandFunnel: {
          ...demandFunnel,
          alumniBreakdown: [{ bucket: 'GRADUATED', count: 10, share }],
        },
      };
    }

    it('accepts a 0–100-scale number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(12.3)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('12.3%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demandFunnel.cohortTrend[].cohortBE', () => {
    function fixtureWith(cohortBE: unknown): unknown {
      const demandFunnel = (FIXTURE as { demandFunnel: object }).demandFunnel;
      return {
        ...FIXTURE,
        demandFunnel: {
          ...demandFunnel,
          cohortTrend: [
            {
              cohortBE,
              admitted: 100,
              enrolled: 95,
              graduated: 80,
              dropped: 10,
              completed: 'complete',
            },
          ],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2560)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('2560')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Recruitment: byYear[].yearBE ─────────────────────────────────────
  describe('recruitment.byYear[].yearBE', () => {
    function fixtureWith(yearBE: unknown): unknown {
      const recruitment = (FIXTURE as { recruitment: { byYear: unknown[] } }).recruitment;
      const byYear = recruitment.byYear;
      return {
        ...FIXTURE,
        recruitment: {
          ...recruitment,
          byYear: [{ ...(byYear[0] as object), yearBE }, ...byYear.slice(1)],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2569)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "BE 2569" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('BE 2569')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Recruitment: byYear[].overAllocation ─────────────────────────────
  describe('recruitment.byYear[].overAllocation', () => {
    // The old string was '' both when the factor was ≤ 1.05 (measured but
    // unremarkable) and when it was null (never measured) — two different
    // facts that were indistinguishable. This must now be a genuine
    // nullable number carrying the raw factor either way.
    function fixtureWith(overAllocation: unknown): unknown {
      const recruitment = (FIXTURE as { recruitment: { byYear: unknown[] } }).recruitment;
      const byYear = recruitment.byYear;
      return {
        ...FIXTURE,
        recruitment: {
          ...recruitment,
          byYear: [{ ...(byYear[0] as object), overAllocation }, ...byYear.slice(1)],
        },
      };
    }

    it('accepts a measured-but-unremarkable factor (≤ 1.05)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(1.02)).success).toBe(true);
    });

    it('accepts a genuinely over-allocated factor', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(1.3)).success).toBe(true);
    });

    it('accepts null (never measured — distinct from "measured, ≤ 1.05")', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "1.23×" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('1.23×')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Recruitment: byYear[].vsPlan ─────────────────────────────────────
  describe('recruitment.byYear[].vsPlan', () => {
    function fixtureWith(vsPlan: unknown): unknown {
      const recruitment = (FIXTURE as { recruitment: { byYear: unknown[] } }).recruitment;
      const byYear = recruitment.byYear;
      return {
        ...FIXTURE,
        recruitment: {
          ...recruitment,
          byYear: [{ ...(byYear[0] as object), vsPlan }, ...byYear.slice(1)],
        },
      };
    }

    it('accepts a percentage-scaled number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(98.75)).success).toBe(true);
    });

    it('accepts null (no plan to compare against)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('99%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Recruitment: latestRoundsYear ────────────────────────────────────
  describe('recruitment.latestRoundsYear', () => {
    function fixtureWith(latestRoundsYear: unknown): unknown {
      const recruitment = (FIXTURE as { recruitment: object }).recruitment;
      return { ...FIXTURE, recruitment: { ...recruitment, latestRoundsYear } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2569)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "BE 2569" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('BE 2569')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Recruitment: latestRounds[].seats ────────────────────────────────
  describe('recruitment.latestRounds[].seats', () => {
    function fixtureWith(seats: unknown): unknown {
      const recruitment = (FIXTURE as { recruitment: { latestRounds: unknown[] } }).recruitment;
      const latestRounds = recruitment.latestRounds;
      return {
        ...FIXTURE,
        recruitment: {
          ...recruitment,
          latestRounds: [{ ...(latestRounds[0] as object), seats }, ...latestRounds.slice(1)],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(28)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('28')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── TCAS: history[].yearBE (split from the old compound "BE 2567 R2") ──
  describe('tcas.history[].yearBE', () => {
    function fixtureWith(yearBE: unknown): unknown {
      const tcas = (FIXTURE as { tcas: { history: unknown[] } }).tcas;
      const history = tcas.history;
      return {
        ...FIXTURE,
        tcas: { ...tcas, history: [{ ...(history[0] as object), yearBE }, ...history.slice(1)] },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2567)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old compound "BE 2567 R2" string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('BE 2567 R2')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // TCAS round stays a DISPLAY string — sub-rounds like "3.1"/"3.2" are
  // genuine upstream strings, not lightly-formatted numbers. This is a
  // deliberate non-conversion, guarded here against a future naive
  // "field name contains 'round'" pattern-match.
  describe('tcas.history[].round', () => {
    function fixtureWith(round: unknown): unknown {
      const tcas = (FIXTURE as { tcas: { history: unknown[] } }).tcas;
      const history = tcas.history;
      return {
        ...FIXTURE,
        tcas: { ...tcas, history: [{ ...(history[0] as object), round }, ...history.slice(1)] },
      };
    }

    it('accepts a genuine sub-round string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('3.2')).success).toBe(true);
    });

    it('rejects a bare number — round must stay a string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(3.2)).success).toBe(false);
    });
  });

  // ── TCAS: history[].fillRate ─────────────────────────────────────────
  describe('tcas.history[].fillRate', () => {
    function fixtureWith(fillRate: unknown): unknown {
      const tcas = (FIXTURE as { tcas: { history: unknown[] } }).tcas;
      const history = tcas.history;
      return {
        ...FIXTURE,
        tcas: { ...tcas, history: [{ ...(history[0] as object), fillRate }, ...history.slice(1)] },
      };
    }

    it('accepts a percentage-scaled number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(200)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('200.0%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── TCAS: history[].minScore ─────────────────────────────────────────
  describe('tcas.history[].minScore', () => {
    function fixtureWith(minScore: unknown): unknown {
      const tcas = (FIXTURE as { tcas: { history: unknown[] } }).tcas;
      const history = tcas.history;
      return {
        ...FIXTURE,
        tcas: { ...tcas, history: [{ ...(history[0] as object), minScore }, ...history.slice(1)] },
      };
    }

    it('accepts a raw score', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(40.79)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('40.79')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── TCAS: peers[].competition ────────────────────────────────────────
  describe('tcas.peers[].competition', () => {
    function fixtureWith(competition: unknown): unknown {
      const tcas = (FIXTURE as { tcas: { peers: unknown[] } }).tcas;
      const peers = tcas.peers;
      return {
        ...FIXTURE,
        tcas: { ...tcas, peers: [{ ...(peers[0] as object), competition }, ...peers.slice(1)] },
      };
    }

    it('accepts a raw ratio', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(79.06)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "79.06×" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('79.06×')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });
});

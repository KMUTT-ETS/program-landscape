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

  // ── Cohort distribution ────────────────────────────────────────────
  // This program's fixture has `cohortDistribution: null` (no linked
  // cohort data for KKU-SEQ-0065) — build a synthetic full object for the
  // nested-field tests below.
  function fixtureWithCohortDistribution(overrides: Record<string, unknown>): unknown {
    return {
      ...FIXTURE,
      cohortDistribution: {
        totalActive: 200,
        currentAcademicYearBE: 2569,
        programDurationYears: 4,
        summary: [{ metric: 'Incoming', value: '50', notes: '' }],
        summaryValues: [{ label: 'Incoming', count: 50, sharePct: 25 }],
        rows: [
          {
            cohortBE: 2569,
            cohortCE: 2026,
            yearInProgram: 1,
            status: 'On track',
            students: 50,
            share: 25,
          },
        ],
        ...overrides,
      },
    };
  }

  describe('cohortDistribution.totalActive', () => {
    it('accepts a number', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithCohortDistribution({ totalActive: 200 }))
          .success,
      ).toBe(true);
    });

    it('accepts null', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithCohortDistribution({ totalActive: null }))
          .success,
      ).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithCohortDistribution({ totalActive: '200' }))
          .success,
      ).toBe(false);
    });

    it('rejects NaN', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWithCohortDistribution({ totalActive: Number.NaN }),
        ).success,
      ).toBe(false);
    });
  });

  describe('cohortDistribution.summaryValues[].sharePct', () => {
    function fixtureWith(sharePct: unknown): unknown {
      return fixtureWithCohortDistribution({
        summaryValues: [{ label: 'Incoming', count: 50, sharePct }],
      });
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(25)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('25%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('cohortDistribution.rows[].cohortBE / cohortCE (split from the old compound "BE 2567 (CE 2024)")', () => {
    function fixtureWith(cohortBE: unknown, cohortCE: unknown): unknown {
      return fixtureWithCohortDistribution({
        rows: [
          {
            cohortBE,
            cohortCE,
            yearInProgram: 1,
            status: 'On track',
            students: 50,
            share: 25,
          },
        ],
      });
    }

    it('accepts numbers', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2569, 2026)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null, null)).success).toBe(true);
    });

    it('rejects the old compound "BE 2569 (CE 2026)" string', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWith('BE 2569 (CE 2026)', 2026)).success,
      ).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN, 2026)).success).toBe(false);
    });
  });

  describe('cohortDistribution.rows[].yearInProgram', () => {
    function fixtureWith(yearInProgram: unknown): unknown {
      return fixtureWithCohortDistribution({
        rows: [
          {
            cohortBE: 2569,
            cohortCE: 2026,
            yearInProgram,
            status: 'On track',
            students: 50,
            share: 25,
          },
        ],
      });
    }

    it('accepts the raw int (was rendered as "Year N")', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(1)).success).toBe(true);
    });

    it('accepts 0 (was "Year 0" — a genuine incoming cohort, not missing data)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(0)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "Year 1" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('Year 1')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Demographic: fifteenYearContraction ──────────────────────────────
  // Signed, raw — POSITIVE means the cohort shrinks, NEGATIVE means it
  // grows. Both are reachable and must be preserved exactly (no
  // normalising, clamping, or abs()). Formatting moved to
  // `../../src/templates/program-detail/format.ts`.
  describe('demographic.fifteenYearContraction', () => {
    function fixtureWith(fifteenYearContraction: unknown): unknown {
      const demographic = (FIXTURE as { demographic: object }).demographic;
      return { ...FIXTURE, demographic: { ...demographic, fifteenYearContraction } };
    }

    it('accepts a positive number (shrinking cohort)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(27.07)).success).toBe(true);
    });

    it('accepts a negative number (growing cohort) — the sign must survive', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(-5.2)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "−27.1%" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('−27.1%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demographic.baselineYearOneIntake', () => {
    function fixtureWith(baselineYearOneIntake: unknown): unknown {
      const demographic = (FIXTURE as { demographic: object }).demographic;
      return { ...FIXTURE, demographic: { ...demographic, baselineYearOneIntake } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(300)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('300')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demographic.projections[].isCurrentYear (new split field)', () => {
    // Was baked into the year string as " (today)" on the first row.
    function fixtureWith(isCurrentYear: unknown): unknown {
      const demographic = (FIXTURE as { demographic: { projections: unknown[] } }).demographic;
      const projections = demographic.projections;
      return {
        ...FIXTURE,
        demographic: {
          ...demographic,
          projections: [
            { ...(projections[0] as object), isCurrentYear },
            ...projections.slice(1),
          ],
        },
      };
    }

    it('accepts a boolean', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(true)).success).toBe(true);
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(false)).success).toBe(true);
    });

    it('rejects the old " (today)" suffix string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('today')).success).toBe(false);
    });
  });

  describe('demographic.projections[].cohortPopulation', () => {
    // Was pre-divided by 1,000,000 and rounded for display ("2.35M"). Now
    // the raw population count — the template owns the "M" formatting.
    function fixtureWith(cohortPopulation: unknown): unknown {
      const demographic = (FIXTURE as { demographic: { projections: unknown[] } }).demographic;
      const projections = demographic.projections;
      return {
        ...FIXTURE,
        demographic: {
          ...demographic,
          projections: [
            { ...(projections[0] as object), cohortPopulation },
            ...projections.slice(1),
          ],
        },
      };
    }

    it('accepts the raw population count', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(3982000)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "3.98M" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('3.98M')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demographic.projections[].decline', () => {
    function fixtureWith(decline: unknown): unknown {
      const demographic = (FIXTURE as { demographic: { projections: unknown[] } }).demographic;
      const projections = demographic.projections;
      return {
        ...FIXTURE,
        demographic: {
          ...demographic,
          projections: [{ ...(projections[0] as object), decline }, ...projections.slice(1)],
        },
      };
    }

    it('accepts a positive number (shrinking)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(10.75)).success).toBe(true);
    });

    it('accepts a negative number (growing) — the old code collapsed this to "0.0%"', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(-3.4)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('10.8%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('demographic.projections[].shareNeeded', () => {
    function fixtureWith(shareNeeded: unknown): unknown {
      const demographic = (FIXTURE as { demographic: { projections: unknown[] } }).demographic;
      const projections = demographic.projections;
      return {
        ...FIXTURE,
        demographic: {
          ...demographic,
          projections: [
            { ...(projections[0] as object), shareNeeded },
            ...projections.slice(1),
          ],
        },
      };
    }

    it('accepts a percentage-scaled number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(0.012)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('0.012%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Outcomes ──────────────────────────────────────────────────────
  describe('outcomes.surveyYear', () => {
    function fixtureWith(surveyYear: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return { ...FIXTURE, outcomes: { ...outcomes, surveyYear } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2023)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('2023')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('outcomes.sampleSize', () => {
    function fixtureWith(sampleSize: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return { ...FIXTURE, outcomes: { ...outcomes, sampleSize } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(439)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('439')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Outcomes: dedicated numeric fields alongside the display-only
  //    `summary` KV table (heterogeneous units — %, THB, %, % — so a
  //    generic label/value companion array would lose the unit). ───────
  describe('outcomes.employmentRatePct', () => {
    function fixtureWith(employmentRatePct: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return { ...FIXTURE, outcomes: { ...outcomes, employmentRatePct } };
    }

    it('accepts a percentage-scaled number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(67.4)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('67.4%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('outcomes.averageSalary', () => {
    function fixtureWith(averageSalary: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return { ...FIXTURE, outcomes: { ...outcomes, averageSalary } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(25000)).success).toBe(true);
    });

    it('accepts a genuine zero without collapsing it to "no data"', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(0)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('25,000')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('outcomes.jobRelevanceScorePct', () => {
    function fixtureWith(jobRelevanceScorePct: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return { ...FIXTURE, outcomes: { ...outcomes, jobRelevanceScorePct } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(72.3)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('72%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('outcomes.furtherStudyRatePct', () => {
    function fixtureWith(furtherStudyRatePct: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return { ...FIXTURE, outcomes: { ...outcomes, furtherStudyRatePct } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(10.71)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('11%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('outcomes.salaryTrajectory[].year / .salary', () => {
    // Declared inline inside the array wrapper — the naive grep in the
    // inventory's Step 1 missed these two fields; verified directly
    // against the schema/builder instead.
    function fixtureWith(year: unknown, salary: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: { salaryTrajectory: unknown[] } }).outcomes;
      const salaryTrajectory = outcomes.salaryTrajectory;
      return {
        ...FIXTURE,
        outcomes: {
          ...outcomes,
          salaryTrajectory: [
            { ...(salaryTrajectory[0] as object), year, salary },
            ...salaryTrajectory.slice(1),
          ],
        },
      };
    }

    it('accepts numbers', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2024, 25000)).success).toBe(true);
    });

    it('accepts a genuine zero salary without collapsing it to "no data"', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2024, 0)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null, null)).success).toBe(true);
    });

    it('rejects formatted strings', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('2024', '25,000')).success).toBe(
        false,
      );
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN, 25000)).success).toBe(
        false,
      );
    });
  });

  describe('outcomes.topEmployers[].satisfaction', () => {
    // Empty in the captured fixture (this program has no employer-feedback
    // rows) — synthetic single-row array.
    function fixtureWith(satisfaction: unknown): unknown {
      const outcomes = (FIXTURE as { outcomes: object }).outcomes;
      return {
        ...FIXTURE,
        outcomes: {
          ...outcomes,
          topEmployers: [{ employer: 'Example Co.', year: 2024, satisfaction }],
        },
      };
    }

    it('accepts a percentage-scaled number', () => {
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

  // ── Skills ────────────────────────────────────────────────────────
  describe('skills.matchScore', () => {
    function fixtureWith(matchScore: unknown): unknown {
      const skills = (FIXTURE as { skills: object }).skills;
      return { ...FIXTURE, skills: { ...skills, matchScore } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(38)).success).toBe(true);
    });

    it('accepts a genuine zero without collapsing it to "no data"', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(0)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('38')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('skills.major[].plo', () => {
    // Was the string 'Yes' / '' — a boolean mis-encoded as a string, not a
    // display label. Passes the real boolean through instead.
    function fixtureWith(plo: unknown): unknown {
      const skills = (FIXTURE as { skills: { major: unknown[] } }).skills;
      const major = skills.major;
      return {
        ...FIXTURE,
        skills: { ...skills, major: [{ ...(major[0] as object), plo }, ...major.slice(1)] },
      };
    }

    it('accepts a boolean', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(true)).success).toBe(true);
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(false)).success).toBe(true);
    });

    it('rejects the old "Yes" / "" string encoding', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('Yes')).success).toBe(false);
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('')).success).toBe(false);
    });
  });

  describe('skills.major[].compulsoryWeight', () => {
    function fixtureWith(compulsoryWeight: unknown): unknown {
      const skills = (FIXTURE as { skills: { major: unknown[] } }).skills;
      const major = skills.major;
      return {
        ...FIXTURE,
        skills: {
          ...skills,
          major: [{ ...(major[0] as object), compulsoryWeight }, ...major.slice(1)],
        },
      };
    }

    it('accepts a raw 0..1 fraction', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(0.9)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "0.90" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('0.90')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('skills.demanded[].match', () => {
    // Empty in the captured fixture (this program has no demand-vs-taught
    // matches computed yet) — synthetic single-row array. Tri-state
    // pass-through of `curriculumMatched: boolean | null`: `null` ("no AI
    // decision yet") must stay distinct from `false` ("confirmed gap").
    function fixtureWith(match: unknown): unknown {
      const skills = (FIXTURE as { skills: object }).skills;
      return {
        ...FIXTURE,
        skills: {
          ...skills,
          demanded: [{ skill: 'Data analysis', peakDemand: 40, careerCount: 3, match }],
        },
      };
    }

    it('accepts true (confirmed taught)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(true)).success).toBe(true);
    });

    it('accepts false (confirmed gap) — distinct from null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(false)).success).toBe(true);
    });

    it('accepts null (no AI match decision yet)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "taught" / "gap" / "—" formatted strings', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('taught')).success).toBe(false);
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('gap')).success).toBe(false);
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('—')).success).toBe(false);
    });
  });

  describe('skills.demanded[].peakDemand', () => {
    function fixtureWith(peakDemand: unknown): unknown {
      const skills = (FIXTURE as { skills: object }).skills;
      return {
        ...FIXTURE,
        skills: {
          ...skills,
          demanded: [{ skill: 'Data analysis', peakDemand, careerCount: 3, match: null }],
        },
      };
    }

    it('accepts a percentage-scaled number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(63.5)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('64%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Faculty ───────────────────────────────────────────────────────
  // `kpis` (the KV table) stays a display-only row — including the
  // "Senior share (Prof + Assoc Prof)" row, which compounds three numbers
  // into one string ("16/18 (89%)"). The three dedicated numeric
  // companions below are what the chart-led rebuild actually binds to.
  describe('faculty.seniorRankCount / totalRankedCount / seniorRankSharePct', () => {
    function fixtureWith(overrides: Record<string, unknown>): unknown {
      const faculty = (FIXTURE as { faculty: object }).faculty;
      return { ...FIXTURE, faculty: { ...faculty, ...overrides } };
    }

    it('accepts numbers', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWith({ seniorRankCount: 16, totalRankedCount: 18, seniorRankSharePct: 88.9 }),
        ).success,
      ).toBe(true);
    });

    it('accepts null on all three (no faculty roster resolved)', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWith({
            seniorRankCount: null,
            totalRankedCount: null,
            seniorRankSharePct: null,
          }),
        ).success,
      ).toBe(true);
    });

    it('accepts a genuine zero seniorRankCount without collapsing it to "no data"', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWith({ seniorRankCount: 0 })).success,
      ).toBe(true);
    });

    it('rejects the old "16/18 (89%)" compound formatted string', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWith({ seniorRankCount: '16/18 (89%)' }))
          .success,
      ).toBe(false);
    });

    it('rejects NaN', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWith({ seniorRankSharePct: Number.NaN }))
          .success,
      ).toBe(false);
    });
  });

  describe('faculty.rankDistribution[].count / .share', () => {
    function fixtureWith(count: unknown, share: unknown): unknown {
      const faculty = (FIXTURE as { faculty: { rankDistribution: unknown[] } }).faculty;
      const rankDistribution = faculty.rankDistribution;
      return {
        ...FIXTURE,
        faculty: {
          ...faculty,
          rankDistribution: [
            { ...(rankDistribution[0] as object), count, share },
            ...rankDistribution.slice(1),
          ],
        },
      };
    }

    it('accepts numbers', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(13, 72.2)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null, null)).success).toBe(true);
    });

    it('rejects formatted strings', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('13', '72%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN, 72.2)).success).toBe(
        false,
      );
    });
  });

  describe('faculty.roster[].name', () => {
    // Was `m.nameEn || m.nameTh || '—'` — the em-dash sentinel becomes a
    // genuine null. Stays a DISPLAY field (this is not a numeric
    // conversion), just without a fake string standing in for "no name".
    function fixtureWith(name: unknown): unknown {
      const faculty = (FIXTURE as { faculty: { roster: unknown[] } }).faculty;
      const roster = faculty.roster;
      return {
        ...FIXTURE,
        faculty: {
          ...faculty,
          roster: [{ ...(roster[0] as object), name }, ...roster.slice(1)],
        },
      };
    }

    it('accepts a string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('REDACTED')).success).toBe(true);
    });

    it('accepts null (no name available under COUNCIL-gated visibility)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });
  });

  // ── Financials ────────────────────────────────────────────────────
  // This program's fixture has `financials: null` (no linked financial
  // rows for KKU-SEQ-0065) — build a synthetic full object for the
  // nested-field tests below, same approach as `cohortDistribution`.
  function fixtureWithFinancials(overrides: Record<string, unknown>): unknown {
    return {
      ...FIXTURE,
      financials: {
        methodologyVersion: 'cost-allocation.v1',
        headlineFiscalYear: 2568,
        partialCurrentYearNote: '',
        kpis: [{ metric: 'Tuition revenue', value: '1,000,000 THB', notes: '' }],
        waterfall: [
          { step: 'Tuition revenue', kind: 'positive', value: 1_000_000, isTotal: false },
          { step: 'Direct program cost', kind: 'negative', value: -400_000, isTotal: false },
          { step: 'Net contribution', kind: 'total', value: 600_000, isTotal: true },
        ],
        sensitivity: {
          tuitionPlus5Pct: { tuitionRevenue: 1_050_000, netContribution: 650_000 },
        },
        trend: [{ year: 2568, tuition: 1_000_000, subsidy: 300_000, net: 600_000 }],
        ...overrides,
      },
    };
  }

  describe('financials.headlineFiscalYear', () => {
    it('accepts a number', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithFinancials({ headlineFiscalYear: 2568 }))
          .success,
      ).toBe(true);
    });

    it('accepts null', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithFinancials({ headlineFiscalYear: null }))
          .success,
      ).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithFinancials({ headlineFiscalYear: '2568' }))
          .success,
      ).toBe(false);
    });

    it('rejects NaN', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWithFinancials({ headlineFiscalYear: Number.NaN }),
        ).success,
      ).toBe(false);
    });
  });

  describe('financials.waterfall[].value / .isTotal', () => {
    // The Waterfall chart primitive's core input. `value` was pre-signed
    // with a literal '−' prefix and Math.abs()'d for display; the sign
    // now lives directly in the number. `isTotal` is new — the primitive
    // draws a total bar from zero rather than continuing the running
    // total, so the data must say which bars are totals.
    function fixtureWith(value: unknown, isTotal: unknown): unknown {
      return fixtureWithFinancials({
        waterfall: [{ step: 'Direct program cost', kind: 'negative', value, isTotal }],
      });
    }

    it('accepts a negative delta (a cost, not pre-absolute-valued)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(-400000, false)).success).toBe(true);
    });

    it('accepts a positive delta', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(1000000, false)).success).toBe(true);
    });

    it('accepts isTotal: true for a closing total bar', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(600000, true)).success).toBe(true);
    });

    it('accepts a null value', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null, false)).success).toBe(true);
    });

    it('rejects the old "−400,000" pre-signed formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('−400,000', false)).success).toBe(
        false,
      );
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN, false)).success).toBe(
        false,
      );
    });

    it('rejects a non-boolean isTotal', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(600000, 'total')).success).toBe(
        false,
      );
    });
  });

  describe('financials.sensitivity (split from the old narrative sentence)', () => {
    it('accepts the two numbers', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWithFinancials({
            sensitivity: {
              tuitionPlus5Pct: { tuitionRevenue: 1050000, netContribution: 650000 },
            },
          }),
        ).success,
      ).toBe(true);
    });

    it('accepts null (no sensitivity computed)', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWithFinancials({ sensitivity: null })).success,
      ).toBe(true);
    });

    it('rejects the old narrative-sentence string', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWithFinancials({
            sensitivity:
              'Sensitivity — if tuition rose 5%, net contribution becomes 650,000 THB (revenue 1,050,000 THB).',
          }),
        ).success,
      ).toBe(false);
    });

    it('rejects NaN inside the nested numbers', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWithFinancials({
            sensitivity: {
              tuitionPlus5Pct: { tuitionRevenue: Number.NaN, netContribution: 650000 },
            },
          }),
        ).success,
      ).toBe(false);
    });
  });

  describe('financials.trend[].year / .tuition / .subsidy / .net', () => {
    function fixtureWith(overrides: Record<string, unknown>): unknown {
      return fixtureWithFinancials({
        trend: [{ year: 2568, tuition: 1000000, subsidy: 300000, net: 600000, ...overrides }],
      });
    }

    it('accepts numbers', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith({})).success).toBe(true);
    });

    it('accepts null on the value fields', () => {
      expect(
        ProgramDetailDataSchema.safeParse(
          fixtureWith({ tuition: null, subsidy: null, net: null }),
        ).success,
      ).toBe(true);
    });

    it('rejects formatted strings', () => {
      expect(
        ProgramDetailDataSchema.safeParse(fixtureWith({ tuition: '1,000,000' })).success,
      ).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith({ net: Number.NaN })).success).toBe(
        false,
      );
    });
  });

  // ── Peers ─────────────────────────────────────────────────────────
  describe('peers.rankingYear', () => {
    function fixtureWith(rankingYear: unknown): unknown {
      const peers = (FIXTURE as { peers: object }).peers;
      return { ...FIXTURE, peers: { ...peers, rankingYear } };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2025)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('2025')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('peers.tiers[].entries[].rank / .qsWorld', () => {
    function fixtureWith(rank: unknown, qsWorld: unknown): unknown {
      const peers = (FIXTURE as { peers: { tiers: unknown[] } }).peers;
      const tiers = peers.tiers as Array<{ tier: string; entries: unknown[] }>;
      return {
        ...FIXTURE,
        peers: {
          ...peers,
          tiers: [
            {
              ...tiers[0],
              entries: [{ ...(tiers[0]!.entries[0] as object), rank, qsWorld }],
            },
            ...tiers.slice(1),
          ],
        },
      };
    }

    it('accepts numbers', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2, 50)).success).toBe(true);
    });

    it('accepts a null qsWorld (peer institution not QS-ranked)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2, null)).success).toBe(true);
    });

    it('rejects the old "50" formatted-as-string qsWorld', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(2, '50')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN, 50)).success).toBe(false);
    });
  });

  describe('peers.aiReview.confidencePct', () => {
    function fixtureWith(confidencePct: unknown): unknown {
      const peers = (FIXTURE as { peers: { aiReview: object } }).peers;
      return {
        ...FIXTURE,
        peers: { ...peers, aiReview: { ...peers.aiReview, confidencePct } },
      };
    }

    it('accepts a percentage-scaled number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(95)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old "95%" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('95%')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('peers.curatedPeers[].ranking', () => {
    // Empty in the captured fixture (this program has no curated
    // peer-programs rows) — synthetic single-row array.
    function fixtureWith(ranking: unknown): unknown {
      const peers = (FIXTURE as { peers: object }).peers;
      return {
        ...FIXTURE,
        peers: {
          ...peers,
          curatedPeers: [
            { institution: 'Example University', country: 'Thailand', programName: 'Example', ranking },
          ],
        },
      };
    }

    it('accepts a number', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(3)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects a formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('3')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  // ── Trends ────────────────────────────────────────────────────────
  describe('trends[].impactScorePct (split from the old compound "72 (High)")', () => {
    // impactScore is a 0–1 fraction upstream and MUST be × 100 here to
    // land on this schema's percentage-scale convention. This guards
    // against exactly the double-scaling bug batch 2 found on
    // alumniBreakdown[].share (already 0–100, run through a ×100 helper
    // anyway, rendering 12.3% as "1230.0%").
    function fixtureWith(impactScorePct: unknown): unknown {
      const trends = (FIXTURE as { trends: unknown[] }).trends;
      return { ...FIXTURE, trends: [{ ...(trends[0] as object), impactScorePct }, ...trends.slice(1)] };
    }

    it('accepts a 0–100-scale number (upstream fraction × 100)', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(82)).success).toBe(true);
    });

    it('accepts null', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(null)).success).toBe(true);
    });

    it('rejects the old compound "72 (High)" formatted string', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('72 (High)')).success).toBe(false);
    });

    it('rejects NaN', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(Number.NaN)).success).toBe(false);
    });
  });

  describe('trends[].impactBucket (split from the old compound field, stays DISPLAY)', () => {
    function fixtureWith(impactBucket: unknown): unknown {
      const trends = (FIXTURE as { trends: unknown[] }).trends;
      return { ...FIXTURE, trends: [{ ...(trends[0] as object), impactBucket }, ...trends.slice(1)] };
    }

    it('accepts the bucket label', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith('High')).success).toBe(true);
    });

    it('rejects a number — this field stays a display label', () => {
      expect(ProgramDetailDataSchema.safeParse(fixtureWith(82)).success).toBe(false);
    });
  });
});

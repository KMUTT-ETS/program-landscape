import { describe, expect, it } from 'vitest';
import {
  buildProgramResearchExpertiseMessages,
  PROGRAM_RESEARCH_EXPERTISE_VERSION,
  ProgramResearchExpertiseSchema,
  researchExpertiseConfidenceCeiling,
  ROSTER_PROVENANCE_CAVEAT,
} from '../src/ai/prompts/program-research-expertise';
import {
  FIXTURE_INPUT,
  THIN_FIXTURE_INPUT,
  NO_ROSTER_FIXTURE_INPUT,
} from './fixtures/research-expertise-input';

describe('program-research-expertise v3 builder', () => {
  const messages = buildProgramResearchExpertiseMessages(FIXTURE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 1', () => {
    expect(PROGRAM_RESEARCH_EXPERTISE_VERSION).toBe('program-research-expertise.v3');
  });

  it('demands English output explicitly', () => {
    expect(system).toMatch(/Write in English/);
  });

  it('tells the model what to do with a single-paper outlier — the v3 rule', () => {
    expect(system).toContain('A single-paper cluster is NOT a theme');
    expect(system).toContain('never pad the theme count');
  });

  it('constrains paperCount to the analysed set — the v2 rule', () => {
    expect(system).toContain('counts ONLY papers listed in TOP PAPERS');
    expect(system).toContain('Never extrapolate to the full roster volume');
    expect(system).toContain('as prose, never as a number');
  });

  it('carries the confidence rubric verbatim and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toContain(
      '0.90-1.00  every key input channel present and mutually consistent',
    );
    expect(system).toContain('below 0.50 best effort over sparse input — flag for human review');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('requires verbatim example titles drawn from the input', () => {
    expect(system).toMatch(/verbatim/i);
  });

  it('states the titles-only limitation', () => {
    expect(system).toMatch(/titles?[\s-]only|no abstracts/i);
  });

  it('states quartile absence must read as "not assessed", never low quality', () => {
    expect(system).toMatch(/not assessed/i);
  });

  it('feeds TOP PAPERS and PUBLICATION STATS into the user snapshot', () => {
    expect(user).toContain('TOP PAPERS');
    expect(user).toContain('PUBLICATION STATS');
  });

  it('renders every top paper with year, quartile-or-dash, citations, venue, and title', () => {
    const first = FIXTURE_INPUT.topPapers[0]!;
    expect(user).toContain(String(first.year));
    expect(user).toContain(first.venue!);
    expect(user).toContain(first.title);
    expect(user).toContain(String(first.citations));
  });

  it('renders a "—" for papers with no quartile', () => {
    const unassessed = FIXTURE_INPUT.topPapers.find((p) => p.quartile === null)!;
    // The unassessed paper's line must exist and use the dash placeholder
    // rather than "Q null" or an omitted field.
    const lines = user.split('\n').filter((l) => l.includes(unassessed.title));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain('—');
  });

  it('does not render a thinness warning for an ok-readiness input', () => {
    expect(user).not.toMatch(/thin|below the .*threshold/i);
  });

  it('renders an explicit thinness warning for a thin-readiness input', () => {
    const thinUser = buildProgramResearchExpertiseMessages(THIN_FIXTURE_INPUT).find(
      (m) => m.role === 'user',
    )!.content;
    expect(thinUser).toMatch(/thin/i);
    expect(thinUser).toContain(String(THIN_FIXTURE_INPUT.stats.totalDistinct));
  });

  it('does not throw when handed a no-roster input (defensive; the runner never calls this in practice)', () => {
    expect(() => buildProgramResearchExpertiseMessages(NO_ROSTER_FIXTURE_INPUT)).not.toThrow();
  });
});

describe('ProgramResearchExpertiseSchema', () => {
  const validPayload = {
    themes: [
      {
        name: 'Sustainable and recycled construction materials',
        paperCount: 7,
        exampleTitles: [
          'Mechanical properties of recycled aggregate concrete under cyclic loading',
          'Durability of fly-ash blended concrete in tropical climates',
        ],
        yearSpan: '2018–2025',
        trend: 'rising' as const,
        evidenceNote: 'Papers cluster in Construction and Building Materials since 2021.',
      },
    ],
    recommendations: {
      curriculum: [
        {
          action: 'Add a recycled-materials module to the year-3 concrete design course.',
          rationale: 'Roster publishes actively in this exact area.',
          horizonMonths: 12,
          themeRefs: ['Sustainable and recycled construction materials'],
        },
      ],
      positioning: [
        {
          action: 'Feature the recycled-concrete research group on the program landing page.',
          rationale: 'Distinctive theme evidenced by 7 papers over 8 years.',
          horizonMonths: 6,
          themeRefs: ['Sustainable and recycled construction materials'],
        },
      ],
      research: [
        {
          action: 'Pursue a joint grant proposal on low-carbon concrete with a peer institution.',
          rationale: 'Multiple Q1 papers already establish credibility in this niche.',
          horizonMonths: 18,
          themeRefs: ['Sustainable and recycled construction materials'],
        },
      ],
    },
    caveats: [ROSTER_PROVENANCE_CAVEAT],
    confidence: 0.8,
  };

  it('accepts a fully valid payload', () => {
    expect(ProgramResearchExpertiseSchema.safeParse(validPayload).success).toBe(true);
  });

  it('accepts 2 or 3 example titles', () => {
    const withThree = {
      ...validPayload,
      themes: [
        {
          ...validPayload.themes[0],
          exampleTitles: [...validPayload.themes[0]!.exampleTitles, 'A third paper title here'],
        },
      ],
    };
    expect(ProgramResearchExpertiseSchema.safeParse(withThree).success).toBe(true);
  });

  it('rejects a theme with 0 example titles', () => {
    const bad = { ...validPayload, themes: [{ ...validPayload.themes[0], exampleTitles: [] }] };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a theme with 1 example title', () => {
    const bad = {
      ...validPayload,
      themes: [{ ...validPayload.themes[0], exampleTitles: ['Only one title'] }],
    };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a theme with more than 3 example titles', () => {
    const bad = {
      ...validPayload,
      themes: [
        {
          ...validPayload.themes[0],
          exampleTitles: ['Title one', 'Title two', 'Title three', 'Title four'],
        },
      ],
    };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('requires caveats to include the roster-provenance caveat verbatim', () => {
    const bad = { ...validPayload, caveats: ['Some other caveat entirely.'] };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects caveats that paraphrase rather than match the roster caveat verbatim', () => {
    const bad = {
      ...validPayload,
      caveats: [ROSTER_PROVENANCE_CAVEAT.replace('curated program roster', 'curated roster')],
    };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts caveats that include the roster caveat alongside other caveats', () => {
    const ok = {
      ...validPayload,
      caveats: ['Quartile data covers only ~31% of papers.', ROSTER_PROVENANCE_CAVEAT],
    };
    expect(ProgramResearchExpertiseSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects an empty themes array', () => {
    const bad = { ...validPayload, themes: [] };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects more than 6 themes', () => {
    const bad = {
      ...validPayload,
      themes: Array.from({ length: 7 }, (_, i) => ({
        ...validPayload.themes[0],
        name: `Theme ${i}`,
      })),
    };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a horizonMonths outside 1..60', () => {
    const bad = {
      ...validPayload,
      recommendations: {
        ...validPayload.recommendations,
        curriculum: [{ ...validPayload.recommendations.curriculum[0], horizonMonths: 61 }],
      },
    };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a recommendation with no themeRefs', () => {
    const bad = {
      ...validPayload,
      recommendations: {
        ...validPayload.recommendations,
        curriculum: [{ ...validPayload.recommendations.curriculum[0], themeRefs: [] }],
      },
    };
    expect(ProgramResearchExpertiseSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(ProgramResearchExpertiseSchema.safeParse({ ...validPayload, confidence: 1.1 }).success).toBe(
      false,
    );
  });
});

describe('ROSTER_PROVENANCE_CAVEAT', () => {
  it('matches the plan-pinned constant verbatim', () => {
    expect(ROSTER_PROVENANCE_CAVEAT).toBe(
      'Analysis covers publications of the curated program roster (AI-extracted, analyst-reviewed); roster gaps or errors propagate to these findings.',
    );
  });
});

describe('researchExpertiseConfidenceCeiling', () => {
  it('bands per the plan header', () => {
    expect(researchExpertiseConfidenceCeiling('thin', 5)).toBe(0.49);
    expect(researchExpertiseConfidenceCeiling('thin', 9)).toBe(0.49);
    expect(researchExpertiseConfidenceCeiling('ok', 10)).toBe(0.69);
    expect(researchExpertiseConfidenceCeiling('ok', 49)).toBe(0.69);
    expect(researchExpertiseConfidenceCeiling('ok', 50)).toBe(0.89);
    expect(researchExpertiseConfidenceCeiling('ok', 149)).toBe(0.89);
    expect(researchExpertiseConfidenceCeiling('ok', 150)).toBe(1.0);
    expect(researchExpertiseConfidenceCeiling('ok', 2899)).toBe(1.0);
  });

  it('ceils no-roster at 0 (defensive — the runner never generates for this readiness)', () => {
    expect(researchExpertiseConfidenceCeiling('no-roster', 0)).toBe(0);
  });
});

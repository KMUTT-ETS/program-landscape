import { describe, expect, it } from 'vitest';
import {
  GAP_BRIEF_VERSION,
  GapBriefOutputSchema,
  buildGapBriefMessages,
  type GapBriefInput,
} from '../src/ai/prompts/gap-brief';

// The brief speaks only about the rows the reader has on screen. Two things
// the schema must not let through: a sixth-plus finding (the Council reads
// five), and a verdict name the map cannot produce — `supply-unknown` is a
// real verdict (programmes exist, none carries a graduate figure) and a
// brief that silently re-labels it "under-served" would invent a shortfall
// out of a data gap.

const input: GapBriefInput = {
  view: { scopeLabel: 'KKU (all faculties)', verdict: 'all', facultyLabel: null, thresholds: { under: 0.5, over: 2 } },
  rows: [
    {
      nameEn: 'Logistics',
      nameTh: 'โลจิสติกส์',
      verdict: 'white-space',
      demandSharePct: 4.8,
      supplySharePct: 0,
      ratio: null,
      gradsPerYear: null,
      pipelineArrow: null,
      postings: 1610,
      topOccupations: ['Logistics officer'],
      risingSkills: ['Supply chain analytics ↑ 31 %'],
      trendSignalTitles: ['EEC logistics hub'],
    },
    {
      nameEn: 'Public health',
      nameTh: 'สาธารณสุข',
      verdict: 'over-served',
      demandSharePct: 0.9,
      supplySharePct: 4.1,
      ratio: 4.6,
      gradsPerYear: 380,
      pipelineArrow: 'down',
      postings: 300,
      topOccupations: [],
      risingSkills: [],
      trendSignalTitles: [],
    },
    {
      nameEn: 'Fine arts',
      nameTh: 'ศิลปกรรม',
      verdict: 'supply-unknown',
      demandSharePct: 0.4,
      supplySharePct: 0,
      ratio: null,
      gradsPerYear: null,
      pipelineArrow: null,
      postings: 140,
      topOccupations: [],
      risingSkills: [],
      trendSignalTitles: [],
    },
  ],
  reconciliation: { fieldPostings: 33_000, anyFieldPostings: 2_566, otherMentions: 2_900, proposedFields: 12, approvedFields: 26 },
};

describe('gap-brief.v1', () => {
  it('is versioned and grounds the user turn in every row', () => {
    expect(GAP_BRIEF_VERSION).toBe('gap-brief.v1');
    const user = buildGapBriefMessages(input).find((m) => m.role === 'user')!.content;
    expect(user).toContain('Logistics');
    expect(user).toContain('4.8');
    expect(user).toContain('over-served');
    expect(user).toContain('2,566');
  });

  it('teaches all six verdicts, supply-unknown included, and forbids reading it as a shortfall', () => {
    const system = buildGapBriefMessages(input).find((m) => m.role === 'system')!.content;
    for (const v of ['white-space', 'under-served', 'served', 'over-served', 'supply-unknown', 'too-few-postings']) {
      expect(system, `system prompt never mentions ${v}`).toContain(v);
    }
    expect(system).toMatch(/no graduate figures/i);
    expect(system).toMatch(/never present a supply-unknown field as under-served/i);
  });

  it('refuses an empty view and more than 60 rows', () => {
    expect(() => buildGapBriefMessages({ ...input, rows: [] })).toThrow();
    expect(() => buildGapBriefMessages({ ...input, rows: Array.from({ length: 61 }, () => input.rows[0]!) })).toThrow(/60/);
  });

  it('validates ≤ 5 findings each naming a row, plus cannotTell', () => {
    const ok = GapBriefOutputSchema.safeParse({
      findings: [
        {
          title: 'Logistics is a white space',
          fieldNameEn: 'Logistics',
          verdict: 'white-space',
          evidence: '4.8 % of adverts, no programme',
          implication: 'A launch case exists.',
        },
        {
          title: 'Fine arts has no measured supply',
          fieldNameEn: 'Fine arts',
          verdict: 'supply-unknown',
          evidence: 'Programmes exist; no graduate figure, so no ratio.',
          implication: 'The registrar figure is missing, not the graduates.',
        },
      ],
      cannotTell: ['Salary levels — JobThai postings carry none.'],
      confidence: 0.7,
      reasoning: 'Grounded on three rows.',
    });
    expect(ok.success).toBe(true);

    const six = {
      findings: Array.from({ length: 6 }, () => ({ title: 't', fieldNameEn: 'x', verdict: 'served', evidence: 'e', implication: 'i' })),
      cannotTell: [],
      confidence: 0.5,
      reasoning: 'r',
    };
    expect(GapBriefOutputSchema.safeParse(six).success).toBe(false);

    const badVerdict = {
      findings: [{ title: 't', fieldNameEn: 'x', verdict: 'oversupplied', evidence: 'e', implication: 'i' }],
      cannotTell: [],
      confidence: 0.5,
      reasoning: 'r',
    };
    expect(GapBriefOutputSchema.safeParse(badVerdict).success).toBe(false);
  });
});

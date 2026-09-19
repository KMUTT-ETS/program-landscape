import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { GapMapResult, GapMapRow, GapVerdict } from '@kku/db';
import type { AiService, ExtractionResponse, GapBriefOutput } from '@kku/shared';
import { GAP_BRIEF_MAX_ROWS } from '@kku/shared';
import { GapBriefService, visibleRows, type GapBriefParams } from '../src/gap/gap-brief.service';
import type { GapService } from '../src/gap/gap.service';

// GapBriefService talks to the AI provider through a private `ai` field set
// in onModuleInit(). Unit tests never want a real provider client (no
// network, no credits — see the hard rule at the top of this workstream),
// so every test builds the service with the constructor only and pokes the
// stub in directly. This is the same "reach past DI for a unit test" move
// gap-controller.test.ts uses for GapService/GapBriefService — there is no
// public seam for it because the whole point of onModuleInit is that ai is
// wired once per process, not per call.
interface HasAi {
  ai: AiService;
}
function withAi(service: GapBriefService, ai: AiService): GapBriefService {
  (service as unknown as HasAi).ai = ai;
  return service;
}

function configWithProvider(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = { GOOGLE_AI_API_KEY: 'test-google-key', ...overrides };
  return { get: vi.fn((key: string) => values[key]) } as unknown as ConfigService;
}

function configWithoutProvider(): ConfigService {
  return { get: vi.fn(() => undefined) } as unknown as ConfigService;
}

function gapServiceReturning(map: GapMapResult): GapService {
  return { map: vi.fn(async () => map) } as unknown as GapService;
}

let rowCounter = 0;
function makeRow(overrides: Partial<GapMapRow> = {}): GapMapRow {
  rowCounter += 1;
  return {
    slug: `field-${rowCounter}`,
    nameTh: `สาขา ${rowCounter}`,
    nameEn: `Field ${rowCounter}`,
    reviewStatus: 'APPROVED',
    postings: 100,
    demandShare: 0.1,
    supplyShare: 0.08,
    ratio: 0.8,
    verdict: 'served',
    gradsPerYear: 50,
    pipeline: 55,
    pipelineArrow: 'flat',
    programmeCount: 2,
    programmesWithSupply: 2,
    signalCount: 0,
    kkuTotal: null,
    provinces: [],
    occupations: [],
    programmes: [],
    facultyIds: [],
    globalSignal: { skills: [], scope: null },
    trendSignals: [],
    ...overrides,
  };
}

function makeMap(rows: GapMapRow[], overrides: Partial<GapMapResult> = {}): GapMapResult {
  return {
    methodologyVersion: 'gap-map.v1',
    computedAt: '2026-09-19T00:00:00.000Z',
    scope: { level: 'university', id: null, label: 'KKU (all faculties)' },
    thresholds: { under: 0.5, over: 2 },
    rows,
    verdictCounts: {} as Record<GapVerdict, number>,
    facultyStrip: [],
    reconciliation: {
      eligiblePostings: 0,
      fieldPostings: 0,
      fieldMentions: 0,
      multiFieldPostings: 0,
      anyFieldPostings: 0,
      otherKinds: 0,
      otherMentions: 0,
      postgraduatePostings: 0,
      demandShareSum: 0,
      supplyShareSum: 0,
      multiFieldProgrammes: 0,
      fieldGraduatesTotal: 0,
    },
    taxonomy: { approved: 0, proposed: 0 },
    freshness: { postingsAsOf: null, taxonomyAsOf: null },
    ...overrides,
  };
}

const baseParams: GapBriefParams = {
  scope: 'university',
  scopeId: null,
  verdict: 'all',
  facultyId: null,
  thresholds: { under: 0.5, over: 2 },
  userId: 'u1',
};

/** A schema-shaped, otherwise clean output: no banned tells, two cannotTell
 *  entries (so the retry path isn't triggered by accident in tests that
 *  aren't testing the retry itself). */
function cleanOutput(findings: GapBriefOutput['findings'] = []): GapBriefOutput {
  return {
    findings,
    cannotTell: ['National job adverts only, Bangkok-weighted.', 'No salary data in this source.'],
    confidence: 0.8,
    reasoning: 'Straightforward read of the table.',
  };
}

function extractionResponse(parsed: GapBriefOutput, rawText = 'raw'): ExtractionResponse<GapBriefOutput> {
  return {
    parsed,
    confidence: parsed.confidence,
    rawText,
    tokens: { input: 100, output: 50 },
    model: 'test-model',
    latencyMs: 10,
    cost: { usd: 0.001, model: 'test-model' },
    aiInferenceId: 'inf-1',
  };
}

describe('visibleRows', () => {
  const underServed = makeRow({ nameEn: 'A', verdict: 'under-served', facultyIds: ['f1'] });
  const served = makeRow({ nameEn: 'B', verdict: 'served', facultyIds: ['f2'] });
  const whiteSpace = makeRow({ nameEn: 'C', verdict: 'white-space', facultyIds: ['f1', 'f2'] });
  const map = makeMap([underServed, served, whiteSpace]);

  it('returns every row when the verdict filter is "all" and no faculty is set', () => {
    expect(visibleRows(map, 'all', null)).toEqual([underServed, served, whiteSpace]);
  });

  it('filters by verdict', () => {
    expect(visibleRows(map, 'served', null)).toEqual([served]);
    expect(visibleRows(map, 'white-space', null)).toEqual([whiteSpace]);
  });

  it('filters by faculty membership', () => {
    expect(visibleRows(map, 'all', 'f1')).toEqual([underServed, whiteSpace]);
    expect(visibleRows(map, 'all', 'f2')).toEqual([served, whiteSpace]);
  });

  it('combines both filters', () => {
    expect(visibleRows(map, 'white-space', 'f2')).toEqual([whiteSpace]);
    expect(visibleRows(map, 'under-served', 'f2')).toEqual([]);
  });
});

describe('GapBriefService.generate — row cap', () => {
  it('caps rowsBriefed at GAP_BRIEF_MAX_ROWS while totalVisible reports the true pre-slice count', async () => {
    const rows = Array.from({ length: GAP_BRIEF_MAX_ROWS + 5 }, (_, i) => makeRow({ nameEn: `Field ${i}` }));
    const map = makeMap(rows);
    const extractStructured = vi.fn(async () => extractionResponse(cleanOutput()));
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithProvider(), gapServiceReturning(map)), ai);

    const result = await service.generate(baseParams);

    expect(result.totalVisible).toBe(GAP_BRIEF_MAX_ROWS + 5);
    expect(result.rowsBriefed).toBe(GAP_BRIEF_MAX_ROWS);
    expect(result.reason).toBe('ok');
    // buildGapBriefMessages throws if handed more than GAP_BRIEF_MAX_ROWS rows
    // — the fact this resolved at all proves the slice actually happened,
    // not just that the response says so.
    expect(extractStructured).toHaveBeenCalledTimes(1);
  });
});

describe('GapBriefService.generate — nothing-to-show paths', () => {
  it('reports reason "empty-view" when the filtered view has no rows, and never calls the model', async () => {
    const map = makeMap([makeRow({ verdict: 'served' })]);
    const extractStructured = vi.fn();
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(
      new GapBriefService(configWithProvider(), gapServiceReturning(map)),
      ai,
    );

    const result = await service.generate({ ...baseParams, verdict: 'white-space' });

    expect(result.reason).toBe('empty-view');
    expect(result.output).toBeNull();
    expect(result.totalVisible).toBe(0);
    expect(result.rowsBriefed).toBe(0);
    expect(result.aiInferenceId).toBeNull();
    expect(extractStructured).not.toHaveBeenCalled();
  });

  it('reports reason "no-provider" when no AI key is configured, even with visible rows, and never calls the model', async () => {
    const map = makeMap([makeRow({ verdict: 'served' })]);
    const extractStructured = vi.fn();
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithoutProvider(), gapServiceReturning(map)), ai);

    const result = await service.generate(baseParams);

    expect(result.reason).toBe('no-provider');
    expect(result.output).toBeNull();
    expect(result.totalVisible).toBe(1);
    // Unlike the empty-view path, there IS a row on screen here — the model
    // just never got to see it. `rowsBriefed` is computed from the same
    // pre-branch slice as `totalVisible`, so it reports what WOULD have been
    // sent, not zero.
    expect(result.rowsBriefed).toBe(1);
    expect(extractStructured).not.toHaveBeenCalled();
  });

  it('the two empty paths are distinguishable only by `reason`, not by matching rawText prose', async () => {
    const mapEmpty = makeMap([]);
    const serviceA = withAi(
      new GapBriefService(configWithProvider(), gapServiceReturning(mapEmpty)),
      { extractStructured: vi.fn() } as unknown as AiService,
    );
    const serviceB = withAi(
      new GapBriefService(configWithoutProvider(), gapServiceReturning(makeMap([makeRow()]))),
      { extractStructured: vi.fn() } as unknown as AiService,
    );
    const a = await serviceA.generate(baseParams);
    const b = await serviceB.generate(baseParams);
    expect(a.reason).not.toBe(b.reason);
    expect(a.reason).toBe('empty-view');
    expect(b.reason).toBe('no-provider');
  });
});

describe('GapBriefService.generate — banned-tell retry', () => {
  it('retries once when the draft uses a banned phrase, and uses the corrected draft', async () => {
    const row = makeRow({ nameEn: 'Logistics', verdict: 'served' });
    const map = makeMap([row]);
    const dirty = cleanOutput([
      { title: 'Robust pipeline', fieldNameEn: 'Logistics', verdict: 'served', evidence: 'e', implication: 'i' },
    ]);
    const clean = cleanOutput([
      { title: 'Steady pipeline', fieldNameEn: 'Logistics', verdict: 'served', evidence: 'e', implication: 'i' },
    ]);
    const extractStructured = vi
      .fn()
      .mockResolvedValueOnce(extractionResponse(dirty))
      .mockResolvedValueOnce(extractionResponse(clean));
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithProvider(), gapServiceReturning(map)), ai);

    const result = await service.generate(baseParams);

    expect(extractStructured).toHaveBeenCalledTimes(2);
    // The retry call carries a corrective user turn appended to the messages.
    const secondCallArgs = extractStructured.mock.calls[1]?.[0] as { messages: Array<{ role: string }> };
    expect(secondCallArgs.messages.at(-1)?.role).toBe('user');
    expect(result.output?.findings[0]?.title).toBe('Steady pipeline');
    expect(result.reason).toBe('ok');
  });

  it('does not throw when the retry still fails the lint — it logs and uses the retry anyway', async () => {
    const row = makeRow({ nameEn: 'Logistics', verdict: 'served' });
    const map = makeMap([row]);
    const stillDirty = (label: string) =>
      cleanOutput([
        { title: `${label} pipeline`, fieldNameEn: 'Logistics', verdict: 'served', evidence: 'e', implication: 'i' },
      ]);
    const extractStructured = vi
      .fn()
      .mockResolvedValueOnce(extractionResponse(stillDirty('Robust')))
      .mockResolvedValueOnce(extractionResponse(stillDirty('Leverage')));
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithProvider(), gapServiceReturning(map)), ai);

    await expect(service.generate(baseParams)).resolves.toMatchObject({ reason: 'ok' });
    expect(extractStructured).toHaveBeenCalledTimes(2);
  });
});

describe('GapBriefService.generate — reconciliation against the rows the model was given', () => {
  it('drops a finding that names a field not among the rows shown', async () => {
    const known = makeRow({ nameEn: 'Nursing', verdict: 'served' });
    const map = makeMap([known]);
    const output = cleanOutput([
      { title: 'Ghost field', fieldNameEn: 'Astrology', verdict: 'served', evidence: 'e', implication: 'i' },
    ]);
    const extractStructured = vi.fn(async () => extractionResponse(output));
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithProvider(), gapServiceReturning(map)), ai);

    const result = await service.generate(baseParams);

    expect(result.output?.findings).toEqual([]);
    expect(result.findingsDropped).toBe(1);
    expect(result.findingsCorrected).toBe(0);
  });

  it('corrects a finding whose verdict disagrees with its row, keeping the finding under the row\'s real verdict', async () => {
    const row = makeRow({ nameEn: 'Nursing', verdict: 'over-served' });
    const map = makeMap([row]);
    const output = cleanOutput([
      { title: 'Shortage in nursing', fieldNameEn: 'Nursing', verdict: 'under-served', evidence: 'e', implication: 'i' },
    ]);
    const extractStructured = vi.fn(async () => extractionResponse(output));
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithProvider(), gapServiceReturning(map)), ai);

    const result = await service.generate(baseParams);

    expect(result.output?.findings).toHaveLength(1);
    expect(result.output?.findings[0]?.verdict).toBe('over-served');
    expect(result.output?.findings[0]?.title).toBe('Shortage in nursing');
    expect(result.findingsCorrected).toBe(1);
    expect(result.findingsDropped).toBe(0);
  });

  it('drops (does not relabel) a finding whose row corrects to supply-unknown', async () => {
    const row = makeRow({ nameEn: 'Actuarial Science', verdict: 'supply-unknown' });
    const map = makeMap([row]);
    const output = cleanOutput([
      {
        title: 'Actuarial shortage',
        fieldNameEn: 'Actuarial Science',
        verdict: 'under-served',
        evidence: 'e',
        implication: 'i',
      },
    ]);
    const extractStructured = vi.fn(async () => extractionResponse(output));
    const ai = { extractStructured } as unknown as AiService;
    const service = withAi(new GapBriefService(configWithProvider(), gapServiceReturning(map)), ai);

    const result = await service.generate(baseParams);

    expect(result.output?.findings).toEqual([]);
    expect(result.findingsDropped).toBe(1);
    expect(result.findingsCorrected).toBe(0);
  });
});

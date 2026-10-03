import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_VARIANT_LABEL,
  OVERLAP_ACTION_LABEL,
  OVERLAP_ACTION_ORDER,
  actionBadgeLabel,
  layerValue,
  matrixTitle,
  overlapQueryString,
  type OverlapCell,
} from '../app/education/program-overlap/types';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');
const DIR = 'app/education/program-overlap';
const page = read(`${DIR}/page.tsx`);
const client = read(`${DIR}/client.tsx`);
const sharedPair = read('src/components/overlap/pair-evidence.tsx');
const surface = `${page}\n${client}`;

const names = new Map([
  ['a', 'A'],
  ['b', 'B'],
]);
const cell = (over: Partial<OverlapCell> = {}): OverlapCell => ({
  a: 'a',
  b: 'b',
  pairId: 'p1',
  overlapIndex: 72,
  structure: 60,
  content: 75,
  outcome: 81,
  marketSimilarity: null,
  band: 'HIGH',
  primaryAction: 'CONSIDER_MERGE_OR_TRACK',
  languageVariant: false,
  limitedEvidence: false,
  uncorroborated: false,
  ...over,
});

describe('program overlap dashboard wiring', () => {
  it('is a tile on the Education hub, with its own thumbnail', () => {
    const hub = read('app/education/page.tsx');
    expect(hub).toContain("href: '/education/program-overlap'");
    expect(hub).toContain('Thumb: ProgramOverlapThumb');
    expect(read('app/education/thumbnails.tsx')).toMatch(/export function ProgramOverlapThumb\(/);
  });

  it('renders the clustered matrix from @kku/ui', () => {
    expect(client).toMatch(/import \{[^}]*\bOverlapMatrix\b[^}]*\} from '@kku\/ui'/);
    expect(client).toContain('<OverlapMatrix');
  });

  it('carries provenance and freshness (Council-readiness rules 1 and 3)', () => {
    expect(surface).toContain('<ProvenanceButton');
    expect(surface).toContain('<FreshnessBadge');
    expect(client).toContain('freshnessDate={data.completedAt}');
  });

  it('shows the AI suggestion with confidence, reasoning and a disagree button', () => {
    // The recommendation block is shared with the Deep-Dive section.
    expect(client).toContain('<OverlapRecommendation');
    expect(sharedPair).toContain('<ConfidenceBadge');
    expect(sharedPair).toContain('Show reasoning');
    expect(sharedPair).toContain('submitDisagreementAction');
  });

  it('notes limited evidence and uncorroborated pairs on the pair panel', () => {
    expect(client).toContain('<EvidenceQualityNote evidence={ev} />');
    expect(client).toContain("nullText={isUncorroborated(ev) ? 'Not scored' : undefined}");
  });

  it('renders an explicit empty state when no run exists', () => {
    expect(page).toContain('data.runId === null');
    expect(page).toContain('No overlap analysis has run yet. Run pnpm programs:overlap --apply.');
  });

  it('never runtime-imports @kku/db or the @kku/shared barrel in client code', () => {
    const types = read(`${DIR}/types.ts`);
    const labels = read('src/components/overlap/labels.ts');
    for (const src of [client, types, sharedPair, labels]) {
      expect(src).not.toMatch(/^import \{[^}]*\} from '@kku\/db'/m);
      expect(src).not.toMatch(/^import \{[^}]*\} from '@kku\/shared'/m);
    }
  });

  it('is labelled for the dashboard chat and the topology', () => {
    expect(read('src/components/dashboard-chat/dashboard-chat-panel.tsx')).toContain(
      "'/education/program-overlap': 'Program overlap'",
    );
    expect(read('app/admin/application-topology/topology-data.ts')).toContain(
      "id: 'dash.education-program-overlap'",
    );
  });
});

describe('matrixTitle', () => {
  it('formats the index, its layers and the primary action', () => {
    expect(matrixTitle(cell(), names)).toBe(
      'A ↔ B · index 72 (structure 60 · content 75 · outcome 81) · Consider merge or track',
    );
  });

  it('skips null layers instead of showing them as 0', () => {
    expect(matrixTitle(cell({ content: null, primaryAction: null }), names)).toBe(
      'A ↔ B · index 72 (structure 60 · outcome 81)',
    );
  });

  it('rounds, adds market similarity and labels language variants', () => {
    expect(
      matrixTitle(
        cell({ overlapIndex: 88.6, structure: null, content: null, outcome: 88.6, marketSimilarity: 91.2, primaryAction: 'SHARE_STAFF_RESOURCES', languageVariant: true }),
        { a: 'ไทย', b: 'Intl' },
      ),
    ).toBe(`ไทย ↔ Intl · index 89 (outcome 89) · market similarity 91 · Share staff & resources · ${LANGUAGE_VARIANT_LABEL}`);
  });

  it('says when a pair has no curriculum index (stored for market similarity only)', () => {
    expect(
      matrixTitle(
        cell({ overlapIndex: null, structure: null, content: null, outcome: null, marketSimilarity: 77, primaryAction: null }),
        names,
      ),
    ).toBe('A ↔ B · no curriculum index · market similarity 77');
  });

  it('says "not scored" for an uncorroborated PLO match (D8)', () => {
    expect(
      matrixTitle(
        cell({ overlapIndex: null, structure: null, content: null, outcome: 100, marketSimilarity: 12, primaryAction: null, band: 'NONE', limitedEvidence: true, uncorroborated: true }),
        names,
      ),
    ).toBe('A ↔ B · not scored (uncorroborated PLO match) · market similarity 12');
  });

  it('falls back to the id for an unknown programme', () => {
    expect(matrixTitle(cell({ b: 'zz', primaryAction: null }), names)).toMatch(/^A ↔ zz · /);
  });
});

describe('action labels', () => {
  it('names every action in English', () => {
    expect(OVERLAP_ACTION_LABEL).toEqual({
      COORDINATE_SHARED_COURSES: 'Coordinate shared courses',
      CONSOLIDATE_EQUIVALENT_COURSES: 'Consolidate equivalent courses',
      SHARE_STAFF_RESOURCES: 'Share staff & resources',
      DIFFERENTIATE: 'Differentiate',
      CONSIDER_MERGE_OR_TRACK: 'Consider merge or track',
    });
  });

  it('suffixes every badge with "for review"', () => {
    for (const a of OVERLAP_ACTION_ORDER) {
      expect(actionBadgeLabel(a)).toBe(`${OVERLAP_ACTION_LABEL[a]} — for review`);
    }
  });

  it('orders actions weakest to strongest', () => {
    expect(OVERLAP_ACTION_ORDER[0]).toBe('COORDINATE_SHARED_COURSES');
    expect(OVERLAP_ACTION_ORDER[OVERLAP_ACTION_ORDER.length - 1]).toBe('CONSIDER_MERGE_OR_TRACK');
  });
});

describe('layer values and URL state', () => {
  it('reads the cell value for the selected layer', () => {
    const c = cell({ marketSimilarity: 64 });
    expect(layerValue(c, 'index')).toBe(72);
    expect(layerValue(c, 'structure')).toBe(60);
    expect(layerValue(c, 'content')).toBe(75);
    expect(layerValue(c, 'outcome')).toBe(81);
    expect(layerValue(c, 'market')).toBe(64);
  });

  it('omits defaults from the query string', () => {
    expect(overlapQueryString({ level: 'BACHELOR', layer: 'index', facultyId: null, threshold: 30, pair: null })).toBe('');
    expect(
      overlapQueryString({ level: 'MASTER', layer: 'content', facultyId: 'f1', threshold: 50, pair: 'p9' }),
    ).toBe('level=MASTER&layer=content&facultyId=f1&threshold=50&pair=p9');
  });
});

describe('risk self-competition panel', () => {
  const riskPage = read('app/risks/page.tsx');
  const panel = read('app/risks/self-competition-panel.tsx');

  it('is fetched from /risks/self-competition and rendered on /risks', () => {
    expect(riskPage).toContain('`/risks/self-competition?${qs}`');
    expect(riskPage).toContain('<SelfCompetitionPanel rows={selfCompetitionRows} meta={selfCompetitionMeta} />');
  });

  it('carries provenance and the explicit empty state', () => {
    expect(panel).toContain('<ProvenanceButton');
    expect(panel).toContain("'No programme is breaching the overlap or market-confusion indicators.'");
  });

  it('links both programmes and shows intakes and measure kinds', () => {
    expect(panel).toContain('<ProgrammeLink p={r.programA} />');
    expect(panel).toContain('<ProgrammeLink p={r.programB} />');
    expect(panel).toContain('r.intakeA');
    expect(panel).toContain('r.intakeB');
    expect(panel).toContain('MEASURE_KIND_LABEL[k]');
  });

  it('never runtime-imports @kku/db or the @kku/shared barrel in the panel', () => {
    expect(panel).not.toMatch(/^import \{[^}]*\} from '@kku\/db'/m);
    expect(panel).not.toMatch(/^import \{[^}]*\} from '@kku\/shared'/m);
  });
});

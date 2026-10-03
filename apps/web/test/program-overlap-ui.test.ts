import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OVERLAP_ACTION_LABEL,
  OVERLAP_ACTION_ORDER,
  OVERLAP_LAYERS,
  actionBadgeLabel,
  largestContainment,
  layerValue,
  nodeSublabel,
  overlapPairRows,
  overlapQueryString,
  shortProgrammeLabel,
  type OverlapCell,
} from '../app/education/program-overlap/types';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');
const DIR = 'app/education/program-overlap';
const page = read(`${DIR}/page.tsx`);
const client = read(`${DIR}/client.tsx`);
const sharedPair = read('src/components/overlap/pair-evidence.tsx');
const pairList = read('src/components/overlap/pair-list.tsx');
const surface = `${page}\n${client}`;
const cell = (over: Partial<OverlapCell> = {}): OverlapCell => ({
  a: 'a',
  b: 'b',
  pairId: 'p1',
  overlapIndex: 72,
  structure: 60,
  content: 75,
  outcome: 81,
  marketSimilarity: null,
  containmentAInB: 84,
  containmentBInA: 61,
  band: 'HIGH',
  primaryAction: 'CONSIDER_MERGE_OR_TRACK',
  languageVariant: false,
  courseLayers: 2,
  ...over,
});

describe('program overlap dashboard wiring', () => {
  it('is a tile on the Education hub, with its own thumbnail', () => {
    const hub = read('app/education/page.tsx');
    expect(hub).toContain("href: '/education/program-overlap'");
    expect(hub).toContain('Thumb: ProgramOverlapThumb');
    expect(read('app/education/thumbnails.tsx')).toMatch(/export function ProgramOverlapThumb\(/);
  });

  it('renders the overlap network from @kku/ui and the ranked pair list', () => {
    expect(client).toMatch(/import \{[^}]*\bOverlapNetwork\b[^}]*\} from '@kku\/ui'/);
    expect(client).toContain('<OverlapNetwork');
    expect(client).toContain('<OverlapPairList');
    expect(client).not.toContain('OverlapMatrix ');
  });

  it('filters the list to a selected programme with a visible clear chip', () => {
    expect(client).toContain('Filtered to');
    expect(client).toContain('onClick={() => selectNode(null)}');
  });

  it('labels every suggested action "for review" in the list', () => {
    expect(pairList).toContain('actionBadgeLabel(r.cell.primaryAction)');
    expect(pairList).toContain('LANGUAGE_VARIANT_LABEL');
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

  it('notes pairs with no course comparison on the pair panel (D9)', () => {
    expect(client).toContain('<EvidenceQualityNote evidence={ev} />');
    expect(client).toContain("nullText={hasNoCourseData(ev) ? 'Not scored' : undefined}");
    expect(client).toContain('Outcome — PLO alignment (context, not in the index)');
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

describe('pair list ranking', () => {
  const cells: OverlapCell[] = [
    cell({ pairId: 'p1', a: 'a', b: 'b', overlapIndex: 72, structure: 60, content: 84 }),
    cell({ pairId: 'p2', a: 'a', b: 'c', overlapIndex: 91, structure: 95, content: 87 }),
    cell({ pairId: 'p3', a: 'c', b: 'd', overlapIndex: 35, structure: 20, content: 50 }),
    cell({ pairId: 'p4', a: 'd', b: 'e', overlapIndex: 22, structure: 22, content: null }),
    // Not scored (D9): no course comparison, so never listed.
    cell({ pairId: 'p5', a: 'b', b: 'e', overlapIndex: null, structure: null, content: null, outcome: 100, courseLayers: 0 }),
  ];

  it('keeps scored pairs at or above the threshold, strongest first', () => {
    expect(overlapPairRows(cells, { layer: 'index', threshold: 30 }).map((r) => r.cell.pairId)).toEqual(['p2', 'p1', 'p3']);
  });

  it('ranks by the chosen measure', () => {
    expect(overlapPairRows(cells, { layer: 'content', threshold: 50 }).map((r) => r.cell.pairId)).toEqual(['p2', 'p1', 'p3']);
    expect(overlapPairRows(cells, { layer: 'structure', threshold: 50 }).map((r) => r.value)).toEqual([95, 60]);
  });

  it('filters to the pairs touching one programme', () => {
    expect(overlapPairRows(cells, { layer: 'index', threshold: 30, nodeId: 'c' }).map((r) => r.cell.pairId)).toEqual(['p2', 'p3']);
  });

  it('never lists a not-scored pair, even at threshold 0', () => {
    expect(overlapPairRows(cells, { layer: 'index', threshold: 0 }).map((r) => r.cell.pairId)).not.toContain('p5');
  });

  it('offers only the course measures (D9)', () => {
    expect(OVERLAP_LAYERS.map((l) => l.value)).toEqual(['index', 'structure', 'content']);
  });
});

describe('containment and node labels', () => {
  it('picks the larger containment direction', () => {
    expect(largestContainment({ containmentAInB: 84, containmentBInA: 61 })).toEqual({ inner: 'A', value: 84 });
    expect(largestContainment({ containmentAInB: 10, containmentBInA: 61 })).toEqual({ inner: 'B', value: 61 });
    expect(largestContainment({ containmentAInB: null, containmentBInA: 40 })).toEqual({ inner: 'B', value: 40 });
    expect(largestContainment({ containmentAInB: null, containmentBInA: null })).toBeNull();
  });

  it('shortens a degree name to its bracketed major', () => {
    expect(shortProgrammeLabel({ code: 'X', nameTh: 'วิทยาศาสตรบัณฑิต (ฟิสิกส์)', nameEn: null })).toBe('ฟิสิกส์');
    expect(shortProgrammeLabel({ code: 'X', nameTh: 'เภสัชศาสตรบัณฑิต', nameEn: null })).toBe('เภสัชศาสตรบัณฑิต');
    expect(shortProgrammeLabel({ code: 'X', nameTh: '', nameEn: 'Law' })).toBe('Law');
    expect(
      shortProgrammeLabel({ code: 'X', nameTh: 'หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเคมี', nameEn: null }),
    ).toBe('วิศวกรรมเคมี');
    expect(shortProgrammeLabel({ code: 'X', nameTh: 'ศิลปศาสตรบัณฑิต การระหว่างประเทศ', nameEn: null })).toBe('การระหว่างประเทศ');
    expect(
      shortProgrammeLabel({ code: 'X', nameTh: 'วิทยาศาสตรมหาบัณฑิต สาขาวิชา (เภสัชวิทยา)', nameEn: null }),
    ).toBe('เภสัชวิทยา');
    expect(shortProgrammeLabel({ code: 'X', nameTh: 'เศรษฐศาสตรบัณฑิต (นานาชาติ)', nameEn: null })).toBe('เศรษฐศาสตรบัณฑิต');
  });

  it('adds "Intl" to the faculty code for an international programme', () => {
    expect(nodeSublabel({ facultyCode: 'PHA', nameEn: 'Doctor of Pharmacy Program (International Program)' })).toBe('PHA · Intl');
    expect(nodeSublabel({ facultyCode: 'PHA', nameEn: 'Doctor of Pharmacy Program' })).toBe('PHA');
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
    expect(
      overlapQueryString({ level: 'BACHELOR', layer: 'index', facultyId: null, threshold: 30, node: null, pair: null }),
    ).toBe('');
    expect(
      overlapQueryString({ level: 'MASTER', layer: 'content', facultyId: 'f1', threshold: 50, node: 'n1', pair: 'p9' }),
    ).toBe('level=MASTER&layer=content&facultyId=f1&threshold=50&node=n1&pair=p9');
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

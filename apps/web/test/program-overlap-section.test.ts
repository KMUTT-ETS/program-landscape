import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { PairEvidence } from '@kku/db';

// Program Deep-Dive "Overlap" section (program-overlap.v1, spec §10.3, D6).
// Static markup, node environment: no jsdom here, so the expandable row is
// asserted by rendering its detail component directly.

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }),
}));
// The real module is 'use server' and reaches the API client at import time.
vi.mock('@/lib/actions/program-deep-dive', () => ({
  submitDisagreementAction: async () => ({ ok: true }),
  regenerateNarrativeAction: async () => ({ ok: false, message: 'not called' }),
}));

import {
  OVERLAP_RAIL_SECTION,
  OverlapSection,
  SiblingDetail,
  overlapHeadline,
  shouldShowOverlapSection,
  withOverlapSection,
} from '../app/programs/[id]/overlap-section';
import type { OverlapSibling, ProgramOverlapSection } from '../app/programs/[id]/types';
import { LIMITED_EVIDENCE_LABEL, orientEvidence } from '../src/components/overlap/labels';

const read = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8');

const evidence = (over: Partial<PairEvidence['coverage']> = {}): PairEvidence => ({
  sharedCourses: [{ code: 'SC101', credits: 3, nameTh: 'ฟิสิกส์' }],
  equivalentCourses: [
    { codeA: 'AA1', codeB: 'BB1', nameA: 'วิชาเอ', nameB: 'วิชาบี', credits: 3, similarity: 0.91, basis: 'name' },
  ],
  matchedPlos: [{ ordinalA: 1, ordinalB: 2, textA: 'PLO of A', textB: 'PLO of B', similarity: 0.88 }],
  unmatchedPlosA: ['only A'],
  unmatchedPlosB: ['only B 1', 'only B 2'],
  coverage: {
    majorCoursesA: 10,
    majorCoursesB: 20,
    embeddedA: 10,
    embeddedB: 20,
    describedA: 4,
    describedB: 8,
    descriptionMatches: 0,
    plosA: 5,
    plosB: 7,
    defaultedCredits: 0,
    layerCount: 3,
    limitedEvidence: false,
    uncorroborated: false,
    ...over,
  },
});

const sibling = (over: Partial<OverlapSibling> = {}): OverlapSibling => ({
  pairId: 'pair-1',
  sibling: {
    id: 'sib',
    code: 'KKU-SEQ-0002',
    nameTh: 'พี่น้อง',
    nameEn: 'Sibling',
    facultyId: 'f1',
    facultyCode: 'SC',
    facultyNameEn: 'Faculty of Science',
  },
  programIsA: true,
  structure: 40,
  content: 55,
  outcome: null,
  overlapIndex: 31,
  band: 'LOW',
  containmentInSibling: 84,
  siblingContainmentInProgramme: 40,
  sharedCredits: 3,
  equivCredits: 3,
  sharedStaff: 2,
  marketSimilarity: null,
  actions: ['COORDINATE_SHARED_COURSES'],
  primaryAction: 'COORDINATE_SHARED_COURSES',
  languageVariant: false,
  evidence: evidence(),
  recommendation: null,
  ...over,
});

const section = (siblings: OverlapSibling[]): ProgramOverlapSection => ({
  programId: 'me',
  methodologyVersion: 'program-overlap.v1',
  completedAt: '2026-10-03T08:00:00.000Z',
  siblings,
});

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(TooltipProvider, null, React.createElement(ProvenanceProvider, null, el)),
  );

describe('shouldShowOverlapSection (D6)', () => {
  it('hides the section when no run exists', () => {
    expect(shouldShowOverlapSection(null)).toBe(false);
    expect(shouldShowOverlapSection(undefined)).toBe(false);
  });

  it('hides the section when no sibling reaches 30', () => {
    expect(shouldShowOverlapSection(section([]))).toBe(false);
    expect(shouldShowOverlapSection(section([sibling({ overlapIndex: 29 })]))).toBe(false);
  });

  it('shows the section when one sibling reaches 30', () => {
    expect(shouldShowOverlapSection(section([sibling({ overlapIndex: 31 })]))).toBe(true);
    expect(shouldShowOverlapSection(section([sibling({ overlapIndex: 30 })]))).toBe(true);
  });
});

describe('rail entry and headline', () => {
  const base = [{ id: 'snapshot' }, { id: 'curriculum' }, { id: 'financials' }];

  it('inserts Overlap right after Curriculum only when shown', () => {
    const entry = { id: 'overlap' };
    expect(withOverlapSection(base, entry, false).map((s) => s.id)).toEqual(['snapshot', 'curriculum', 'financials']);
    expect(withOverlapSection(base, entry, true).map((s) => s.id)).toEqual([
      'snapshot',
      'curriculum',
      'overlap',
      'financials',
    ]);
    expect(OVERLAP_RAIL_SECTION.subs[0]?.href).toBe('#overlap-siblings');
  });

  it('headlines high-overlap siblings, else every overlapping programme', () => {
    expect(overlapHeadline(null)).toBeUndefined();
    expect(overlapHeadline(section([sibling({ band: 'HIGH', overlapIndex: 80 }), sibling({ band: 'HIGH', overlapIndex: 75 })]))).toEqual({
      count: 2,
      label: 'high-overlap siblings',
    });
    expect(overlapHeadline(section([sibling()]))).toEqual({ count: 1, label: 'overlapping programme' });
  });
});

describe('Deep-Dive wiring (source level)', () => {
  const client = read('app/programs/[id]/client.tsx');
  const page = read('app/programs/[id]/page.tsx');
  const overlapSrc = read('app/programs/[id]/overlap-section.tsx');
  const shared = read('src/components/overlap/pair-evidence.tsx');

  it('fetches the overlap endpoint in the page Promise.all', () => {
    expect(page).toContain('`/programs/${id}/overlap`');
    expect(page).toContain('overlap={overlapEnvelope?.data ?? null}');
  });

  it('adds the rail entry and renders the section only when shouldShowOverlapSection is true', () => {
    expect(client).toContain('const showOverlap = shouldShowOverlapSection(props.overlap);');
    expect(client).toContain('withOverlapSection(SECTIONS, OVERLAP_RAIL_SECTION, showOverlap)');
    expect(client).toMatch(/\{showOverlap && props\.overlap \? \(\s*<MacroGroup\s+id="overlap"/);
    // After Curriculum, before Financials.
    expect(client.indexOf('id="curriculum"')).toBeLessThan(client.indexOf('id="overlap"'));
    expect(client.indexOf('id="overlap"')).toBeLessThan(client.indexOf('id="financials"'));
  });

  it('carries provenance, freshness and the AI confidence badge', () => {
    expect(overlapSrc).toContain('<ProvenanceButton');
    expect(overlapSrc).toContain('<FreshnessBadge freshnessDate={data.completedAt}');
    expect(overlapSrc).toContain('<OverlapRecommendation');
    expect(shared).toContain('<ConfidenceBadge');
  });

  it('never runtime-imports @kku/db or the @kku/shared barrel', () => {
    for (const src of [overlapSrc, shared, client]) {
      expect(src).not.toMatch(/^import \{[^}]*\} from '@kku\/db'/m);
      expect(src).not.toMatch(/^import \{[^}]*\} from '@kku\/shared'/m);
    }
  });
});

describe('rendering', () => {
  it('renders the sibling row with link, containment and the for-review badge', () => {
    const html = render(
      React.createElement(OverlapSection, { data: section([sibling()]), meta: null, programCode: 'KKU-SEQ-0001' }),
    );
    expect(html).toContain('href="/programs/sib"');
    expect(html).toContain('this ⊂ sibling');
    expect(html).toContain('84 %');
    expect(html).toContain('Coordinate shared courses — for review');
    expect(html).not.toContain(LIMITED_EVIDENCE_LABEL);
  });

  it('shows the muted limited-evidence note on a limited sibling', () => {
    const limited = sibling({ evidence: evidence({ layerCount: 1, limitedEvidence: true }) });
    const row = render(
      React.createElement(OverlapSection, { data: section([limited]), meta: null, programCode: 'KKU-SEQ-0001' }),
    );
    expect(row).toContain(LIMITED_EVIDENCE_LABEL);
    const detail = render(
      React.createElement(SiblingDetail, { s: limited, programId: 'me', programCode: 'KKU-SEQ-0001' }),
    );
    expect(detail).toContain(LIMITED_EVIDENCE_LABEL);
    expect(detail).toContain('The band is capped at moderate');
  });

  it('renders the recommendation with confidence and reasoning in the expanded row', () => {
    const s = sibling({
      recommendation: {
        rationale: 'Coordinate the shared physics sequence.',
        distinctiveA: 'A is applied',
        distinctiveB: 'B is theoretical',
        nextSteps: ['Meet'],
        confidence: 0.8,
        disagreesWithAction: false,
        disagreementReason: null,
        promptVersion: 'program-overlap-recommendation.v1',
        aiInferenceId: 'inf-1',
        stale: false,
        createdAt: '2026-10-03T08:00:00.000Z',
      },
    });
    const html = render(React.createElement(SiblingDetail, { s, programId: 'me', programCode: 'KKU-SEQ-0001' }));
    expect(html).toContain('Coordinate the shared physics sequence.');
    expect(html).toContain('Show reasoning');
    expect(html).toContain('Disagree');
    expect(html).toContain('name match');
  });

  it('orients B-side evidence so A is always this programme', () => {
    const o = orientEvidence(evidence(), false);
    expect(o.equivalentCourses[0]).toMatchObject({ codeA: 'BB1', codeB: 'AA1', nameA: 'วิชาบี' });
    expect(o.unmatchedPlosA).toEqual(['only B 1', 'only B 2']);
    expect(o.coverage.plosA).toBe(7);
    expect(o.matchedPlos[0]).toMatchObject({ ordinalA: 2, textA: 'PLO of B' });
  });
});

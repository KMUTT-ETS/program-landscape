import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import {
  SELF_COMPETITION_EMPTY,
  SelfCompetitionPanel,
  worstBreach,
} from '../app/risks/self-competition-panel';
import type { SelfCompetitionRow } from '../app/risks/types';

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    React.createElement(TooltipProvider, null, React.createElement(ProvenanceProvider, null, el)),
  );

const ref = (id: string, code: string) => ({
  id,
  code,
  nameTh: `ชื่อ ${id}`,
  nameEn: null,
  facultyId: 'f1',
  facultyCode: 'SC',
  facultyNameEn: 'Faculty of Science',
});

const row: SelfCompetitionRow = {
  pairId: 'p1',
  level: 'BACHELOR',
  programA: ref('a', 'KKU-SEQ-0001'),
  programB: ref('b', 'KKU-SEQ-0002'),
  overlapIndex: 72.4,
  marketSimilarity: 61,
  languageVariant: false,
  primaryAction: 'CONSIDER_MERGE_OR_TRACK',
  intakeA: 52,
  intakeB: null,
  intakeEntryYearA: 2568,
  intakeEntryYearB: null,
  breaches: [
    { programId: 'a', indicatorSlug: 'curriculum_overlap_max', severity: 'WARN', value: 72, observedAt: '2026-10-03T00:00:00.000Z' },
    { programId: 'b', indicatorSlug: 'curriculum_overlap_max', severity: 'CRITICAL', value: 72, observedAt: '2026-10-03T00:00:00.000Z' },
  ],
  measureKinds: ['PROGRAM_MERGE'],
};

const meta = { freshnessDate: null, sources: [] };

describe('SelfCompetitionPanel', () => {
  it('shows the freshness of the answer, also when nothing is listed', () => {
    const fresh = { freshnessDate: '2026-10-02T05:00:00.000Z', sources: [] };
    expect(render(React.createElement(SelfCompetitionPanel, { rows: [row], meta: fresh }))).toContain('Updated 2026-10-02');
    expect(render(React.createElement(SelfCompetitionPanel, { rows: [], meta: fresh }))).toContain('Updated 2026-10-02');
  });

  it('renders the explicit empty state', () => {
    expect(render(React.createElement(SelfCompetitionPanel, { rows: [], meta }))).toContain(SELF_COMPETITION_EMPTY);
  });

  it('renders a pair with links, figures, intakes and measure badges', () => {
    const html = render(React.createElement(SelfCompetitionPanel, { rows: [row], meta }));
    expect(html).toContain('href="/risks/a"');
    expect(html).toContain('href="/programs/b"');
    expect(html).toContain('>72<');
    expect(html).toContain('>61<');
    expect(html).toContain('critical');
    expect(html).toContain('entry 2568');
    expect(html).toContain('no intake data');
    expect(html).toContain('Merge with another program');
  });

  it('says so when the endpoint is unreachable', () => {
    expect(render(React.createElement(SelfCompetitionPanel, { rows: null, meta: null }))).toContain('unavailable');
  });
});

describe('worstBreach', () => {
  it('takes the worst severity of one indicator across both sides', () => {
    expect(worstBreach(row.breaches, 'curriculum_overlap_max')).toBe('CRITICAL');
    expect(worstBreach(row.breaches, 'market_confusion_max')).toBeNull();
    expect(worstBreach(row.breaches.slice(0, 1), 'curriculum_overlap_max')).toBe('WARN');
  });
});

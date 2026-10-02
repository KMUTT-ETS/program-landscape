import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { StaffGrantsSummary } from '@kku/shared';
import { GrantsPanel, type GrantsPanelState } from '../app/profile/grants-panel';

const summary = (over: Partial<StaffGrantsSummary> = {}): StaffGrantsSummary => ({
  led: 1, coInvestigator: 1, active: 1,
  byType: { RESEARCH: 1, ACADEMIC_SERVICE: 1, CONSULTING: 0, OTHER: 0 },
  projects: [
    { sourceProposalId: 1, titleTh: 'โครงการหนึ่ง', titleEn: 'Project one', type: 'RESEARCH', role: 'LEAD', fiscalYearBe: 2569,
      startDate: '2025-10-01', endDate: '2026-09-30', funderName: 'วช.', budgetThb: 1500000, workflowStatus: 'x', teamSize: 3 },
  ],
  freshnessDate: '2026-10-02T04:00:00.000Z',
  ...over,
});

// FreshnessBadge and ProvenanceButton need the app-root providers to render.
const render = (state: GrantsPanelState, lang: 'th' | 'en' = 'en') =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ProvenanceProvider>
        <GrantsPanel state={state} lang={lang} />
      </ProvenanceProvider>
    </TooltipProvider>,
  );

describe('GrantsPanel', () => {
  it('shows KPIs and labels the budget as the project total', () => {
    const html = render(summary());
    expect(html).toContain('Led');
    expect(html).toContain('project total');
    expect(html).toContain('โครงการหนึ่ง');
    expect(html).toContain('฿1,500,000');
  });

  it('labels the budget in Thai too', () => {
    expect(render(summary(), 'th')).toContain('งบรวมโครงการ');
  });

  it('says plainly when the person is not linked, has no projects, or the read failed', () => {
    expect(render('unlinked')).toContain('link you to the grants system');
    expect(render(summary({ projects: [], led: 0, coInvestigator: 0, active: 0 }))).toContain('No external grants on record');
    expect(render('unavailable')).toContain('unavailable');
  });
});

describe('GrantsPanel stays owner-only and client-safe', () => {
  const read = (...p: string[]) => readFileSync(path.join(__dirname, '..', ...p), 'utf8');

  it('renders in profile-view only inside the !publicMode block', () => {
    const src = read('app', 'profile', 'profile-view.tsx');
    const at = src.indexOf('<GrantsPanel');
    expect(at).toBeGreaterThan(-1);
    const open = src.lastIndexOf('{!publicMode && profile.hasFacultyMemberRecord && (', at);
    expect(open).toBeGreaterThan(-1);
    // No other gate closes between the opening of that block and the panel.
    expect(src.slice(open, at)).not.toContain(')}');
    expect(read('app', 'p', '[slug]', 'page.tsx')).not.toContain('grants');
  });

  it('imports only types from @kku/shared', () => {
    const src = read('app', 'profile', 'grants-panel.tsx');
    for (const m of src.match(/^import[^;]*from '@kku\/shared[^']*';/gm) ?? []) expect(m).toMatch(/^import type\b/);
  });
});

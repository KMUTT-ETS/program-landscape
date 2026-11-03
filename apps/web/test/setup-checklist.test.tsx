import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupChecklistView, type SetupChecklistData } from '../app/admin/programs/[id]/setup-checklist';
import { DriverSourceMark } from '../src/components/data-source-mark';

const fixture: SetupChecklistData = {
  programId: 'p1',
  programCode: 'PRG-001',
  level: 'BACHELOR',
  generatedAt: '2026-11-03T00:00:00.000Z',
  summary: { ok: 1, empty: 1, notApplicable: 1, degraded: 1, ready: 3 },
  items: [
    { key: 'a', group: 'Students', title: 'Enrolment history', status: 'ok', note: null, waitingOn: [] },
    {
      key: 'b',
      group: 'Students',
      title: 'Admissions',
      status: 'empty',
      note: 'No rows yet',
      waitingOn: [{ kind: 'dataset', slug: 'admission-campaigns', label: 'Admission campaigns', href: '/admin/data-setup' }],
    },
    { key: 'c', group: 'Curriculum', title: 'Overlap', status: 'not-applicable', note: 'No sibling', waitingOn: [] },
    { key: 'd', group: 'Curriculum', title: 'Pedagogy', status: 'degraded', note: 'degraded: timeout', waitingOn: [] },
  ],
};

describe('SetupChecklistView', () => {
  const html = renderToStaticMarkup(<SetupChecklistView checklist={fixture} />);
  it('shows the summary', () => expect(html).toContain('3 of 4 ready'));
  it('renders groups', () => {
    expect(html).toContain('Students');
    expect(html).toContain('Curriculum');
  });
  it('renders status chips', () => {
    for (const t of ['OK', 'Missing', 'N/A', 'Degraded']) expect(html).toContain(t);
  });
  it('links waiting-on entries and shows notes', () => {
    expect(html).toContain('href="/admin/data-setup"');
    expect(html).toContain('Admission campaigns');
    expect(html).toContain('degraded: timeout');
  });
});

describe('grant award chip', () => {
  it('is neutral', () => {
    const h = renderToStaticMarkup(<DriverSourceMark label="external_grant_award" />);
    expect(h).toContain('External grants');
    expect(h).not.toContain('Research Services');
  });
});

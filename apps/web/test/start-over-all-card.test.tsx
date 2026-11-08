import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import { StartOverAllCard } from '../app/admin/data-setup/start-over-all-card';
import { startOverAllBlockedReason } from '../src/lib/import-panel-state';

// Same split as import-panel.test.tsx: no DOM here, so the gate is a pure
// function and the card is asserted through static markup.

const base = { confirmName: 'WDU', confirmAs: 'WDU', uploadCount: 3, busy: false };

describe('startOverAllBlockedReason', () => {
  it('allows the reset when the name matches and there are uploads', () => {
    expect(startOverAllBlockedReason(base)).toBeNull();
  });

  it('forgives surrounding spaces but not case', () => {
    expect(startOverAllBlockedReason({ ...base, confirmName: '  WDU ' })).toBeNull();
    expect(startOverAllBlockedReason({ ...base, confirmName: 'wdu' })).toMatch(/WDU/);
  });

  it('blocks when nothing has been uploaded', () => {
    expect(startOverAllBlockedReason({ ...base, uploadCount: 0 })).toMatch(/nothing/i);
  });

  it('blocks while a request is in flight', () => {
    expect(startOverAllBlockedReason({ ...base, busy: true })).not.toBeNull();
  });
});

describe('StartOverAllCard', () => {
  it('names what is kept, what goes, and the name to type', () => {
    const html = renderToStaticMarkup(
      <StartOverAllCard confirmAs="WDU" uploadCount={3} datasetCount={2} />,
    );
    expect(html).toContain('Start over: all data');
    expect(html).toContain('3 uploads across 2 datasets');
    expect(html).toContain('organization profile');
    expect(html).toContain('Type &quot;WDU&quot; to confirm');
  });
});

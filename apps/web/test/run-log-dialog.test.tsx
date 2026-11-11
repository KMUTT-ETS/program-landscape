import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RunLogLineDto } from '@kku/shared';

vi.mock('@/lib/actions/data-sources', () => ({ fetchRunLogAction: vi.fn() }));

import { RunLogDialog, keep, lineToText } from '../app/admin/data-sources/[slug]/run-log-dialog';

// No DOM in this workspace (see apps/web/vitest.config.ts): the closed
// trigger is asserted as static markup, the filter and copy format as pure
// functions. Polling is exercised in the browser drive.

const line = (seq: number, level: RunLogLineDto['level'], meta: unknown = null): RunLogLineDto => ({
  seq,
  ts: '2026-11-11T03:00:00.000Z',
  level,
  message: `m${seq}`,
  meta,
});

describe('RunLogDialog', () => {
  it('renders a labelled Log trigger and fetches nothing while closed', () => {
    const html = renderToStaticMarkup(<RunLogDialog runId="run-1" label="11/11/2026 10:00" />);
    expect(html).toContain('>Log<');
    expect(html).toContain('aria-label="View log for run at 11/11/2026 10:00"');
  });

  it('filters by level', () => {
    const lines = [line(1, 'INFO'), line(2, 'WARN'), line(3, 'ERROR')];
    expect(lines.filter((l) => keep(l, 'all')).map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(lines.filter((l) => keep(l, 'warn')).map((l) => l.seq)).toEqual([2, 3]);
    expect(lines.filter((l) => keep(l, 'error')).map((l) => l.seq)).toEqual([3]);
  });

  it('copies one line per entry with level and meta', () => {
    expect(lineToText(line(1, 'INFO'))).toBe('2026-11-11T03:00:00.000Z INFO  m1');
    expect(lineToText(line(2, 'WARN', { n: 2 }))).toBe('2026-11-11T03:00:00.000Z WARN  m2 {"n":2}');
  });
});

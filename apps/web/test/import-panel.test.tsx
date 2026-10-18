import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';

import { ImportPanel, type ImportPanelDataset } from '../app/admin/data-setup/raw/[dataset]/import-panel';
import {
  canStartOver,
  describeUploadOutcome,
  isOverridableShrinkRefusal,
} from '../src/lib/import-panel-state';

// Two halves, for the reason apps/web/vitest.config.ts gives: this workspace
// has no DOM, so what the operator SEES is asserted through static markup and
// what the controls DECIDE is asserted as pure functions.

function dataset(over: Partial<ImportPanelDataset> = {}): ImportPanelDataset {
  return {
    slug: 'faculties',
    title: 'Faculties',
    description: 'The faculties that own programmes.',
    sheetName: 'Faculties',
    keyColumns: ['Faculty Code'],
    rowCount: 12,
    batches: [],
    ...over,
  };
}

function markup(d: ImportPanelDataset): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ImportPanel dataset={d} />
    </TooltipProvider>,
  );
}

const liveBatch = {
  id: 'b1', filename: 'live.xlsx', rowCount: 3, fileSize: 2048, status: 'SUCCEEDED',
  createdAt: '2026-10-18T00:00:00.000Z', clearedAt: null, uploadedBy: 'Admin', errorMessage: null,
};
const clearedBatch = {
  id: 'b2', filename: 'old.xlsx', rowCount: 2, fileSize: 1024, status: 'CLEARED',
  createdAt: '2026-10-01T00:00:00.000Z', clearedAt: '2026-10-17T00:00:00.000Z',
  uploadedBy: 'Admin', errorMessage: null,
};

describe('ImportPanel — what the operator sees', () => {
  it('links the template download at the dataset endpoint', () => {
    expect(markup(dataset())).toContain('/api/v1/admin/imports/faculties/template');
  });

  it('says what rows are matched on, so re-uploading is predictable', () => {
    const html = markup(dataset());
    expect(html).toContain('Faculty Code');
    expect(html).toMatch(/updates matching rows/i);
  });

  it('tells an adopter what to do when nothing has been uploaded', () => {
    expect(markup(dataset())).toMatch(/Nothing uploaded yet/i);
  });

  it('lists an upload with its filename, rows and uploader', () => {
    const html = markup(dataset({ batches: [liveBatch] }));
    expect(html).toContain('live.xlsx');
    expect(html).toContain('Admin');
  });

  it('strikes through a cleared upload so it is not mistaken for live data', () => {
    const html = markup(dataset({ batches: [clearedBatch] }));
    const row = html.slice(html.indexOf('old.xlsx') - 200, html.indexOf('old.xlsx'));
    expect(row).toContain('line-through');
  });

  it('warns that start-over is only recoverable from the kept files', () => {
    const html = markup(dataset());
    expect(html).toMatch(/uploading them again/i);
    expect(html).toMatch(/cannot be undone/i);
  });

  it('names the exact text the operator must type', () => {
    expect(markup(dataset())).toContain('Type &quot;Faculties&quot; to confirm');
  });
});

describe('canStartOver', () => {
  const base = { confirmName: 'Faculties', title: 'Faculties', liveBatchCount: 1, busy: false };

  it('allows it when the title is reproduced exactly', () => {
    expect(canStartOver(base)).toBe(true);
  });

  it('forgives surrounding whitespace, which is a paste artefact', () => {
    expect(canStartOver({ ...base, confirmName: '  Faculties  ' })).toBe(true);
  });

  it('refuses the wrong case or a near miss', () => {
    expect(canStartOver({ ...base, confirmName: 'faculties' })).toBe(false);
    expect(canStartOver({ ...base, confirmName: 'Faculty' })).toBe(false);
    expect(canStartOver({ ...base, confirmName: '' })).toBe(false);
  });

  it('refuses when there is nothing to clear', () => {
    expect(canStartOver({ ...base, liveBatchCount: 0 })).toBe(false);
  });

  it('refuses while another request is in flight', () => {
    expect(canStartOver({ ...base, busy: true })).toBe(false);
  });
});

describe('isOverridableShrinkRefusal', () => {
  it('recognises the shrink guard, which an operator may legitimately override', () => {
    expect(isOverridableShrinkRefusal({
      message: '1 problem',
      errors: [{ row: 0, column: null, message: 'That looks like a partial export.' }],
    })).toBe(true);
  });

  it('does not offer an override for an ordinary cell error', () => {
    expect(isOverridableShrinkRefusal({
      message: '1 problem',
      errors: [{ row: 4, column: 'Faculty Code', message: 'This cell is required.' }],
    })).toBe(false);
  });

  it('does not offer an override for a privacy refusal', () => {
    expect(isOverridableShrinkRefusal({
      message: '1 problem',
      errors: [{ row: 7, column: 'Name', message: 'This cell looks like a personal identifier.' }],
    })).toBe(false);
  });
});

describe('describeUploadOutcome', () => {
  it('reports what changed', () => {
    expect(describeUploadOutcome({ deduplicated: false, rowCount: 5, inserted: 3, updated: 2 }))
      .toBe('Loaded 5 rows — 3 added, 2 updated.');
  });

  it('says plainly that a duplicate changed nothing', () => {
    expect(describeUploadOutcome({ deduplicated: true, rowCount: 5, inserted: 0, updated: 0 }))
      .toMatch(/nothing changed/i);
  });
});

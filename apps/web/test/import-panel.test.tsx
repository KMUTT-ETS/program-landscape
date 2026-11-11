import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';

// The panel calls useRouter() to refresh after a mutation. Static rendering
// has no app router, so stub it — the refresh itself is exercised in the
// browser drive, not here.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

import { ImportPanel, type ImportPanelDataset } from '../app/admin/data-setup/raw/[dataset]/import-panel';
import {
  canStartOver,
  describeUploadOutcome,
  isOverridableShrinkRefusal,
  startOverBlockedReason,
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


const apiBatch = {
  id: 'b3', filename: 'API: Registry classes', rowCount: 9, fileSize: 0, status: 'SUCCEEDED',
  createdAt: '2026-11-08T00:00:00.000Z', clearedAt: null, uploadedBy: null, errorMessage: null,
  via: 'api' as const, connector: 'Registry classes',
};

describe('ImportPanel — mixed sources', () => {
  it('shows the two-sources banner when sourceMix has two sources', () => {
    const html = markup(
      dataset({
        batches: [liveBatch, apiBatch],
        sourceMix: {
          sources: ['upload', 'api'],
          lastBy: { via: 'api', connector: 'Registry classes', at: '2026-11-08T00:00:00.000Z' },
          perScope: [
            { label: 'Semester 1/2025', via: 'api', connector: 'Registry classes', at: '2026-11-08T00:00:00.000Z' },
          ],
        },
      }),
    );
    expect(html).toContain('Two sources feed this dataset');
    expect(html).toContain('Uploads and the API connector &quot;Registry classes&quot; both load this dataset.');
    expect(html).toContain('Semester 1/2025');
    expect(html).toContain('Last loaded by');
  });

  it('shows no banner for a single source', () => {
    const html = markup(
      dataset({ batches: [liveBatch], sourceMix: { sources: ['upload'], lastBy: null, perScope: [] } }),
    );
    expect(html).not.toContain('Two sources feed this dataset');
  });

  it('labels API batches with the connector name in a Source column', () => {
    const html = markup(dataset({ batches: [liveBatch, apiBatch] }));
    expect(html).toContain('>Source<');
    expect(html).toContain('API: Registry classes');
    expect(html).toContain('>Upload<');
    // An API batch has no file, so no size.
    const row = html.slice(html.indexOf('API: Registry classes'));
    expect(row.slice(0, row.indexOf('</tr>'))).toContain('—');
  });

  it('start-over copy names API connector runs', () => {
    expect(markup(dataset())).toContain('Deletes the rows these uploads and API connector runs created.');
  });
});

describe('ImportPanel — what the operator sees', () => {
  it('links the template download at the dataset endpoint', () => {
    expect(markup(dataset())).toContain('/api/admin-imports/faculties/template');
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

describe('startOverBlockedReason', () => {
  const base = { confirmName: 'Faculties', title: 'Faculties', liveBatchCount: 1, busy: false };

  it('says nothing when the button is ready', () => {
    expect(startOverBlockedReason(base)).toBeNull();
  });

  it('explains the commonest case: there is nothing an import added', () => {
    // Reported from the live UI: the name was typed correctly and the button
    // stayed disabled with no reason given. The dataset had seeded rows but
    // no uploads, and start-over never touches rows it did not create.
    const reason = startOverBlockedReason({ ...base, liveBatchCount: 0, confirmName: '' });
    expect(reason).toMatch(/nothing to clear/i);
    expect(reason).toMatch(/connector|original setup/i);
  });

  it('keeps saying so even when the name is typed correctly', () => {
    expect(startOverBlockedReason({ ...base, liveBatchCount: 0 })).toMatch(/nothing to clear/i);
  });

  it('asks for the name when the box is empty', () => {
    expect(startOverBlockedReason({ ...base, confirmName: '' })).toMatch(/Type "Faculties"/);
  });

  it('says the name does not match, and that capitals count', () => {
    const reason = startOverBlockedReason({ ...base, confirmName: 'faculties' });
    expect(reason).toMatch(/does not match/i);
    expect(reason).toMatch(/capitals/i);
  });

  it('reports work in progress', () => {
    expect(startOverBlockedReason({ ...base, busy: true })).toMatch(/working/i);
  });

  it('agrees with canStartOver in every case', () => {
    for (const over of [
      {}, { liveBatchCount: 0 }, { confirmName: '' }, { confirmName: 'nope' }, { busy: true },
    ]) {
      const input = { ...base, ...over };
      expect(canStartOver(input)).toBe(startOverBlockedReason(input) === null);
    }
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

  it('does not offer an override when a real problem accompanies the shrink guard', () => {
    // Seen in the browser: a national-ID refusal and the shrink guard arrived
    // together, and the override button sat directly under the ID message —
    // promising something it cannot do, next to the one error that must never
    // look negotiable.
    expect(isOverridableShrinkRefusal({
      message: '2 problems',
      errors: [
        { row: 2, column: 'Name (Thai)', message: 'This cell looks like a personal identifier (national ID).' },
        { row: 0, column: null, message: 'That looks like a partial export.' },
      ],
    })).toBe(false);
  });

  it('offers no override when there are no errors at all', () => {
    expect(isOverridableShrinkRefusal({ message: '', errors: [] })).toBe(false);
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

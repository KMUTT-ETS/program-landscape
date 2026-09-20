import { describe, expect, it, vi } from 'vitest';

// Coverage for the multi-select + bulk-approve feature on /admin/job-fields.
//
// This package's vitest environment is `node` (see apps/web/vitest.config.ts)
// — no jsdom, no @testing-library — so a real checkbox click or button press
// cannot be simulated. Interactive logic (filtering, selection, the
// confirmation message, the bulk-approve call) therefore lives in exported
// pure functions in client.tsx and is tested directly here, the same pattern
// the Scholar panel's state machine and this page's own
// job-fields-admin-render.test.tsx already use. Only markup/text is asserted
// via renderToStaticMarkup.

const hooks = vi.hoisted(() => ({ callIndex: 0, forcedSelectedIds: null as Set<string> | null }));

// Hook order inside JobFieldsReview: fields(1) assignments(2) selected(3)
// busy(4) renaming(5) merging(6) mergeTarget(7) query(8) selectedIds(9).
// This mock forces index 9 only, so it can render as if some rows were
// already checked — every other hook passes straight through to React.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      hooks.callIndex += 1;
      if (hooks.forcedSelectedIds && hooks.callIndex === 9) {
        return [hooks.forcedSelectedIds, () => {}];
      }
      return actual.useState(initial as never);
    },
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';
import {
  JobFieldsReview,
  buildBulkApproveConfirmation,
  claimableProgramIdsByField,
  filterJobFields,
  isAllVisibleSelected,
  nextSelectionAfterSelectAllToggle,
  runBulkApprove,
  summarizeSelection,
} from '../app/admin/job-fields/client';
import type { FieldSynonymSourceDto, JobFieldRowDto, ProgramJobFieldRowDto } from '../app/admin/job-fields/client';

const MAX = 15; // mirrors MAX_PROGRAMMES_PER_FIELD (packages/db/src/jobthai-bridge.ts) for these tests only

// Real field ids are cuids (25 chars, 'c' + 24 lowercase alnum) — used here,
// as in job-fields-admin-synonym-sources.test.tsx, so the "no raw cuid on
// screen" assertion below is meaningful rather than accidental.
const narrowField: JobFieldRowDto = {
  id: 'cnr1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'narrow-field',
  nameTh: 'สาขาแคบ',
  nameEn: 'Narrow Field',
  synonyms: ['แคบ'],
  mentionCount: 40,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 3,
  updatedAt: '2026-09-20T00:00:00Z',
};
const broadField: JobFieldRowDto = {
  id: 'cbr1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'broad-field',
  nameTh: 'สาขากว้าง',
  nameEn: 'Broad Field',
  synonyms: ['กว้าง'],
  mentionCount: 900,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 16,
  updatedAt: '2026-09-20T00:00:00Z',
};
const govField: JobFieldRowDto = {
  id: 'cgv3a2b3c4d5e6f7g8h9i0j1k',
  slug: 'gov-only-field',
  nameTh: 'สาขารัฐ',
  nameEn: 'Gov Only Field',
  synonyms: ['รัฐ'],
  mentionCount: 10,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 1,
  updatedAt: '2026-09-20T00:00:00Z',
};
const approvedField: JobFieldRowDto = {
  id: 'cap3a2b3c4d5e6f7g8h9i0j1k',
  slug: 'already-approved',
  nameTh: 'อนุมัติแล้ว',
  nameEn: 'Already Approved',
  synonyms: ['อนุมัติ'],
  mentionCount: 5,
  reviewStatus: 'APPROVED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 3,
  updatedAt: '2026-09-20T00:00:00Z',
};

const allFields = [narrowField, broadField, govField, approvedField];

const govSources: FieldSynonymSourceDto[] = [{ fieldId: govField.id, synonym: 'รัฐ', sources: ['job-108'] }];

function assignment(
  n: number,
  fieldId: string,
  programId: string,
  reviewStatus: ProgramJobFieldRowDto['reviewStatus'] = 'PROPOSED',
): ProgramJobFieldRowDto {
  return {
    id: `a${n}`,
    programId,
    programCode: `KKU-SEQ-${String(n).padStart(4, '0')}`,
    programNameTh: `โปรแกรม ${n}`,
    programNameEn: `Programme ${n}`,
    programLevel: 'BACHELOR',
    fieldId,
    fieldSlug: 'x',
    source: 'rule',
    confidence: null,
    reviewStatus,
  };
}

// narrowField claims {p1, p2} (2 programmes, under the cap).
// broadField claims {p2, p3, ..., p17} (16 programmes, over the cap) —
// p2 overlaps narrowField, so the UNION across both is 17, not 2 + 16 = 18.
// One extra REJECTED row on narrowField (p99) must NOT count toward its claim.
const assignments: ProgramJobFieldRowDto[] = [
  assignment(1, narrowField.id, 'p1'),
  assignment(2, narrowField.id, 'p2'),
  assignment(99, narrowField.id, 'p99', 'REJECTED'),
  ...Array.from({ length: 16 }, (_, i) => assignment(100 + i, broadField.id, `p${i + 2}`)), // p2..p17
];

describe('filterJobFields', () => {
  it('returns every field, unfiltered, for an empty or whitespace-only query', () => {
    expect(filterJobFields(allFields, '')).toEqual(allFields);
    expect(filterJobFields(allFields, '   ')).toEqual(allFields);
  });
  it('matches by English name, case-insensitively', () => {
    expect(filterJobFields(allFields, 'narrow')).toEqual([narrowField]);
    expect(filterJobFields(allFields, 'NARROW')).toEqual([narrowField]);
  });
  it('matches by Thai name, slug, and synonym', () => {
    expect(filterJobFields(allFields, 'สาขากว้าง')).toEqual([broadField]);
    expect(filterJobFields(allFields, 'gov-only-field')).toEqual([govField]);
    expect(filterJobFields(allFields, 'อนุมัติ')).toEqual([approvedField]);
  });
  it('returns nothing when no field matches', () => {
    expect(filterJobFields(allFields, 'no such field anywhere')).toEqual([]);
  });
});

describe('claimableProgramIdsByField', () => {
  const byField = claimableProgramIdsByField(assignments);
  it('excludes a REJECTED assignment from the claimable set', () => {
    expect(byField.get(narrowField.id)).toEqual(new Set(['p1', 'p2']));
  });
  it('includes PROPOSED assignments', () => {
    expect(byField.get(broadField.id)?.size).toBe(16);
  });
  it('a field with no assignment rows at all gets no entry', () => {
    expect(byField.get(govField.id)).toBeUndefined();
  });
});

describe('summarizeSelection — select-all-only-visible safety', () => {
  const claimable = claimableProgramIdsByField(assignments);
  const sourcesByField = new Map([[govField.id, govSources]]);

  it('an id outside the currently-visible selectable list contributes nothing', () => {
    // Simulates a filter having narrowed the view: only narrowField is
    // "visible", but selectedIds still carries broadField's id from before
    // the filter changed (or from a row that has since been approved).
    // A selection built from this must not silently include broadField.
    const selection = summarizeSelection(
      new Set([narrowField.id, broadField.id]),
      [narrowField], // only this field is currently visible + selectable
      claimable,
      sourcesByField,
      MAX,
    );
    expect(selection.ids).toEqual([narrowField.id]);
    expect(selection.fieldCount).toBe(1);
    expect(selection.programmeCount).toBe(2); // narrowField's own {p1, p2} only
  });

  it('an APPROVED field can never appear even if its id is in selectedIds', () => {
    // approvedField is never in visibleSelectableFields (the caller already
    // filters by reviewStatus !== 'APPROVED'), so this asserts the same
    // safety property one level up, at the boundary the component enforces.
    const selection = summarizeSelection(
      new Set([approvedField.id]),
      [narrowField, broadField, govField], // approvedField deliberately excluded
      claimable,
      sourcesByField,
      MAX,
    );
    expect(selection.fieldCount).toBe(0);
    expect(selection.ids).toEqual([]);
  });

  it('unions programme ids across fields rather than summing them', () => {
    const selection = summarizeSelection(
      new Set([narrowField.id, broadField.id]),
      [narrowField, broadField],
      claimable,
      sourcesByField,
      MAX,
    );
    expect(selection.fieldCount).toBe(2);
    // {p1, p2} ∪ {p2..p17} = 17 distinct, not 2 + 16 = 18.
    expect(selection.programmeCount).toBe(17);
  });

  it('flags a field whose claimable count exceeds the cap', () => {
    const selection = summarizeSelection(new Set([broadField.id]), [broadField], claimable, sourcesByField, MAX);
    expect(selection.overCapFieldCount).toBe(1);
  });

  it('does not flag a field at or under the cap', () => {
    const selection = summarizeSelection(new Set([narrowField.id]), [narrowField], claimable, sourcesByField, MAX);
    expect(selection.overCapFieldCount).toBe(0);
  });

  it('counts a field whose synonyms are entirely government-sourced', () => {
    const selection = summarizeSelection(new Set([govField.id]), [govField], claimable, sourcesByField, MAX);
    expect(selection.governmentOnlyFieldCount).toBe(1);
  });

  it('with no cap supplied, never flags anything as over cap', () => {
    const selection = summarizeSelection(new Set([broadField.id]), [broadField], claimable, sourcesByField, undefined);
    expect(selection.overCapFieldCount).toBe(0);
  });

  it('an empty selection summarises to all zeros', () => {
    const selection = summarizeSelection(new Set(), [narrowField, broadField], claimable, sourcesByField, MAX);
    expect(selection).toEqual({ ids: [], fieldCount: 0, programmeCount: 0, overCapFieldCount: 0, governmentOnlyFieldCount: 0 });
  });
});

describe('isAllVisibleSelected / nextSelectionAfterSelectAllToggle', () => {
  it('is false when nothing is selected, and true once every visible field is', () => {
    expect(isAllVisibleSelected(new Set(), [narrowField, broadField])).toBe(false);
    expect(isAllVisibleSelected(new Set([narrowField.id]), [narrowField, broadField])).toBe(false);
    expect(isAllVisibleSelected(new Set([narrowField.id, broadField.id]), [narrowField, broadField])).toBe(true);
  });
  it('is false for an empty visible list (nothing to select)', () => {
    expect(isAllVisibleSelected(new Set(), [])).toBe(false);
  });
  it('selects every visible field when not all are selected yet', () => {
    const next = nextSelectionAfterSelectAllToggle(new Set(), [narrowField, broadField]);
    expect(next).toEqual(new Set([narrowField.id, broadField.id]));
  });
  it('deselects only the visible fields when all are already selected — a filtered-out selection survives', () => {
    const next = nextSelectionAfterSelectAllToggle(
      new Set([narrowField.id, broadField.id, govField.id]),
      [narrowField, broadField], // govField is not currently visible
    );
    expect(next).toEqual(new Set([govField.id]));
  });
});

describe('buildBulkApproveConfirmation', () => {
  it('names the field count and the distinct programme count', () => {
    const selection = { ids: [narrowField.id, broadField.id], fieldCount: 2, programmeCount: 17, overCapFieldCount: 0, governmentOnlyFieldCount: 0 };
    const message = buildBulkApproveConfirmation(selection, MAX);
    expect(message).toContain('Approve 2 fields?');
    expect(message).toContain('Together they will claim 17 distinct programmes once approved.');
  });
  it('warns by name when a selected field is over the cap', () => {
    const selection = { ids: [broadField.id], fieldCount: 1, programmeCount: 16, overCapFieldCount: 1, governmentOnlyFieldCount: 0 };
    const message = buildBulkApproveConfirmation(selection, MAX);
    expect(message).toMatch(/1 of the selected fields claims more than 15 programmes and will be excluded/);
    expect(message).toContain('excluded from the JobThai bridge');
  });
  it('warns by name when a selected field rests only on government text', () => {
    const selection = { ids: [govField.id], fieldCount: 1, programmeCount: 0, overCapFieldCount: 0, governmentOnlyFieldCount: 1 };
    const message = buildBulkApproveConfirmation(selection, MAX);
    expect(message).toMatch(/1 of the selected fields rests entirely on government announcement text/);
  });
  it('always ends with the repository\'s own guidance, verbatim', () => {
    const selection = { ids: [narrowField.id], fieldCount: 1, programmeCount: 2, overCapFieldCount: 0, governmentOnlyFieldCount: 0 };
    const message = buildBulkApproveConfirmation(selection, MAX);
    expect(message).toContain(
      'Approve narrow fields first. A broad field concentrates thousands of unrelated adverts onto a handful of programmes.',
    );
  });
});

describe('runBulkApprove', () => {
  it('confirms, then posts exactly once with every selected id', async () => {
    const post = vi.fn(async () => true);
    const confirm = vi.fn(() => true);
    const selection = { ids: [narrowField.id, broadField.id, govField.id], fieldCount: 3, programmeCount: 19, overCapFieldCount: 1, governmentOnlyFieldCount: 1 };

    const ok = await runBulkApprove(selection, MAX, { confirm, post });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([narrowField.id, broadField.id, govField.id]);
    expect(ok).toBe(true);
  });
  it('never posts when the confirmation is declined', async () => {
    const post = vi.fn(async () => true);
    const selection = { ids: [narrowField.id], fieldCount: 1, programmeCount: 2, overCapFieldCount: 0, governmentOnlyFieldCount: 0 };

    const ok = await runBulkApprove(selection, MAX, { confirm: () => false, post });

    expect(post).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
  it('never confirms or posts for an empty selection', async () => {
    const post = vi.fn(async () => true);
    const confirm = vi.fn(() => true);
    const selection = { ids: [], fieldCount: 0, programmeCount: 0, overCapFieldCount: 0, governmentOnlyFieldCount: 0 };

    const ok = await runBulkApprove(selection, MAX, { confirm, post });

    expect(confirm).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});

// ── Render-level wiring ──────────────────────────────────────────────────

function render(forcedSelectedIds: Set<string> | null = null): string {
  hooks.callIndex = 0;
  hooks.forcedSelectedIds = forcedSelectedIds;
  try {
    return renderToStaticMarkup(
      <TooltipProvider>
        <JobFieldsReview fields={allFields} assignments={assignments} synonymSources={govSources} maxProgrammesPerField={MAX} />
      </TooltipProvider>,
    );
  } finally {
    hooks.forcedSelectedIds = null;
  }
}

const html = render();
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('JobFieldsReview — bulk-select markup', () => {
  it('offers a checkbox for every non-approved field, and none for the approved one', () => {
    const count = (html.match(/data-action="select-field"/g) ?? []).length;
    expect(count).toBe(3); // narrowField, broadField, govField — not approvedField
  });
  it('offers a select-all control', () => {
    expect(html).toContain('data-action="select-all-fields"');
  });
  it('shows the per-field claimable programme count for every non-approved field', () => {
    expect(text).toMatch(/Would claim 2 programmes if approved/);
    expect(text).toMatch(/Would claim 16 programmes if approved/);
  });
  it('flags the over-cap field with a visible warning', () => {
    expect(html).toContain('data-testid="over-cap-warning"');
    expect(text).toMatch(/This field would claim 16 programmes, over the 15-programme cap/);
  });
  it('does not flag the under-cap field', () => {
    const count = (html.match(/data-testid="over-cap-warning"/g) ?? []).length;
    expect(count).toBe(1);
  });
  it('shows no bulk-approve action when nothing is selected', () => {
    expect(html).not.toContain('data-testid="selection-summary"');
    expect(html).not.toContain('data-action="bulk-approve-fields"');
  });
});

describe('JobFieldsReview — bulk-select markup with a forced selection', () => {
  const selectedHtml = render(new Set([narrowField.id, broadField.id]));
  const selectedText = selectedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('shows the aggregate selection summary and the bulk-approve button', () => {
    expect(selectedHtml).toContain('data-testid="selection-summary"');
    expect(selectedText).toMatch(/2 fields selected · 17 programmes/);
    expect(selectedHtml).toContain('data-action="bulk-approve-fields"');
    expect(selectedText).toMatch(/Approve 2 fields/);
  });
});

describe('JobFieldsReview — no raw id reaches the screen', () => {
  it('the visible text never contains a bare cuid', () => {
    expect(text).not.toMatch(/\bc[a-z0-9]{24}\b/);
  });
  it('none of the fixture field ids literally appear in the visible text', () => {
    for (const f of allFields) expect(text).not.toContain(f.id);
  });
});

import { describe, expect, it, vi } from 'vitest';

// Coverage for the assignment-level multi-select + bulk-approve feature on
// /admin/job-fields — the programme-assignment sibling of
// job-fields-admin-bulk-approve.test.tsx's field-level feature.
//
// Same rationale as that file: this package's vitest environment is `node`
// (apps/web/vitest.config.ts) — no jsdom, no @testing-library — so interactive
// logic lives in exported pure functions in client.tsx and is tested directly
// here; only markup/text is asserted via renderToStaticMarkup.
//
// The central property under test is SCOPING: an assignment selected while
// one field is on screen must never leak into a bulk-approve submitted for a
// different field. summarizeAssignmentSelection enforces this by intersecting
// the selected-id Set against `visibleSelectableAssignments`, which the
// component always passes as the CURRENTLY DISPLAYED field's PROPOSED rows
// only (apps/web/app/admin/job-fields/client.tsx: selectableSelectedAssignments).

const hooks = vi.hoisted(() => ({ callIndex: 0, forcedAssignmentSelectedIds: null as Set<string> | null }));

// Hook order inside JobFieldsReview: fields(1) assignments(2) selected(3)
// busy(4) renaming(5) merging(6) mergeTarget(7) query(8) selectedIds(9)
// assignmentSelectedIds(10). This mock forces index 10 only, so it can render
// as if some assignment rows were already checked — every other hook passes
// straight through to React. Mirrors job-fields-admin-bulk-approve.test.tsx's
// approach for index 9.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      hooks.callIndex += 1;
      if (hooks.forcedAssignmentSelectedIds && hooks.callIndex === 10) {
        return [hooks.forcedAssignmentSelectedIds, () => {}];
      }
      return actual.useState(initial as never);
    },
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';
import {
  JobFieldsReview,
  buildBulkApproveAssignmentsConfirmation,
  isAllVisibleAssignmentsSelected,
  nextAssignmentSelectionAfterSelectAllToggle,
  runBulkApproveAssignments,
  summarizeAssignmentSelection,
} from '../app/admin/job-fields/client';
import type { JobFieldRowDto, ProgramJobFieldRowDto } from '../app/admin/job-fields/client';

// Real ids are cuids (25 chars, 'c' + 24 lowercase alnum) — used here so the
// "no raw cuid on screen" assertion below is meaningful.
const fieldA: JobFieldRowDto = {
  id: 'cfa1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'field-a',
  nameTh: 'สาขาเอ',
  nameEn: 'Field A',
  synonyms: ['เอ'],
  mentionCount: 100,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 3,
  updatedAt: '2026-09-20T00:00:00Z',
};
const fieldB: JobFieldRowDto = {
  id: 'cfb1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'field-b',
  nameTh: 'สาขาบี',
  nameEn: 'Field B',
  synonyms: ['บี'],
  mentionCount: 50,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 2,
  updatedAt: '2026-09-20T00:00:00Z',
};
const fields: JobFieldRowDto[] = [fieldA, fieldB];

function assignment(
  n: number,
  fieldId: string,
  source: string,
  confidence: number | null,
  reviewStatus: ProgramJobFieldRowDto['reviewStatus'] = 'PROPOSED',
): ProgramJobFieldRowDto {
  // 25 chars total: 'c' + 3-char n-discriminator + a fixed 21-char tail —
  // matches the shape real cuids have (see job-fields-admin-bulk-approve.test.tsx).
  return {
    id: `c` + `a${String(n).padStart(2, '0')}` + `a2b3c4d5e6f7g8h9i0j1k`,
    programId: `p${n}`,
    programCode: `KKU-SEQ-${String(n).padStart(4, '0')}`,
    programNameTh: `โปรแกรม ${n}`,
    programNameEn: `Programme ${n}`,
    programLevel: 'BACHELOR',
    fieldId,
    fieldSlug: fieldId === fieldA.id ? 'field-a' : 'field-b',
    source,
    confidence,
    reviewStatus,
  };
}

// fieldA: 2 PROPOSED rule + 1 PROPOSED ai + 1 already-APPROVED + 1 REJECTED.
// fieldB: 1 PROPOSED rule — disjoint programme/assignment ids from fieldA.
const a1 = assignment(1, fieldA.id, 'rule', null);
const a2 = assignment(2, fieldA.id, 'rule', null);
const a3 = assignment(3, fieldA.id, 'ai', 0.82);
const a4 = assignment(4, fieldA.id, 'rule', null, 'APPROVED');
const a5 = assignment(5, fieldA.id, 'rule', null, 'REJECTED');
const b1 = assignment(11, fieldB.id, 'rule', null);

const fieldAAssignments = [a1, a2, a3, a4, a5];
const fieldBAssignments = [b1];
const allAssignments = [...fieldAAssignments, ...fieldBAssignments];

describe('summarizeAssignmentSelection — scoping', () => {
  it('selects only PROPOSED rows visible for the field on screen', () => {
    const visible = fieldAAssignments.filter((a) => a.reviewStatus === 'PROPOSED'); // a1, a2, a3
    const selection = summarizeAssignmentSelection(new Set([a1.id, a2.id, a3.id]), visible);
    expect(selection.ids.sort()).toEqual([a1.id, a2.id, a3.id].sort());
    expect(selection.count).toBe(3);
  });

  it('an id from a DIFFERENT field cannot enter the submitted list', () => {
    // Simulates: the reviewer selected a1 while fieldA was on screen, then
    // switched to fieldB. The component now passes fieldB's visible list —
    // a1 must not survive that intersection.
    const visibleForFieldB = fieldBAssignments.filter((a) => a.reviewStatus === 'PROPOSED'); // b1 only
    const selection = summarizeAssignmentSelection(new Set([a1.id, b1.id]), visibleForFieldB);
    expect(selection.ids).toEqual([b1.id]);
    expect(selection.count).toBe(1);
    expect(selection.ids).not.toContain(a1.id);
  });

  it('an already-APPROVED assignment can never be selected, even if its id is in the selected set', () => {
    // The component's own filter already excludes APPROVED rows from
    // visibleSelectableAssignments — this asserts the same safety property
    // one level up, at the boundary summarizeAssignmentSelection enforces.
    const visible = fieldAAssignments.filter((a) => a.reviewStatus === 'PROPOSED'); // does not include a4
    const selection = summarizeAssignmentSelection(new Set([a4.id]), visible);
    expect(selection.count).toBe(0);
    expect(selection.ids).toEqual([]);
  });

  it('a REJECTED assignment is also never selected in bulk', () => {
    const visible = fieldAAssignments.filter((a) => a.reviewStatus === 'PROPOSED'); // does not include a5
    const selection = summarizeAssignmentSelection(new Set([a5.id]), visible);
    expect(selection.count).toBe(0);
  });

  it('computes the correct rule/AI split', () => {
    const visible = fieldAAssignments.filter((a) => a.reviewStatus === 'PROPOSED'); // a1(rule) a2(rule) a3(ai)
    const selection = summarizeAssignmentSelection(new Set([a1.id, a2.id, a3.id]), visible);
    expect(selection.ruleCount).toBe(2);
    expect(selection.aiCount).toBe(1);
  });

  it('an empty selection summarises to all zeros', () => {
    const visible = fieldAAssignments.filter((a) => a.reviewStatus === 'PROPOSED');
    expect(summarizeAssignmentSelection(new Set(), visible)).toEqual({ ids: [], count: 0, ruleCount: 0, aiCount: 0 });
  });
});

describe('isAllVisibleAssignmentsSelected / nextAssignmentSelectionAfterSelectAllToggle', () => {
  const visible = [a1, a2, a3]; // fieldA's PROPOSED rows

  it('is false when nothing selected, true once every visible row is', () => {
    expect(isAllVisibleAssignmentsSelected(new Set(), visible)).toBe(false);
    expect(isAllVisibleAssignmentsSelected(new Set([a1.id]), visible)).toBe(false);
    expect(isAllVisibleAssignmentsSelected(new Set([a1.id, a2.id, a3.id]), visible)).toBe(true);
  });

  it('is false for an empty visible list', () => {
    expect(isAllVisibleAssignmentsSelected(new Set(), [])).toBe(false);
  });

  it('select-all only touches the visible field — a selection for another field survives untouched', () => {
    const next = nextAssignmentSelectionAfterSelectAllToggle(new Set([b1.id]), visible);
    expect(next).toEqual(new Set([b1.id, a1.id, a2.id, a3.id]));
  });

  it('deselect-all only removes the visible field\'s ids, leaving another field\'s selection intact', () => {
    const next = nextAssignmentSelectionAfterSelectAllToggle(new Set([a1.id, a2.id, a3.id, b1.id]), visible);
    expect(next).toEqual(new Set([b1.id]));
  });
});

describe('buildBulkApproveAssignmentsConfirmation', () => {
  it('names the total and the rule/AI split for a rule-only selection', () => {
    const selection = { ids: [a1.id, a2.id], count: 2, ruleCount: 2, aiCount: 0 };
    const message = buildBulkApproveAssignmentsConfirmation(selection);
    expect(message).toContain('Approve 2 assignments?');
    expect(message).toContain('2 rule-matched.');
    expect(message).not.toMatch(/AI field-matching model/);
  });

  it('names the AI count explicitly for a mixed rule/AI selection', () => {
    const selection = { ids: [a1.id, a3.id], count: 2, ruleCount: 1, aiCount: 1 };
    const message = buildBulkApproveAssignmentsConfirmation(selection);
    expect(message).toBe(
      'Approve 2 assignments?\n1 rule-matched, 1 AI-suggested.\n1 of these came from the AI field-matching model, not a name match — review before approving in bulk.',
    );
  });

  it('an AI-only selection still calls out the AI count', () => {
    const selection = { ids: [a3.id], count: 1, ruleCount: 0, aiCount: 1 };
    const message = buildBulkApproveAssignmentsConfirmation(selection);
    expect(message).toMatch(/1 AI-suggested/);
    expect(message).toMatch(/1 of these came from the AI field-matching model/);
  });
});

describe('runBulkApproveAssignments', () => {
  it('confirms, then posts exactly once with every selected id', async () => {
    const post = vi.fn(async () => true);
    const confirm = vi.fn(() => true);
    const selection = { ids: [a1.id, a3.id], count: 2, ruleCount: 1, aiCount: 1 };

    const ok = await runBulkApproveAssignments(selection, { confirm, post });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith([a1.id, a3.id]);
    expect(ok).toBe(true);
  });

  it('never posts when the confirmation is declined', async () => {
    const post = vi.fn(async () => true);
    const selection = { ids: [a1.id], count: 1, ruleCount: 1, aiCount: 0 };

    const ok = await runBulkApproveAssignments(selection, { confirm: () => false, post });

    expect(post).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('never confirms or posts for an empty selection', async () => {
    const post = vi.fn(async () => true);
    const confirm = vi.fn(() => true);
    const selection = { ids: [], count: 0, ruleCount: 0, aiCount: 0 };

    const ok = await runBulkApproveAssignments(selection, { confirm, post });

    expect(confirm).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });
});

// ── Render-level wiring ──────────────────────────────────────────────────

function render(forcedAssignmentSelectedIds: Set<string> | null = null): string {
  hooks.callIndex = 0;
  hooks.forcedAssignmentSelectedIds = forcedAssignmentSelectedIds;
  try {
    return renderToStaticMarkup(
      <TooltipProvider>
        <JobFieldsReview fields={fields} assignments={allAssignments} />
      </TooltipProvider>,
    );
  } finally {
    hooks.forcedAssignmentSelectedIds = null;
  }
}

// Default render: `selected` defaults to fields[0].id (fieldA), so the
// right-hand panel shows fieldA's 5 assignment rows.
const html = render();
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('JobFieldsReview — assignment bulk-select markup', () => {
  it('offers a checkbox for every PROPOSED assignment of the selected field, and none for APPROVED/REJECTED', () => {
    const count = (html.match(/data-action="select-assignment"/g) ?? []).length;
    expect(count).toBe(3); // a1, a2, a3 — not a4 (APPROVED) or a5 (REJECTED)
  });

  it('offers a select-all control for the field\'s assignments', () => {
    expect(html).toContain('data-action="select-all-assignments"');
  });

  it('shows source and confidence per row', () => {
    expect(text).toMatch(/rule/);
    expect(text).toMatch(/ai · 82 %/);
  });

  it('shows no bulk-approve action when nothing is selected', () => {
    expect(html).not.toContain('data-testid="assignment-selection-summary"');
    expect(html).not.toContain('data-action="bulk-approve-assignments"');
  });
});

describe('JobFieldsReview — assignment bulk-select markup with a forced selection', () => {
  const selectedHtml = render(new Set([a1.id, a3.id]));
  const selectedText = selectedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('shows the rule/AI split in the selection summary and the bulk-approve button', () => {
    expect(selectedHtml).toContain('data-testid="assignment-selection-summary"');
    expect(selectedText).toMatch(/2 assignments selected \(1 rule, 1 AI\)/);
    expect(selectedHtml).toContain('data-action="bulk-approve-assignments"');
    expect(selectedText).toMatch(/Approve 2 assignments/);
  });
});

describe('JobFieldsReview — no raw id reaches the screen', () => {
  it('the visible text never contains a bare cuid', () => {
    expect(text).not.toMatch(/\bc[a-z0-9]{24}\b/);
  });
  it('none of the fixture assignment ids literally appear in the visible text', () => {
    for (const a of allAssignments) expect(text).not.toContain(a.id);
  });
  it('none of the fixture field ids literally appear in the visible text', () => {
    for (const f of fields) expect(text).not.toContain(f.id);
  });
});

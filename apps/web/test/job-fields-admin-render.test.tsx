import { describe, expect, it, vi } from 'vitest';

// JobFieldsReview only mounts its rename form and merge picker once the
// user opens them (the `renaming` / `merging` state), and this package's
// vitest environment is `node` — no jsdom, no @testing-library/react (see
// apps/web/vitest.config.ts) — so a real click can't be simulated to reach
// that markup. Wrapping `react`'s `useState` lets one render force those two
// hooks open for a given field id while every other hook (and every other
// test's render) passes straight through to the real implementation.
//
// Hook order inside JobFieldsReview is: fields(1) assignments(2) selected(3)
// busy(4) renaming(5) merging(6) mergeTarget(7). Nothing else in this render
// tree (TooltipProvider/Button/Badge/Card) calls useState — confirmed by
// inspection of packages/ui — so the call index is stable. If client.tsx's
// hook order ever changes, update the indices below.
const hooks = vi.hoisted(() => ({ callIndex: 0, forceOpenId: null as string | null }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      hooks.callIndex += 1;
      if (hooks.forceOpenId) {
        if (hooks.callIndex === 5) {
          return [{ id: hooks.forceOpenId, nameTh: 'ชื่อทดสอบ', nameEn: 'Test name' }, () => {}];
        }
        if (hooks.callIndex === 6) {
          return [hooks.forceOpenId, () => {}];
        }
      }
      return actual.useState(initial as never);
    },
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';
import { JobFieldsReview } from '../app/admin/job-fields/client';
import type { JobFieldRowDto, ProgramJobFieldRowDto } from '../app/admin/job-fields/client';

const fields: JobFieldRowDto[] = [
  { id: 'f1', slug: 'accounting', nameTh: 'การบัญชี', nameEn: 'Accounting', synonyms: ['บัญชี', 'Accounting'], mentionCount: 852, reviewStatus: 'PROPOSED', methodVersion: 'job-field-taxonomy.v1', programmeCount: 2, updatedAt: '2026-09-15T00:00:00Z' },
  { id: 'f2', slug: 'nursing', nameTh: 'พยาบาลศาสตร์', nameEn: 'Nursing', synonyms: ['พยาบาล'], mentionCount: 310, reviewStatus: 'APPROVED', methodVersion: 'job-field-taxonomy.v1', programmeCount: 1, updatedAt: '2026-09-15T00:00:00Z' },
];
const assignments: ProgramJobFieldRowDto[] = [
  { id: 'a1', programId: 'p1', programCode: 'KKU-SEQ-0245', programNameTh: 'บัญชีบัณฑิต', programNameEn: 'Accountancy', programLevel: 'BACHELOR', fieldId: 'f1', fieldSlug: 'accounting', source: 'rule', confidence: null, reviewStatus: 'PROPOSED' },
];

function render(): string {
  hooks.callIndex = 0;
  return renderToStaticMarkup(
    <TooltipProvider>
      <JobFieldsReview fields={fields} assignments={assignments} />
    </TooltipProvider>,
  );
}

const html = render();
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function renderWithFormsOpen(): string {
  const [firstField] = fields;
  if (!firstField) throw new Error('fixture must have at least one field');
  hooks.forceOpenId = firstField.id;
  try {
    return render();
  } finally {
    hooks.forceOpenId = null;
  }
}

describe('JobFieldsReview', () => {
  it('lists every field with both names, synonyms, mention count and status', () => {
    expect(text).toContain('การบัญชี');
    expect(text).toContain('Accounting');
    expect(text).toContain('852');
    expect(text).toContain('Proposed');
    expect(text).toContain('Approved');
  });
  it('shows review counts in the header', () => {
    expect(text).toMatch(/1 approved/);
    expect(text).toMatch(/1 proposed/);
  });
  it('lists assignments with programme code, source and status', () => {
    expect(text).toContain('KKU-SEQ-0245');
    expect(text).toContain('rule');
  });
  it('offers approve and reject on a proposed field, and merge on every field', () => {
    expect(html).toContain('data-action="approve-field"');
    expect(html).toContain('data-action="reject-field"');
    expect(html).toContain('data-action="merge-field"');
  });
  it('offers no approve action on a field that is already approved', () => {
    const count = (html.match(/data-action="approve-field"/g) ?? []).length;
    expect(count).toBe(1);
  });
  it('gives every icon-only action button an accessible name', () => {
    expect((html.match(/aria-label="Approve field"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-label="Reject field"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-label="Rename field"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-label="Merge field"/g) ?? []).length).toBe(2);
    expect((html.match(/aria-label="Approve assignment"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-label="Reject assignment"/g) ?? []).length).toBe(1);
  });
  it('labels the programme-id input for assistive tech', () => {
    expect(html).toContain('aria-label="Programme id"');
  });
  it('opens an accessible rename form and merge picker', () => {
    const openHtml = renderWithFormsOpen();
    expect(openHtml).toContain('aria-label="Thai name"');
    expect(openHtml).toContain('aria-label="English name"');
    expect(openHtml).toMatch(/required/);
    expect(openHtml).toMatch(/minLength="1"/);
    expect(openHtml).toContain('Merge into');
    expect(openHtml).toContain('<select');
    expect(openHtml).toContain('data-action="merge-confirm"');
  });
});

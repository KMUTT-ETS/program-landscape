import { describe, expect, it } from 'vitest';
import * as React from 'react';
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

const html = renderToStaticMarkup(
  <TooltipProvider>
    <JobFieldsReview fields={fields} assignments={assignments} />
  </TooltipProvider>,
);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

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
});

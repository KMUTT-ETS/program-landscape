import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TooltipProvider } from '@kku/ui';
import { JobFieldsReview, isGovernmentOnlyField } from '../app/admin/job-fields/client';
import type { FieldSynonymSourceDto, JobFieldRowDto, ProgramJobFieldRowDto } from '../app/admin/job-fields/client';

// Coverage for Task 14: since jobthai-bridge.v3, an APPROVED field's
// assignments decide which programmes a JobThai advert is matched to. Now
// that government announcements (job-108) also seed the taxonomy, a field
// can be entirely government-sourced while still governing JobThai matching
// once approved — this file asserts the reviewer sees that before clicking
// approve, and per-synonym attribution otherwise, without leaking a raw id.

// Real field ids are cuids (25 chars, 'c' + 24 lowercase alnum) — using the
// real shape here, rather than short test-friendly strings like 'f1', is
// what makes the "no raw cuid on screen" assertion below meaningful.
const govField: JobFieldRowDto = {
  id: 'cgv1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'public-administration',
  nameTh: 'รัฐประศาสนศาสตร์',
  nameEn: 'Public Administration',
  synonyms: ['รัฐประศาสนศาสตร์/บริหารรัฐกิจ'],
  mentionCount: 12,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 0,
  updatedAt: '2026-09-20T00:00:00Z',
};
const govSources: FieldSynonymSourceDto[] = [
  { fieldId: govField.id, synonym: 'รัฐประศาสนศาสตร์/บริหารรัฐกิจ', sources: ['job-108'] },
];

const mixedField: JobFieldRowDto = {
  id: 'cmx1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'agriculture',
  nameTh: 'เกษตรศาสตร์',
  nameEn: 'Agriculture',
  synonyms: ['เกษตร', 'Agriculture'],
  mentionCount: 240,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 1,
  updatedAt: '2026-09-20T00:00:00Z',
};
const mixedSources: FieldSynonymSourceDto[] = [
  { fieldId: mixedField.id, synonym: 'เกษตร', sources: ['job-108'] },
  { fieldId: mixedField.id, synonym: 'Agriculture', sources: ['jobthai'] },
];

const jobthaiField: JobFieldRowDto = {
  id: 'cjt1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'accounting',
  nameTh: 'การบัญชี',
  nameEn: 'Accounting',
  synonyms: ['บัญชี', 'Accounting'],
  mentionCount: 852,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 2,
  updatedAt: '2026-09-20T00:00:00Z',
};
const jobthaiSources: FieldSynonymSourceDto[] = [
  { fieldId: jobthaiField.id, synonym: 'บัญชี', sources: ['jobthai'] },
  { fieldId: jobthaiField.id, synonym: 'Accounting', sources: ['jobthai'] },
];

// A synonym seen on both sources at once — exercises the "both" label and
// keeps the gov-only predicate honest (this field must NOT read as
// government-only even though job-108 is one of its sources).
const bothField: JobFieldRowDto = {
  id: 'cbt1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'public-health',
  nameTh: 'สาธารณสุขศาสตร์',
  nameEn: 'Public Health',
  synonyms: ['สาธารณสุข'],
  mentionCount: 40,
  reviewStatus: 'PROPOSED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 0,
  updatedAt: '2026-09-20T00:00:00Z',
};
const bothSources: FieldSynonymSourceDto[] = [
  { fieldId: bothField.id, synonym: 'สาธารณสุข', sources: ['job-108', 'jobthai'] },
];

// A field already APPROVED must not show the warning — there is no approve
// control left for it to sit "above".
const approvedGovField: JobFieldRowDto = {
  id: 'cap1a2b3c4d5e6f7g8h9i0j1k',
  slug: 'already-approved-gov',
  nameTh: 'ทดสอบ',
  nameEn: 'Already Approved',
  synonyms: ['ทดสอบคำ'],
  mentionCount: 5,
  reviewStatus: 'APPROVED',
  methodVersion: 'job-field-taxonomy.v1',
  programmeCount: 1,
  updatedAt: '2026-09-20T00:00:00Z',
};
const approvedGovSources: FieldSynonymSourceDto[] = [
  { fieldId: approvedGovField.id, synonym: 'ทดสอบคำ', sources: ['job-108'] },
];

const allFields = [govField, mixedField, jobthaiField, bothField, approvedGovField];
const allSources = [...govSources, ...mixedSources, ...jobthaiSources, ...bothSources, ...approvedGovSources];
const assignments: ProgramJobFieldRowDto[] = [];

function render(fields: JobFieldRowDto[], synonymSources: FieldSynonymSourceDto[]): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <JobFieldsReview fields={fields} assignments={assignments} synonymSources={synonymSources} />
    </TooltipProvider>,
  );
}

const html = render(allFields, allSources);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('isGovernmentOnlyField', () => {
  it('is true only when every synonym is attributed to job-108 alone', () => {
    expect(isGovernmentOnlyField(govField.synonyms, govSources)).toBe(true);
  });
  it('is false for a field with mixed sources', () => {
    expect(isGovernmentOnlyField(mixedField.synonyms, mixedSources)).toBe(false);
  });
  it('is false for a field with only JobThai synonyms', () => {
    expect(isGovernmentOnlyField(jobthaiField.synonyms, jobthaiSources)).toBe(false);
  });
  it('is false for a field where the one synonym is attributed to both sources', () => {
    expect(isGovernmentOnlyField(bothField.synonyms, bothSources)).toBe(false);
  });
  it('is false (not "safe") when a synonym has no attribution at all', () => {
    expect(isGovernmentOnlyField(['unseen synonym'], [])).toBe(false);
  });
});

describe('JobFieldsReview — the government-only warning', () => {
  it('shows the warning for the field whose synonyms are entirely job-108', () => {
    expect(text).toContain(
      'Every synonym of this field comes from government announcements. Approving it will also change which programmes JobThai adverts are matched to',
    );
  });
  it('shows it exactly once — the mixed, JobThai-only, both-sources and already-approved fields must not trigger it', () => {
    const count = (html.match(/data-testid="government-only-warning"/g) ?? []).length;
    expect(count).toBe(1);
  });
  it('does not show it for the already-approved government-only field — there is no approve control to sit above', () => {
    const approvedOnly = render([approvedGovField], approvedGovSources);
    expect(approvedOnly).not.toContain('data-testid="government-only-warning"');
  });
});

describe('JobFieldsReview — per-synonym source attribution', () => {
  it('labels a job-108-only synonym', () => {
    expect(text).toMatch(/รัฐประศาสนศาสตร์\/บริหารรัฐกิจ\s*·\s*Job-108/);
  });
  it('labels a jobthai-only synonym', () => {
    expect(text).toMatch(/Accounting\s*·\s*JobThai/);
  });
  it('labels each synonym of a mixed field with its own source, not the field\'s', () => {
    expect(text).toMatch(/เกษตร\s*·\s*Job-108/);
    expect(text).toMatch(/Agriculture\s*·\s*JobThai/);
  });
  it('labels a synonym seen on both sources with both, JobThai second (alphabetical, matching the SQL sort)', () => {
    expect(text).toMatch(/สาธารณสุข\s*·\s*Job-108,\s*JobThai/);
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

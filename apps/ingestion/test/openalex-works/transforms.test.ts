import { afterEach, describe, expect, it, vi } from 'vitest';
import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';

import { OpenAlexWorksConnector, openAlexSkipReason } from '../../src/connectors/sources/openalex-works/connector';
import {
  buildStaffLookup,
  institutionAuthors,
  normaliseDoi,
  openAlexTypeToOurs,
  resolveStaff,
  type OpenAlexWork,
} from '../../src/connectors/sources/openalex-works/transforms';

const staff = (over: Partial<{ id: string; orcid: string | null; openalexAuthorId: string | null; nameEn: string; nameTh: string }>) => ({
  id: 's1', orcid: null, openalexAuthorId: null, nameEn: '', nameTh: '', ...over,
});

describe('skip reasons', () => {
  it('skips without institution id', () => {
    expect(openAlexSkipReason(null, 'key')).toMatch(/institution ID is not set/);
  });
  it('skips without api key', () => {
    expect(openAlexSkipReason('I1', undefined)).toMatch(/OPENALEX_API_KEY/);
    expect(openAlexSkipReason('I1', '  ')).toMatch(/OPENALEX_API_KEY/);
    expect(openAlexSkipReason('I1', 'k')).toBeNull();
  });
});

describe('author matching', () => {
  const author = { authorId: 'A9', displayName: 'Zed Testwriter', orcid: '0000-0000-0000-0001' };

  it('ORCID beats name', () => {
    const lookup = buildStaffLookup([
      staff({ id: 'byName', nameEn: 'Zed Testwriter' }),
      staff({ id: 'byOrcid', orcid: '0000-0000-0000-0001', nameEn: 'Someone Else' }),
    ]);
    expect(resolveStaff(author, lookup)).toEqual({ facultyMemberId: 'byOrcid', matchedBy: 'orcid' });
  });

  it('falls to the OpenAlex id, then the English name, then the Thai name', () => {
    const noOrcid = { ...author, orcid: null };
    expect(
      resolveStaff(noOrcid, buildStaffLookup([staff({ id: 'x', openalexAuthorId: 'A9' })])).matchedBy,
    ).toBe('openalex_author_id');
    expect(resolveStaff(noOrcid, buildStaffLookup([staff({ id: 'x', nameEn: ' zed testwriter ' })])).matchedBy).toBe('name_en');
    expect(
      resolveStaff({ ...noOrcid, displayName: 'สมมติ ทดสอบ' }, buildStaffLookup([staff({ id: 'x', nameTh: 'สมมติ ทดสอบ' })])).matchedBy,
    ).toBe('name_th');
  });

  it('ambiguous name stays unmatched', () => {
    const lookup = buildStaffLookup([
      staff({ id: 'a', nameEn: 'Zed Testwriter' }),
      staff({ id: 'b', nameEn: 'zed testwriter' }),
    ]);
    expect(resolveStaff({ ...author, orcid: null, authorId: null }, lookup)).toEqual({
      facultyMemberId: null, matchedBy: 'ambiguous',
    });
  });
});

describe('helpers', () => {
  it('normalises DOIs to bare lower case', () => {
    expect(normaliseDoi('https://doi.org/10.1234/ABC.1')).toBe('10.1234/abc.1');
    expect(normaliseDoi('doi:10.1/X')).toBe('10.1/x');
    expect(normaliseDoi('  ')).toBeNull();
  });
  it('collapses types', () => {
    expect(openAlexTypeToOurs('https://openalex.org/types/proceedings-article')).toBe('CONFERENCE');
    expect(openAlexTypeToOurs('book-chapter')).toBe('BOOK');
    expect(openAlexTypeToOurs('dataset')).toBe('JOURNAL');
  });
  it('keeps only authorships at the institution', () => {
    const work: OpenAlexWork = {
      id: 'https://openalex.org/W1',
      authorships: [
        { author: { id: 'https://openalex.org/A1', display_name: 'Ina Inside' }, institutions: [{ id: 'https://openalex.org/I5' }] },
        { author: { id: 'https://openalex.org/A2', display_name: 'Otto Outside' }, institutions: [{ id: 'https://openalex.org/I6' }] },
      ],
    };
    expect(institutionAuthors(work, 'I5').map((a) => a.displayName)).toEqual(['Ina Inside']);
  });
});

function page(ids: string[], next: string | null): Response {
  const results = ids.map((id) => ({
    id: `https://openalex.org/${id}`,
    title: `Paper ${id}`,
    publication_year: 2024,
    authorships: [{ author: { id: 'https://openalex.org/A1', display_name: 'Ina Inside' }, institutions: [{ id: 'https://openalex.org/I5' }] }],
  }));
  return new Response(JSON.stringify({ results, meta: { count: 3, next_cursor: next } }), { status: 200 });
}

describe('connector fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
  });

  it('cursor pagination follows next_cursor', async () => {
    setOrganizationForTest({ ...KKU_REFERENCE_ORGANIZATION, openalexInstitutionId: 'I5' });
    vi.stubEnv('OPENALEX_API_KEY', 'secret-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(['W1', 'W2'], 'CUR2'))
      .mockResolvedValueOnce(page(['W3'], null));
    vi.stubGlobal('fetch', fetchMock);
    const db = { facultyMember: { findMany: vi.fn().mockResolvedValue([]) } };
    const connector = new OpenAlexWorksConnector(db as never, 0);
    const ctx = { runId: 'r', log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };

    const raw = await connector.fetch(ctx as never);

    expect(raw.map((r) => r.externalId)).toEqual([
      'openalex-works:W1', 'openalex-works:W2', 'openalex-works:W3',
    ]);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain('cursor=*');
    expect(urls[0]).toContain('per-page=200');
    expect(urls[0]).toContain('authorships.institutions.id%3AI5');
    expect(urls[1]).toContain('cursor=CUR2');
    expect(urls[1]).toContain('api_key=secret-key');
    // The key must never reach the run log.
    expect(JSON.stringify(ctx.log.info.mock.calls)).not.toContain('secret-key');
  });

  it('health check reports the reason instead of fetching', async () => {
    setOrganizationForTest({ ...KKU_REFERENCE_ORGANIZATION, openalexInstitutionId: null });
    vi.stubEnv('OPENALEX_API_KEY', 'k');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const health = await new OpenAlexWorksConnector({} as never, 0).healthCheck({} as never);
    expect(health.ok).toBe(false);
    expect(health.message).toMatch(/institution ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

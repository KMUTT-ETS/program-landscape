import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@kku/db';
import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';

import { OpenAlexWorksConnector } from '../../src/connectors/sources/openalex-works/connector';

const FACULTY = 'OAW-FAC';
const CODES = ['OAW-0001', 'OAW-0002', 'OAW-0003', 'OAW-0004', 'OAW-0005', 'OAW-0006'];
let runId = '';
let sheetRunId = '';

async function cleanup(): Promise<void> {
  await prisma.researchOutput.deleteMany({ where: { OR: [{ facultyMember: { employeeCode: { in: CODES } } }, { openalexId: { startsWith: 'WOAW' } }] } });
  await prisma.facultyMember.deleteMany({ where: { employeeCode: { in: CODES } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY } });
}

async function makeRun(slug: string): Promise<string> {
  const source = await prisma.dataSource.upsert({
    where: { slug }, update: {},
    create: { slug, name: `${slug} test`, kind: 'API', inputFormat: 'JSON', mocked: false, scheduleEnabled: false, status: 'real' },
    select: { id: true },
  });
  const run = await prisma.ingestionRun.create({
    data: { dataSourceId: source.id, trigger: 'MANUAL', status: 'SUCCEEDED', attempt: 1 }, select: { id: true },
  });
  return run.id;
}

function work(id: string, authors: Array<{ aid: string; name: string; orcid?: string }>, extra: Record<string, unknown> = {}) {
  return {
    id: `https://openalex.org/${id}`,
    doi: 'https://doi.org/10.9999/OAW.Shared',
    title: `Fictional paper ${id}`,
    publication_year: 2023,
    type: 'article',
    cited_by_count: 12,
    primary_location: { source: { display_name: 'Journal of Imaginary Results' } },
    authorships: authors.map((a) => ({
      author: { id: `https://openalex.org/${a.aid}`, display_name: a.name, orcid: a.orcid ? `https://orcid.org/${a.orcid}` : null },
      institutions: [{ id: 'https://openalex.org/I5' }],
    })),
    ...extra,
  };
}

async function runConnector(works: unknown[]): Promise<void> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ results: works, meta: { count: works.length, next_cursor: null } }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const connector = new OpenAlexWorksConnector(prisma, 0);
  const ctx = { runId, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  const raw = await connector.fetch(ctx as never);
  const normalized = (await Promise.all(raw.map((r) => connector.transform(ctx as never, r)))).flat();
  const result = await connector.load(ctx as never, normalized);
  expect(result.recordsFailed).toBe(0);
}

describe('openalex-works load (scratch DB)', () => {
  beforeAll(async () => {
    await cleanup();
    setOrganizationForTest({ ...KKU_REFERENCE_ORGANIZATION, openalexInstitutionId: 'I5' });
    vi.stubEnv('OPENALEX_API_KEY', 'test-key');
    runId = await makeRun('openalex-works');
    sheetRunId = await makeRun('xlsx-research-outputs');
    const fac = await prisma.faculty.create({ data: { code: FACULTY, nameTh: 'คณะทดสอบ', nameEn: 'Test Faculty' } });
    const base = { facultyId: fac.id, rank: 'LECTURER' as const, isActive: true };
    await prisma.facultyMember.createMany({
      data: [
        { ...base, employeeCode: CODES[0]!, nameTh: 'ก', nameEn: 'Ina Inside' },
        { ...base, employeeCode: CODES[1]!, nameTh: 'ข', nameEn: 'Dup Namesake' },
        { ...base, employeeCode: CODES[2]!, nameTh: 'ค', nameEn: 'Dup Namesake' },
        { ...base, employeeCode: CODES[3]!, nameTh: 'ง', nameEn: 'Orla Holder', orcid: '0000-0000-0000-0042' },
        { ...base, employeeCode: CODES[4]!, nameTh: 'จ', nameEn: 'Ivo Firstcomer' },
        { ...base, employeeCode: CODES[5]!, nameTh: 'ฉ', nameEn: 'Pax Latecomer' },
      ],
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanup();
  });

  it('existing spreadsheet row with same DOI is enriched, not duplicated', async () => {
    const member = await prisma.facultyMember.findUniqueOrThrow({ where: { employeeCode: CODES[0]! } });
    const sheet = await prisma.researchOutput.create({
      data: {
        facultyMemberId: member.id, year: 2023, type: 'JOURNAL', title: 'Fictional paper from the sheet',
        doi: '10.9999/oaw.SHARED', citations: 40, source: 'xlsx-import', ingestionRunId: sheetRunId,
      },
    });

    await runConnector([work('WOAW1', [{ aid: 'AOAW1', name: 'Ina Inside' }])]);

    const rows = await prisma.researchOutput.findMany({ where: { facultyMemberId: member.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: sheet.id, openalexId: 'WOAW1', source: 'xlsx-import', ingestionRunId: sheetRunId, citations: 40,
    });
  });

  it('ambiguous name stays unmatched and lands with no staff member', async () => {
    await runConnector([work('WOAW2', [{ aid: 'AOAW2', name: 'Dup Namesake' }], { doi: null })]);
    const rows = await prisma.researchOutput.findMany({ where: { openalexId: 'WOAW2' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ facultyMemberId: null, kkuAuthorName: 'Dup Namesake', source: 'openalex', ingestionRunId: runId });
  });

  it('writes ids back only into free columns no one else holds', async () => {
    // OpenAlex lists the same ORCID on two authors (a merge error upstream).
    // Both match by name; only the first may take it, the second still gets
    // its OpenAlex author id.
    const shared = '0000-0000-0000-0077';
    await runConnector([
      work('WOAW4', [
        { aid: 'AOAW4', name: 'Ivo Firstcomer', orcid: shared },
        { aid: 'AOAW5', name: 'Pax Latecomer', orcid: shared },
      ], { doi: null }),
    ]);
    const first = await prisma.facultyMember.findUniqueOrThrow({ where: { employeeCode: CODES[4]! } });
    const second = await prisma.facultyMember.findUniqueOrThrow({ where: { employeeCode: CODES[5]! } });
    expect(first).toMatchObject({ orcid: shared, openalexAuthorId: 'AOAW4' });
    expect(second).toMatchObject({ orcid: null, openalexAuthorId: 'AOAW5' });
  });

  it('a held ORCID is never overwritten by a name match', async () => {
    await runConnector([work('WOAW6', [{ aid: 'AOAW6', name: 'Orla Holder', orcid: '0000-0000-0000-0099' }], { doi: null })]);
    const holder = await prisma.facultyMember.findUniqueOrThrow({ where: { employeeCode: CODES[3]! } });
    expect(holder.orcid).toBe('0000-0000-0000-0042');
  });

  it('a re-run never clobbers an enriched spreadsheet row', async () => {
    const member = await prisma.facultyMember.findUniqueOrThrow({ where: { employeeCode: CODES[0]! } });
    // Test 1 left this member's sheet row enriched with openalexId WOAW1 and 40 citations.
    await runConnector([work('WOAW1', [{ aid: 'AOAW1', name: 'Ina Inside' }], { title: 'A changed title', cited_by_count: 5 })]);
    const rows = await prisma.researchOutput.findMany({ where: { facultyMemberId: member.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'xlsx-import', ingestionRunId: sheetRunId, title: 'Fictional paper from the sheet', citations: 40,
    });
  });

  it('re-running updates in place without duplicating', async () => {
    await runConnector([work('WOAW7', [{ aid: 'AOAW7', name: 'Ivo Firstcomer' }], { doi: null })]);
    await runConnector([work('WOAW7', [{ aid: 'AOAW7', name: 'Ivo Firstcomer' }], { doi: null, cited_by_count: 99 })]);
    const rows = await prisma.researchOutput.findMany({ where: { openalexId: 'WOAW7' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.citations).toBe(99);
  });
});

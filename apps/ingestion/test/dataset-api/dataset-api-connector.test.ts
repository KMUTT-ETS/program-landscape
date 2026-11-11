import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { prisma } from '@kku/db';
import type { ConnectorContext } from '@kku/shared';

import { ApiClient } from '../../src/connectors/base/api-client';
import { NonRetryableError } from '../../src/connectors/base/base-connector';
import {
  DatasetApiConnector,
  datasetApiEntry,
  type DatasetRows,
} from '../../src/connectors/base/dataset-api-connector';
import { buildRegistry } from '../../src/connectors/registry';

// Runs the REAL shipped class-offerings, faculty-members, external-grants and
// external-grant-team loaders against the dev database, with test-only codes
// (prefix TAPI-) and the term/year 1999, and removes exactly what it created.

const SLUG = 'tapi-test-connector';

// The registry spreads INSTITUTION_CONNECTORS at import time, so the entry
// has to exist before it loads. The factory is filled in once the class does.
// The real refresh is a no-op for these datasets; mocking it lets a test force a failure.
const refresh = vi.hoisted(() => ({
  fn: vi.fn(async (_slug: string): Promise<void> => undefined),
}));
vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return { ...actual, refreshMetricViewsIfNeeded: (slug: string) => refresh.fn(slug) };
});

const institution = vi.hoisted(() => {
  const make: { current: () => unknown } = { current: () => undefined };
  const entry = {
    slug: 'tapi-test-connector',
    mock: () => make.current(),
    real: () => make.current(),
  };
  return { make, list: [entry] };
});
vi.mock('../../src/connectors/sources/institution', () => ({
  INSTITUTION_CONNECTORS: institution.list,
}));
const PARENT_SLUG = 'api-tapi-test-connector';
const FACULTY = 'TAPI-F';
const PREFIX = 'TAPI-';
const NAME_TH = 'ทดสอบ ข้อมูลส่วนตัว';

class TestConnector extends DatasetApiConnector {
  readonly slug = SLUG;
  readonly displayName = 'Test Institution API';

  constructor(
    readonly datasets: readonly string[],
    private readonly build: (records: readonly unknown[]) => DatasetRows,
    private readonly payload: readonly unknown[] = [{ n: 1 }],
  ) {
    super();
  }

  protected createClient(): ApiClient {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(this.payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    return new ApiClient({ baseUrl: 'https://upstream.test', fetchImpl });
  }

  protected async fetchAll(_ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]> {
    return api.getJson('/records', z.array(z.unknown()));
  }

  protected toRows(records: readonly unknown[]): DatasetRows {
    return this.build(records);
  }

  limits(): { maxRows: number; allowShrink: boolean } {
    return this.importLimits();
  }
}

const parentRunIds: string[] = [];
const warn = vi.fn();

async function newContext(): Promise<ConnectorContext> {
  const ds = await prisma.dataSource.findUniqueOrThrow({ where: { slug: PARENT_SLUG } });
  const run = await prisma.ingestionRun.create({
    data: {
      dataSourceId: ds.id,
      trigger: 'MANUAL',
      status: 'RUNNING',
      startedAt: new Date(),
      attempt: 1,
    },
    select: { id: true },
  });
  parentRunIds.push(run.id);
  return {
    runId: run.id,
    dataSource: { id: ds.id, slug: ds.slug, name: ds.name, baseUrl: null, lastSyncedAt: null },
    log: { info: vi.fn(), warn, error: vi.fn() },
  };
}

/** The runner's call order, without the runner. */
async function runConnector(
  connector: TestConnector,
  ctx: ConnectorContext,
): Promise<{
  loaded: Awaited<ReturnType<TestConnector['load']>>;
}> {
  const raw = await connector.fetch(ctx);
  for (const r of raw) expect(await connector.transform(ctx, r)).toEqual([]);
  return { loaded: await connector.load(ctx, []) };
}

type Meta = {
  datasets: Record<
    string,
    {
      importRunId?: string;
      rows: number;
      inserted: number;
      updated: number;
      deleted: number;
      status: string;
    }
  >;
  warnings: string[];
  errors: { dataset: string; record: number; column: string | null; message: string }[];
  totalErrors: number;
};

const classRow = (
  course: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  'Academic Year': 1999,
  Semester: 1,
  'Faculty Code': FACULTY,
  'Course Code': course,
  Section: 1,
  Enrolled: 10,
  'Total Seats': 20,
  ...extra,
});

beforeAll(async () => {
  await prisma.dataSource.upsert({
    where: { slug: PARENT_SLUG },
    update: {},
    create: {
      slug: PARENT_SLUG,
      name: 'Test Institution API',
      kind: 'API',
      inputFormat: 'JSON',
      mocked: false,
      scheduleEnabled: false,
      status: 'real',
    },
  });
  await prisma.faculty.create({
    data: { code: FACULTY, nameTh: 'คณะทดสอบ', nameEn: 'Test Faculty' },
  });
});

beforeEach(() => {
  warn.mockReset();
  refresh.fn.mockClear();
});

afterAll(async () => {
  const children = await prisma.ingestionRun.findMany({
    where: { OR: parentRunIds.map((id) => ({ metadata: { path: ['parentRunId'], equals: id } })) },
    select: { id: true },
  });
  const runIds = [...children.map((c) => c.id), ...parentRunIds];
  // Rows first (team members cascade from their project), then batches and runs.
  await prisma.researchServiceProject.deleteMany({
    where: { id: { startsWith: `rsp-xlsx-${PREFIX}` } },
  });
  await prisma.classOffering.deleteMany({ where: { courseCode: { startsWith: PREFIX } } });
  await prisma.facultyMember.deleteMany({ where: { employeeCode: { startsWith: PREFIX } } });
  await prisma.faculty.deleteMany({ where: { code: FACULTY } });
  await prisma.importBatch.deleteMany({ where: { ingestionRunId: { in: runIds } } });
  await prisma.ingestionRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.dataSource.deleteMany({ where: { slug: PARENT_SLUG } });
});

describe('DatasetApiConnector', () => {
  it('loads class-offerings rows from records and stamps the xlsx DataSource', async () => {
    const connector = new TestConnector(['class-offerings'], () => ({
      'class-offerings': [classRow('TAPI-101'), classRow('TAPI-102')],
    }));
    const ctx = await newContext();
    const { loaded } = await runConnector(connector, ctx);

    const meta = loaded.metadata as Meta;
    expect(meta.datasets['class-offerings']).toMatchObject({
      rows: 2,
      inserted: 2,
      status: 'LOADED',
    });
    expect(loaded.recordsLoaded).toBe(2);

    const rows = await prisma.classOffering.findMany({
      where: { courseCode: { startsWith: PREFIX } },
      select: {
        ingestionRun: {
          select: { dataSource: { select: { slug: true } }, metadata: true, id: true },
        },
      },
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.ingestionRun?.dataSource.slug).toBe('xlsx-class-offerings');
      expect(r.ingestionRun?.metadata).toMatchObject({
        via: 'api',
        connector: SLUG,
        parentRunId: ctx.runId,
      });
      expect(r.ingestionRun?.id).toBe(meta.datasets['class-offerings']?.importRunId);
    }
  });

  it('loads the second dataset against codes the first just committed', async () => {
    const connector = new TestConnector(
      ['faculty-members', 'external-grants', 'external-grant-team'],
      () => ({
        // Deliberately listed out of dependency order.
        'external-grant-team': [
          { 'Project Code': 'TAPI-G1', 'Employee Code': 'TAPI-E1', Role: 'Lead' },
        ],
        'external-grants': [
          {
            'Project Code': 'TAPI-G1',
            'Title (Thai)': 'โครงการทดสอบ',
            Type: 'Research',
            'Fiscal Year': 1999,
            'Lead Faculty Code': FACULTY,
          },
        ],
        'faculty-members': [
          {
            'Employee Code': 'TAPI-E1',
            'Name (Thai)': 'ทดสอบ หนึ่ง',
            'Name (English)': 'Test One',
            'Faculty Code': FACULTY,
            Rank: 'LECTURER',
          },
        ],
      }),
    );
    const { loaded } = await runConnector(connector, await newContext());
    const meta = loaded.metadata as Meta;
    expect(Object.keys(meta.datasets)).toEqual([
      'faculty-members',
      'external-grants',
      'external-grant-team',
    ]);
    for (const d of Object.values(meta.datasets)) expect(d.status).toBe('LOADED');
    expect(meta.datasets['external-grant-team']).toMatchObject({ rows: 1, inserted: 1 });

    const members = await prisma.researchServiceProjectMember.count({
      where: { projectId: 'rsp-xlsx-TAPI-G1' },
    });
    expect(members).toBe(1);
  });

  it('refuses on validation failure and loads nothing for that dataset', async () => {
    // Buddhist-era year: the column wants the Common Era.
    const connector = new TestConnector(['class-offerings'], () => ({
      'class-offerings': [classRow('TAPI-201', { 'Academic Year': 2542 })],
    }));
    const err = await runConnector(connector, await newContext()).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NonRetryableError);
    const nre = err as NonRetryableError;
    expect(nre.code).toBe('VALIDATION');
    expect(nre.message).toMatch(
      /^\d+ problems? in Class Offerings\. First: record 1, Academic Year — /,
    );
    const meta = nre.details as unknown as Meta;
    expect(meta.datasets['class-offerings']).toMatchObject({
      status: 'REFUSED',
      rows: 1,
      inserted: 0,
    });
    expect(meta.errors[0]).toMatchObject({
      dataset: 'class-offerings',
      record: 1,
      column: 'Academic Year',
    });
    expect(Object.keys(meta.errors[0] ?? {}).sort()).toEqual([
      'column',
      'dataset',
      'message',
      'record',
    ]);
    expect(meta.totalErrors).toBeGreaterThanOrEqual(1);
    expect(await prisma.classOffering.count({ where: { courseCode: 'TAPI-201' } })).toBe(0);
  });

  it('stops at the first refused dataset and marks the rest NOT_RUN', async () => {
    // faculty-members precedes class-offerings in IMPORT_DATASETS.
    const connector = new TestConnector(['class-offerings', 'faculty-members'], () => ({
      'class-offerings': [classRow('TAPI-301')],
      'faculty-members': [
        {
          'Employee Code': 'TAPI-E3',
          'Name (Thai)': 'ก',
          'Name (English)': 'A',
          'Faculty Code': FACULTY,
          Rank: 'NOT_A_RANK',
        },
      ],
    }));
    const err = (await runConnector(connector, await newContext()).catch(
      (e: unknown) => e,
    )) as NonRetryableError;
    const meta = err.details as unknown as Meta;
    expect(meta.datasets['faculty-members']?.status).toBe('REFUSED');
    expect(meta.datasets['class-offerings']?.status).toBe('NOT_RUN');
    expect(await prisma.classOffering.count({ where: { courseCode: 'TAPI-301' } })).toBe(0);
  });

  it('error metadata never contains cell values from name columns', async () => {
    const connector = new TestConnector(['faculty-members'], () => ({
      'faculty-members': [
        // The name is in a text column AND echoed by an invalid enum cell.
        {
          'Employee Code': 'TAPI-E9',
          'Name (Thai)': NAME_TH,
          'Name (English)': 'Private Person',
          'Faculty Code': FACULTY,
          Rank: NAME_TH,
        },
      ],
    }));
    const err = (await runConnector(connector, await newContext()).catch(
      (e: unknown) => e,
    )) as NonRetryableError;
    expect(err.code).toBe('VALIDATION');
    const meta = err.details as unknown as Meta;
    expect(meta.errors[0]).toMatchObject({ dataset: 'faculty-members', record: 1, column: 'Rank' });
    for (const text of [JSON.stringify(meta), err.message, JSON.stringify(warn.mock.calls)]) {
      expect(text).not.toContain(NAME_TH);
      expect(text).not.toContain('Private Person');
      expect(text).not.toContain('TAPI-E9');
    }
    expect(await prisma.facultyMember.count({ where: { employeeCode: 'TAPI-E9' } })).toBe(0);
  });

  it('refuses a dataset not declared in datasets', async () => {
    const connector = new TestConnector(['class-offerings'], () => ({
      'class-offerings': [classRow('TAPI-401')],
      'faculty-members': [],
    }));
    const err = await runConnector(connector, await newContext()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('CONFIG');
    expect((err as NonRetryableError).message).toContain('faculty-members');
    // Nothing was loaded, not even the declared dataset.
    expect(await prisma.classOffering.count({ where: { courseCode: 'TAPI-401' } })).toBe(0);
  });

  it('refuses a slug that is not an import dataset', async () => {
    const connector = new TestConnector(['nope'], () => ({ nope: [] }));
    const err = await runConnector(connector, await newContext()).catch((e: unknown) => e);
    expect((err as NonRetryableError).code).toBe('CONFIG');
  });

  it('logs a failed metric refresh as a warning and still succeeds, never logging records', async () => {
    refresh.fn.mockRejectedValueOnce(new Error('refresh exploded'));
    const connector = new TestConnector(
      ['class-offerings'],
      () => ({
        'class-offerings': [classRow('TAPI-501')],
      }),
      [{ secret: NAME_TH }],
    );
    const ctx = await newContext();
    const { loaded } = await runConnector(connector, ctx);

    expect(refresh.fn).toHaveBeenCalledWith('class-offerings');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('refresh exploded');
    expect((loaded.metadata as Meta).datasets['class-offerings']?.status).toBe('LOADED');
    expect(await prisma.classOffering.count({ where: { courseCode: 'TAPI-501' } })).toBe(1);
    expect(
      JSON.stringify([warn.mock.calls, (ctx.log.info as ReturnType<typeof vi.fn>).mock.calls]),
    ).not.toContain(NAME_TH);
  });

  it('keeps an earlier dataset loaded when a later one is refused, and marks the rest NOT_RUN', async () => {
    // IMPORT_DATASETS order: faculty-members, class-offerings, compensation.
    const connector = new TestConnector(
      ['faculty-members', 'class-offerings', 'faculty-compensation'],
      () => ({
        'faculty-members': [
          {
            'Employee Code': 'TAPI-E5',
            'Name (Thai)': 'ทดสอบ ห้า',
            'Name (English)': 'Test Five',
            'Faculty Code': FACULTY,
            Rank: 'LECTURER',
          },
        ],
        'class-offerings': [classRow('TAPI-701', { 'Academic Year': 2542 })],
        'faculty-compensation': [],
      }),
    );
    const err = (await runConnector(connector, await newContext()).catch(
      (e: unknown) => e,
    )) as NonRetryableError;

    expect(err).toBeInstanceOf(NonRetryableError);
    expect(err.code).toBe('VALIDATION');
    expect(err.message).toContain('Class Offerings');
    const meta = err.details as unknown as Meta;
    expect(Object.keys(meta.datasets)).toEqual([
      'faculty-members',
      'class-offerings',
      'faculty-compensation',
    ]);
    expect(meta.datasets['faculty-members']).toMatchObject({
      status: 'LOADED',
      rows: 1,
      inserted: 1,
    });
    expect(meta.datasets['faculty-members']?.importRunId).toEqual(expect.any(String));
    expect(meta.datasets['class-offerings']?.status).toBe('REFUSED');
    expect(meta.datasets['class-offerings']?.importRunId).toBeUndefined();
    expect(meta.datasets['faculty-compensation']?.status).toBe('NOT_RUN');
    expect(meta.errors.every((e) => e.dataset === 'class-offerings')).toBe(true);

    // The committed dataset stays committed; nothing from the refused one exists.
    const member = await prisma.facultyMember.findUnique({
      where: { employeeCode: 'TAPI-E5' },
      select: { ingestionRunId: true },
    });
    expect(member?.ingestionRunId).toBe(meta.datasets['faculty-members']?.importRunId);
    expect(await prisma.classOffering.count({ where: { courseCode: 'TAPI-701' } })).toBe(0);
  });

  describe('limits', () => {
    const saved = { ...process.env };
    afterAll(() => {
      process.env = saved;
    });

    it('defaults to 10,000 rows with the shrink guard on', () => {
      delete process.env.CONNECTOR_TAPI_TEST_CONNECTOR_MAX_ROWS;
      delete process.env.CONNECTOR_TAPI_TEST_CONNECTOR_ALLOW_SHRINK;
      expect(new TestConnector([], () => ({})).limits()).toEqual({
        maxRows: 10_000,
        allowShrink: false,
      });
    });

    it('CONNECTOR_<SLUG>_MAX_ROWS raises it but never above 100,000', () => {
      process.env.CONNECTOR_TAPI_TEST_CONNECTOR_MAX_ROWS = '25000';
      expect(new TestConnector([], () => ({})).limits().maxRows).toBe(25_000);
      process.env.CONNECTOR_TAPI_TEST_CONNECTOR_MAX_ROWS = '5000000';
      expect(new TestConnector([], () => ({})).limits().maxRows).toBe(100_000);
      process.env.CONNECTOR_TAPI_TEST_CONNECTOR_MAX_ROWS = 'abc';
      expect(new TestConnector([], () => ({})).limits().maxRows).toBe(10_000);
    });

    it('CONNECTOR_<SLUG>_ALLOW_SHRINK=true turns the shrink guard off', () => {
      process.env.CONNECTOR_TAPI_TEST_CONNECTOR_ALLOW_SHRINK = 'true';
      expect(new TestConnector([], () => ({})).limits().allowShrink).toBe(true);
    });

    it('a file over the row limit is refused as a whole-file error at record 0', async () => {
      process.env.CONNECTOR_TAPI_TEST_CONNECTOR_MAX_ROWS = '1';
      const connector = new TestConnector(['class-offerings'], () => ({
        'class-offerings': [classRow('TAPI-601'), classRow('TAPI-602')],
      }));
      const err = (await runConnector(connector, await newContext()).catch(
        (e: unknown) => e,
      )) as NonRetryableError;
      const meta = err.details as unknown as Meta;
      expect(meta.errors[0]).toMatchObject({ record: 0, column: null });
      expect(
        await prisma.classOffering.count({ where: { courseCode: { startsWith: 'TAPI-60' } } }),
      ).toBe(0);
    });
  });

  it('registry resolves an INSTITUTION_CONNECTORS entry by slug', () => {
    institution.make.current = () => new TestConnector([], () => ({}));
    expect(buildRegistry().get(SLUG)).toBeInstanceOf(TestConnector);
  });

  it('datasetApiEntry registers one factory for mock and real', () => {
    const factory = (): TestConnector => new TestConnector([], () => ({}));
    const entry = datasetApiEntry(SLUG, factory);
    expect(entry.slug).toBe(SLUG);
    expect(entry.mock).toBe(factory);
    expect(entry.real).toBe(factory);
  });
});

import { describe, expect, it } from 'vitest';
import { prisma } from '../src/index';
import {
  heldAnnouncementLastmods,
  planJob108Fetch,
  recordJob108Failure,
  toPostingRows,
  upsertJob108Announcement,
} from '../src/job108';

const entry = (id: string, lastmod: string) => ({
  announcementId: id,
  url: `https://www.job-108.com/${id}.html`,
  lastmod: new Date(`${lastmod}T00:00:00Z`),
});

describe('planJob108Fetch', () => {
  it('fetches an announcement we have never seen', () => {
    const plan = planJob108Fetch([entry('id1', '2026-09-01')], new Map());
    expect(plan.map((e) => e.announcementId)).toEqual(['id1']);
  });

  it('skips one whose lastmod is not newer than what we hold', () => {
    const held = new Map([['id1', new Date('2026-09-01T00:00:00Z')]]);
    expect(planJob108Fetch([entry('id1', '2026-09-01')], held)).toEqual([]);
  });

  it('refetches when the source says it changed', () => {
    const held = new Map([['id1', new Date('2026-09-01T00:00:00Z')]]);
    const plan = planJob108Fetch([entry('id1', '2026-09-05')], held);
    expect(plan.map((e) => e.announcementId)).toEqual(['id1']);
  });

  it('caps the batch, taking the newest', () => {
    const entries = [entry('id1', '2026-09-01'), entry('id2', '2026-09-09'), entry('id3', '2026-09-05')];
    const plan = planJob108Fetch(entries, new Map(), 2);
    expect(plan.map((e) => e.announcementId)).toEqual(['id2', 'id3']);
  });
});

describe('toPostingRows', () => {
  const base = {
    announcementId: 'id20256',
    agencyName: 'กรมการข้าว',
    publishedDate: new Date('2026-09-09T00:00:00Z'),
    applicationCloseDate: new Date('2026-09-30T00:00:00Z'),
  };
  const position = (over: Partial<Parameters<typeof toPostingRows>[1][number]> = {}) => ({
    title: 'ก',
    positionCount: 1,
    salaryMin: null,
    salaryMax: null,
    minEducationLevel: 'BACHELOR' as const,
    requiredFieldsRaw: ['รัฐศาสตร์'],
    qualificationRaw: 'x',
    ...over,
  });

  it('gives each position a distinct external id, prefixed by the announcement id', () => {
    const rows = toPostingRows(base, [position(), position({ title: 'ข', requiredFieldsRaw: ['บัญชี'] })]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(2);
    for (const row of rows) {
      expect(row.externalId.startsWith('id20256#')).toBe(true);
    }
  });

  it('gives a position the same external id regardless of where it falls in the array', () => {
    const p1 = position();
    const p2 = position({ title: 'ข', requiredFieldsRaw: ['บัญชี'], qualificationRaw: 'y' });
    const forward = toPostingRows(base, [p1, p2]);
    const reversed = toPostingRows(base, [p2, p1]);
    expect(new Set(forward.map((r) => r.externalId))).toEqual(new Set(reversed.map((r) => r.externalId)));
  });

  it('marks the posted date as real, not estimated', () => {
    const [row] = toPostingRows(base, [position()]);
    expect(row?.postedDateEstimated).toBe(false);
    expect(row?.postedDate).toEqual(base.publishedDate);
  });

  it('falls back to the fetch date and says so when the page states none', () => {
    const fetchedAt = new Date('2026-09-20T00:00:00Z');
    const [row] = toPostingRows({ ...base, publishedDate: null }, [position()], fetchedAt);
    expect(row?.postedDate).toEqual(fetchedAt);
    expect(row?.postedDateEstimated).toBe(true);
  });

  /* Two genuinely distinct vacancies can share a title and character-identical
   * qualification text, differing only by the posting unit, which this schema
   * does not store. Announcement id20185 (การนิคมอุตสาหกรรมแห่งประเทศไทย) lists
   * วิศวกร 5 at Eastern Seaboard (Rayong) and at Laem Chabang exactly that way.
   * Before this was handled, the pair hashed to one id and createMany aborted
   * the whole announcement — discarding a model call already paid for, and
   * leaving the page FAILED, which planJob108Fetch then skips forever. */
  it('keeps both of two positions that share a title and qualification text', () => {
    const rows = toPostingRows(base, [
      position({ title: 'วิศวกร 5', qualificationRaw: 'ปริญญาตรีวิศวกรรมศาสตร์' }),
      position({ title: 'วิศวกร 5', qualificationRaw: 'ปริญญาตรีวิศวกรรมศาสตร์' }),
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(2);
    for (const row of rows) {
      expect(row.externalId.startsWith('id20256#')).toBe(true);
    }
  });

  /* The disambiguating suffix is assigned by content order, not array order,
   * so the ids of a colliding pair survive the source reordering them. */
  it('gives a colliding pair the same ids whichever way round the page lists them', () => {
    const a = position({ title: 'วิศวกร 5', qualificationRaw: 'q', positionCount: 1 });
    const b = position({ title: 'วิศวกร 5', qualificationRaw: 'q', positionCount: 4 });
    const forward = toPostingRows(base, [a, b]);
    const reversed = toPostingRows(base, [b, a]);
    expect(new Set(forward.map((r) => r.externalId))).toEqual(new Set(reversed.map((r) => r.externalId)));
    const idOf = (rows: typeof forward, seats: number) =>
      rows.find((r) => r.positionCount === seats)?.externalId;
    expect(idOf(forward, 1)).toBe(idOf(reversed, 1));
    expect(idOf(forward, 4)).toBe(idOf(reversed, 4));
  });

  /* A position with no twin keeps the bare hash, so adding this did not churn
   * the ids of anything already stored. */
  it('leaves an uncontested position id unsuffixed', () => {
    const [row] = toPostingRows(base, [position()]);
    expect(row?.externalId).toMatch(/^id20256#[0-9a-f]{10}$/);
  });

  it('carries seats through without multiplying rows', () => {
    const rows = toPostingRows(base, [position({ positionCount: 89, requiredFieldsRaw: ['พยาบาล'] })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.positionCount).toBe(89);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postgres-backed tests for the three functions that write or read through
// Prisma: upsertJob108Announcement, recordJob108Failure, heldAnnouncementLastmods.
//
// job-fields.test.ts's rolled-back-transaction pattern does not apply here
// unmodified: writeTaxonomy/writeAssignments accept an injected `tx` and so
// can be handed the outer test transaction, but upsertJob108Announcement and
// recordJob108Failure call `prisma.$transaction` / `prisma.…upsert` on the
// top-level singleton directly — a call made inside an OUTER rolled-back
// transaction would open its own separate connection and commit for real
// regardless of the outer rollback. So these tests do real writes and clean
// up explicitly in a `finally`, verified by checking the row is gone
// afterwards — the same discipline the job-fields tests want (leave the
// database exactly as found), reached by a different mechanism because these
// functions don't accept an injectable client.
// ─────────────────────────────────────────────────────────────────────────────

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

/** A real IngestionRun scoped to the seeded job-108 DataSource. Returns null
 *  on a fresh database with no job-108 row — the tests skip rather than fail,
 *  matching the `if (!runId) return;` guard job-fields.test.ts uses for the
 *  same situation. */
async function job108TestRun(): Promise<string | null> {
  const dataSource = await prisma.dataSource.findUnique({ where: { slug: 'job-108' }, select: { id: true } });
  if (!dataSource) return null;
  const run = await prisma.ingestionRun.create({
    data: {
      dataSourceId: dataSource.id,
      trigger: 'MANUAL',
      status: 'SUCCEEDED',
      startedAt: new Date(),
      completedAt: new Date(),
    },
    select: { id: true },
  });
  return run.id;
}

async function cleanupJob108TestRun(runId: string): Promise<void> {
  // Deleting the IngestionRun does NOT cascade to Job108Announcement /
  // JobPosting (both relations are onDelete: SetNull) — the announcement
  // rows created in each test must be deleted first, by the test itself,
  // before this runs.
  await prisma.ingestionRun.delete({ where: { id: runId } }).catch(() => undefined);
}

describe.skipIf(!postgresUp)('upsertJob108Announcement against postgres', () => {
  it('leaves no orphans when a re-extraction returns fewer positions than before', async () => {
    const runId = await job108TestRun();
    if (!runId) return; // fresh database: no job-108 DataSource row to attribute to
    const announcementId = 'zz-test-job108-shrink';
    const header = {
      announcementId,
      agencyName: 'กรมทดสอบ',
      publishedDate: new Date('2026-09-09T00:00:00Z'),
      applicationCloseDate: new Date('2026-09-30T00:00:00Z'),
    };
    try {
      const threePositions = [
        { title: 'ก1', positionCount: 1, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR' as const, requiredFieldsRaw: ['a'], qualificationRaw: 'q1' },
        { title: 'ก2', positionCount: 2, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR' as const, requiredFieldsRaw: ['b'], qualificationRaw: 'q2' },
        { title: 'ก3', positionCount: 3, salaryMin: null, salaryMax: null, minEducationLevel: 'BACHELOR' as const, requiredFieldsRaw: ['c'], qualificationRaw: 'q3' },
      ];
      const first = await upsertJob108Announcement({
        announcementId,
        url: `https://www.job-108.com/${announcementId}.html`,
        contentHash: 'hash-1',
        title: 'ประกาศทดสอบ',
        header,
        applicationOpenDate: null,
        sourceLastmod: new Date('2026-09-09T00:00:00Z'),
        rows: toPostingRows(header, threePositions),
        runId,
      });
      expect(first.postingsWritten).toBe(3);

      const onePosition = [
        { title: 'ใหม่', positionCount: 9, salaryMin: null, salaryMax: null, minEducationLevel: 'MASTER' as const, requiredFieldsRaw: ['d'], qualificationRaw: 'q-new' },
      ];
      const second = await upsertJob108Announcement({
        announcementId,
        url: `https://www.job-108.com/${announcementId}.html`,
        contentHash: 'hash-2',
        title: 'ประกาศทดสอบ',
        header,
        applicationOpenDate: null,
        sourceLastmod: new Date('2026-09-10T00:00:00Z'),
        rows: toPostingRows(header, onePosition),
        runId,
      });
      expect(second.postingsWritten).toBe(1);

      const announcement = await prisma.job108Announcement.findUniqueOrThrow({
        where: { announcementId },
        select: { id: true },
      });
      const remaining = await prisma.jobPosting.findMany({ where: { job108AnnouncementId: announcement.id } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.title).toBe('ใหม่');
      expect(remaining[0]?.qualificationRaw).toBe('q-new');
      expect(remaining[0]?.positionCount).toBe(9);
    } finally {
      // Deleting the announcement cascades to its postings (onDelete: Cascade
      // on job108AnnouncementId).
      await prisma.job108Announcement.deleteMany({ where: { announcementId } });
      await cleanupJob108TestRun(runId);
    }
  });
});

describe.skipIf(!postgresUp)('recordJob108Failure + heldAnnouncementLastmods against postgres', () => {
  it('stores a FAILED row without inventing a title, and heldAnnouncementLastmods includes it', async () => {
    const runId = await job108TestRun();
    if (!runId) return;
    const announcementId = 'zz-test-job108-failed';
    const sourceLastmod = new Date('2026-09-05T00:00:00Z');
    try {
      await recordJob108Failure({
        announcementId,
        url: `https://www.job-108.com/${announcementId}.html`,
        contentHash: 'hash-fail',
        sourceLastmod,
        error: 'boom: could not parse the page',
        runId,
      });

      const stored = await prisma.job108Announcement.findUniqueOrThrow({ where: { announcementId } });
      expect(stored.status).toBe('FAILED');
      expect(stored.title).toBeNull();
      expect(stored.parseError).toBe('boom: could not parse the page');
      expect(stored.ingestionRunId).toBe(runId);

      const held = await heldAnnouncementLastmods();
      expect(held.get(announcementId)).toEqual(sourceLastmod);
    } finally {
      await prisma.job108Announcement.deleteMany({ where: { announcementId } });
      await cleanupJob108TestRun(runId);
    }
  });
});

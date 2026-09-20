import { createHash } from 'node:crypto';

import type { Job108Position, SitemapEntry } from '@kku/shared';
import { PUBLIC_DEMAND_SOURCE } from '@kku/shared';

import { prisma } from './index';

export interface Job108PostingRow {
  externalId: string;
  title: string;
  employerName: string | null;
  postedDate: Date;
  postedDateEstimated: boolean;
  applicationCloseDate: Date | null;
  positionCount: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  minEducationLevel: Job108Position['minEducationLevel'];
  requiredFieldsRaw: string[];
  qualificationRaw: string;
  descriptionRaw: string;
}

export interface Job108AnnouncementHeader {
  announcementId: string;
  agencyName: string | null;
  publishedDate: Date | null;
  applicationCloseDate: Date | null;
}

/**
 * Which announcements to fetch this run.
 *
 * An entry whose sitemap `lastmod` is no newer than the one we already stored
 * is skipped, so a steady-state weekly run touches roughly 22 pages instead of
 * the 2,000 in the archive. `limit` caps a run and takes the NEWEST, because a
 * capped run should make progress on the freshest announcements rather than an
 * arbitrary slice.
 *
 * If a held `lastmod` is somehow newer than the sitemap's own — clock skew, or
 * a publisher correcting a wrongly-future-dated entry downward — that
 * announcement is never refetched again, silently, with no log line. That is
 * the documented policy working exactly as designed, not a bug, but it will
 * read as a mystery six months from now if nobody wrote it down.
 */
export function planJob108Fetch(
  entries: SitemapEntry[],
  heldLastmodById: Map<string, Date>,
  limit?: number,
): SitemapEntry[] {
  const due = entries.filter((e) => {
    const held = heldLastmodById.get(e.announcementId);
    return held === undefined || e.lastmod.getTime() > held.getTime();
  });
  const newestFirst = [...due].sort((a, b) => b.lastmod.getTime() - a.lastmod.getTime());
  return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
}

/** Identity derives from content, not from the order the model returned
 *  positions in. With an index-based id, a re-extraction that reordered two
 *  positions would silently reassign `#1` from one job to another — no
 *  constraint violation, because rows are deleted and recreated rather than
 *  diffed. Hashing title + qualification means an unchanged position keeps
 *  its id whatever the order, and a genuinely reworded one gets a new id,
 *  which is the semantics anything downstream would expect. Nothing reads
 *  job-108 rows today, so this costs nothing now and saves a backfill once
 *  something does. The `\u0000` separator (an escape inside the template
 *  literal, not a literal NUL byte in the file — checked with
 *  `grep -cP '\x00'`) stops title="ab", qual="c" colliding with
 *  title="a", qual="bc". */
const positionExternalId = (announcementId: string, p: Job108Position): string =>
  `${announcementId}#${createHash('sha256').update(`${p.title}\u0000${p.qualificationRaw}`).digest('hex').slice(0, 10)}`;

/**
 * One row per position-type. `positionCount` rides along as evidence and is
 * never multiplied out: an 89-seat announcement is one row, because JobThai
 * carries no headcount column and counting public seats against private
 * adverts of unknown size would over-weight the public side by an unknowable
 * factor.
 *
 * `postedDateEstimated` is FALSE whenever the page states a date, unlike every
 * JobThai row, which carries its batch receipt date. When a page states none,
 * the fetch date stands in and the flag says so.
 */
export function toPostingRows(
  header: Job108AnnouncementHeader,
  positions: Job108Position[],
  fetchedAt: Date = new Date(),
): Job108PostingRow[] {
  const posted = header.publishedDate ?? fetchedAt;
  return positions.map((p) => ({
    externalId: positionExternalId(header.announcementId, p),
    title: p.title,
    employerName: header.agencyName,
    postedDate: posted,
    postedDateEstimated: header.publishedDate === null,
    applicationCloseDate: header.applicationCloseDate,
    positionCount: p.positionCount,
    salaryMin: p.salaryMin,
    salaryMax: p.salaryMax,
    minEducationLevel: p.minEducationLevel,
    requiredFieldsRaw: p.requiredFieldsRaw,
    qualificationRaw: p.qualificationRaw,
    // descriptionRaw is NOT NULL, and these pages carry no separate duties
    // section — only a qualification block — so this duplicates rather than
    // inventing content. A future evidence panel showing "Description" and
    // "Qualifications" side by side will show the same text twice for a
    // government posting; that is honest, not a bug.
    descriptionRaw: p.qualificationRaw,
  }));
}

export function hashPage(bytes: string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `announcementId → sourceLastmod` for everything already stored, FAILED
 *  rows included.
 *
 *  Including failures is deliberate. Excluding them made every permanently
 *  unparseable page — a withdrawn posting, a news item swept into the sitemap
 *  — due on every run forever, at a model call each time. The cost of the
 *  opposite mistake is smaller and recoverable: a transiently failed page
 *  waits for the source to bump its lastmod, or for an operator to force a
 *  refetch. The durable answer is a retry-count column with backoff, which
 *  this schema does not have yet. */
export async function heldAnnouncementLastmods(): Promise<Map<string, Date>> {
  const rows = await prisma.job108Announcement.findMany({
    where: { status: { in: ['EXTRACTED', 'FAILED'] } },
    select: { announcementId: true, sourceLastmod: true },
  });
  return new Map(
    rows.flatMap((r) => (r.sourceLastmod === null ? [] : [[r.announcementId, r.sourceLastmod] as const])),
  );
}

/**
 * Replace an announcement and its positions in one transaction.
 *
 * Positions are deleted and rewritten rather than merged: a re-extraction
 * that returns fewer positions than last time would otherwise leave orphans
 * claiming to be current. The announcement row itself is preserved across a
 * re-extraction, so its `id` and `createdAt` survive a fail→succeed→fail
 * cycle — but `parseError` is cleared unconditionally on a successful
 * re-extraction, because a stale error no longer describes the current state
 * and leaving it would misrepresent a now-working page as still broken.
 *
 * Every row carries `ingestionRunId`. Omitting it is what has left rows
 * invisible to realDataWhere() three times in this repository.
 */
export async function upsertJob108Announcement(args: {
  announcementId: string;
  url: string;
  contentHash: string;
  title: string | null;
  header: Job108AnnouncementHeader;
  applicationOpenDate: Date | null;
  sourceLastmod: Date;
  rows: Job108PostingRow[];
  runId: string;
}): Promise<{ postingsWritten: number }> {
  return prisma.$transaction(
    async (tx) => {
      const announcement = await tx.job108Announcement.upsert({
        where: { announcementId: args.announcementId },
        create: {
          announcementId: args.announcementId,
          url: args.url,
          contentHash: args.contentHash,
          title: args.title,
          agencyName: args.header.agencyName,
          publishedDate: args.header.publishedDate,
          applicationOpenDate: args.applicationOpenDate,
          applicationCloseDate: args.header.applicationCloseDate,
          sourceLastmod: args.sourceLastmod,
          status: 'EXTRACTED',
          parseError: null,
          ingestionRunId: args.runId,
        },
        update: {
          url: args.url,
          contentHash: args.contentHash,
          title: args.title,
          agencyName: args.header.agencyName,
          publishedDate: args.header.publishedDate,
          applicationOpenDate: args.applicationOpenDate,
          applicationCloseDate: args.header.applicationCloseDate,
          sourceLastmod: args.sourceLastmod,
          fetchedAt: new Date(),
          status: 'EXTRACTED',
          parseError: null,
          ingestionRunId: args.runId,
        },
        select: { id: true },
      });

      await tx.jobPosting.deleteMany({ where: { job108AnnouncementId: announcement.id } });

      // createMany rather than a create loop: the loop held this
      // announcement's row lock for its whole duration, and the loop plus
      // the bare `$transaction` call below it used to inherit Prisma's
      // default 5s interactive-transaction timeout. During the
      // 2,000-announcement backfill, one large announcement or a moment of
      // connection-pool contention would fail the whole write with P2028 —
      // discarding an LLM extraction we had already paid a model call for.
      // Nothing here blocks createMany: no created id is read back,
      // requiredFieldsRaw is a plain Postgres array, and both foreign keys
      // are scalars rather than nested writes.
      const created = await tx.jobPosting.createMany({
        data: args.rows.map((row) => ({
          source: PUBLIC_DEMAND_SOURCE,
          externalId: row.externalId,
          title: row.title,
          employerName: row.employerName,
          postedDate: row.postedDate,
          postedDateEstimated: row.postedDateEstimated,
          freshnessDate: row.postedDate,
          applicationCloseDate: row.applicationCloseDate,
          positionCount: row.positionCount,
          salaryMin: row.salaryMin,
          salaryMax: row.salaryMax,
          minEducationLevel: row.minEducationLevel,
          requiredFieldsRaw: row.requiredFieldsRaw,
          qualificationRaw: row.qualificationRaw,
          descriptionRaw: row.descriptionRaw,
          job108AnnouncementId: announcement.id,
          ingestionRunId: args.runId,
        })),
      });

      // The number actually written, not args.rows.length: createMany can
      // legitimately write fewer rows than it was given (e.g. a duplicate
      // externalId within the same batch), and the caller should be told
      // what happened, not what was attempted.
      return { postingsWritten: created.count };
    },
    // A busy backfill announcement, or a moment of connection-pool
    // contention, must not abort at Prisma's 5s interactive-transaction
    // default. 30s is a wide margin over the single createMany call this
    // now does; maxWait bounds how long we queue for a connection before
    // giving up, so a genuinely stuck pool still fails loudly rather than
    // hanging.
    { maxWait: 10_000, timeout: 30_000 },
  );
}

/**
 * Record a page we could not extract, without losing the reason.
 *
 * `title` is left null rather than filled with the announcement id. The schema
 * makes it nullable precisely so a FAILED row can be stored honestly; writing
 * a placeholder would put invented data in a Council-facing table.
 */
export async function recordJob108Failure(args: {
  announcementId: string;
  url: string;
  contentHash: string;
  sourceLastmod: Date;
  error: string;
  runId: string;
}): Promise<void> {
  await prisma.job108Announcement.upsert({
    where: { announcementId: args.announcementId },
    create: {
      announcementId: args.announcementId,
      url: args.url,
      contentHash: args.contentHash,
      title: null,
      sourceLastmod: args.sourceLastmod,
      status: 'FAILED',
      parseError: args.error.slice(0, 2_000),
      ingestionRunId: args.runId,
    },
    update: {
      status: 'FAILED',
      parseError: args.error.slice(0, 2_000),
      fetchedAt: new Date(),
      ingestionRunId: args.runId,
    },
  });
}

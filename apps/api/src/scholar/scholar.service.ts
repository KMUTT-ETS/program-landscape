import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SCHOLAR_NEEDS_BINDING,
  bindScholarProfile,
  prisma,
  resolveScholarFacultyMember,
} from '@kku/db';
import {
  ApiError,
  GOOGLE_PAGE_CREDIT_COST,
  configFromEnv as scrapingBeeConfigFromEnv,
  decideScholarQuota,
  fetchScrapingBeePage,
  type Role,
  type ScrapingBeeConfig,
  type ScholarStatus,
  type ScholarTrigger,
} from '@kku/shared';
import { AiJobsQueueService } from '../ai-jobs/ai-jobs-queue.service';

// ────────────────────────────────────────────────────────────────────────────
// Google Scholar on-demand fetch — API layer.
//
// The split between synchronous and queued is deliberate and is the shape of
// this whole module:
//
//   BIND is synchronous. It is one page fetch, and a human has just pasted a
//   URL and is waiting to hear whether it was accepted. Handing them a job id
//   to poll for a yes/no answer would be worse in every way.
//
//   FETCH is queued. A profile is 1-2 pages at 3-8s each (up to 10 at the
//   runner's ceiling), which is too long to hold an HTTP request open. The
//   endpoints return a job reference and the UI polls GET /scholar/status/me.
//
// Nothing here writes a ResearchOutput row or a ScholarFetchRun row: the
// runner in packages/db/src/scholar-fetch.ts is the only writer, and this
// service's whole job is to decide who may ask for what, price it, and hand
// it to the queue.
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_BULK_MAX_TARGETS = 100;

/** How far back GET /scholar/status/me reads the ledger. The quota window is
 *  30 days; 90 gives decideScholarQuota headroom and bounds the query — the
 *  same lookback the runner uses. */
const LEDGER_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export interface ScholarEnqueueResult {
  jobId: string;
  userId: string;
  trigger: ScholarTrigger;
}

export interface ScholarBulkTargetPlan {
  userId: string;
  /** A profile is already linked, so the fetch can spend credits on pages. */
  profileBound: boolean;
  /** No staff record could be resolved — the fetch will refuse before it
   *  spends anything. Surfaced so the console can grey the row out rather
   *  than let an operator wonder why nothing happened. */
  resolutionRefusal: string | null;
}

export interface ScholarBulkResult {
  enqueued: ScholarEnqueueResult[];
  /** Distinct targets asked for, after de-duplication. */
  targetCount: number;
  /** Duplicate ids the request carried and this service collapsed. */
  duplicatesDropped: number;
  estimatedCredits: number;
  targets: ScholarBulkTargetPlan[];
}

export interface ScholarSelfStatus {
  userId: string;
  /** The staff record this account resolves to, or why it does not resolve
   *  to exactly one. Without a staff record no fetch is possible at all, so
   *  this is the first thing the UI has to be able to say. */
  staffRecord:
    | { linked: true; facultyMemberId: string; nameEn: string; nameTh: string }
    | { linked: false; reason: string };
  profile:
    | { bound: true; scholarProfileId: string; scholarProfileUrl: string | null; boundAt: Date | null }
    | { bound: false };
  lastRun: {
    id: string;
    status: ScholarStatus;
    trigger: ScholarTrigger;
    startedAt: Date;
    finishedAt: Date | null;
    papersFound: number;
    papersInserted: number;
    citationsUpdated: number;
    creditsUsed: number;
    /** Why it ended the way it did. For a REFUSED run this is the actionable
     *  sentence; `needsBinding` below says whether it was the unbound case. */
    errorText: string | null;
    needsBinding: boolean;
  } | null;
  /** Null when a fetch may be started now. Derived from the quota unit's own
   *  `retryAt` rather than recomputed from the last run's date, so the window
   *  has exactly one definition. */
  nextEligibleAt: Date | null;
  quotaReason: string | null;
  /** True when the next step is "paste a profile URL", from either side:
   *  no profile on the staff record, or a run that refused for that reason. */
  needsBinding: boolean;
}

/**
 * Floor price of a bulk run, in ScrapingBee credits.
 *
 * A bound target costs at least one publication page. An unbound one costs
 * that plus the page `bindScholarProfile` spends verifying the profile name
 * before it will link it — somebody has to pay for that page before the fetch
 * can do anything.
 *
 * It is a FLOOR, not an estimate of the likely spend: a prolific researcher's
 * profile runs to several pages (up to SCHOLAR_MAX_PAGES = 10), and this
 * cannot know how many without fetching. The console must present it as
 * "at least", never as "this will cost".
 */
export function estimateScholarBulkCredits(
  targets: ReadonlyArray<{ profileBound: boolean }>,
): number {
  const pages = targets.reduce((sum, t) => sum + (t.profileBound ? 1 : 2), 0);
  return pages * GOOGLE_PAGE_CREDIT_COST;
}

@Injectable()
export class ScholarService {
  private readonly logger = new Logger(ScholarService.name);

  constructor(
    private readonly queue: AiJobsQueueService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Server-side ceiling on a bulk request. The admin console shows it too,
   * but the console is not the guard: a bulk run is the one place in this
   * feature where a single click can spend hundreds of credits.
   */
  bulkMaxTargets(): number {
    const raw = this.config.get<string | number>('SCHOLAR_BULK_MAX_TARGETS');
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BULK_MAX_TARGETS;
    return Math.floor(parsed);
  }

  // ── Self ────────────────────────────────────────────────────────────────

  async enqueueSelfFetch(userId: string, actorRole: Role): Promise<ScholarEnqueueResult> {
    return this.enqueueOne({ userId, triggeredById: userId, trigger: 'SELF', actorRole });
  }

  /**
   * Link a Scholar profile to the caller's own staff record — synchronously,
   * because the answer is a yes or a no and the person is waiting for it.
   *
   * `bindScholarProfile` refuses on a name mismatch, an already-linked
   * profile, an unreadable page and a malformed URL, all by throwing a plain
   * Error whose message is written to be read by the person who pasted the
   * URL. Those are user-fixable input problems, so they are mapped to
   * VALIDATION_FAILED (400) rather than allowed to surface as a 500 with the
   * message swallowed by the exception filter.
   */
  async bindOwnProfile(
    userId: string,
    url: string,
  ): Promise<{ scholarProfileId: string; profileName: string; creditsUsed: number }> {
    const { member, refusal } = await resolveScholarFacultyMember(userId);
    if (!member) {
      throw new ApiError(
        'NOT_FOUND',
        refusal ?? 'This account could not be matched to a single staff record.',
      );
    }

    let cfg: ScrapingBeeConfig;
    try {
      cfg = scrapingBeeConfigFromEnv();
    } catch (err) {
      // Missing API key: an operator problem, not the caller's.
      throw new ApiError(
        'UPSTREAM_UNAVAILABLE',
        err instanceof Error ? err.message : 'Scholar fetching is not configured.',
      );
    }

    try {
      return await bindScholarProfile({
        facultyMemberId: member.id,
        url,
        boundById: userId,
        fetchPage: async (targetUrl) => {
          const page = await fetchScrapingBeePage(targetUrl, cfg);
          return { html: page.html, creditsUsed: page.creditsUsed };
        },
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        'VALIDATION_FAILED',
        err instanceof Error ? err.message : 'Could not link that Scholar profile.',
      );
    }
  }

  /**
   * Everything the self-service panel needs to decide what to show: whether a
   * staff record exists at all, whether a profile is bound, what the last run
   * did, and when the next one may run.
   */
  async selfStatus(userId: string, actorRole: Role): Promise<ScholarSelfStatus> {
    const { member, refusal } = await resolveScholarFacultyMember(userId);

    let profile: ScholarSelfStatus['profile'] = { bound: false };
    if (member?.scholarProfileId) {
      const row = await prisma.facultyMember.findUnique({
        where: { id: member.id },
        select: { scholarProfileId: true, scholarProfileUrl: true, scholarBoundAt: true },
      });
      if (row?.scholarProfileId) {
        profile = {
          bound: true,
          scholarProfileId: row.scholarProfileId,
          scholarProfileUrl: row.scholarProfileUrl,
          boundAt: row.scholarBoundAt,
        };
      }
    }

    const now = new Date();
    const runs = await prisma.scholarFetchRun.findMany({
      where: { userId, startedAt: { gte: new Date(now.getTime() - LEDGER_LOOKBACK_MS) } },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        status: true,
        trigger: true,
        startedAt: true,
        finishedAt: true,
        papersFound: true,
        papersInserted: true,
        citationsUpdated: true,
        creditsUsed: true,
        errorText: true,
      },
    });

    const latest = runs[0] ?? null;
    const lastRunNeedsBinding = Boolean(latest?.errorText?.startsWith(SCHOLAR_NEEDS_BINDING));

    // One source of truth for the window: the same pure function the runner
    // consults. Recomputing "last success + 30 days" here would be a second
    // definition, and the two would drift the first time the window changed.
    const quota = decideScholarQuota({
      trigger: 'SELF',
      actorRole,
      runs: runs.map((r) => ({ trigger: r.trigger, status: r.status, startedAt: r.startedAt })),
      now,
    });

    return {
      userId,
      staffRecord: member
        ? {
            linked: true,
            facultyMemberId: member.id,
            nameEn: member.nameEn,
            nameTh: member.nameTh,
          }
        : {
            linked: false,
            reason: refusal ?? 'This account could not be matched to a single staff record.',
          },
      profile,
      lastRun: latest
        ? {
            id: latest.id,
            status: latest.status,
            trigger: latest.trigger,
            startedAt: latest.startedAt,
            finishedAt: latest.finishedAt,
            papersFound: latest.papersFound,
            papersInserted: latest.papersInserted,
            citationsUpdated: latest.citationsUpdated,
            creditsUsed: latest.creditsUsed,
            errorText: latest.errorText,
            needsBinding: lastRunNeedsBinding,
          }
        : null,
      nextEligibleAt: quota.allowed ? null : (quota.retryAt ?? null),
      quotaReason: quota.allowed ? null : (quota.reason ?? null),
      needsBinding: Boolean(member) && (!profile.bound || lastRunNeedsBinding),
    };
  }

  // ── Admin ───────────────────────────────────────────────────────────────

  async enqueueForUser(
    targetUserId: string,
    actor: { userId: string; role: Role },
  ): Promise<ScholarEnqueueResult> {
    const exists = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!exists) throw new ApiError('NOT_FOUND', `No user with id "${targetUserId}".`);
    return this.enqueueOne({
      userId: targetUserId,
      triggeredById: actor.userId,
      trigger: 'ADMIN',
      actorRole: actor.role,
    });
  }

  /**
   * Enqueue one ADMIN_BULK job per target.
   *
   * De-duplication happens BEFORE the cap is applied, on purpose: a console
   * that sends 150 ids describing 40 distinct people is asking for 40 fetches,
   * and rejecting that as "over the 100 limit" would be wrong about what was
   * requested. It also means the cap counts the thing that actually costs
   * money — one job, one profile walk — rather than the length of a list.
   */
  async enqueueBulk(
    userIds: readonly string[],
    actor: { userId: string; role: Role },
  ): Promise<ScholarBulkResult> {
    const distinct = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    const duplicatesDropped = userIds.length - distinct.length;

    if (distinct.length === 0) {
      throw new ApiError('VALIDATION_FAILED', 'No usable user ids in the request.');
    }

    const max = this.bulkMaxTargets();
    if (distinct.length > max) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `A bulk Scholar fetch is capped at ${max} people; this request names ${distinct.length} distinct ones. ` +
          'Split it into smaller batches — each person costs real ScrapingBee credits.',
        { max, requested: distinct.length },
      );
    }

    // Priced before anything is enqueued, using the same resolution the
    // runner will perform, so the console's confirmation dialog is quoting
    // the real shape of the run rather than a guess. This is O(targets)
    // resolutions and each one scans FacultyMember for the name path — which
    // is why the cap above is not optional.
    const targets: ScholarBulkTargetPlan[] = [];
    for (const userId of distinct) {
      const { member, refusal } = await resolveScholarFacultyMember(userId);
      targets.push({
        userId,
        profileBound: Boolean(member?.scholarProfileId),
        resolutionRefusal: member ? null : (refusal ?? 'No single staff record matches this account.'),
      });
    }

    const enqueued: ScholarEnqueueResult[] = [];
    for (const target of targets) {
      enqueued.push(
        await this.enqueueOne({
          userId: target.userId,
          triggeredById: actor.userId,
          trigger: 'ADMIN_BULK',
          actorRole: actor.role,
        }),
      );
    }

    return {
      enqueued,
      targetCount: distinct.length,
      duplicatesDropped,
      estimatedCredits: estimateScholarBulkCredits(targets),
      targets,
    };
  }

  /** The run ledger, newest first — the admin console's whole view of what
   *  has been spent and on whom. */
  async listRuns(query: { limit: number; userId?: string; status?: ScholarStatus }) {
    const rows = await prisma.scholarFetchRun.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: query.limit,
      select: {
        id: true,
        userId: true,
        facultyMemberId: true,
        triggeredById: true,
        trigger: true,
        status: true,
        searchQuery: true,
        scholarProfileId: true,
        papersFound: true,
        papersInserted: true,
        citationsUpdated: true,
        creditsUsed: true,
        errorText: true,
        startedAt: true,
        finishedAt: true,
        user: { select: { id: true, name: true, email: true } },
        triggeredBy: { select: { id: true, name: true } },
      },
    });
    return {
      runs: rows.map((r) => ({
        ...r,
        needsBinding: Boolean(r.errorText?.startsWith(SCHOLAR_NEEDS_BINDING)),
      })),
      totalCreditsUsed: rows.reduce((sum, r) => sum + r.creditsUsed, 0),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async enqueueOne(input: {
    userId: string;
    triggeredById: string;
    trigger: ScholarTrigger;
    actorRole: Role;
  }): Promise<ScholarEnqueueResult> {
    const jobId = await this.queue.enqueue({
      kind: 'SCHOLAR_FETCH',
      entityId: input.userId,
      triggeredByUserId: input.triggeredById,
      // The JOB trigger. Always MANUAL here — every route into this service
      // is a person clicking something. Which Scholar allowance the run
      // spends is `scholarTrigger`, a different axis entirely.
      trigger: 'MANUAL',
      scholarTrigger: input.trigger,
      scholarActorRole: input.actorRole,
    });
    this.logger.log(
      `SCHOLAR_FETCH queued job=${jobId} user=${input.userId} trigger=${input.trigger} by=${input.triggeredById}`,
    );
    return { jobId, userId: input.userId, trigger: input.trigger };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SCHOLAR_NEEDS_BINDING,
  bindScholarProfile,
  planScholarBulkTargets,
  prisma,
  resolveScholarFacultyMember,
  type ScholarBulkTargetPlan,
} from '@kku/db';
import {
  ApiError,
  DEFAULT_SCHOLAR_BIND_MAX_PER_DAY,
  SCHOLAR_LEDGER_LOOKBACK_MS,
  configFromEnv as scrapingBeeConfigFromEnv,
  decideScholarBindQuota,
  decideScholarQuota,
  estimateScholarBulkCredits,
  fetchScrapingBeePage,
  parseScholarProfileUrl,
  scholarBindQuotaWhere,
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

export interface ScholarEnqueueResult {
  jobId: string;
  userId: string;
  trigger: ScholarTrigger;
}

// The plan shape lives in @kku/db beside `planScholarBulkTargets`, which is
// the one place that decides it — the console prices a run through the same
// function one round trip before this endpoint does. Re-exported so callers of
// this service keep a single import.
export type { ScholarBulkTargetPlan };

export interface ScholarBulkResult {
  enqueued: ScholarEnqueueResult[];
  /** Targets that were priced and reported but NOT enqueued, because the
   *  pre-flight already proved the run would refuse before doing anything. */
  skipped: ScholarBulkTargetPlan[];
  /** Distinct targets asked for, after de-duplication. */
  targetCount: number;
  /** Duplicate ids the request carried and this service collapsed. */
  duplicatesDropped: number;
  estimatedCredits: number;
  /** Targets that actually reached Google, and therefore what
   *  `estimatedCredits` prices. Echoed so the caller can see that the number
   *  it quoted and the number that was billed describe the same run. */
  chargeableCount: number;
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
  /**
   * A fetch for this person is waiting or running on the queue right now.
   *
   * Without it a click is invisible: the job is enqueued, `lastRun` still
   * shows the PREVIOUS run, and the honest reading of the panel is "nothing
   * happened" — so the user clicks again. The runner's in-flight guard would
   * eventually refuse the duplicate, but only after it had been queued.
   */
  fetchQueued: boolean;
  /** How many binds are left today, and when the allowance frees up. Shown
   *  next to the paste-a-URL field, because a bind is billed whether or not
   *  it matches. */
  bind: { attemptsToday: number; maxPerDay: number; retryAt: Date | null };
}

// Priced by @kku/shared, and re-exported here because two processes have to
// quote the same number: this endpoint prices the run it is about to enqueue,
// and the admin console prices the same run one round trip earlier so the
// operator sees a figure before anything is spent. The re-export keeps the
// existing `from '../src/scholar/scholar.service'` import in
// apps/api/test/scholar-service.test.ts pointing at the one implementation.
export { estimateScholarBulkCredits } from '@kku/shared';

/**
 * Which recorded bind attempts count against a person's daily allowance.
 *
 * Everything that SPENT, plus every REFUSED attempt whether it spent or not.
 * The refusals are the point of the cap — a name mismatch is billed in full,
 * and "no staff record, try again, try again" is the same button in the same
 * loop even though it costs nothing.
 *
 * What does NOT count is a zero-cost FAILED attempt, which in practice means
 * exactly one thing: SCRAPINGBEE_API_KEY is unset. Those rows are still
 * written — a fresh deploy whose key was never filled in must not present as
 * a silently inert button — but charging them to the user would mean five
 * clicks against a broken deploy locked them out of binding for a day after
 * the operator fixed it. Our fault, our cost.
 *
 * THE DEFINITION MOVED to `@kku/shared`, beside `decideScholarBindQuota`, on
 * 2026-09-09, and this is now an alias for it. The fetch runner meters its
 * 75-credit name search against the same cap — a name search is a bind
 * attempt, not a fetch — so two copies of the filter would mean the number
 * shown to a user here and the number enforced against them there could
 * drift apart. One definition, two callers.
 */
const bindQuotaWhere = scholarBindQuotaWhere;

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

  /**
   * Binds allowed per person per rolling 24 hours. A bind fetches a Google
   * page (~15 credits) BEFORE the name check that can reject it, so a wrong
   * URL is billed in full — this is the only thing standing between a paste
   * field and the ScrapingBee invoice.
   */
  bindMaxPerDay(): number {
    const raw = this.config.get<string | number>('SCHOLAR_BIND_MAX_PER_DAY');
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCHOLAR_BIND_MAX_PER_DAY;
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
   * EVERY ATTEMPT IS METERED AND RECORDED, including the ones that fail.
   * Verifying that a profile belongs to this person means fetching page 1 of
   * it (~15 ScrapingBee credits) and reading the name off the page, so a bind
   * refused for a name mismatch has already been billed in full. Before this
   * was metered, the only guard was a 10/min throttle keyed per user — 150
   * credits a minute, no daily ceiling — and the credits left no trace
   * anywhere, because a bind writes no ScholarFetchRun and the run ledger's
   * credit total therefore could not see them. Pasting one wrong profile id
   * after another was an unrecorded drain on the plan; a UI retry loop or a
   * confused user retrying a bad URL did the same, slower.
   *
   * So: the cap is checked BEFORE the page is fetched, and the attempt is
   * written to `scholar_bind_attempts` with its real cost on every path out.
   * The credit tally comes from this method's own fetcher closure rather than
   * from `bindScholarProfile`'s return value, because that value only exists
   * on the success path — and the refusals are exactly the attempts that
   * spend without producing anything.
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
    actorRole: Role,
  ): Promise<{ scholarProfileId: string; profileName: string; creditsUsed: number }> {
    const { member, refusal } = await resolveScholarFacultyMember(userId);

    // Cap first, so a refused attempt cannot be retried into a drain. Read
    // before the resolution refusal below is raised, so that "no staff record,
    // try again, try again" is counted too — it spends nothing itself, but it
    // is the same button and the same loop.
    const now = new Date();
    const attempts = await prisma.scholarBindAttempt.findMany({
      where: bindQuotaWhere(userId, now),
      select: { createdAt: true },
    });
    const quota = decideScholarBindQuota({
      actorRole,
      attempts,
      now,
      maxPerDay: this.bindMaxPerDay(),
    });
    if (!quota.allowed) {
      // No row written: this attempt cost nothing, and a ledger entry for it
      // would make tomorrow's allowance smaller than the cap says it is.
      throw new ApiError('RATE_LIMITED', quota.reason ?? 'Too many bind attempts today.', {
        retryAt: quota.retryAt?.toISOString(),
      });
    }

    // Recorded even though nothing was fetched: the operator asking "why does
    // this person keep failing to bind" needs the resolution failures in the
    // same place as the billed ones.
    if (!member) {
      const reason = refusal ?? 'This account could not be matched to a single staff record.';
      await this.recordBindAttempt({ userId, url, outcome: 'REFUSED', creditsUsed: 0, errorText: reason });
      throw new ApiError('NOT_FOUND', reason);
    }

    let cfg: ScrapingBeeConfig;
    try {
      cfg = scrapingBeeConfigFromEnv();
    } catch (err) {
      // Missing API key: an operator problem, not the caller's, and it spends
      // nothing — but it is recorded so a fresh deploy whose key was never
      // filled in does not present as a silently inert button.
      const message = err instanceof Error ? err.message : 'Scholar fetching is not configured.';
      await this.recordBindAttempt({
        userId,
        facultyMemberId: member.id,
        url,
        outcome: 'FAILED',
        creditsUsed: 0,
        errorText: message,
      });
      throw new ApiError('UPSTREAM_UNAVAILABLE', message);
    }

    // The credit tally lives here, in the closure, so it is correct on the
    // throwing paths too.
    let creditsSpent = 0;
    const parsedUrl = parseScholarProfileUrl(url);
    const scholarProfileId = parsedUrl.ok ? parsedUrl.profileId : null;

    try {
      const result = await bindScholarProfile({
        facultyMemberId: member.id,
        url,
        boundById: userId,
        fetchPage: async (targetUrl) => {
          const page = await fetchScrapingBeePage(targetUrl, cfg);
          if (typeof page.creditsUsed === 'number' && Number.isFinite(page.creditsUsed)) {
            creditsSpent += page.creditsUsed;
          }
          return { html: page.html, creditsUsed: page.creditsUsed };
        },
      });
      await this.recordBindAttempt({
        userId,
        facultyMemberId: member.id,
        url,
        scholarProfileId: result.scholarProfileId,
        outcome: 'BOUND',
        profileName: result.profileName,
        creditsUsed: Math.round(creditsSpent),
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not link that Scholar profile.';
      await this.recordBindAttempt({
        userId,
        facultyMemberId: member.id,
        url,
        scholarProfileId,
        outcome: 'REFUSED',
        creditsUsed: Math.round(creditsSpent),
        errorText: message,
      });
      if (err instanceof ApiError) throw err;
      throw new ApiError('VALIDATION_FAILED', message);
    }
  }

  /**
   * Write one bind attempt to the ledger. NEVER throws: the attempt has
   * already happened and the credits are already spent, so replacing the
   * caller's real error (or their successful bind) with a database error
   * would lose the more useful of the two. A ledger write that fails is
   * logged loudly instead, because a hole in a spend ledger matters.
   */
  private async recordBindAttempt(data: {
    userId: string;
    facultyMemberId?: string;
    url: string;
    scholarProfileId?: string | null;
    outcome: 'BOUND' | 'REFUSED' | 'FAILED';
    profileName?: string;
    creditsUsed: number;
    errorText?: string;
  }): Promise<void> {
    try {
      await prisma.scholarBindAttempt.create({
        data: {
          userId: data.userId,
          facultyMemberId: data.facultyMemberId ?? null,
          url: data.url.slice(0, 2048),
          scholarProfileId: data.scholarProfileId ?? null,
          outcome: data.outcome,
          profileName: data.profileName ?? null,
          creditsUsed: data.creditsUsed,
          errorText: data.errorText ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `could not record scholar bind attempt for user=${data.userId} ` +
          `(outcome=${data.outcome}, credits=${data.creditsUsed}): ` +
          (err instanceof Error ? err.message : String(err)),
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
      where: { userId, startedAt: { gte: new Date(now.getTime() - SCHOLAR_LEDGER_LOOKBACK_MS) } },
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

    // Is a fetch already on the queue for this person? Read alongside the
    // ledger, because "you clicked and it is waiting" and "here is your last
    // run" are the two halves of the same answer.
    const fetchQueued = (await this.queue.countRunning('SCHOLAR_FETCH', userId)) > 0;

    // Same filter the cap itself uses, so the number shown to the user and the
    // number enforced against them are the same number.
    const bindAttempts = await prisma.scholarBindAttempt.findMany({
      where: bindQuotaWhere(userId, now),
      select: { createdAt: true },
    });
    const bindMaxPerDay = this.bindMaxPerDay();
    const bindQuota = decideScholarBindQuota({
      actorRole,
      attempts: bindAttempts,
      now,
      maxPerDay: bindMaxPerDay,
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
      fetchQueued,
      bind: {
        attemptsToday: bindAttempts.length,
        maxPerDay: bindMaxPerDay,
        retryAt: bindQuota.allowed ? null : (bindQuota.retryAt ?? null),
      },
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
    /**
     * The number of chargeable targets the CALLER was shown before it
     * confirmed — the console's quote, handed back as a token.
     *
     * Optional, so the endpoint stays callable by hand during an incident; the
     * console always sends it. When present it is checked against this
     * service's own count and a disagreement refuses the whole request.
     *
     * The window it closes is small but real and only ever costs money in one
     * direction: between the quote and the confirmation, targets can BIND
     * their own profiles from /profile — self-service, no administrator
     * involved — and every one that does turns a free refusal into a paid
     * profile walk. Ten selected with two linked quotes 30 credits; if eight
     * of them link in the meantime, confirming spends at least 150.
     */
    expectedChargeableCount?: number,
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

    // Priced before anything is enqueued, through the SAME function the admin
    // console priced it with one round trip ago — which is what makes the
    // token check below a check on the world changing rather than on the two
    // sides drifting apart. Three queries for the whole batch, not two per
    // target.
    //
    // Targets we have just PROVED cannot resolve are not enqueued. Their jobs
    // would reach `refusedWithoutRun`, which by design writes no
    // ScholarFetchRun — so they would occupy worker slots and vanish without a
    // trace, exactly the blind spot the config-failure row in the handler
    // exists to close. They are still returned in `targets[]` with the reason.
    //
    // Unbound and quota-blocked targets ARE enqueued: their refusals are
    // recorded as run rows, and the unbound one is where SCHOLAR_NEEDS_BINDING
    // comes from — the thing that puts "paste your profile URL" in front of
    // the right people. Neither spends anything.
    const plan = await planScholarBulkTargets({
      userIds: distinct,
      actorRole: actor.role,
      trigger: 'ADMIN_BULK',
    });

    if (
      typeof expectedChargeableCount === 'number' &&
      expectedChargeableCount !== plan.chargeableCount
    ) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `The estimate you confirmed covered ${expectedChargeableCount} ` +
          `${expectedChargeableCount === 1 ? 'profile' : 'profiles'} to fetch from Google. ` +
          `It would now be ${plan.chargeableCount}, because somebody linked or unlinked a ` +
          'Scholar profile since that estimate was taken. Nothing was queued — take a fresh estimate.',
        { quoted: expectedChargeableCount, actual: plan.chargeableCount },
      );
    }

    const enqueued: ScholarEnqueueResult[] = [];
    for (const target of plan.runnable) {
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
      skipped: plan.skipped,
      targetCount: distinct.length,
      duplicatesDropped,
      estimatedCredits: estimateScholarBulkCredits(plan.runnable),
      chargeableCount: plan.chargeableCount,
      targets: plan.targets,
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

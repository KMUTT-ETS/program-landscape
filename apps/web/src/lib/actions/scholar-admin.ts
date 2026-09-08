'use server';

import { z } from 'zod';
import { SCHOLAR_NEEDS_BINDING, planScholarBulkTargets } from '@kku/db';
import { can, estimateScholarBulkCredits, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { scholarBulkMaxTargets } from '@/lib/scholar-admin-config';
import { apiFetch } from '@/lib/api-client';
import type {
  ScholarBulkPreview,
  ScholarLedger,
  ScholarLedgerRun,
} from '@/lib/scholar-admin';

// Server actions behind the admin Scholar console.
//
// Four calls, and the split between them is the shape of the whole page:
//
//   preview — PRICES a bulk fetch WITHOUT enqueueing anything. Free.
//   bulk    — POST /scholar/fetch/bulk. Enqueues. Spends.
//   fetchOne— POST /scholar/fetch/:userId. Enqueues one. Spends.
//   runs    — GET  /scholar/runs. The ledger, polled while a batch lands.
//
// WHY `preview` EXISTS AT ALL. `POST /scholar/fetch/bulk` returns
// `estimatedCredits`, but it returns it AFTER enqueueing — by the time the API
// can quote a price, the jobs are on the queue. The console's requirement is
// the other way round: a number in front of the operator before anything is
// spent. So the preview runs the SAME resolution the API's pre-flight will run
// moments later (`resolveScholarMember` against one roster read) and prices it
// with the SAME function the API prices with (`estimateScholarBulkCredits`,
// which lives in @kku/shared for exactly this reason). It is a forecast of the
// API's own answer, not an independent opinion about money.
//
// Every action returns a discriminated result rather than throwing. A thrown
// server action reaches the client as an opaque digest with the message
// stripped in production, and the API's messages here are the actionable part
// — the bulk cap refusal names both the cap and the number requested.

/**
 * `preview` reads Prisma directly and therefore bypasses the NestJS guard that
 * protects every other route in this feature. A server action is a public
 * endpoint: without this check, anyone with a session could enumerate the
 * whole staff roster's resolution state through it.
 *
 * `actorRole` is the EFFECTIVE role, and that distinction is load-bearing
 * here rather than cosmetic. `JwtAuthGuard` replaces `role` outright with the
 * impersonated one, so `actor.role` on the API side already IS the effective
 * role — pricing the preview against the real role instead would make a
 * super-admin impersonating a system-admin quote without the quota (they are
 * exempt) and then be refused by an API that applies it, with the stale-quote
 * message blaming a change nobody made.
 */
async function requireScholarAdmin(): Promise<{ user: SessionUser; actorRole: string }> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) throw new Error('Not authenticated');
  if (!can(user, 'scholar:admin')) throw new Error('Forbidden — scholar:admin required');
  return { user, actorRole: user.effectiveRole ?? user.role };
}

function messageOf(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : '';
  return message.length > 0 ? message : fallback;
}

// ── Preview (free) ─────────────────────────────────────────────────────────

export type ScholarPreviewResult =
  | { ok: true; preview: ScholarBulkPreview }
  | { ok: false; message: string };

export async function previewScholarBulkAction(
  userIds: string[],
): Promise<ScholarPreviewResult> {
  try {
    const { actorRole } = await requireScholarAdmin();

    // The `string[]` in the signature is a compile-time claim and nothing
    // else — a server action's argument types are erased at runtime.
    if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== 'string')) {
      return { ok: false, message: 'Select people from the table before asking for an estimate.' };
    }

    // De-duplicated BEFORE the cap, matching `ScholarService.enqueueBulk`: a
    // request naming the same person twice asks for one fetch, and refusing it
    // as "over the limit" would be wrong about what was requested.
    const distinct = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    const duplicatesDropped = userIds.length - distinct.length;
    if (distinct.length === 0) {
      return { ok: false, message: 'No usable people in the selection.' };
    }

    // The SAME function the API will run moments later, against the same
    // gates the runner applies — resolution, then quota, then binding. That
    // shared path is what makes `expectedChargeableCount` below a token
    // rather than a second opinion: when the two disagree it is because the
    // world changed, not because two implementations drifted.
    //
    // `ADMIN_BULK` and the ACTOR's role, not the target's: the two admin
    // triggers share one quota counter, and SUPER_ADMIN is exempt outright,
    // so the same selection is blocked for one administrator and clear for
    // another.
    const plan = await planScholarBulkTargets({
      userIds: distinct,
      actorRole,
      trigger: 'ADMIN_BULK',
    });

    const quotaBlockedCount = plan.runnable.filter((t) => t.quotaBlocked).length;
    return {
      ok: true,
      preview: {
        userIds: distinct,
        targetCount: distinct.length,
        duplicatesDropped,
        chargeableCount: plan.chargeableCount,
        quotaBlockedCount,
        // Unbound is reported only for targets the quota would NOT have
        // stopped first. The runner checks quota at step 2 and binding at step
        // 4, so a person who is both is a quota refusal — counting them in
        // both buckets would make the dialog's four numbers overshoot the
        // target count.
        unboundCount: plan.runnable.filter((t) => !t.quotaBlocked && !t.profileBound).length,
        unresolvableCount: plan.skipped.length,
        estimatedCredits: estimateScholarBulkCredits(plan.runnable),
        maxTargets: scholarBulkMaxTargets(),
      },
    };
  } catch (err) {
    return { ok: false, message: messageOf(err, 'Could not price this fetch.') };
  }
}

// ── Enqueue ────────────────────────────────────────────────────────────────

export interface ScholarBulkOutcome {
  enqueuedCount: number;
  skippedCount: number;
  targetCount: number;
  duplicatesDropped: number;
  /** The API's figure, rendered verbatim. Never recomputed here. */
  estimatedCredits: number;
  /** How many of them actually reached Google. */
  chargeableCount: number;
  enqueuedUserIds: string[];
}

export type ScholarBulkActionResult =
  | { ok: true; outcome: ScholarBulkOutcome }
  | { ok: false; message: string };

const BulkResponseSchema = z.object({
  enqueued: z.array(z.object({ userId: z.string() })),
  skipped: z.array(z.object({ userId: z.string() })),
  targetCount: z.number(),
  duplicatesDropped: z.number(),
  estimatedCredits: z.number(),
  chargeableCount: z.number(),
});

export async function bulkFetchScholarAction(
  userIds: string[],
  /**
   * The chargeable count the operator was shown. Sent so the API can refuse
   * the whole request if its own pre-flight now disagrees — see the note on
   * `enqueueBulk`'s `expectedChargeableCount`. Without it the quote is an
   * advisory; with it, it is a token.
   */
  expectedChargeableCount: number,
): Promise<ScholarBulkActionResult> {
  try {
    const raw = await apiFetch<unknown>('/scholar/fetch/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds, expectedChargeableCount }),
    });
    const parsed = BulkResponseSchema.parse(raw);
    return {
      ok: true,
      outcome: {
        enqueuedCount: parsed.enqueued.length,
        skippedCount: parsed.skipped.length,
        targetCount: parsed.targetCount,
        duplicatesDropped: parsed.duplicatesDropped,
        estimatedCredits: parsed.estimatedCredits,
        chargeableCount: parsed.chargeableCount,
        enqueuedUserIds: parsed.enqueued.map((e) => e.userId),
      },
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        message: 'The Scholar service answered in a shape this page does not understand.',
      };
    }
    return { ok: false, message: messageOf(err, 'Could not start the bulk Scholar fetch.') };
  }
}

export type ScholarFetchOneResult =
  | { ok: true; jobId: string }
  | { ok: false; message: string };

export async function fetchScholarForUserAction(
  userId: string,
): Promise<ScholarFetchOneResult> {
  try {
    const data = await apiFetch<{ jobId: string }>(
      `/scholar/fetch/${encodeURIComponent(userId)}`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    return { ok: true, jobId: data.jobId };
  } catch (err) {
    return { ok: false, message: messageOf(err, 'Could not start the Scholar fetch.') };
  }
}

// ── Ledger ─────────────────────────────────────────────────────────────────

const IsoDate = z.string().min(1);

const RunsSchema = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      status: z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED', 'REFUSED']),
      trigger: z.enum(['SELF', 'ADMIN', 'ADMIN_BULK']),
      startedAt: IsoDate,
      finishedAt: IsoDate.nullable(),
      papersFound: z.number(),
      papersInserted: z.number(),
      citationsUpdated: z.number(),
      creditsUsed: z.number(),
      errorText: z.string().nullable(),
      scholarProfileId: z.string().nullable(),
      needsBinding: z.boolean(),
      user: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
      triggeredBy: z.object({ name: z.string().nullable() }).nullable(),
    }),
  ),
  totalCreditsUsed: z.number(),
});

export type ScholarRunsResult =
  | { ok: true; ledger: ScholarLedger }
  | { ok: false; message: string };

export async function listScholarRunsAction(
  options: { limit?: number; userId?: string } = {},
): Promise<ScholarRunsResult> {
  try {
    const params = new URLSearchParams();
    params.set('limit', String(options.limit ?? 50));
    if (options.userId) params.set('userId', options.userId);
    const raw = await apiFetch<unknown>(`/scholar/runs?${params.toString()}`);
    const parsed = RunsSchema.parse(raw);
    const runs: ScholarLedgerRun[] = parsed.runs.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user?.name ?? null,
      userEmail: r.user?.email ?? null,
      triggeredByName: r.triggeredBy?.name ?? null,
      status: r.status,
      trigger: r.trigger,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      papersFound: r.papersFound,
      papersInserted: r.papersInserted,
      citationsUpdated: r.citationsUpdated,
      creditsUsed: r.creditsUsed,
      // `needs-binding: <sentence>` is a machine-readable prefix the UI
      // branches on, and `needsBinding` already carries that branch. Showing
      // the prefix to a person would leak an internal code into a sentence
      // they are meant to act on, so it is stripped once, here.
      errorText: humaniseRunError(r.errorText),
      scholarProfileId: r.scholarProfileId,
      needsBinding: r.needsBinding,
    }));
    return { ok: true, ledger: { runs, totalCreditsUsed: parsed.totalCreditsUsed } };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        message: 'The Scholar run ledger answered in a shape this page does not understand.',
      };
    }
    return { ok: false, message: messageOf(err, 'Could not read the Scholar run ledger.') };
  }
}

function humaniseRunError(errorText: string | null): string | null {
  if (!errorText) return null;
  const prefix = `${SCHOLAR_NEEDS_BINDING}:`;
  const stripped = errorText.startsWith(prefix)
    ? errorText.slice(prefix.length).trim()
    : errorText.trim();
  return stripped.length > 0 ? stripped : null;
}

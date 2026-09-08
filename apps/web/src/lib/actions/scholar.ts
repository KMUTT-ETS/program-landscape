'use server';

import { z } from 'zod';
import { SCHOLAR_NEEDS_BINDING } from '@kku/db';
import { parseScholarProfileUrl } from '@kku/shared/scholar/parse';
import { apiFetch } from '@/lib/api-client';
import type { ScholarStatus } from '@/lib/scholar-status';

// Server actions behind the profile page's Google Scholar panel.
//
// Three calls, and the split between them is the API's, not ours:
//
//   status  — GET  /scholar/status/me. Cheap, polled while a fetch is queued.
//   bind    — POST /scholar/bind/me. SYNCHRONOUS, and it spends ~15
//             ScrapingBee credits per attempt whether or not the URL turns out
//             to be the right person's. The caller is waiting for a yes or a
//             no, so this returns one.
//   fetch   — POST /scholar/fetch/me. QUEUED. Returns a job reference; the
//             panel polls `status` until the run lands.
//
// Every one of them returns a discriminated result rather than throwing.
// A thrown server action reaches the client as an opaque digest with the
// message stripped in production — and the messages here are the entire point:
// the API's bind refusal quotes both the Scholar profile's name and the staff
// record's name, which is what lets a person work out which of the two is
// wrong.

/** Shape of the API's error objects after `apiFetch` has unwrapped them. */
interface ApiFetchLikeError extends Error {
  code?: string | null;
  status?: number | null;
}

function messageOf(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message.trim() : '';
  return message.length > 0 ? message : fallback;
}

function codeOf(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as ApiFetchLikeError).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

// ── Status ─────────────────────────────────────────────────────────────────

// Dates come off the wire as ISO strings (the envelope is JSON). They are kept
// as strings all the way to the component, which formats them with a pinned
// timezone — passing Date objects through a server action would serialise them
// back to strings anyway, one layer further from where the choice is visible.
// Non-empty rather than `.datetime()`: the format is not load-bearing here.
// `formatScholarDay` returns null for anything `new Date()` cannot read, so a
// malformed timestamp degrades to a missing date instead of failing the whole
// parse and blanking a panel that is otherwise correct.
const IsoDate = z.string().min(1);

const StatusSchema = z.object({
  userId: z.string(),
  staffRecord: z.union([
    z.object({
      linked: z.literal(true),
      facultyMemberId: z.string(),
      nameEn: z.string(),
      nameTh: z.string(),
    }),
    z.object({ linked: z.literal(false), reason: z.string() }),
  ]),
  profile: z.union([
    z.object({
      bound: z.literal(true),
      scholarProfileId: z.string(),
      scholarProfileUrl: z.string().nullable(),
      boundAt: IsoDate.nullable(),
    }),
    z.object({ bound: z.literal(false) }),
  ]),
  lastRun: z
    .object({
      id: z.string(),
      status: z.enum(['SUCCEEDED', 'PARTIAL', 'FAILED', 'REFUSED']),
      trigger: z.enum(['SELF', 'ADMIN', 'ADMIN_BULK']),
      startedAt: IsoDate,
      finishedAt: IsoDate.nullable(),
      papersFound: z.number(),
      papersInserted: z.number(),
      citationsUpdated: z.number(),
      creditsUsed: z.number(),
      errorText: z.string().nullable(),
      needsBinding: z.boolean(),
    })
    .nullable(),
  nextEligibleAt: IsoDate.nullable(),
  quotaReason: z.string().nullable(),
  needsBinding: z.boolean(),
  fetchQueued: z.boolean(),
  bind: z.object({
    attemptsToday: z.number(),
    maxPerDay: z.number(),
    retryAt: IsoDate.nullable(),
  }),
});

/**
 * `needs-binding: <sentence>` is a machine-readable prefix for the UI to
 * branch on, and `lastRun.needsBinding` already carries that branch. Showing
 * the raw prefix to a person would be leaking an internal code into a sentence
 * they are meant to act on, so it is stripped here — once, on the way through
 * — rather than in the component, where the constant would have to be
 * duplicated into the browser bundle.
 */
function humaniseRunError(errorText: string | null): string | null {
  if (!errorText) return null;
  const prefix = `${SCHOLAR_NEEDS_BINDING}:`;
  const stripped = errorText.startsWith(prefix)
    ? errorText.slice(prefix.length).trim()
    : errorText.trim();
  return stripped.length > 0 ? stripped : null;
}

export type ScholarStatusResult =
  | { ok: true; status: ScholarStatus }
  | { ok: false; message: string };

export async function getScholarStatusAction(): Promise<ScholarStatusResult> {
  try {
    const raw = await apiFetch<unknown>('/scholar/status/me');
    // Annotated, not cast: if `StatusSchema` and the `ScholarStatus` interface
    // the panel renders ever disagree, this line stops compiling.
    const parsed: ScholarStatus = StatusSchema.parse(raw);
    return {
      ok: true,
      status: parsed.lastRun
        ? {
            ...parsed,
            lastRun: { ...parsed.lastRun, errorText: humaniseRunError(parsed.lastRun.errorText) },
          }
        : parsed,
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        message: 'The Scholar service answered in a shape this page does not understand.',
      };
    }
    return { ok: false, message: messageOf(err, 'Could not read your Scholar status.') };
  }
}

// ── Bind ───────────────────────────────────────────────────────────────────

export type ScholarBindResult =
  | { ok: true; scholarProfileId: string; profileName: string }
  /**
   * `rateLimited` separates "you have used today's attempts" from "that URL is
   * wrong", because the two need different things from the user: one is a
   * matter of waiting, the other of pasting a different link. The panel greys
   * the submit button for the first and only the first.
   */
  | { ok: false; message: string; rateLimited: boolean };

export async function bindScholarProfileAction(url: string): Promise<ScholarBindResult> {
  // Client-side validation already ran on this string, with THIS function, via
  // the client-safe `@kku/shared/scholar/parse` subpath. Running it again here
  // is not redundancy for its own sake: a server action is a public endpoint,
  // and a request that skipped the form would otherwise reach the API and burn
  // ~15 credits on a URL we can already prove is not a Scholar profile.
  const parsed = parseScholarProfileUrl(url);
  if (!parsed.ok) {
    return { ok: false, message: parsed.reason, rateLimited: false };
  }

  try {
    const data = await apiFetch<{ scholarProfileId: string; profileName: string }>(
      '/scholar/bind/me',
      { method: 'POST', body: JSON.stringify({ url }) },
    );
    return { ok: true, scholarProfileId: data.scholarProfileId, profileName: data.profileName };
  } catch (err) {
    const code = codeOf(err);
    return {
      ok: false,
      // Passed through verbatim. On a name mismatch the API's sentence quotes
      // both the Scholar profile's name and the staff record's name; rewriting
      // it here would throw away the only thing that tells the user which side
      // is wrong.
      message: messageOf(err, 'Could not link that Scholar profile.'),
      rateLimited: code === 'RATE_LIMITED',
    };
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────────

export type ScholarFetchResult =
  | { ok: true; jobId: string }
  | { ok: false; message: string };

export async function startScholarFetchAction(): Promise<ScholarFetchResult> {
  try {
    const data = await apiFetch<{ jobId: string; userId: string; trigger: string }>(
      '/scholar/fetch/me',
      { method: 'POST', body: JSON.stringify({}) },
    );
    return { ok: true, jobId: data.jobId };
  } catch (err) {
    return { ok: false, message: messageOf(err, 'Could not start the Scholar fetch.') };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions and dwell are DERIVED from timestamps, never captured. A session is
// a run of one user's views with no gap over 30 minutes; dwell is the time to
// the next view inside a session (the last view has none).
// ─────────────────────────────────────────────────────────────────────────────

// The SQL sessioniser in packages/db must use the same threshold — derive it
// from this constant, never retype 30: same session iff gap <= SESSION_GAP_MS,
// so SQL starts a new one on `> interval`. Equal at exactly 30:00.000 means
// the SAME session on both sides.
export const SESSION_GAP_MS = 30 * 60_000;

export interface ViewLike {
  at: Date;
  path: string;
}
export interface Session<V extends ViewLike = ViewLike> {
  startedAt: Date;
  endedAt: Date;
  views: readonly V[];
}

export function groupSessions<V extends ViewLike>(views: ReadonlyArray<V>): Session<V>[] {
  const sorted = [...views].sort((a, b) => a.at.getTime() - b.at.getTime());
  const out: Array<Session<V> & { views: V[] }> = [];
  for (const v of sorted) {
    const cur = out[out.length - 1];
    if (cur && v.at.getTime() - cur.endedAt.getTime() <= SESSION_GAP_MS) {
      cur.views.push(v);
      cur.endedAt = v.at;
    } else {
      out.push({ startedAt: v.at, endedAt: v.at, views: [v] }); // shares the caller's Date — treat as immutable
    }
  }
  return out;
}

export function medianDwellMs(sessions: ReadonlyArray<Session>): number | null {
  const gaps: number[] = [];
  for (const s of sessions) {
    for (let i = 0; i + 1 < s.views.length; i++) {
      gaps.push(s.views[i + 1]!.at.getTime() - s.views[i]!.at.getTime());
    }
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : Math.round((gaps[mid - 1]! + gaps[mid]!) / 2);
}

export const ACTION_FAMILIES = [
  'export',
  'ai-brief',
  'scenario',
  'decision',
  'pipeline',
  'upload',
  'other',
] as const;
export type ActionFamily = (typeof ACTION_FAMILIES)[number];

/** Audit actions that are platform housekeeping, not usage. */
const NOT_USAGE = [
  /^auth\./,
  /^update_theme$/,
  /^impersonation_/,
  /^update_public_profile$/,
  /^regenerate_public_profile_slug$/,
];

const FAMILY_RULES: Array<[RegExp, ActionFamily]> = [
  [/export|^pdf\.generate$/, 'export'],
  // AI generation on demand: briefs, narratives, AUN-QA criterion text.
  [/\.brief$|regenerate_|criterion-narrative/, 'ai-brief'],
  [/^scenario\./, 'scenario'],
  // The Decision Workspace: decisions, their milestones and annotations.
  [/^decision\.|^milestone\.|^annotation\.create$/, 'decision'],
  // Job runs: the programme pipeline, connector runs, re-extraction requeues.
  [
    /run_pipeline|run_digest|\.run_now$|refresh|^scholar\.fetch\.|^imd\.extract\.|^pdf\.(re_extract|bulk_reprocess)$/,
    'pipeline',
  ],
  [/upload$|^trend_document\.from_url$/, 'upload'],
];

export function actionFamily(action: string): ActionFamily | null {
  if (NOT_USAGE.some((r) => r.test(action))) return null;
  for (const [re, family] of FAMILY_RULES) if (re.test(action)) return family;
  return 'other';
}

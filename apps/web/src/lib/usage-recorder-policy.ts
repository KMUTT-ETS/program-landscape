// Pure decisions for the page-view recorder, kept out of the component so
// they are testable without a DOM.
//
// Events built here are sent by usage-recorder.tsx to the Next.js route
// handler app/api/usage/page-views/route.ts, which forwards them to
// POST /api/v1/usage/page-views on the NestJS api (a separate task).

export const DEDUPE_MS = 5000;
const EXCLUDED = [
  /^\/signin/,
  /^\/no-access/,
  /^\/api\//,
  // print views render outside the app shell today, so the recorder never
  // mounts there — listed for defence in depth
  /^\/programs\/[^/]+\/print/,
];
const SCOPES = ['university', 'faculty', 'department', 'program'] as const;
type Scope = (typeof SCOPES)[number];

export interface UsageEvent {
  path: string;
  scope?: Scope;
  scopeId?: string;
  programId?: string;
}

export function buildEvent(pathname: string, params: URLSearchParams): UsageEvent | null {
  if (EXCLUDED.some((r) => r.test(pathname))) return null;
  const e: UsageEvent = { path: pathname };
  const scope = params.get('scope');
  if (scope && (SCOPES as readonly string[]).includes(scope)) {
    e.scope = scope as Scope;
    const id = params.get('scopeId');
    if (id) e.scopeId = id;
  }
  const m = pathname.match(/^\/programs\/([^/]+)/);
  if (m?.[1]) e.programId = m[1];
  return e;
}

/** Suppresses an identical event within DEDUPE_MS (StrictMode, shell re-mounts). */
export class RecorderDedupe {
  private lastKey = '';
  private lastAt = -Infinity;
  shouldSend(e: UsageEvent, nowMs: number): boolean {
    const key = `${e.path}|${e.scope ?? ''}|${e.scopeId ?? ''}|${e.programId ?? ''}`;
    if (key === this.lastKey && nowMs - this.lastAt < DEDUPE_MS) return false;
    this.lastKey = key;
    this.lastAt = nowMs;
    return true;
  }
}

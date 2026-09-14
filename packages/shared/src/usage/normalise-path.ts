// ─────────────────────────────────────────────────────────────────────────────
// Raw pathname → bounded route pattern + module.
//
// The client sends what the browser saw; nothing user-controlled reaches
// page_views unbounded. A segment is kept only when it reads like a
// kebab-case route word — everything else (cuid, KKU-SEQ code, UUID, numeric
// id, base64url share slug, percent-encoding, a whole URL) collapses to
// `[id]`, still without a hardcoded route list. The module comes from the
// first segment; the route-coverage test fails CI when a new top-level
// folder is unclassified.
// ─────────────────────────────────────────────────────────────────────────────

export const USAGE_MODULES = [
  'home', 'cockpit', 'deep-dive', 'gap', 'benchmarking', 'scenarios', 'decisions',
  'analyst', 'trends', 'risk', 'education', 'staff', 'skills', 'teaching-learning',
  'dashboards', 'admin', 'docs', 'profile', 'public-profile', 'inbox', 'usage', 'other',
] as const;
export type UsageModule = (typeof USAGE_MODULES)[number];

const MODULE_BY_SEGMENT: Record<string, UsageModule> = {
  '': 'home',
  cockpit: 'cockpit',
  programs: 'deep-dive',
  'gap-analysis': 'gap',
  benchmarking: 'benchmarking',
  scenarios: 'scenarios',
  decisions: 'decisions',
  analyst: 'analyst',
  trends: 'trends',
  risks: 'risk',
  education: 'education',
  staff: 'staff',
  skills: 'skills',
  'teaching-learning': 'teaching-learning',
  dashboards: 'dashboards',
  admin: 'admin',
  upload: 'admin',
  docs: 'docs',
  changelog: 'docs',
  copyright: 'docs',
  disclaimer: 'docs',
  terms: 'docs',
  profile: 'profile',
  p: 'public-profile',
  inbox: 'inbox',
  usage: 'usage',
};

const ID_SEGMENT = /^(c[a-z0-9]{24}|kku-seq-\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Deny by default. A segment survives only if it reads like a route word;
// everything else — cuid, uuid, numeric id, base64url profile slug,
// percent-encoding, a whole URL — collapses. Every Next route folder under
// apps/web/app is strict kebab-case, so this is still a shape rule with no
// route list to go stale, and a dynamic route added tomorrow is bounded the
// day it ships. ID_SEGMENT stays for the one overlap: `kku-seq-0062` is a
// valid route word AND an id.
const ROUTE_WORD = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID_PLACEHOLDER = '[id]';
const TRUNCATED_MARKER = '[...]';
const MAX_SEGMENT_LENGTH = 40;
const MAX_PATH_SEGMENTS = 12;
export const MAX_PATH_PATTERN_LENGTH = 200;

export interface NormalisedPath {
  path: string;
  module: UsageModule;
}

// A hostile client can send a literal `/programs/[id]`; it is indistinguishable
// from a normalised one. Harmless for counting — never treat `[id]` as proof
// that normalisation ran.
export function normalisePath(raw: string): NormalisedPath {
  const noQuery = raw.split(/[?#]/)[0] ?? '';
  const segments: string[] = [];
  let truncated = false;

  for (const rawSegment of noQuery.split('/')) {
    if (rawSegment.length === 0) continue;
    if (segments.length >= MAX_PATH_SEGMENTS) {
      truncated = true;
      break;
    }
    const segment = rawSegment.toLowerCase();
    const isRouteWord =
      segment.length <= MAX_SEGMENT_LENGTH && ROUTE_WORD.test(segment) && !ID_SEGMENT.test(segment);
    const next = isRouteWord ? segment : ID_PLACEHOLDER;
    // Cut on a segment boundary. A mid-segment slice invents a route that
    // never existed and collapses two different paths onto one prefix.
    const candidate = segments.length === 0 ? next : `${segments.join('/')}/${next}`;
    if (candidate.length + 1 > MAX_PATH_PATTERN_LENGTH - TRUNCATED_MARKER.length - 1) {
      truncated = true;
      break;
    }
    segments.push(next);
  }
  if (truncated) segments.push(TRUNCATED_MARKER);

  // `/p/<slug>` is the one parameter that is a share token rather than an
  // entity id — it is the only access control on an unauthenticated page, so
  // it never reaches page_views even in the rare case a slug reads as a
  // route word.
  if (segments[0] === 'p' && segments.length > 1 && segments[1] !== TRUNCATED_MARKER) {
    segments[1] = ID_PLACEHOLDER;
  }

  const path = '/' + segments.join('/');
  const first = segments[0] ?? '';
  const module = MODULE_BY_SEGMENT[first] ?? 'other';
  return { path, module };
}

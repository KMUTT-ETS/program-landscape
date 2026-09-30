// PDPA-compliant log redaction for pino. Used by both apps/api and
// apps/ingestion.
//
// Two-layer defence:
//   1. `REDACT_PATHS` — pino's built-in fast-redact (`redact.paths`).
//      Cheap; covers known top-level + req/res shapes.
//   2. `scrubLogObject(obj)` — recursive walker. Catches anything pino's
//      fast-redact misses (deeply-nested keys, unknown shapes from
//      third-party SDK loggers).
//
// The redaction list is informed by Thai PDPA + KKU IT operational
// posture:
//   - Authentication: password, passwd, pwd, secret, clientSecret,
//     apiKey, token, accessToken, refreshToken, authorization, cookie
//   - PDPA personal data (sensitive PII): citizenId, nationalId, idCard,
//     phone, dateOfBirth, dob
//   - Operational: exportReason (PII-adjacent — operator wrote it)
//
// Note: `email` is NOT in the universal redaction list because emails
// are domain identifiers used in audit / SSO / operator logs. Specific
// req.body.email paths are redacted explicitly.

const REDACTED = '[REDACTED]';

// Keys that must be redacted at any depth in the log object tree.
// Match is case-insensitive; both camelCase and snake_case caught.
const SENSITIVE_KEYS = new Set<string>([
  // Auth
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientsecret',
  'client_secret',
  'apikey',
  'api_key',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'cookie',
  'set-cookie',

  // PDPA — sensitive PII
  'citizenid',
  'citizen_id',
  'nationalid',
  'national_id',
  'idcard',
  'id_card',
  'pid',
  'phone',
  'phonenumber',
  'phone_number',
  'dateofbirth',
  'date_of_birth',
  'dob',
  'birthdate',

  // Operational
  'exportreason',
  'export_reason',
]);

// Pino fast-redact paths. fast-redact supports `*` as a single-level
// wildcard, but only within a path expression (e.g. `req.headers.*` or
// `*.password`). For arbitrary depth we rely on `scrubLogObject`.
export const REDACT_PATHS: readonly string[] = [
  // Standard request / response surface.
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',

  // Common body shapes for credentialed endpoints.
  'req.body.password',
  'req.body.secret',
  'req.body.apiKey',
  'req.body.token',
  'req.body.exportReason',
  // External staff-profile lookups: the identifier a machine client sent.
  'req.body.citizenId',
  'req.body.email',

  // Top-level common patterns. fast-redact's `*.x` only walks one level
  // deep — these catch direct properties on the log record root.
  '*.password',
  '*.secret',
  '*.token',
  '*.apiKey',
  '*.citizenId',
  '*.nationalId',
  '*.idCard',
  '*.phone',
  '*.dateOfBirth',
];

const MAX_RECURSION_DEPTH = 8; // guard against pathological cycles

// Recursive scrub for arbitrary-depth nested objects. Pino calls this
// via `formatters.log`, so it only runs once per log line.
//
// Returns a NEW object — never mutates the input (pino sometimes hands
// back the request/response context, mutating which would corrupt other
// log lines).
export function scrubLogObject<T = unknown>(input: T, depth = 0): T {
  if (depth >= MAX_RECURSION_DEPTH) return input;
  if (input === null || typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return input.map((v) => scrubLogObject(v, depth + 1)) as unknown as T;
  }
  // Buffer / typed-array — leave alone.
  if (
    Buffer.isBuffer?.(input) ||
    (input as unknown) instanceof ArrayBuffer ||
    ArrayBuffer.isView(input as unknown as ArrayBufferView)
  ) {
    return input;
  }
  // Date — leave alone (toJSON will stringify).
  if (input instanceof Date) return input;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else if (typeof value === 'string' && looksLikeThai13DigitId(value)) {
      // Catch raw 13-digit Thai citizen IDs that slip in as bare values
      // (e.g. via a stack-trace string or a generic `data: string` log).
      out[key] = REDACTED;
    } else {
      out[key] = scrubLogObject(value, depth + 1);
    }
  }
  return out as unknown as T;
}

// Thai citizen IDs are exactly 13 digits. We treat any 13-consecutive-digit
// run inside a string value as PII-shaped. Conservative — could occasionally
// false-positive on a transaction-ID. Acceptable: false positives in logs
// are noise; false negatives leak personal data.
const THAI_ID_RE = /\b\d{13}\b/;

function looksLikeThai13DigitId(value: string): boolean {
  if (value.length < 13 || value.length > 200) return false;
  return THAI_ID_RE.test(value);
}

// Convenience: scrub a single string. Used by the AI safety + analyst
// output sanitisers if they want to call this directly. Replaces every
// 13-digit run with [REDACTED:THAI_ID].
export function scrubString(value: string): string {
  return value.replace(/\b\d{13}\b/g, '[REDACTED:THAI_ID]');
}

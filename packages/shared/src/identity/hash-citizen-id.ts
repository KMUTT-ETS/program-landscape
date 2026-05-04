// Canonical citizen-ID hash — the cross-system join key for KKU staff
// (and, later, students) across:
//   - processed-HR mart (raw `identification` field)
//   - kku-hr connector (server-side HASHBYTES on `ID_PEOPLE`)
//   - UNICON DS2003 / DS2004 (raw `CITIZEN_ID` field)
//
// Convention (locked 2026-05-04):
//   - SHA-256 of digit-stripped input → 64-char lowercase hex
//   - No salt: cross-system determinism is the point
//   - Foreign passport strings hash through the same path; collisions
//     with citizen IDs are negligible (different keyspaces, 256-bit out)
//
// PDPA posture: this is a JOIN KEY, NOT a privacy guarantee. Thai
// citizen IDs are 13 digits = ~2^43 keyspace; a rainbow table is
// hours of GPU work. Treat columns containing this hash as PII for
// RBAC purposes — audit-log on SELECT, role-gate at the service
// layer, never expose to client-side bundles.

import { createHash } from 'crypto';

const DIGITS_OR_ALPHANUM = /[^0-9A-Za-z]/g;

export function hashCitizenId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // For Thai citizen IDs we strip everything but digits. For passports
  // (mixed alpha+digit, foreign staff), preserve alphanumerics. Whitespace
  // and dashes always go.
  const cleaned = raw.replace(DIGITS_OR_ALPHANUM, '');
  if (cleaned.length === 0) return null;
  return createHash('sha256').update(cleaned, 'utf8').digest('hex');
}

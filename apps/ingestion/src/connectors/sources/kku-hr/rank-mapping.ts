// ─────────────────────────────────────────────────────────────────────────────
// Maps the Thai rank text from `workforce_hcm_actual.POSITION_LEVEL` to
// our `FacultyRank` enum.
//
// POSITION_LEVEL is formatted `<rank>-<personnel_type>`, e.g.,
//   "อาจารย์-พนักงานมหาวิทยาลัย"
//   "รองศาสตราจารย์-ข้าราชการ"
//
// The first segment is the rank. We match by *prefix* so variants like
// `ศาสตราจารย์เกียรติคุณ` and `ศาสตราจารย์วุฒิคุณ` collapse to PROF, and
// `อาจารย์ สอนและวิจัยต่ำกว่าอุดมศึกษา` collapses to LECTURER.
//
// Anything we can't classify returns `null`. The connector counts the
// unmatched rows in IngestionRun.metadata so the analyst can review
// and extend this map (single source of truth — change here, the next
// run picks it up).
// ─────────────────────────────────────────────────────────────────────────────

import type { FacultyRank } from '@kku/db';

/**
 * Strip the `-personnel_type` suffix off a POSITION_LEVEL value and
 * return the rank segment. Trims whitespace; preserves multi-word
 * Thai. Returns null if the value is empty.
 */
export function extractRankSegment(positionLevel: string | null): string | null {
  if (!positionLevel) return null;
  const trimmed = positionLevel.trim();
  if (!trimmed) return null;
  const dashIdx = trimmed.indexOf('-');
  return dashIdx === -1 ? trimmed : trimmed.slice(0, dashIdx).trim();
}

/**
 * Map a rank segment (output of extractRankSegment) to FacultyRank.
 * Match by prefix so variants of each title collapse cleanly. Returns
 * null if no match — the connector logs and skips that row.
 *
 * The prefixes are ordered by specificity: more specific ones first so
 * "รองศาสตราจารย์" doesn't get caught by "ศาสตราจารย์".
 */
export function rankSegmentToFacultyRank(
  segment: string | null,
): FacultyRank | null {
  if (!segment) return null;
  // Order matters — longer/more-specific prefixes first.
  const PREFIX_TABLE: Array<{ prefix: string; rank: FacultyRank }> = [
    { prefix: 'รองศาสตราจารย์', rank: 'ASSOC_PROF' },
    { prefix: 'ผู้ช่วยศาสตราจารย์', rank: 'ASST_PROF' },
    { prefix: 'ศาสตราจารย์', rank: 'PROF' },
    { prefix: 'อาจารย์', rank: 'LECTURER' },
  ];
  for (const { prefix, rank } of PREFIX_TABLE) {
    if (segment.startsWith(prefix)) return rank;
  }
  return null;
}

/**
 * Convenience: extract + map in one call.
 */
export function positionLevelToFacultyRank(
  positionLevel: string | null,
): FacultyRank | null {
  return rankSegmentToFacultyRank(extractRankSegment(positionLevel));
}

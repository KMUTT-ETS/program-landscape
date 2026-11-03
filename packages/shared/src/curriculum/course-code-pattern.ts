/**
 * The one course-code shape every curriculum locator agrees on.
 *
 * 2-4 upper-case Latin letters, an optional single space, then either
 *   - 3 digits + optional space + 3 digits (KKU: "EN 241 100", "EN241100"), or
 *   - exactly 3 digits (KMUTT-style: "MEE 221", "MEE221"),
 * not followed by another digit, and word-bounded at both ends.
 *
 * Rejects "PHY 2565" and "MEE 4000" (4 digits), "MEE 22" (2 digits),
 * "ISO 9001" and lower-case "mee 221".
 *
 * Pure and client-safe (no node imports).
 */
export const COURSE_CODE_SOURCE = String.raw`\b[A-Z]{2,4} ?(?:\d{3} ?\d{3}|\d{3})(?!\d)\b`;

/** A fresh RegExp each call (a shared /g regex carries lastIndex state). */
export function courseCodeRegex(flags = ''): RegExp {
  return new RegExp(COURSE_CODE_SOURCE, flags);
}

/** True when the whole string is exactly one course code. */
export function isCourseCode(s: string): boolean {
  return new RegExp(`^(?:${COURSE_CODE_SOURCE})$`).test(s);
}

// Thai-aware sorting helpers used everywhere the Education dashboards
// surface faculty / program-level / program names. Keeps ordering
// consistent across all 5 dashboards + the drill-down pivot.
//
// Rules:
//   - Faculty + program names use a Thai locale collator
//     (Intl.Collator('th')) — Postgres' default collation is C/UTF8
//     which gives nonsensical ordering for Thai script.
//   - Program level uses an explicit canonical order
//     (BACHELOR < MASTER < DOCTORAL < HIGHER_GRAD_DIPLOMA + the
//     verbatim Thai labels VIEW_STUDENT_DETAIL_ALL emits).

const COLLATOR = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

export function compareThai(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

// Canonical program-level order. The registry stores Thai labels
// directly; the English enum names are kept here as aliases so any
// caller emitting the API enum form sorts correctly too.
const LEVEL_RANK: Record<string, number> = {
  // Sub-degree / pre-bachelor (rare but possible)
  'อนุปริญญา': 5,
  'ประกาศนียบัตร': 5,
  'ประกาศนียบัตรวิชาชีพ': 5,
  // Undergraduate
  'ปริญญาตรี': 10,
  BACHELOR: 10,
  // Lower graduate diploma — sits below Master.
  'ประกาศนียบัตรบัณฑิต': 20,
  // Master's
  'ปริญญาโท': 30,
  MASTER: 30,
  // Higher graduate diploma — sits BETWEEN Master and Doctoral
  // (post-Master practical credential, not a doctorate).
  'ประกาศนียบัตรบัณฑิตชั้นสูง': 35,
  HIGHER_GRAD_DIPLOMA: 35,
  // Doctoral
  'ปริญญาเอก': 40,
  DOCTORAL: 40,
};

export function compareLevel(a: string, b: string): number {
  const ra = LEVEL_RANK[a.trim()] ?? 99;
  const rb = LEVEL_RANK[b.trim()] ?? 99;
  if (ra !== rb) return ra - rb;
  // Same rank or both unknown — fall back to Thai collation.
  return compareThai(a, b);
}

export function sortByThai<T>(items: T[], keyFn: (t: T) => string): T[] {
  return [...items].sort((a, b) => compareThai(keyFn(a), keyFn(b)));
}

export function sortByLevel<T>(items: T[], keyFn: (t: T) => string): T[] {
  return [...items].sort((a, b) => compareLevel(keyFn(a), keyFn(b)));
}

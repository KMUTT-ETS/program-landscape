// UNICON DS2003 is a per-term staff report: every staff member is re-listed,
// with their whole education history, once per academic year + semester. The
// unicon-ds2003 connector keeps each term as its own snapshot (it replaces only
// the term it is loading), so a person's degrees recur once per term loaded.
// The profile must show ONE snapshot — the most recent term that person
// appears in — not the union. Taking the latest term rather than
// de-duplicating degrees also means a record corrected in a later term
// replaces the old version instead of standing beside it.
//
// Repeats WITHIN a single term are the source's own data and are left alone.

interface SnapshotRow {
  academicYear: string | null;
  semester: string | null;
}

/** Sort key for a term; a missing or unparseable term ranks below any stated one. */
function termKey(row: SnapshotRow): number {
  const year = Number(row.academicYear);
  const semester = Number(row.semester);
  if (!Number.isFinite(year) || row.academicYear === null) return -1;
  return year * 10 + (Number.isFinite(semester) && row.semester !== null ? semester : 0);
}

/** The rows from the most recent term present, in their original order. */
export function latestEducationSnapshot<T extends SnapshotRow>(rows: readonly T[]): T[] {
  if (rows.length === 0) return [];
  const latest = Math.max(...rows.map(termKey));
  return rows.filter((r) => termKey(r) === latest);
}

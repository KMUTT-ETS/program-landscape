// Public TCAS round-3 funnel basis (health-score.v5.6).
//
// An adopting university's admission-campaign upload often has applicants and
// passed counts but no planned seats. The public mytcas data (connector `tcas`,
// table tcas_admission_stats) states a quota per course code, so the funnel
// drivers fall back to it when the latest complete campaign year has no seats.
//
// TCAS trap: some years (2568) repeat the 3.1 and 3.2 sub-round rows with the
// same quota/applicants, and the admitted counts sit on only one of them. Each
// tcas_course_code is therefore counted ONCE per entry year (the largest figure
// across its rows), and the codes are then summed.

export const PUBLIC_TCAS_BASIS = 'public-tcas-round3';

/** Stored `round` values for TCAS round 3 (older years: '3'; later: '3.1'/'3.2').
 *  The fallback and its peers read ONLY these, so the label stays true when
 *  rounds 1, 2 and 4 land in the same table. */
export const PUBLIC_TCAS_ROUND3 = ['3', '3.1', '3.2'] as const;

/** Admitted count of one public row. pass2 is NOT additive to pass1: summing
 *  them exceeds the quota on 70% of rows that carry admits (2514 of 3561 on
 *  the dev data) against 6% for the larger of the two, and a 3.1/3.2 pair
 *  repeats the same figures. */
export const admittedCount = (admittedPass1: number, admittedPass2: number): number =>
  Math.max(admittedPass1, admittedPass2);

export interface PublicTcasRow {
  tcasCourseCode: string;
  quota: number;
  applicants: number;
  admittedPass1: number;
  admittedPass2: number;
}

export interface PublicTcasTotals {
  quota: number;
  applicants: number;
  admitted: number;
  courses: number;
  /** False when no row states an admitted count: the figure is missing, not 0. */
  admittedPublished: boolean;
}

/** Sum the rows of ONE entry year, counting each course code once. Null when
 *  there is no quota at all (nothing to divide by). */
export function publicTcasTotals(rows: readonly PublicTcasRow[]): PublicTcasTotals | null {
  const byCode = new Map<string, { quota: number; applicants: number; admitted: number }>();
  for (const r of rows) {
    const admitted = admittedCount(r.admittedPass1, r.admittedPass2);
    const cur = byCode.get(r.tcasCourseCode);
    if (!cur) {
      byCode.set(r.tcasCourseCode, { quota: r.quota, applicants: r.applicants, admitted });
    } else {
      cur.quota = Math.max(cur.quota, r.quota);
      cur.applicants = Math.max(cur.applicants, r.applicants);
      cur.admitted = Math.max(cur.admitted, admitted);
    }
  }
  let quota = 0;
  let applicants = 0;
  let admitted = 0;
  for (const v of byCode.values()) {
    quota += v.quota;
    applicants += v.applicants;
    admitted += v.admitted;
  }
  if (quota <= 0) return null;
  return { quota, applicants, admitted, courses: byCode.size, admittedPublished: admitted > 0 };
}

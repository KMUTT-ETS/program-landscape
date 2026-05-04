// Staff-category discriminator for the processed-HR mart (vw_history).
//
// Rules per the 2026-05-04 session:
//   - ACADEMIC   : workline contains 'วิชาการ'
//   - EXECUTIVE  : workline = 'บริหาร'   (some execs hold dual contracts —
//                 the secondary contract isn't surfaced via workline)
//   - RESEARCH   : workline = 'วิจัย'
//   - SUPPORT    : everything else (incl. 'สนับสนุน', 'ไม่ระบุ', NULL)
//
// The order matters — a row that contained 'วิชาการ' AND happened to
// equal 'บริหาร' would be impossible (mutually exclusive in current
// data) but if a future row carries dual semantics, ACADEMIC wins
// since it carries the publication-track KPI bundle.

export type StaffCategory =
  | 'ACADEMIC'
  | 'EXECUTIVE'
  | 'RESEARCH'
  | 'SUPPORT';

export const STAFF_CATEGORY_LABELS: Record<StaffCategory, { th: string; en: string }> = {
  ACADEMIC: { th: 'วิชาการ', en: 'Academic' },
  EXECUTIVE: { th: 'บริหาร', en: 'Executive' },
  RESEARCH: { th: 'วิจัย', en: 'Research' },
  SUPPORT: { th: 'สายสนับสนุน', en: 'Support' },
};

export function categorizeWorkline(workline: string | null | undefined): StaffCategory {
  const w = (workline ?? '').trim();
  if (w.includes('วิชาการ')) return 'ACADEMIC';
  if (w === 'บริหาร') return 'EXECUTIVE';
  if (w === 'วิจัย') return 'RESEARCH';
  return 'SUPPORT';
}

// SQL fragment that mirrors `categorizeWorkline()` so we can compute
// the bucket server-side and aggregate without pulling per-person
// rows. Inline the column expression (not a parameter) — these are
// constant fragments.
export function staffCategorySqlExpr(worklineCol = 'workline'): string {
  return `CASE
            WHEN ${worklineCol} LIKE '%วิชาการ%' THEN 'ACADEMIC'
            WHEN ${worklineCol} = 'บริหาร'      THEN 'EXECUTIVE'
            WHEN ${worklineCol} = 'วิจัย'       THEN 'RESEARCH'
            ELSE 'SUPPORT'
          END`;
}

// The application reads only the current-snapshot view; the historical
// view (vw_history_all) is preserved for separate audit work.
export const STAFF_TABLE = 'vw_history';

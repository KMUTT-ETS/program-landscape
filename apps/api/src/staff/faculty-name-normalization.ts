// Maps the raw `faculty` value from the processed-HR mart (vw_history)
// onto the canonical KKU Faculty.nameTh used everywhere else in this app.
// Two cases this handles:
//
//   1. Sub-faculty research centres / sub-units that report to a parent
//      faculty in the org chart but appear in the mart with their own
//      `faculty` value. Total ~19 staff across 11 entries — too small
//      to seed as standalone Faculty rows; rolled up here at ingest.
//
//   2. Single-row typo: 'คณะสัตวแพทศาสตร์' (missing ย) belongs to
//      'คณะสัตวแพทยศาสตร์'.
//
// The mart row keeps its original `faculty` value — this map only
// affects how the cube refresh resolves it. If a future row introduces
// a new sub-unit name, it'll show up as 'unmapped' in the dashboard
// and we add it here.

export const FACULTY_NAME_NORMALIZATION: Record<string, string> = {
  // Group B — sub-units rolled up to inferred parent
  'ศูนย์บริหารเทคโนโลยีและนวัตกรรม': 'สำนักงานอธิการบดี',
  'สถานบริหารจัดการงานวิจัยคลินิก': 'คณะแพทยศาสตร์',
  'สถานบริการสุขภาพเทคนิคการแพทย์และกายภาพบำบัด': 'คณะเทคนิคการแพทย์',
  'ศูนย์นวัตกรรมและบริการวิศวกรรม': 'คณะวิศวกรรมศาสตร์',
  'ศูนย์บริหารจัดการห้องเรียนวิทยาศาสตร์ในโรงเรียน คณะวิทยาศาสตร์': 'คณะวิทยาศาสตร์',
  'อุทยานวิทยาศาสตร์': 'สำนักงานอธิการบดี',
  'พิพิธภัณฑ์สัตว์น้ำจังหวัดหนองคาย': 'สำนักงานอธิการบดี',
  'ศูนย์สื่อการเรียนรู้': 'สำนักหอสมุด',
  'ฝ่ายนวัตกรรมและวิสาหกิจ': 'สำนักงานอธิการบดี',
  'ศูนย์ประสานงานโครงการอันเนื่องมาจากพระราชดำริ': 'สำนักงานอธิการบดี',
  'สภามหาวิทยาลัย': 'สำนักงานสภามหาวิทยาลัย',

  // Group C — single-character typo
  'คณะสัตวแพทศาสตร์': 'คณะสัตวแพทยศาสตร์',

  // Renamed unit — historical 'Integrated Social Sciences' is now
  // covered by the Interdisciplinary Studies faculty (Nong Khai).
  'คณะสังคมศาสตร์บูรณาการ': 'คณะสหวิทยาการ',
};

// Fallback faculty for rows with a NULL/empty `faculty` field. Per the
// 2026-05-04 session: the 4 such rows in the current snapshot are
// centrally-administered staff with no faculty placement — bucket them
// to the Office of the President.
export const UNKNOWN_FACULTY_FALLBACK = 'สำนักงานอธิการบดี';

export function normalizeFacultyName(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (t === '') return UNKNOWN_FACULTY_FALLBACK;
  return FACULTY_NAME_NORMALIZATION[t] ?? t;
}

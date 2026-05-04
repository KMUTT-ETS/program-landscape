// ─────────────────────────────────────────────────────────────────────────────
// Maps the registrar's raw `STUDENTSTATUS` values (Thai, ~30 distinct
// strings observed in `VIEW_STUDENT_DETAIL_ALUMNI`) onto 8 funnel-relevant
// buckets:
//
//   GRADUATED        — completed the program (สำเร็จการศึกษา)
//   RENOUNCED        — admitted but renounced rights (แจ้งสละสิทธิ์แล้ว)
//   NO_REPORT        — admitted but never showed up to register
//   DROPPED_FINANCIAL — dropped because of unpaid fees
//   DROPPED_ACADEMIC — failed out / exceeded study time
//   DROPPED_VOLUNTARY — voluntary leave
//   TRANSFERRED      — transferred to another faculty / program / level
//   OTHER            — everything else (incl. death, document issues, exchange)
//
// Together with `student_cohort_distributions` (currently enrolled),
// these 8 buckets fully account for every student of every cohort and
// power the demand funnel's Application → Admitted → Enrolled →
// Persisted → Graduated breakdown.
// ─────────────────────────────────────────────────────────────────────────────

export type AlumniStatusBucket =
  | 'GRADUATED'
  | 'RENOUNCED'
  | 'NO_REPORT'
  | 'DROPPED_FINANCIAL'
  | 'DROPPED_ACADEMIC'
  | 'DROPPED_VOLUNTARY'
  | 'TRANSFERRED'
  | 'OTHER';

export const ALUMNI_STATUS_BUCKETS: AlumniStatusBucket[] = [
  'GRADUATED',
  'RENOUNCED',
  'NO_REPORT',
  'DROPPED_FINANCIAL',
  'DROPPED_ACADEMIC',
  'DROPPED_VOLUNTARY',
  'TRANSFERRED',
  'OTHER',
];

// Substring-match in priority order — first hit wins. Order matters
// because some Thai phrases are super-strings of others (e.g.,
// "ไม่ชำระค่าต่อทะเบียน" ≠ "ไม่ชำระค่าขึ้นทะเบียน นศ.ใหม่").
const RULES: Array<{ contains: string; bucket: AlumniStatusBucket }> = [
  { contains: 'สำเร็จการศึกษา', bucket: 'GRADUATED' },

  { contains: 'สละสิทธิ์', bucket: 'RENOUNCED' },

  // No-show / no-report — register-time absence
  { contains: 'ไม่รายงานตัวเข้าเป็นนักศึกษา', bucket: 'NO_REPORT' },
  { contains: 'รับตรง(ไม่มารายงานตัว)', bucket: 'NO_REPORT' },
  { contains: 'ไม่รายงานตัว(ใช้กับงานquota)', bucket: 'NO_REPORT' },
  { contains: 'ขาดเอกสารประกอบการรายงานตัว', bucket: 'NO_REPORT' },
  { contains: 'ไม่ชำระค่าขึ้นทะเบียน นศ.ใหม่', bucket: 'NO_REPORT' },

  // Financial dropouts (during the program)
  { contains: 'ไม่ชำระค่าต่อทะเบียน', bucket: 'DROPPED_FINANCIAL' },
  { contains: 'ไม่ลงทะเบียนตามเวลากำหนด', bucket: 'DROPPED_FINANCIAL' },

  // Academic / time-limit dropouts
  { contains: 'ตกออก', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'ใช้เวลาเรียนเกิน', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'ขาดคุณสมบัติในการรับเข้าศึกษา', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'ไม่ผ่านเกณฑ์', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'ไม่มีความก้าวหน้าในการทำวิทยานิพนธ์', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'สอบประมวลความรู้ ได้ S=0', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'สอบวิทยานิพนธ์', bucket: 'DROPPED_ACADEMIC' },
  { contains: 'สอบวัดคุณสมบัติ', bucket: 'DROPPED_ACADEMIC' },

  // Voluntary leave
  { contains: 'ลาออก', bucket: 'DROPPED_VOLUNTARY' },

  // Transfers
  { contains: 'โอนย้ายไป', bucket: 'TRANSFERRED' },
  { contains: 'เปลี่ยนระดับการศึกษา', bucket: 'TRANSFERRED' },
  { contains: 'เปลี่ยนระบบการศึกษา', bucket: 'TRANSFERRED' },
  { contains: 'เปลี่ยนแผนการศึกษา', bucket: 'TRANSFERRED' },
  { contains: 'สิ้นสุดการเรียนข้าม มหาวิทยาลัย', bucket: 'TRANSFERRED' },
];

export function bucketAlumniStatus(rawStatus: string | null | undefined): AlumniStatusBucket {
  if (!rawStatus) return 'OTHER';
  for (const rule of RULES) {
    if (rawStatus.includes(rule.contains)) return rule.bucket;
  }
  return 'OTHER';
}

// ────────────────────────────────────────────────────────────────────────────
// KKU Registrar STUDENTSTATUSCODE → enrollment-funnel bucket.
//
// The registrar's `STUDENTSTATUSCODE` (NUMBER) and `STUDENTSTATUS` (Thai
// text) describe a student's terminal state. We collapse the 51 distinct
// codes seen on 2026-04-27 into 5 funnel buckets so cohort counts roll up
// cleanly into our `EnrollmentMetric` schema.
//
// Update procedure when a new code appears:
//   1. Re-run `pnpm registry:capture aggregate` to refresh the fixture.
//   2. Add the new code to STATUS_BUCKET_MAP below with a comment quoting
//      the Thai text and reasoning for the chosen bucket.
//   3. Update apps/ingestion/test/kku-registry/status-mapping.test.ts —
//      the test asserts every code in the captured fixture maps to a
//      bucket (no UNCATEGORISED).
//
// Codes NOT in the map default to UNCATEGORISED — the connector logs a
// warning and surfaces them in `IngestionRun.metadata.unknownStatuses[]`
// rather than silently dropping them.
//
// Bucket semantics:
//   GRADUATED       Student completed the program.
//   ACTIVE          Currently enrolled (incl. on leave / pending paperwork).
//   DROPOUT         Terminated after enrolling — academic, financial,
//                   transferred out, deceased, disciplinary, etc.
//   NEVER_ENROLLED  Admitted but never started classes (declined offer,
//                   didn't report, missing docs, waitlist).
//   UNCATEGORISED   Code not yet in the map. Counted but not flowed into
//                   any of the four funnel slots until classified.
// ────────────────────────────────────────────────────────────────────────────

export type StatusBucket =
  | 'GRADUATED'
  | 'ACTIVE'
  | 'DROPOUT'
  | 'NEVER_ENROLLED'
  | 'UNCATEGORISED';

export interface StatusEntry {
  code: number;
  bucket: StatusBucket;
  /** Thai text observed in the fixture — for analyst readability. */
  thaiLabel: string;
}

// 51 codes captured 2026-04-27 — total = 349,965 rows. Sorted by bucket
// then by descending row count within each bucket.
export const STATUS_BUCKET_MAP: ReadonlyMap<number, StatusEntry> = new Map<
  number,
  StatusEntry
>([
  // ── GRADUATED ─────────────────────────────────────────────────────
  [40, { code: 40, bucket: 'GRADUATED',      thaiLabel: 'สำเร็จการศึกษา' }],
  // 98 = "terminated, awaiting correct alumni status" — a paperwork end
  // state for completed students.
  [98, { code: 98, bucket: 'GRADUATED',      thaiLabel: 'พ้นสภาพ-รอสถานภาพที่ถูกต้อง(ศิษย์เก่า)' }],

  // ── ACTIVE ────────────────────────────────────────────────────────
  [10, { code: 10, bucket: 'ACTIVE',         thaiLabel: 'นักศึกษาปัจจุบัน สถานะปกติ' }],
  // 5/6: reported but not yet started classes — they're past the
  // never-enrolled gate so we count them as ACTIVE.
  [5,  { code: 5,  bucket: 'ACTIVE',         thaiLabel: 'มารายงานตัวแล้ว' }],
  [6,  { code: 6,  bucket: 'ACTIVE',         thaiLabel: 'มารายงานตัว ผ่อนผัน / ได้รับทุน' }],
  // 39: pending faculty board graduation approval — academically done.
  [39, { code: 39, bucket: 'ACTIVE',         thaiLabel: 'รอกรรมการคณะอนุมัติจบ/นำเสนอสภา' }],
  [12, { code: 12, bucket: 'ACTIVE',         thaiLabel: 'ลาพักการเรียน' }],
  [11, { code: 11, bucket: 'ACTIVE',         thaiLabel: 'รักษาสภาพนักศึกษา' }],
  [16, { code: 16, bucket: 'ACTIVE',         thaiLabel: 'รอการตีพิมพ์' }],
  [14, { code: 14, bucket: 'ACTIVE',         thaiLabel: 'ศึกษาต่อต่างประเทศตามโครงการร่วม' }],
  [13, { code: 13, bucket: 'ACTIVE',         thaiLabel: 'ถูกสั่งพักการเรียน' }],
  [90, { code: 90, bucket: 'ACTIVE',         thaiLabel: 'ต่อทะเบียนโดยไม่ลงทะเบียนรายวิชาเรียน' }],

  // ── NEVER_ENROLLED ────────────────────────────────────────────────
  [51, { code: 51, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพเนื่องจากไม่รายงานตัวเข้าเป็นนักศึกษา' }],
  [67, { code: 67, bucket: 'NEVER_ENROLLED', thaiLabel: 'แจ้งสละสิทธิ์แล้ว' }],
  [78, { code: 78, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพ-ขาดเอกสารประกอบการรายงานตัว' }],
  [52, { code: 52, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพ-ไม่รายงานตัว(ใช้กับงานquota)' }],
  [95, { code: 95, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพ-รับตรง(ไม่มารายงานตัว)' }],
  [0,  { code: 0,  bucket: 'NEVER_ENROLLED', thaiLabel: 'ยังไม่มารายงานตัว' }],
  [1,  { code: 1,  bucket: 'NEVER_ENROLLED', thaiLabel: 'ผู้ที่ได้อันดับสำรอง' }],
  [79, { code: 79, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพ-ยกเลิกการใช้รหัสนักศึกษา' }],
  [68, { code: 68, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพการเป็นนักศึกษาเนื่องจากขาดคุณสมบัติในการรับเข้าศึกษา' }],
  [53, { code: 53, bucket: 'NEVER_ENROLLED', thaiLabel: 'พ้นสภาพเนื่องจากไม่ชำระค่าขึ้นทะเบียน นศ.ใหม่' }],

  // ── DROPOUT ───────────────────────────────────────────────────────
  [50, { code: 50, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากลาออก' }],
  [61, { code: 61, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากไม่ชำระค่าต่อทะเบียนนักศึกษา' }],
  [62, { code: 62, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากตกออก' }],
  [60, { code: 60, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากไม่ลงทะเบียนตามเวลากำหนด' }],
  [59, { code: 59, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-โอนย้ายไปสาขาอื่น' }],
  [58, { code: 58, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-สิ้นสุดโครงการ' }],
  [63, { code: 63, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากใช้เวลาเรียนเกิน2เท่าระยะเวลา' }],
  [97, { code: 97, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ ไม่ผ่านเกณฑ์การประเมินความรู้ความสามารถทางภาษาต่างประเทศ' }],
  [57, { code: 57, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากสิ้นสุดการศึกษา-ร่วมเรียน' }],
  [81, { code: 81, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ- ( ตาย )' }],
  [55, { code: 55, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-โอนย้ายไปคณะอื่น' }],
  [69, { code: 69, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-เปลี่ยนแผนการศึกษา' }],
  [66, { code: 66, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากเปลี่ยนระดับการศึกษา' }],
  [99, { code: 99, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ- ( อื่นๆ )' }],
  [85, { code: 85, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-เปลี่ยนระบบการศึกษา' }],
  [83, { code: 83, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-เปลี่ยนระดับการศึกษา' }],
  [74, { code: 74, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-ไม่มีความก้าวหน้าในการทำวิทยานิพนธ์หรือการศึกษาอิสระ 2 ภาคติดต่อกัน โดยได้สัญลักษณ์ S เป็น 0' }],
  [82, { code: 82, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-สอบประมวลความรู้ ได้ S=0 2 ครั้ง' }],
  [75, { code: 75, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-สอบวิทยานิพนธ์หรือสอบประมวลความรู้ หรือสอบศึกษาอิสระ หรือสอบวัดคุณสมบัติครั้งที่ 2 ไม่ผ่าน' }],
  [84, { code: 84, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-สิ้นสุดการเรียนข้าม มหาวิทยาลัย' }],
  [64, { code: 64, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากสอบ Thesis /Com /IS ครั้งที่ 2 ไม่ผ่าน' }],
  [80, { code: 80, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-โอนไปศึกษาสถาบันอื่น' }],
  [65, { code: 65, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากไม่ผ่านภาษาต่างประเทศตามเกณฑ์ที่  สกอ. กำหนด' }],
  [70, { code: 70, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากถูกลงโทษให้พ้นสภาพการเป็น นศ.' }],
  [56, { code: 56, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-ลบชื่อออก' }],
  [76, { code: 76, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-หลังสอบครั่งที่ 1 ไม่ผ่านไม่ดำเนินการ และ/หรือ สอบครั้งที่ 2 ตามเวลาที่กำหนด' }],
  [73, { code: 73, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพ-มหาวิทยาลัยสั่งให้ออก อันเนื่องจากการฝ่าฝืนระเบียบการลงทะเบียนและการชำระค่าธรรมเนียมการศึกษา' }],
  [72, { code: 72, bucket: 'DROPOUT',        thaiLabel: 'พ้นสภาพเนื่องจากต้องโทษคำพิพากษาจำคุก' }],

  // ── UNCATEGORISED (rare; null status text) ────────────────────────
  [41, { code: 41, bucket: 'UNCATEGORISED',  thaiLabel: '(NULL)' }],
]);

export function bucketForStatusCode(code: number | null | undefined): StatusBucket {
  if (code === null || code === undefined) return 'UNCATEGORISED';
  return STATUS_BUCKET_MAP.get(code)?.bucket ?? 'UNCATEGORISED';
}

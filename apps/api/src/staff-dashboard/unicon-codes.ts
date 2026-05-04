// UNICON reference code → label maps. Source: Reference_V2.01.xlsx
// (committed off-repo at /home/denpong/employment/unicon/). Hand-
// transcribed; refresh when MHESI publishes a new reference release.

export const STAFF_TYPE: Record<string, string> = {
  '1': 'ข้าราชการ',
  '2': 'พนักงานมหาวิทยาลัย',
  '3': 'จ้างประจำ',
  '4': 'จ้างชั่วคราว',
  '5': 'พนักงานราชการ',
};

export const SUB_STAFFTYPE: Record<string, string> = {
  '1': 'สายวิชาการ (อาจารย์ประจำ)',
  '2': 'สายสนับสนุน',
  '3': 'สายสนับสนุนมีชั่วโมงช่วยสอน',
  '4': 'สายวิชาการ (อาจารย์พิเศษ)',
  '5': 'สายสนับสนุนที่เคยเป็นสายวิชาการ',
};

// Track classification: ACADEMIC vs SUPPORT, derived from SUBSTAFFTYPE_ID.
export type StaffTrack = 'ACADEMIC' | 'SUPPORT';
export function staffTrack(subStaffTypeId: string | null | undefined): StaffTrack {
  if (subStaffTypeId === '1' || subStaffTypeId === '4') return 'ACADEMIC';
  return 'SUPPORT';
}

export const ACADEMIC_STANDING: Record<string, string> = {
  '00': 'ไม่มีตำแหน่งทางวิชาการ',
  '01': 'อาจารย์',
  '02': 'ผู้ช่วยศาสตราจารย์',
  '03': 'รองศาสตราจารย์',
  '04': 'ศาสตราจารย์',
  '05': 'ศาสตราจารย์ (ขั้นสูง)',
  '06': 'ผู้ช่วยศาสตราจารย์พิเศษ',
  '07': 'รองศาสตราจารย์พิเศษ',
  '08': 'ศาสตราจารย์พิเศษ',
  '09': 'ศาสตราจารย์คลินิก',
  '10': 'ศาสตราจารย์กิตติคุณ/เกียรติคุณ',
};

// Tenure-track ladder ranks for visualisation ordering. Codes 06-10
// (พิเศษ / คลินิก / เกียรติคุณ) sit alongside the regular ladder rather
// than on it — they get rank 5 so the chart doesn't collapse them onto ศ.
export const ACADEMIC_STANDING_RANK: Record<string, number> = {
  '00': 0,
  '01': 1, // อาจารย์
  '02': 2, // ผศ.
  '03': 3, // รศ.
  '04': 4, // ศ.
  '05': 4.5, // ศ. ขั้นสูง — same tier as ศ., one notch up
  '06': 5,
  '07': 5,
  '08': 5,
  '09': 5,
  '10': 5,
};

export const POSITION_LEVEL: Record<string, string> = {
  '00': 'ไม่มีรหัสวิทยฐานะ',
  '10': 'ปฏิบัติการ',
  '11': 'ชำนาญการ',
  '12': 'เชี่ยวชาญ',
  '13': 'เชี่ยวชาญพิเศษ',
  '14': 'ชำนาญงาน',
  '15': 'ชำนาญงานพิเศษ',
  '16': 'ชำนาญการพิเศษ',
};

export const ADMIN_POSITION: Record<string, string> = {
  '00': 'ไม่มีตำแหน่งทางบริหาร',
  '01': 'อธิการบดี',
  '02': 'รองอธิการบดี',
  '03': 'คณบดี',
  '04': 'หัวหน้าหน่วยงานเทียบเท่าคณะ',
  '05': 'รองคณบดี',
  '06': 'ผู้ช่วยอธิการบดี',
  '07': 'ผู้ช่วยคณบดี',
  '08': 'หัวหน้าภาควิชา',
};

export const BUDGET_SOURCE: Record<string, string> = {
  '1': 'งบประมาณแผ่นดิน',
  '2': 'เงินรายได้',
  '3': 'เงินกู้',
  '4': 'เงินสนับสนุนจากแหล่งอื่น',
};

export const GENDER: Record<string, string> = {
  '1': 'ชาย',
  '2': 'หญิง',
};

export const INCOME_BAND: Record<string, string> = {
  '01': '<= 15,000',
  '02': '15,001-30,000',
  '03': '30,001-45,000',
  '04': '45,001-60,000',
  '05': '> 60,000',
};

export const INCOME_BAND_ORDER = ['01', '02', '03', '04', '05'];

export const MOVEMENT_TYPE: Record<string, string> = {
  '01': 'ย้าย',
  '02': 'เลื่อนตำแหน่ง',
  '03': 'บรรจุใหม่',
  '04': 'บรรจุกลับ',
  '05': 'รับโอน',
  '06': 'เกษียณ',
  '07': 'ลาออก',
  '08': 'ถึงแก่กรรม',
  '09': 'ทำสัญญาครั้งแรก',
  '10': 'ต่อสัญญา',
  '11': 'หมดสัญญา',
  '12': 'พ้นสภาพ',
  '13': 'อื่นๆ',
  '14': 'ปรับปรุงข้อมูล',
};

export const DEFORM_NORMAL = '00';

export const TIME_CONTACT: Record<string, string> = {
  '0': 'ไม่ระบุ/ข้าราชการ',
  '1': 'สัญญา 1 ปี',
  '2': 'สัญญา 2 ปี',
  '3': 'สัญญา 3 ปี',
  '4': 'สัญญา 4 ปี',
  '5': 'สัญญา 5 ปี',
};

export const TEACH_LEVEL: Record<string, string> = {
  '01': 'ป.ตรี',
  '02': 'ป.บัณฑิต',
  '03': 'ป.โท',
  '04': 'ป.บัณฑิตชั้นสูง',
  '05': 'ป.เอก',
  '-': 'ไม่ได้สอน',
};

// Look up a label, or fall back to the raw code (so unknown values stay
// visible to the analyst rather than disappearing).
export function lookupOrCode(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return '∅';
  const trimmed = code.trim();
  return map[trimmed] ?? trimmed;
}

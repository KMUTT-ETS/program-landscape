// Static map of Thailand's 77 administrative divisions (76 provinces +
// Bangkok metropolis) → 6 NESDC regions. Used by the Education
// dashboard and any other module that wants to roll up province-level
// data to a regional view without a database trip.
//
// Source: NESDC (National Economic and Social Development Council)
// canonical regional classification. Bangkok is grouped with Central
// per the NESDC convention.
//
// Lookup is by Thai name (the registry's HOMEPROVINCENAME and
// SCHOOLPROVINCENAME columns are Thai). English names are kept as a
// secondary lookup so module authors can use either form. The lookup
// helper is whitespace-tolerant (registry data sometimes has leading/
// trailing whitespace).

export type ThailandRegion =
  | 'NORTH'
  | 'NORTHEAST'
  | 'CENTRAL'
  | 'EAST'
  | 'WEST'
  | 'SOUTH';

export interface ThailandProvince {
  /** Thai name as it appears in the registry (canonical form). */
  nameTh: string;
  /** English short name (per common Thai-English transliteration). */
  nameEn: string;
  /** ISO 3166-2:TH subdivision code (e.g., "TH-10" for Bangkok). */
  iso: string;
  region: ThailandRegion;
}

export const THAILAND_REGION_LABELS: Record<
  ThailandRegion,
  { th: string; en: string }
> = {
  NORTH: { th: 'ภาคเหนือ', en: 'Northern' },
  NORTHEAST: { th: 'ภาคตะวันออกเฉียงเหนือ', en: 'Northeastern (Isan)' },
  CENTRAL: { th: 'ภาคกลาง', en: 'Central' },
  EAST: { th: 'ภาคตะวันออก', en: 'Eastern' },
  WEST: { th: 'ภาคตะวันตก', en: 'Western' },
  SOUTH: { th: 'ภาคใต้', en: 'Southern' },
};

// Display order (north → south, with Bangkok-led Central in the middle).
export const THAILAND_REGION_ORDER: ThailandRegion[] = [
  'NORTH',
  'NORTHEAST',
  'CENTRAL',
  'EAST',
  'WEST',
  'SOUTH',
];

// 77 administrative divisions. Order: ISO code ascending so the literal
// shape doubles as a sortable reference table.
export const THAILAND_PROVINCES: readonly ThailandProvince[] = [
  // ── Central (incl. Bangkok) ─────────────────────────────────────
  { nameTh: 'กรุงเทพมหานคร', nameEn: 'Bangkok', iso: 'TH-10', region: 'CENTRAL' },
  { nameTh: 'สมุทรปราการ', nameEn: 'Samut Prakan', iso: 'TH-11', region: 'CENTRAL' },
  { nameTh: 'นนทบุรี', nameEn: 'Nonthaburi', iso: 'TH-12', region: 'CENTRAL' },
  { nameTh: 'ปทุมธานี', nameEn: 'Pathum Thani', iso: 'TH-13', region: 'CENTRAL' },
  { nameTh: 'พระนครศรีอยุธยา', nameEn: 'Ayutthaya', iso: 'TH-14', region: 'CENTRAL' },
  { nameTh: 'อ่างทอง', nameEn: 'Ang Thong', iso: 'TH-15', region: 'CENTRAL' },
  { nameTh: 'ลพบุรี', nameEn: 'Lopburi', iso: 'TH-16', region: 'CENTRAL' },
  { nameTh: 'สิงห์บุรี', nameEn: 'Sing Buri', iso: 'TH-17', region: 'CENTRAL' },
  { nameTh: 'ชัยนาท', nameEn: 'Chai Nat', iso: 'TH-18', region: 'CENTRAL' },
  { nameTh: 'สระบุรี', nameEn: 'Saraburi', iso: 'TH-19', region: 'CENTRAL' },

  // ── East ────────────────────────────────────────────────────────
  { nameTh: 'ชลบุรี', nameEn: 'Chonburi', iso: 'TH-20', region: 'EAST' },
  { nameTh: 'ระยอง', nameEn: 'Rayong', iso: 'TH-21', region: 'EAST' },
  { nameTh: 'จันทบุรี', nameEn: 'Chanthaburi', iso: 'TH-22', region: 'EAST' },
  { nameTh: 'ตราด', nameEn: 'Trat', iso: 'TH-23', region: 'EAST' },
  { nameTh: 'ฉะเชิงเทรา', nameEn: 'Chachoengsao', iso: 'TH-24', region: 'EAST' },
  { nameTh: 'ปราจีนบุรี', nameEn: 'Prachinburi', iso: 'TH-25', region: 'EAST' },
  { nameTh: 'นครนายก', nameEn: 'Nakhon Nayok', iso: 'TH-26', region: 'CENTRAL' },
  { nameTh: 'สระแก้ว', nameEn: 'Sa Kaeo', iso: 'TH-27', region: 'EAST' },

  // ── Northeast (Isan) ────────────────────────────────────────────
  { nameTh: 'นครราชสีมา', nameEn: 'Nakhon Ratchasima', iso: 'TH-30', region: 'NORTHEAST' },
  { nameTh: 'บุรีรัมย์', nameEn: 'Buriram', iso: 'TH-31', region: 'NORTHEAST' },
  { nameTh: 'สุรินทร์', nameEn: 'Surin', iso: 'TH-32', region: 'NORTHEAST' },
  { nameTh: 'ศรีสะเกษ', nameEn: 'Sisaket', iso: 'TH-33', region: 'NORTHEAST' },
  { nameTh: 'อุบลราชธานี', nameEn: 'Ubon Ratchathani', iso: 'TH-34', region: 'NORTHEAST' },
  { nameTh: 'ยโสธร', nameEn: 'Yasothon', iso: 'TH-35', region: 'NORTHEAST' },
  { nameTh: 'ชัยภูมิ', nameEn: 'Chaiyaphum', iso: 'TH-36', region: 'NORTHEAST' },
  { nameTh: 'อำนาจเจริญ', nameEn: 'Amnat Charoen', iso: 'TH-37', region: 'NORTHEAST' },
  { nameTh: 'บึงกาฬ', nameEn: 'Bueng Kan', iso: 'TH-38', region: 'NORTHEAST' },
  { nameTh: 'หนองบัวลำภู', nameEn: 'Nong Bua Lamphu', iso: 'TH-39', region: 'NORTHEAST' },
  { nameTh: 'ขอนแก่น', nameEn: 'Khon Kaen', iso: 'TH-40', region: 'NORTHEAST' },
  { nameTh: 'อุดรธานี', nameEn: 'Udon Thani', iso: 'TH-41', region: 'NORTHEAST' },
  { nameTh: 'เลย', nameEn: 'Loei', iso: 'TH-42', region: 'NORTHEAST' },
  { nameTh: 'หนองคาย', nameEn: 'Nong Khai', iso: 'TH-43', region: 'NORTHEAST' },
  { nameTh: 'มหาสารคาม', nameEn: 'Maha Sarakham', iso: 'TH-44', region: 'NORTHEAST' },
  { nameTh: 'ร้อยเอ็ด', nameEn: 'Roi Et', iso: 'TH-45', region: 'NORTHEAST' },
  { nameTh: 'กาฬสินธุ์', nameEn: 'Kalasin', iso: 'TH-46', region: 'NORTHEAST' },
  { nameTh: 'สกลนคร', nameEn: 'Sakon Nakhon', iso: 'TH-47', region: 'NORTHEAST' },
  { nameTh: 'นครพนม', nameEn: 'Nakhon Phanom', iso: 'TH-48', region: 'NORTHEAST' },
  { nameTh: 'มุกดาหาร', nameEn: 'Mukdahan', iso: 'TH-49', region: 'NORTHEAST' },

  // ── North ───────────────────────────────────────────────────────
  { nameTh: 'เชียงใหม่', nameEn: 'Chiang Mai', iso: 'TH-50', region: 'NORTH' },
  { nameTh: 'ลำพูน', nameEn: 'Lamphun', iso: 'TH-51', region: 'NORTH' },
  { nameTh: 'ลำปาง', nameEn: 'Lampang', iso: 'TH-52', region: 'NORTH' },
  { nameTh: 'อุตรดิตถ์', nameEn: 'Uttaradit', iso: 'TH-53', region: 'NORTH' },
  { nameTh: 'แพร่', nameEn: 'Phrae', iso: 'TH-54', region: 'NORTH' },
  { nameTh: 'น่าน', nameEn: 'Nan', iso: 'TH-55', region: 'NORTH' },
  { nameTh: 'พะเยา', nameEn: 'Phayao', iso: 'TH-56', region: 'NORTH' },
  { nameTh: 'เชียงราย', nameEn: 'Chiang Rai', iso: 'TH-57', region: 'NORTH' },
  { nameTh: 'แม่ฮ่องสอน', nameEn: 'Mae Hong Son', iso: 'TH-58', region: 'NORTH' },

  // ── Central (continued — lower-central provinces) ───────────────
  { nameTh: 'นครสวรรค์', nameEn: 'Nakhon Sawan', iso: 'TH-60', region: 'CENTRAL' },
  { nameTh: 'อุทัยธานี', nameEn: 'Uthai Thani', iso: 'TH-61', region: 'CENTRAL' },
  { nameTh: 'กำแพงเพชร', nameEn: 'Kamphaeng Phet', iso: 'TH-62', region: 'CENTRAL' },
  { nameTh: 'ตาก', nameEn: 'Tak', iso: 'TH-63', region: 'WEST' },
  { nameTh: 'สุโขทัย', nameEn: 'Sukhothai', iso: 'TH-64', region: 'CENTRAL' },
  { nameTh: 'พิษณุโลก', nameEn: 'Phitsanulok', iso: 'TH-65', region: 'CENTRAL' },
  { nameTh: 'พิจิตร', nameEn: 'Phichit', iso: 'TH-66', region: 'CENTRAL' },
  { nameTh: 'เพชรบูรณ์', nameEn: 'Phetchabun', iso: 'TH-67', region: 'CENTRAL' },

  // ── West ────────────────────────────────────────────────────────
  { nameTh: 'ราชบุรี', nameEn: 'Ratchaburi', iso: 'TH-70', region: 'WEST' },
  { nameTh: 'กาญจนบุรี', nameEn: 'Kanchanaburi', iso: 'TH-71', region: 'WEST' },
  { nameTh: 'สุพรรณบุรี', nameEn: 'Suphan Buri', iso: 'TH-72', region: 'CENTRAL' },
  { nameTh: 'นครปฐม', nameEn: 'Nakhon Pathom', iso: 'TH-73', region: 'CENTRAL' },
  { nameTh: 'สมุทรสาคร', nameEn: 'Samut Sakhon', iso: 'TH-74', region: 'CENTRAL' },
  { nameTh: 'สมุทรสงคราม', nameEn: 'Samut Songkhram', iso: 'TH-75', region: 'CENTRAL' },
  { nameTh: 'เพชรบุรี', nameEn: 'Phetchaburi', iso: 'TH-76', region: 'WEST' },
  { nameTh: 'ประจวบคีรีขันธ์', nameEn: 'Prachuap Khiri Khan', iso: 'TH-77', region: 'WEST' },

  // ── South ───────────────────────────────────────────────────────
  { nameTh: 'นครศรีธรรมราช', nameEn: 'Nakhon Si Thammarat', iso: 'TH-80', region: 'SOUTH' },
  { nameTh: 'กระบี่', nameEn: 'Krabi', iso: 'TH-81', region: 'SOUTH' },
  { nameTh: 'พังงา', nameEn: 'Phang Nga', iso: 'TH-82', region: 'SOUTH' },
  { nameTh: 'ภูเก็ต', nameEn: 'Phuket', iso: 'TH-83', region: 'SOUTH' },
  { nameTh: 'สุราษฎร์ธานี', nameEn: 'Surat Thani', iso: 'TH-84', region: 'SOUTH' },
  { nameTh: 'ระนอง', nameEn: 'Ranong', iso: 'TH-85', region: 'SOUTH' },
  { nameTh: 'ชุมพร', nameEn: 'Chumphon', iso: 'TH-86', region: 'SOUTH' },
  { nameTh: 'สงขลา', nameEn: 'Songkhla', iso: 'TH-90', region: 'SOUTH' },
  { nameTh: 'สตูล', nameEn: 'Satun', iso: 'TH-91', region: 'SOUTH' },
  { nameTh: 'ตรัง', nameEn: 'Trang', iso: 'TH-92', region: 'SOUTH' },
  { nameTh: 'พัทลุง', nameEn: 'Phatthalung', iso: 'TH-93', region: 'SOUTH' },
  { nameTh: 'ปัตตานี', nameEn: 'Pattani', iso: 'TH-94', region: 'SOUTH' },
  { nameTh: 'ยะลา', nameEn: 'Yala', iso: 'TH-95', region: 'SOUTH' },
  { nameTh: 'นราธิวาส', nameEn: 'Narathiwat', iso: 'TH-96', region: 'SOUTH' },
];

// O(1) lookup tables built once at module load. Lookups are case-
// insensitive on whitespace-trimmed input; the registry occasionally
// emits names with leading/trailing space.
const PROVINCE_BY_TH = new Map<string, ThailandProvince>(
  THAILAND_PROVINCES.map((p) => [normaliseProvinceName(p.nameTh), p]),
);
const PROVINCE_BY_EN = new Map<string, ThailandProvince>(
  THAILAND_PROVINCES.map((p) => [normaliseProvinceName(p.nameEn), p]),
);

function normaliseProvinceName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Strip the optional Thai "จังหวัด" prefix some sources include. */
function stripJangwatPrefix(name: string): string {
  return name.replace(/^จังหวัด\s*/, '');
}

/** Resolve a province by its Thai or English name (case-insensitive,
 *  whitespace-tolerant). Returns null when the name is not in the
 *  static map — common for foreign / unknown / "(unknown)" sentinels. */
export function lookupProvince(name: string | null | undefined): ThailandProvince | null {
  if (!name) return null;
  const cleaned = normaliseProvinceName(stripJangwatPrefix(name));
  if (!cleaned) return null;
  return PROVINCE_BY_TH.get(cleaned) ?? PROVINCE_BY_EN.get(cleaned) ?? null;
}

/** Convenience: resolve to region only. Returns null when the province
 *  isn't recognised. Foreign / unmapped values should be reported as
 *  "Unknown" by the caller, not silently bucketed. */
export function lookupRegion(name: string | null | undefined): ThailandRegion | null {
  return lookupProvince(name)?.region ?? null;
}

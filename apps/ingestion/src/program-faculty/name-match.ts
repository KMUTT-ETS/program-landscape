/**
 * Roster name matching for the programme-faculty extraction.
 *
 * Curriculum documents print staff as "Asst. Prof. Dr. Somsak Testing" or
 * "ผศ.ดร. สมมติ ทดสอบ", while the HR roster holds bare names. Matching on the
 * exact string therefore misses everyone who carries a title. This module
 * strips academic/medical/courtesy titles, then looks the name up by Thai
 * name, English name, and English name with first/last swapped. A key shared
 * by two members is ambiguous and never matches — a wrong link is worse than
 * a missing one.
 */

// Thai titles that carry a dot (the dot is required). Longest first.
const THAI_DOTTED = [
  'ศ.ดร', 'รศ.ดร', 'ผศ.ดร', 'ศ.นพ', 'รศ.นพ', 'ผศ.นพ', 'ศ.พญ', 'รศ.พญ', 'ผศ.พญ',
  'ศ.ทพญ', 'รศ.ทพญ', 'ผศ.ทพญ', 'ศ.ทพ', 'รศ.ทพ', 'ผศ.ทพ', 'ศ.ภก', 'รศ.ภก', 'ผศ.ภก',
  'ศ.ภญ', 'รศ.ภญ', 'ผศ.ภญ', 'รศ', 'ผศ', 'ศ', 'ดร', 'อ', 'ทพญ', 'ทพ', 'พญ', 'นพ', 'ภก', 'ภญ',
];
// Thai titles written out in full (no dot needed).
const THAI_WORDS = ['ผู้ช่วยศาสตราจารย์', 'รองศาสตราจารย์', 'ศาสตราจารย์', 'อาจารย์', 'นางสาว', 'นาง', 'นาย'];
// English titles; matched case-insensitively, dot optional, must end at a boundary.
const EN_TITLES = [
  'assistant professor', 'associate professor', 'assoc\\.?\\s*prof', 'asst\\.?\\s*prof',
  'professor', 'prof', 'dr', 'mrs', 'mr', 'ms',
];

const esc = (s: string): string => s.replace(/\./g, '\\.');
const TITLE_RE = new RegExp(
  '^(?:' +
    `(?:${THAI_DOTTED.map(esc).join('|')})\\.` +
    '|' +
    `(?:${THAI_WORDS.join('|')})` +
    '|' +
    `(?:${EN_TITLES.join('|')})(?:\\.|(?=\\s))` +
    ')\\s*',
  'i',
);

export function stripAcademicTitles(name: string): string {
  let s = name.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 12; i++) {
    const next = s.replace(TITLE_RE, '');
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function swapFirstLast(stripped: string): string | null {
  const parts = stripped.split(' ');
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]!;
  return [last, ...parts.slice(0, -1)].join(' ');
}

const AMBIGUOUS = Symbol('ambiguous');
type Slot = string | typeof AMBIGUOUS;

export interface RosterLookup {
  th: Map<string, Slot>;
  en: Map<string, Slot>;
  swapped: Map<string, Slot>;
}

function put(map: Map<string, Slot>, key: string | null, id: string): void {
  if (!key) return;
  const existing = map.get(key);
  if (existing === undefined) map.set(key, id);
  else if (existing !== id) map.set(key, AMBIGUOUS);
}

export function buildRosterLookup(
  members: { id: string; nameTh: string | null; nameEn: string | null }[],
): RosterLookup {
  const lookup: RosterLookup = { th: new Map(), en: new Map(), swapped: new Map() };
  for (const m of members) {
    if (m.nameTh) put(lookup.th, stripAcademicTitles(m.nameTh), m.id);
    if (m.nameEn) {
      const en = stripAcademicTitles(m.nameEn);
      put(lookup.en, en, m.id);
      put(lookup.swapped, swapFirstLast(en), m.id);
    }
  }
  return lookup;
}

function get(map: Map<string, Slot>, key: string | null | undefined): string | null {
  if (!key) return null;
  const v = map.get(key);
  return typeof v === 'string' ? v : null;
}

/** Thai, then English, then swapped English. Returns the member id or null. */
export function matchRosterName(
  lookup: RosterLookup,
  entry: { nameTh?: string | null; nameEn?: string | null },
): string | null {
  const th = entry.nameTh ? stripAcademicTitles(entry.nameTh) : null;
  const en = entry.nameEn ? stripAcademicTitles(entry.nameEn) : null;
  return get(lookup.th, th) ?? get(lookup.en, en) ?? get(lookup.swapped, en);
}

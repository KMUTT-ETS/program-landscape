/**
 * Roster name matching for the programme-faculty extraction.
 *
 * Curriculum documents print staff as "Asst. Prof. Dr. Somsak Testing" or
 * "ผศ.ดร. สมมติ ทดสอบ", while the HR roster holds bare names. Matching on the
 * exact string therefore misses everyone who carries a title. This module
 * strips academic/medical/courtesy titles, then looks the name up by Thai
 * name, English name, and English name with first/last swapped. A key shared
 * by several members prefers the single active one, then an exact raw-name
 * match, then the last in load order (the pre-change behaviour).
 */

// Thai titles that carry a dot (the dot is required). Longest first.
const THAI_DOTTED = [
  'ศ.ดร', 'รศ.ดร', 'ผศ.ดร', 'ศ.นพ', 'รศ.นพ', 'ผศ.นพ', 'ศ.พญ', 'รศ.พญ', 'ผศ.พญ',
  'ศ.ทพญ', 'รศ.ทพญ', 'ผศ.ทพญ', 'ศ.ทพ', 'รศ.ทพ', 'ผศ.ทพ', 'ศ.ภก', 'รศ.ภก', 'ผศ.ภก',
  'ศ.ภญ', 'รศ.ภญ', 'ผศ.ภญ', 'รศ', 'ผศ', 'ศ', 'ดร', 'อ', 'ทพญ', 'ทพ', 'พญ', 'นพ', 'ภก', 'ภญ',
];
// Thai titles written out in full (no dot needed).
const THAI_WORDS = ['ผู้ช่วยศาสตราจารย์', 'รองศาสตราจารย์', 'ศาสตราจารย์', 'อาจารย์', 'นางสาว'];
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
    let next = s.replace(TITLE_RE, '');
    if (next === s) {
      // Bare นาย / นาง: a title only when a space follows, or when at least
      // two tokens remain (a given name that merely starts with these letters
      // is kept).
      const m = /^(?:นาย|นาง)(\s*)/.exec(s);
      if (m) {
        const rest = s.slice(m[0].length);
        if ((m[1] ?? '').length > 0 || rest.split(' ').length >= 2) next = rest;
      }
    }
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

interface Candidate {
  id: string;
  active: boolean;
  /** The name this candidate was indexed under, unstripped (see normRaw). */
  raw: string;
}

/** Unstripped normalisation: trim, collapse whitespace, lower-case. */
function normRaw(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface RosterLookup {
  th: Map<string, Candidate[]>;
  en: Map<string, Candidate[]>;
  swapped: Map<string, Candidate[]>;
}

function put(map: Map<string, Candidate[]>, key: string | null, c: Candidate): void {
  if (!key) return;
  const list = map.get(key);
  if (!list) map.set(key, [c]);
  else if (!list.some((x) => x.id === c.id)) list.push(c);
}

export function buildRosterLookup(
  members: { id: string; nameTh: string | null; nameEn: string | null; isActive?: boolean }[],
): RosterLookup {
  const lookup: RosterLookup = { th: new Map(), en: new Map(), swapped: new Map() };
  for (const m of members) {
    const active = m.isActive ?? true;
    if (m.nameTh) put(lookup.th, stripAcademicTitles(m.nameTh), { id: m.id, active, raw: normRaw(m.nameTh) });
    if (m.nameEn) {
      const en = stripAcademicTitles(m.nameEn);
      const c: Candidate = { id: m.id, active, raw: normRaw(m.nameEn) };
      put(lookup.en, en, c);
      put(lookup.swapped, swapFirstLast(en), c);
    }
  }
  return lookup;
}

/**
 * undefined = key not held; string = the member. A held key always resolves:
 * one candidate; else exactly one active; else the candidate whose unstripped
 * name equals the entry's (when exactly one does); else the LAST candidate in
 * load order. The last-wins fallback preserves the pre-change KKU linking
 * (an exact Map overwritten per member), where an HR "นายสมชาย ใจดี" and a
 * publications "สมชาย ใจดี" both active were linked rather than dropped.
 */
function resolve(
  map: Map<string, Candidate[]>,
  key: string | null,
  rawEntry: string | null,
): string | undefined {
  if (!key) return undefined;
  const list = map.get(key);
  if (!list) return undefined;
  if (list.length === 1) return list[0]!.id;
  const active = list.filter((c) => c.active);
  if (active.length === 1) return active[0]!.id;
  const pool = active.length > 0 ? active : list;
  if (rawEntry) {
    const exact = pool.filter((c) => c.raw === rawEntry);
    if (exact.length === 1) return exact[0]!.id;
  }
  return list[list.length - 1]!.id;
}

/**
 * Thai, then English, then swapped English. Stops at the first kind that
 * HOLDS the key: a held key never falls through to the next kind, so a
 * swapped hit is never accepted when the straight English key exists.
 */
export function matchRosterName(
  lookup: RosterLookup,
  entry: { nameTh?: string | null; nameEn?: string | null },
): string | null {
  const th = entry.nameTh ? stripAcademicTitles(entry.nameTh) : null;
  const en = entry.nameEn ? stripAcademicTitles(entry.nameEn) : null;
  const rawTh = entry.nameTh ? normRaw(entry.nameTh) : null;
  const rawEn = entry.nameEn ? normRaw(entry.nameEn) : null;
  for (const [map, key, raw] of [
    [lookup.th, th, rawTh],
    [lookup.en, en, rawEn],
    [lookup.swapped, en, rawEn],
  ] as const) {
    const r = resolve(map, key, raw);
    if (r !== undefined) return r;
  }
  return null;
}

/** Operator note for a run that extracted staff but linked none; null otherwise. */
export function rosterDegradedNote(
  extracted: number,
  matched: number,
  rowsFromSystemContext: number,
): string | null {
  if (extracted > 0 && matched === 0 && rowsFromSystemContext === 0) {
    return `matched 0 of ${extracted} — load the Staff spreadsheet (or check names) to link teaching staff`;
  }
  return null;
}

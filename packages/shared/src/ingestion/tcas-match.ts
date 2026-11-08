// Own-programme matcher for TCAS rows, shared by the `tcas` connector and
// anything that needs to predict what it will match (e.g. the workshop
// mock-data check). Behaviour is the connector's, moved verbatim.

export interface TcasMatchProgramme {
  id: string;
  nameTh: string;
  majors: string[];
  facultyNameTh: string;
}

type IndexEntry = { id: string; nameTh: string; majors: string[] };

/** Opaque: the two maps the connector used to build inline. */
export interface TcasMatchIndex {
  byFacultyProgramme: Map<string, IndexEntry[]>;
  byFacultySpec: Map<string, IndexEntry[]>;
}

// Separates faculty and programme in the match-index keys, so one faculty
// name that is a prefix of another cannot match the other's programmes.
const KEY_SEP = '\u0001';

export function buildTcasMatchIndex(programmes: readonly TcasMatchProgramme[]): TcasMatchIndex {
  // Index by faculty + programme name for O(1) lookup. Multiple programmes can
  // share a faculty + programme prefix (with major disambiguation); we
  // tolerate ambiguity by preferring the entry whose major matches.
  const byFacultyProgramme = new Map<string, IndexEntry[]>();
  for (const p of programmes) {
    const key = `${p.facultyNameTh}${KEY_SEP}${p.nameTh}`;
    const arr = byFacultyProgramme.get(key) ?? [];
    arr.push(p);
    byFacultyProgramme.set(key, arr);
  }
  // Secondary index by faculty + specialization name (extracted from nameTh
  // via the สาขาวิชา pattern), used by strategy 5.
  const byFacultySpec = new Map<string, IndexEntry[]>();
  for (const p of programmes) {
    const spec = extractSpecialization(p.nameTh);
    if (!spec) continue;
    const key = `${p.facultyNameTh}${KEY_SEP}${spec}`;
    const arr = byFacultySpec.get(key) ?? [];
    arr.push(p);
    byFacultySpec.set(key, arr);
  }
  return { byFacultyProgramme, byFacultySpec };
}

export function findOwnProgrammeMatch(
  tcasIndex: TcasMatchIndex,
  facultyNameTh: string,
  programmeName: string,
  majorName: string,
): { id: string } | null {
  const index = tcasIndex.byFacultyProgramme;
  const specIndex = tcasIndex.byFacultySpec;
  // Strategy 1: exact concat match (faculty + programme).
  for (const candidates of [
    index.get(`${facultyNameTh}${KEY_SEP}${programmeName}`),
  ]) {
    if (candidates && candidates.length > 0) return candidates[0]!;
  }
  // Strategy 2: parenthesised content as the programme key.
  const parenMatch = programmeName.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const inner = parenMatch[1]!.trim();
    const list = index.get(`${facultyNameTh}${KEY_SEP}${inner}`);
    if (list && list.length > 0) return list[0]!;
  }
  // Strategy 3: strip the leading "หลักสูตร...บัณฑิต " prefix.
  const stripped = programmeName.replace(/^หลักสูตร[^ ]*บัณฑิต[\s]*/, '').trim();
  if (stripped !== programmeName) {
    const list = index.get(`${facultyNameTh}${KEY_SEP}${stripped}`);
    if (list && list.length > 0) return list[0]!;
  }
  // Strategy 4: substring of TCAS name contains DB nameTh (works when
  // TCAS uses the full "หลักสูตร..." prefix with extra suffix).
  for (const [key, candidates] of index.entries()) {
    if (!key.startsWith(`${facultyNameTh}${KEY_SEP}`)) continue;
    for (const cand of candidates) {
      if (cand.nameTh && programmeName.includes(cand.nameTh)) return cand;
      if (majorName && cand.nameTh && majorName.includes(cand.nameTh)) return cand;
      for (const m of cand.majors) {
        if (m && programmeName.includes(m)) return cand;
      }
    }
  }
  // Strategy 5: extract specialization (สาขาวิชา / สาขา) from both
  // the TCAS programme name and DB nameTh, then match on it. This
  // bridges abbreviated TCAS names ("วศ.บ.สาขาวิศวกรรมเครื่องกล-วศ.บ.4ปี")
  // with formal DB names ("หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล").
  const tcasSpec = extractSpecialization(programmeName);
  if (tcasSpec) {
    // Try direct match against the spec index.
    const specCandidates = specIndex.get(`${facultyNameTh}${KEY_SEP}${tcasSpec}`);
    if (specCandidates && specCandidates.length > 0) return specCandidates[0]!;
    // Try normalized (lowercased) match.
    const normSpec = tcasSpec.toLowerCase();
    for (const [key, candidates] of specIndex.entries()) {
      if (!key.startsWith(`${facultyNameTh}${KEY_SEP}`)) continue;
      const keySpec = key.slice(facultyNameTh.length + KEY_SEP.length).toLowerCase();
      if (keySpec === normSpec) return candidates[0]!;
    }
    // Try substring match — TCAS spec may be shorter than DB spec.
    for (const [key, candidates] of specIndex.entries()) {
      if (!key.startsWith(`${facultyNameTh}${KEY_SEP}`)) continue;
      const keySpec = key.slice(facultyNameTh.length + KEY_SEP.length).toLowerCase();
      if (keySpec.includes(normSpec) || normSpec.includes(keySpec)) return candidates[0]!;
    }
  }
  // Strategy 5b: try majorName as a specialization source.
  if (majorName) {
    const majorSpec = extractSpecialization(majorName) ?? majorName.trim();
    if (majorSpec) {
      const normMajor = majorSpec.toLowerCase();
      for (const [key, candidates] of specIndex.entries()) {
        if (!key.startsWith(`${facultyNameTh}${KEY_SEP}`)) continue;
        const keySpec = key.slice(facultyNameTh.length + KEY_SEP.length).toLowerCase();
        if (keySpec === normMajor) return candidates[0]!;
        if (keySpec.includes(normMajor) || normMajor.includes(keySpec)) return candidates[0]!;
      }
    }
  }
  return null;
}

/**
 * Extract the specialization / major name from a Thai programme name.
 *
 * TCAS uses many naming formats:
 *   - "วศ.บ.สาขาวิศวกรรมเครื่องกล-วศ.บ.4ปี"
 *   - "หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล ปริญญาตรี 4 ปี"
 *   - "วิศวกรรมเครื่องกล - วศ.บ. 4 ปี"  (no สาขา prefix)
 *   - "คณิตศาสตร์ - วท.บ. 4 ปี"
 *
 * Returns the extracted specialization string, or empty if unextractable.
 */
export function extractSpecialization(name: string): string {
  const n = name.trim();
  // After สาขาวิชา or สาขา — take until end or " ปริญญา" / " -" / "("
  const sakhaMatch = n.match(/สาขา(?:วิชา)?(.+)/);
  if (sakhaMatch) {
    let spec = sakhaMatch[1]!.trim();
    // Strip trailing degree markers: "ปริญญาตรี 4 ปี", "- วศ.บ. 4 ปี", etc.
    spec = spec.replace(/\s*[-–]\s*(วศ\.บ\.|วท\.บ\.|ค\.อ\.บ\.|ทล\.บ\.|ศป\.บ\.|บธ\.บ\.|วิชาเอก).*$/, '').trim();
    spec = spec.replace(/\s*ปริญญา.*$/, '').trim();
    spec = spec.replace(/\s*\(หลักสูตร.*$/, '').trim();
    if (spec) return spec;
  }
  // No สาขา prefix — try "X - วศ.บ. N ปี" pattern (specialization before dash).
  const dashMatch = n.match(/^(.+?)\s*[-–]\s*(วศ\.บ\.|วท\.บ\.|ค\.อ\.บ\.|ทล\.บ\.|ศป\.บ\.|บธ\.บ\.)/);
  if (dashMatch) {
    let spec = dashMatch[1]!.trim();
    // Strip parenthesised suffix like "(หลักสูตรนานาชาติ)".
    spec = spec.replace(/\s*\(หลักสูตร.*$/, '').trim();
    if (spec) return spec;
  }
  // No dash — try "X (หลักสูตร...) - ศป.บ. 4 ปี" pattern.
  const parenDashMatch = n.match(/^(.+?)\s*\(หลักสูตร[^)]+\)\s*[-–]/);
  if (parenDashMatch) {
    return parenDashMatch[1]!.trim();
  }
  return '';
}

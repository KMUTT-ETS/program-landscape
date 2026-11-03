import * as xlsx from 'xlsx';
import { prisma } from '@kku/db';
import {
  isOwnInstitution,
  outboundUserAgent,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import { ApiConnector } from '../../base/api-connector';

// ─────────────────────────────────────────────────────────────────────────────
// TCAS — annual admission statistics from mytcas.com (CUPT).
//
// Round 3 ("Admission") xlsx files are published per academic year at
// stable assets.mytcas.com URLs. TCAS68 (BE 2568 = CE 2025) is split
// into round 3.1 (initial pass) + round 3.2 (clearing). Older years
// publish a single TCAS<NN>_maxmin.xlsx without sub-round split.
//
// Per row schema (Thai column headers):
//   สถาบัน, วิทยาเขต, รหัสหลักสูตร, คณะ, หลักสูตร, รายละเอียด,
//   สาขา/วิชาเอก, รหัสรับร่วม, รับ, สมัคร,
//   ผ่าน ประมวลผลครั้งที่ 1, ผ่าน ประมวลผลครั้งที่ 2,
//   คะแนนสูงสุด/ต่ำสุด ประมวลผลครั้งที่ 1/2
//
// We persist ALL institution rows (not just KKU) so the Benchmarking
// module has cross-institution peer data; KKU rows additionally
// resolve to `programId` via faculty + programme name matching.
//
// Idempotent: upsert on (tcas_course_code, entry_year_be, round).
//
// TCAS1/2/4 are NOT yet ingested — files exist on the same site but
// per user direction (2026-05-02) those connectors will land later.
// ─────────────────────────────────────────────────────────────────────────────

interface TcasFile {
  url: string;
  entryYearBE: number;
  round: '3' | '3.1' | '3.2';
}

// Stable URLs probed against assets.mytcas.com — verified 2026-05-02.
// When new TCAS years publish, append entries here (curator action).
const TCAS3_FILES: TcasFile[] = [
  { url: 'https://assets.mytcas.com/maxmin/TCAS62_maxmin.xlsx', entryYearBE: 2562, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS63_maxmin.xlsx', entryYearBE: 2563, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS64_maxmin.xlsx', entryYearBE: 2564, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS65_maxmin.xlsx', entryYearBE: 2565, round: '3' },
  { url: 'https://assets.mytcas.com/maxmin/TCAS66_maxmin.xlsx', entryYearBE: 2566, round: '3' },
  { url: 'https://assets.mytcas.com/67/TCAS67_maxmin.xlsx',     entryYearBE: 2567, round: '3' },
  { url: 'https://assets.mytcas.com/68/T68-stat-r3_1-maxmin-20May25.xlsx', entryYearBE: 2568, round: '3.1' },
  { url: 'https://assets.mytcas.com/68/T68-stat-r3_2-maxmin-24May25.xlsx', entryYearBE: 2568, round: '3.2' },
];

const FETCH_TIMEOUT_MS = 60_000;

// Thai column headers in the source xlsx.
const COL = {
  institution: 'สถาบัน',
  campus: 'วิทยาเขต',
  courseCode: 'รหัสหลักสูตร',
  faculty: 'คณะ',
  programme: 'หลักสูตร',
  detail: 'รายละเอียด',
  major: 'สาขา/วิชาเอก',
  jointCode: 'รหัสรับร่วม',
  quota: 'รับ',
  applicants: 'สมัคร',
  admittedPass1: 'ผ่าน ประมวลผลครั้งที่ 1',
  admittedPass2: 'ผ่าน ประมวลผลครั้งที่ 2',
  maxScorePass1: 'คะแนนสูงสุด ประมวลผลครั้งที่ 1',
  minScorePass1: 'คะแนนต่ำสุด ประมวลผลครั้งที่ 1',
  maxScorePass2: 'คะแนนสูงสุด ประมวลผลครั้งที่ 2',
  minScorePass2: 'คะแนนต่ำสุด ประมวลผลครั้งที่ 2',
} as const;

interface TcasRowRaw {
  file: TcasFile;
  row: Record<string, unknown>;
}

export class TcasRealConnector extends ApiConnector {
  readonly slug = 'tcas';
  readonly mocked = false;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const probe = TCAS3_FILES[TCAS3_FILES.length - 1]!.url; // freshest
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(probe, {
        signal: controller.signal,
        method: 'HEAD',
        headers: { 'user-agent': outboundUserAgent() },
      });
      clearTimeout(timer);
      return {
        ok: res.ok,
        message: res.ok ? `mytcas assets reachable (${res.status})` : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const records: RawRecord[] = [];
    for (const file of TCAS3_FILES) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(file.url, {
          signal: controller.signal,
          headers: {
            'user-agent': outboundUserAgent(),
            referer: 'https://www.mytcas.com/stat/',
          },
        });
        clearTimeout(timer);
        if (!res.ok) {
          ctx.log.warn(`TCAS file fetch failed`, { url: file.url, status: res.status });
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const wb = xlsx.read(buf, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]!];
        if (!sheet) {
          ctx.log.warn(`TCAS xlsx has no sheet`, { url: file.url });
          continue;
        }
        const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: null,
          raw: true,
        });
        ctx.log.info(`TCAS file parsed`, {
          url: file.url,
          year: file.entryYearBE,
          round: file.round,
          rows: rows.length,
        });
        for (const row of rows) {
          const courseCode = (row[COL.courseCode] ?? '') as string;
          if (!courseCode) continue; // header rows / blanks
          records.push({
            externalId: `${courseCode}-${file.entryYearBE}-${file.round}`,
            sourceTimestamp: new Date(`${file.entryYearBE - 543}-06-01`),
            data: { file, row } satisfies TcasRowRaw,
          });
        }
      } catch (err) {
        ctx.log.warn(`TCAS file errored`, {
          url: file.url,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return records;
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const { file, row } = raw.data as TcasRowRaw;
    return [
      {
        target: 'tcas_admission_stats',
        externalId: raw.externalId,
        payload: {
          tcasCourseCode: String(row[COL.courseCode] ?? ''),
          institutionName: stringOrEmpty(row[COL.institution]),
          campusName: nullableString(row[COL.campus]),
          facultyName: nullableString(row[COL.faculty]),
          programmeName: stringOrEmpty(row[COL.programme]),
          majorName: nullableString(row[COL.major]),
          entryYearBE: file.entryYearBE,
          round: file.round,
          quota: numberOrZero(row[COL.quota]),
          applicants: numberOrZero(row[COL.applicants]),
          admittedPass1: numberOrZero(row[COL.admittedPass1]),
          admittedPass2: numberOrZero(row[COL.admittedPass2]),
          maxScorePass1: nullableNumber(row[COL.maxScorePass1]),
          minScorePass1: nullableNumber(row[COL.minScorePass1]),
          maxScorePass2: nullableNumber(row[COL.maxScorePass2]),
          minScorePass2: nullableNumber(row[COL.minScorePass2]),
          sourceUrl: file.url,
        },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    // Pre-load KKU programs once for in-memory matching of KKU rows.
    // The TCAS xlsx doesn't carry KKU-internal identifiers, so we
    // match on (faculty.nameTh, programme.nameTh) — the Thai gov data
    // uses the canonical KKU names for both.
    const kkuPrograms = await prisma.program.findMany({
      select: {
        id: true,
        nameTh: true,
        majors: true,
        faculty: { select: { nameTh: true } },
      },
    });
    // Index by faculty + programme name for O(1) lookup. Multiple
    // KKU programs can share a faculty + programme prefix (with major
    // disambiguation); we tolerate ambiguity by preferring the entry
    // whose major matches the TCAS programme suffix.
    const kkuByFacultyProgramme = new Map<string, typeof kkuPrograms>();
    for (const p of kkuPrograms) {
      const key = `${p.faculty.nameTh}${KEY_SEP}${p.nameTh}`;
      const arr = kkuByFacultyProgramme.get(key) ?? [];
      arr.push(p);
      kkuByFacultyProgramme.set(key, arr);
    }
    // Secondary index by faculty + specialization name (extracted from
    // DB nameTh via สาขาวิชา pattern). Used by findKkuMatch strategy 5
    // to bridge abbreviated TCAS names with formal DB names.
    const kkuByFacultySpec = new Map<string, typeof kkuPrograms>();
    for (const p of kkuPrograms) {
      const spec = extractSpecialization(p.nameTh);
      if (!spec) continue;
      const key = `${p.faculty.nameTh}${KEY_SEP}${spec}`;
      const arr = kkuByFacultySpec.get(key) ?? [];
      arr.push(p);
      kkuByFacultySpec.set(key, arr);
    }

    let loaded = 0;
    let failed = 0;
    let kkuMatched = 0;
    let kkuUnmatched = 0;
    const unmatchedSamples: string[] = [];

    for (const n of normalized) {
      try {
        const p = n.payload as Record<string, unknown>;
        const isKku = isOwnInstitution(p.institutionName as string | null | undefined);
        let programId: string | null = null;
        if (isKku) {
          const facultyNameTh = String(p.facultyName ?? '');
          const programmeName = String(p.programmeName ?? '');
          const candidate = findKkuMatch(
            kkuByFacultyProgramme,
            kkuByFacultySpec,
            facultyNameTh,
            programmeName,
            String(p.majorName ?? ''),
          );
          if (candidate) {
            programId = candidate.id;
            kkuMatched++;
          } else {
            kkuUnmatched++;
            if (unmatchedSamples.length < 10) {
              unmatchedSamples.push(`${facultyNameTh} | ${programmeName}`);
            }
          }
        }
        await prisma.tcasAdmissionStat.upsert({
          where: {
            tcasCourseCode_entryYearBE_round: {
              tcasCourseCode: String(p.tcasCourseCode),
              entryYearBE: Number(p.entryYearBE),
              round: String(p.round),
            },
          },
          create: {
            programId,
            tcasCourseCode: String(p.tcasCourseCode),
            institutionName: String(p.institutionName),
            campusName: (p.campusName ?? null) as string | null,
            facultyName: (p.facultyName ?? null) as string | null,
            programmeName: String(p.programmeName),
            majorName: (p.majorName ?? null) as string | null,
            entryYearBE: Number(p.entryYearBE),
            round: String(p.round),
            quota: Number(p.quota),
            applicants: Number(p.applicants),
            admittedPass1: Number(p.admittedPass1),
            admittedPass2: Number(p.admittedPass2),
            maxScorePass1: p.maxScorePass1 as number | null,
            minScorePass1: p.minScorePass1 as number | null,
            maxScorePass2: p.maxScorePass2 as number | null,
            minScorePass2: p.minScorePass2 as number | null,
            sourceUrl: String(p.sourceUrl),
            ingestionRunId: ctx.runId,
          },
          update: {
            programId,
            quota: Number(p.quota),
            applicants: Number(p.applicants),
            admittedPass1: Number(p.admittedPass1),
            admittedPass2: Number(p.admittedPass2),
            maxScorePass1: p.maxScorePass1 as number | null,
            minScorePass1: p.minScorePass1 as number | null,
            maxScorePass2: p.maxScorePass2 as number | null,
            minScorePass2: p.minScorePass2 as number | null,
            sourceUrl: String(p.sourceUrl),
            ingestionRunId: ctx.runId,
          },
        });
        loaded++;
      } catch (err) {
        ctx.log.error(`TCAS load failed`, {
          externalId: n.externalId,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        files: TCAS3_FILES.length,
        kkuMatched,
        kkuUnmatched,
        unmatchedSamples,
      },
    };
  }
}

// Separates faculty and programme in the match-index keys, so one faculty
// name that is a prefix of another cannot match the other's programmes.
const KEY_SEP = '\u0001';

function findKkuMatch(
  index: Map<string, Array<{ id: string; nameTh: string; majors: string[] }>>,
  specIndex: Map<string, Array<{ id: string; nameTh: string; majors: string[] }>>,
  facultyNameTh: string,
  programmeName: string,
  majorName: string,
): { id: string } | null {
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
function extractSpecialization(name: string): string {
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

function stringOrEmpty(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function nullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}
function numberOrZero(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function nullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

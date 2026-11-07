import * as xlsx from 'xlsx';
import { prisma } from '@kku/db';
import {
  buildTcasMatchIndex,
  findOwnProgrammeMatch,
  isOwnInstitution,
  outboundUserAgent,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import { ApiConnector } from '../../base/api-connector';
import { BUILT_IN_TCAS_FILES, resolveTcasFiles, type TcasFile } from './files';

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
  private fileListSource: 'discovered' | 'built-in' = 'built-in';
  private fileCount = BUILT_IN_TCAS_FILES.length;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const probe = BUILT_IN_TCAS_FILES[BUILT_IN_TCAS_FILES.length - 1]!.url; // freshest
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
    const resolved = await resolveTcasFiles();
    this.fileListSource = resolved.source;
    this.fileCount = resolved.files.length;
    for (const file of resolved.files) {
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
    const matchIndex = buildTcasMatchIndex(
      kkuPrograms.map((p) => ({
        id: p.id,
        nameTh: p.nameTh,
        majors: p.majors,
        facultyNameTh: p.faculty.nameTh,
      })),
    );

    let loaded = 0;
    let failed = 0;
    let ownMatched = 0;
    let ownUnmatched = 0;
    const unmatchedSamples: string[] = [];

    for (const n of normalized) {
      try {
        const p = n.payload as Record<string, unknown>;
        const isKku = isOwnInstitution(p.institutionName as string | null | undefined);
        let programId: string | null = null;
        if (isKku) {
          const facultyNameTh = String(p.facultyName ?? '');
          const programmeName = String(p.programmeName ?? '');
          const candidate = findOwnProgrammeMatch(
            matchIndex,
            facultyNameTh,
            programmeName,
            String(p.majorName ?? ''),
          );
          if (candidate) {
            programId = candidate.id;
            ownMatched++;
          } else {
            ownUnmatched++;
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
        files: this.fileCount,
        fileListSource: this.fileListSource,
        ownMatched,
        ownUnmatched,
        unmatchedSamples,
      },
    };
  }
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

#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Ingest KKU annual undergraduate employment surveys (PDF → AI extraction
// → GraduateOutcome upsert).
//
// Source: /home/denpong/employment/Graduate-Employment-Analysis-Report-
// Undergraduate-Year-YYYY.pdf · 192 pages each · Thai-language tables
// of per-faculty / per-program employment outcomes.
//
// Output: GraduateOutcome rows linked to KKU Programs by faculty +
// Thai-name exact match (case-insensitive). Non-matching report rows
// are surfaced in the run summary so an analyst can hand-link them.
//
// Usage:
//   pnpm outcomes:ingest                           # all PDFs in /home/denpong/employment
//   pnpm outcomes:ingest 2023                      # one year
//   pnpm outcomes:ingest --pdf=/path/to/file.pdf   # arbitrary path
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

import { prisma } from '@kku/db';
import { withScriptRun } from '../lib/script-run';
import { createIngestionAiService } from '../lib/ai-service';
import {
  buildGraduateEmploymentSurveyMessages,
  GraduateEmploymentSurveySchema,
  GRADUATE_EMPLOYMENT_SURVEY_VERSION,
} from '@kku/shared';

const SOURCE_DIR = '/home/denpong/employment';

interface RunStats {
  pdfPath: string;
  surveyYear: number | null;
  programsExtracted: number;
  matchedProgramIds: Set<string>;
  unmatched: Array<{ facultyNameTh: string; programNameTh: string }>;
  rowsUpserted: number;
  costUsd: number;
  confidence: number | null;
}

function pickPdfs(argv: string[]): string[] {
  const all = readdirSync(SOURCE_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const explicitPath = argv.find((a) => a.startsWith('--pdf='))?.split('=')[1];
  if (explicitPath) return [explicitPath];
  const yearArg = argv.find((a) => /^20\d{2}$/.test(a));
  if (yearArg) {
    const match = all.find((f) => f.includes(`-${yearArg}.pdf`));
    if (!match) throw new Error(`No PDF found for year ${yearArg} in ${SOURCE_DIR}`);
    return [path.join(SOURCE_DIR, match)];
  }
  return all.map((f) => path.join(SOURCE_DIR, f)).sort();
}

function surveyYearFromFilename(p: string): number | null {
  const m = p.match(/Year-(\d{4})/);
  return m ? parseInt(m[1]!, 10) : null;
}

function normaliseForMatch(s: string): string {
  return s.replace(/\s+/g, '').replace(/[\(\)（）「」『』]/g, '').toLowerCase().trim();
}

async function main() {
  const args = process.argv.slice(2);
  const pdfs = pickPdfs(args);
  console.log(`━━━ Ingesting ${pdfs.length} employment-survey PDF(s) ━━━\n`);

  // Wrap the whole run in a tracked IngestionRun on kku-alumni. PDF survey
  // ingestion writes real graduate-outcome data; the run tags every row so
  // they survive the data-quality.v2 STRICT filter.
  await withScriptRun('kku-alumni', async ({ runId, setRecordsLoaded }) => {
    const rowsWritten = await mainInner(args, pdfs, runId);
    setRecordsLoaded(rowsWritten);
  });
}

async function mainInner(_args: string[], pdfs: string[], runId: string): Promise<number> {

  const ai = createIngestionAiService();
  if (!ai.uploadFile) {
    throw new Error(`Provider ${ai.providerId} doesn't expose uploadFile — needed for large PDF ingestion. Set AI_PROVIDER=google.`);
  }

  // Pull faculties + active undergraduate programs once for matching.
  const [faculties, programs] = await Promise.all([
    prisma.faculty.findMany({ select: { id: true, code: true, nameTh: true, nameEn: true } }),
    prisma.program.findMany({
      where: { status: 'ACTIVE', level: 'BACHELOR' },
      select: { id: true, code: true, facultyId: true, nameTh: true, nameEn: true },
    }),
  ]);
  const facultyByNameTh = new Map(faculties.map((f) => [normaliseForMatch(f.nameTh), f]));
  const programsByFaculty = new Map<string, typeof programs>();
  for (const p of programs) {
    const list = programsByFaculty.get(p.facultyId) ?? [];
    list.push(p);
    programsByFaculty.set(p.facultyId, list);
  }
  console.log(`Match pool: ${faculties.length} faculties, ${programs.length} active undergraduate programs\n`);

  const allStats: RunStats[] = [];
  for (const pdf of pdfs) {
    const yearHint = surveyYearFromFilename(pdf);
    console.log(`━━ ${path.basename(pdf)} (yearHint=${yearHint}) ━━`);
    const stats: RunStats = {
      pdfPath: pdf,
      surveyYear: yearHint,
      programsExtracted: 0,
      matchedProgramIds: new Set(),
      unmatched: [],
      rowsUpserted: 0,
      costUsd: 0,
      confidence: null,
    };

    try {
      // 1. Upload PDF via Gemini File API.
      const bytes = readFileSync(pdf);
      console.log(`  uploading ${(bytes.length / 1024 / 1024).toFixed(1)} MB ...`);
      const uploaded = await ai.uploadFile(bytes, path.basename(pdf), 'application/pdf');
      console.log(`  uploaded → ${uploaded.fileUri}`);

      // 2. Extract.
      const messages = buildGraduateEmploymentSurveyMessages({
        surveyYearHint: yearHint ?? new Date().getFullYear(),
        knownFacultyNamesTh: faculties.map((f) => f.nameTh),
      });
      console.log(`  extracting (large PDF — may take 30-90s) ...`);
      const t0 = Date.now();
      const response = await ai.extractStructured(
        {
          ctx: { module: 'outcomes', kind: 'graduate-employment-survey' },
          messages,
          // Uses the universal default (gemini-3.5-flash). Large report
          // — 100+ programs, ~30k output tokens — so maxOutputTokens is
          // set generously below.
          methodVersion: GRADUATE_EMPLOYMENT_SURVEY_VERSION,
          maxOutputTokens: 32_000,
          fileAttachment: { fileUri: uploaded.fileUri, mimeType: 'application/pdf' },
        },
        GraduateEmploymentSurveySchema,
      );
      const elapsedMs = Date.now() - t0;
      console.log(`  extracted ${response.parsed.programs.length} program rows in ${(elapsedMs / 1000).toFixed(1)}s · cost $${response.cost.usd.toFixed(3)} · confidence ${response.parsed.confidence.toFixed(2)}`);
      stats.programsExtracted = response.parsed.programs.length;
      stats.costUsd = response.cost.usd;
      stats.confidence = response.parsed.confidence;

      // 3. Match + upsert.
      //
      // KKU's annual report tables are PRIMARILY faculty-aggregate
      // (per-curriculum rows don't exist in most chapters). When the
      // AI returns a "faculty-aggregate" row (where programNameTh ≈
      // facultyNameTh OR the report row covers all programs in the
      // faculty), fan out to every undergraduate program in that
      // faculty and tag the methodology version so the deep-dive can
      // surface "(faculty-aggregate)" alongside the number.
      const freshness = new Date();
      for (const row of response.parsed.programs) {
        const faculty = facultyByNameTh.get(normaliseForMatch(row.facultyNameTh));
        if (!faculty) {
          stats.unmatched.push({ facultyNameTh: row.facultyNameTh, programNameTh: row.programNameTh });
          continue;
        }
        const candidates = programsByFaculty.get(faculty.id) ?? [];
        const reportName = normaliseForMatch(row.programNameTh);
        const facultyName = normaliseForMatch(row.facultyNameTh);
        const isFacultyAggregate =
          reportName === facultyName
          || reportName.includes(facultyName)
          || facultyName.includes(reportName);

        let targets: typeof candidates = [];
        let methodTag = GRADUATE_EMPLOYMENT_SURVEY_VERSION;
        if (isFacultyAggregate) {
          targets = candidates;
          methodTag = `${GRADUATE_EMPLOYMENT_SURVEY_VERSION}.faculty-aggregate`;
        } else {
          const program = candidates.find((p) => normaliseForMatch(p.nameTh) === reportName)
            ?? candidates.find((p) => {
              const pname = normaliseForMatch(p.nameTh);
              return pname.includes(reportName) || reportName.includes(pname);
            });
          if (program) targets = [program];
        }
        if (targets.length === 0) {
          stats.unmatched.push({ facultyNameTh: row.facultyNameTh, programNameTh: row.programNameTh });
          continue;
        }
        for (const program of targets) {
          await prisma.graduateOutcome.upsert({
            where: {
              programId_graduationYear_surveyYear: {
                programId: program.id,
                graduationYear: row.graduationYear,
                surveyYear: row.surveyYear,
              },
            },
            create: {
              programId: program.id,
              graduationYear: row.graduationYear,
              surveyYear: row.surveyYear,
              employmentRate: row.employmentRate ?? 0,
              averageSalary: row.averageSalary ?? 0,
              jobRelevanceScore: row.jobRelevanceScore ?? 0,
              furtherStudyRate: row.furtherStudyRate ?? 0,
              sampleSize: row.sampleSize,
              freshnessDate: freshness,
              methodologyVersion: methodTag,
              ingestionRunId: runId,
            },
            update: {
              employmentRate: row.employmentRate ?? 0,
              averageSalary: row.averageSalary ?? 0,
              jobRelevanceScore: row.jobRelevanceScore ?? 0,
              furtherStudyRate: row.furtherStudyRate ?? 0,
              sampleSize: row.sampleSize,
              freshnessDate: freshness,
              methodologyVersion: methodTag,
              ingestionRunId: runId,
            },
          });
          stats.matchedProgramIds.add(program.id);
          stats.rowsUpserted++;
        }
      }
      console.log(`  matched + upserted: ${stats.rowsUpserted} rows from ${stats.programsExtracted} report rows (${stats.matchedProgramIds.size} unique programs · ${stats.unmatched.length} unmatched)`);
    } catch (e) {
      console.log(`  ✗ FAILED: ${(e as Error).message}`);
    }
    allStats.push(stats);
  }

  // Final summary.
  console.log(`\n━━━ Run summary ━━━`);
  for (const s of allStats) {
    console.log(`  ${path.basename(s.pdfPath).slice(0, 65).padEnd(65)} extracted=${s.programsExtracted} upserted=${s.rowsUpserted} unmatched=${s.unmatched.length} cost=$${s.costUsd.toFixed(3)}`);
  }
  const allUnmatched = new Map<string, number>();
  for (const s of allStats) {
    for (const u of s.unmatched) {
      const key = `${u.facultyNameTh} · ${u.programNameTh}`;
      allUnmatched.set(key, (allUnmatched.get(key) ?? 0) + 1);
    }
  }
  if (allUnmatched.size > 0) {
    console.log(`\nTop 15 unmatched (faculty · program), with occurrence count across reports:`);
    for (const [k, n] of [...allUnmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  (${n}×) ${k.slice(0, 100)}`);
    }
  }
  const total = allStats.reduce((acc, s) => ({
    rows: acc.rows + s.rowsUpserted,
    cost: acc.cost + s.costUsd,
    extracted: acc.extracted + s.programsExtracted,
  }), { rows: 0, cost: 0, extracted: 0 });
  console.log(`\nTOTAL: ${total.rows} GraduateOutcome rows upserted (${total.extracted} extracted) · cost $${total.cost.toFixed(2)}`);
  return total.rows;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

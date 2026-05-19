#!/usr/bin/env tsx
// ───────────────────────────────────────────────────────────────────────
// Probe POWERBI.EVALUATE_INSTRUCTOR — registrar's student-evaluation
// dataset for teaching & learning. Powers two upcoming sub-dashboards:
//
//   /education/satisfaction  — course + teacher satisfaction by faculty
//   /staff/teaching          — personal + roster views
//
// What we MUST learn before designing the schema:
//   [1] Column list + data types
//   [2] Row count
//   [3] Sample 5 rows  (masked: 13-digit IDs, long values)
//   [4] ACADYEAR × SEMESTER coverage
//   [5] Cardinalities  (instructors, subjects, classes, questions)
//   [6] Question identity — same code across semesters? text drift?
//   [7] Score scale  (1-5 likert? 0-4? percentage? min/max)
//   [8] Response unit — per-student or pre-aggregated?
//   [9] Join keys to our entities (instructor employee code, course code,
//       class/section, faculty/program/department)
//  [10] PII audit — any column that looks like citizen ID / phone /
//       email / open-text comment?
//
// Output is aggregate-only / sample-only. PDPA gate: this script ONLY
// reads the EVALUATE_INSTRUCTOR view in the POWERBI schema; no other
// tables. 13-digit values masked; long text columns truncated.
//
// Run:
//   pnpm tsx apps/ingestion/src/scripts/probe-kku-evaluations.ts
//   pnpm evaluations:probe                        (when wired in package.json)
//   pnpm evaluations:probe schema                 (single section)
// ───────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { configFromEnv, query, withConnection } from '../lib/oracle-client';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const VIEW = 'POWERBI.EVALUATE_INSTRUCTOR';
const [VIEW_OWNER, VIEW_NAME] = VIEW.split('.');
const FIXTURE_DIR = path.resolve(
  process.cwd(),
  'apps/ingestion/test/fixtures/kku-evaluations',
);

function mask(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  if (/^\d{13}$/.test(s)) return '***masked-13-digit-id***';
  if (/^\d{10}$/.test(s) && s.startsWith('0')) return '***masked-thai-phone***';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(s)) {
    const at = s.indexOf('@');
    return `${s.slice(0, 2)}***${s.slice(at)}`;
  }
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

function writeFixture(name: string, payload: unknown): void {
  if (!existsSync(FIXTURE_DIR)) mkdirSync(FIXTURE_DIR, { recursive: true });
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`  ↳ fixture written: ${path.relative(process.cwd(), file)}`);
}

interface ColumnRow extends Record<string, unknown> {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  DATA_LENGTH: number;
  NULLABLE: string;
  COLUMN_ID: number;
}

// Heuristic regex match helpers
function colMatch(cols: ColumnRow[], re: RegExp): ColumnRow[] {
  return cols.filter((c) => re.test(c.COLUMN_NAME));
}
function firstCol(cols: ColumnRow[], re: RegExp): string | undefined {
  return colMatch(cols, re)[0]?.COLUMN_NAME;
}

const PII_PATTERNS = [
  /CITIZEN/i,
  /NATIONAL.?ID/i,
  /ID.?CARD/i,
  /PASSPORT/i,
  /TAX.?ID/i,
  /SOC.?SEC/i,
  /SSN/i,
  /PHONE/i,
  /MOBILE/i,
  /STUDENT.?ID/i, // catch raw per-student linkage even if hashed
  /STUDENTID/i,
  /COMMENT/i,
  /FEEDBACK/i,
  /REMARK/i,
];

async function fetchColumns(conn: Parameters<typeof query>[0]): Promise<ColumnRow[]> {
  return query<ColumnRow>(
    conn,
    `SELECT column_name, data_type, data_length, nullable, column_id
     FROM all_tab_columns
     WHERE owner = :owner AND table_name = :name
     ORDER BY column_id`,
    { owner: VIEW_OWNER, name: VIEW_NAME },
  );
}

// ── [1] schema ──────────────────────────────────────────────────────────
async function runSchema(conn: Parameters<typeof query>[0]): Promise<ColumnRow[]> {
  console.log('\n[1] Columns:');
  const cols = await fetchColumns(conn);
  if (cols.length === 0) {
    console.log('  (no columns — view missing or not visible to this account)');
    return cols;
  }
  for (const c of cols) {
    const piiHit = PII_PATTERNS.some((re) => re.test(c.COLUMN_NAME));
    const flag = piiHit ? '⚠ PII?' : '';
    console.log(
      `  ${String(c.COLUMN_ID).padStart(2)}. ${c.COLUMN_NAME.padEnd(32)} ${c.DATA_TYPE.padEnd(14)} len=${String(c.DATA_LENGTH).padEnd(6)} ${c.NULLABLE === 'Y' ? 'NULL' : 'NOT NULL'}  ${flag}`,
    );
  }
  writeFixture('schema', {
    view: VIEW,
    capturedAt: new Date().toISOString(),
    columns: cols.map((c) => ({
      ordinal: c.COLUMN_ID,
      name: c.COLUMN_NAME,
      type: c.DATA_TYPE,
      length: c.DATA_LENGTH,
      nullable: c.NULLABLE === 'Y',
      piiFlag: PII_PATTERNS.some((re) => re.test(c.COLUMN_NAME)),
    })),
  });
  return cols;
}

// ── [2] counts ──────────────────────────────────────────────────────────
async function runCounts(conn: Parameters<typeof query>[0]): Promise<void> {
  console.log('\n[2] Row count:');
  const cnt = await query<{ N: number }>(conn, `SELECT COUNT(*) AS N FROM ${VIEW}`);
  console.log(`  ${(cnt[0]?.N ?? 0).toLocaleString('en-US')} rows`);
  writeFixture('row-count', { view: VIEW, rowCount: Number(cnt[0]?.N ?? 0) });
}

// ── [3] sample ──────────────────────────────────────────────────────────
async function runSample(conn: Parameters<typeof query>[0]): Promise<void> {
  console.log('\n[3] Sample 5 rows:');
  const sample = await query<Record<string, unknown>>(
    conn,
    `SELECT * FROM ${VIEW} FETCH FIRST 5 ROWS ONLY`,
  );
  const fixtureRows: Array<Record<string, string>> = [];
  for (let i = 0; i < sample.length; i++) {
    console.log(`  Row ${i + 1}:`);
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(sample[i]!)) {
      const m = mask(v);
      masked[k] = m;
      console.log(`    ${k.padEnd(32)} ${m}`);
    }
    fixtureRows.push(masked);
  }
  writeFixture('sample-rows', { view: VIEW, sample: fixtureRows });
}

// ── [4] year × semester coverage ────────────────────────────────────────
async function runCoverage(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  const yearCol = firstCol(cols, /ACAD.?YEAR|^YEAR$/i);
  const semCol = firstCol(cols, /SEMESTER|^TERM$/i);
  console.log(`\n[4] Year × Semester coverage (yearCol=${yearCol ?? '?'}, semCol=${semCol ?? '?'}):`);
  if (!yearCol || !semCol) {
    console.log('  (year/semester columns not detected — skip)');
    return;
  }
  const cov = await query<{ Y: number; S: string; N: number }>(
    conn,
    `SELECT ${yearCol} AS Y, ${semCol} AS S, COUNT(*) AS N
     FROM ${VIEW}
     GROUP BY ${yearCol}, ${semCol}
     ORDER BY ${yearCol} DESC, ${semCol}`,
  );
  for (const r of cov.slice(0, 30)) {
    console.log(`  BE ${r.Y} / sem ${r.S}: ${Number(r.N).toLocaleString('en-US')} rows`);
  }
  if (cov.length > 30) console.log(`  … and ${cov.length - 30} more (year,sem) buckets`);
  writeFixture('coverage', {
    view: VIEW,
    yearCol,
    semCol,
    buckets: cov.map((r) => ({ year: r.Y, semester: r.S, rowCount: Number(r.N) })),
  });
}

// ── [5] cardinalities ───────────────────────────────────────────────────
async function runCardinalities(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  console.log('\n[5] Cardinalities (distinct counts):');
  const candidates: Array<[string, RegExp]> = [
    ['instructor', /INSTRUCTOR|TEACHER|LECTURER|EMPLOYEE|STAFF|PERSON|KKUMAIL|EMP/i],
    ['subject', /SUBJECT.?CODE|COURSE.?CODE|SUBJECT/i],
    ['class', /SECTION|GROUP|CLASS/i],
    ['question', /QUESTION|QUERY|ITEM/i],
    ['faculty', /FACULTY/i],
    ['program', /PROGRAM|CURRIC|MAJOR/i],
    ['department', /DEPART|DIVISION/i],
  ];
  const out: Array<{
    label: string;
    column: string;
    distinct: number;
    nonNullPct: number;
  }> = [];
  for (const [label, re] of candidates) {
    for (const c of colMatch(cols, re)) {
      try {
        const r = await query<{ D: number; NN: number; T: number }>(
          conn,
          `SELECT COUNT(DISTINCT ${c.COLUMN_NAME}) AS D,
                  SUM(CASE WHEN ${c.COLUMN_NAME} IS NOT NULL THEN 1 ELSE 0 END) AS NN,
                  COUNT(*) AS T
           FROM ${VIEW}`,
        );
        const distinct = Number(r[0]?.D ?? 0);
        const nn = Number(r[0]?.NN ?? 0);
        const tot = Number(r[0]?.T ?? 1);
        const pct = (nn / tot) * 100;
        console.log(
          `  ${label.padEnd(11)} ${c.COLUMN_NAME.padEnd(28)} distinct=${distinct.toLocaleString().padStart(8)}  populated=${pct.toFixed(1)}%`,
        );
        out.push({ label, column: c.COLUMN_NAME, distinct, nonNullPct: pct });
      } catch (err) {
        console.log(
          `  ${label.padEnd(11)} ${c.COLUMN_NAME.padEnd(28)} (failed: ${err instanceof Error ? err.message : err})`,
        );
      }
    }
  }
  writeFixture('cardinalities', { view: VIEW, columns: out });
}

// ── [6] question stability ──────────────────────────────────────────────
async function runQuestionStability(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  console.log('\n[6] Question identity across semesters:');
  const qIdCol = firstCol(cols, /QUESTION.?(ID|NO|CODE|SEQ)/i);
  const qTextCol = firstCol(cols, /QUESTION.?(TEXT|NAME|DESC|TH|EN)/i) ??
    firstCol(cols, /QUESTION/i);
  const yearCol = firstCol(cols, /ACAD.?YEAR|^YEAR$/i);
  const semCol = firstCol(cols, /SEMESTER|^TERM$/i);
  console.log(`  questionIdCol=${qIdCol ?? '?'}  questionTextCol=${qTextCol ?? '?'}`);
  if (!qIdCol || !yearCol || !semCol) {
    console.log('  (insufficient columns to assess stability — skip)');
    return;
  }
  // (a) Distinct (year, sem) where each question_id appears
  const presence = await query<{ Q: string; YS: number }>(
    conn,
    `SELECT ${qIdCol} AS Q, COUNT(DISTINCT ${yearCol} || '-' || ${semCol}) AS YS
     FROM ${VIEW}
     WHERE ${qIdCol} IS NOT NULL
     GROUP BY ${qIdCol}
     ORDER BY YS DESC FETCH FIRST 30 ROWS ONLY`,
  );
  console.log(`  Top ${qIdCol} by (year×sem) presence (max 30):`);
  for (const r of presence) {
    console.log(`    ${String(r.Q).padEnd(10)} present in ${r.YS} (year,sem) buckets`);
  }
  // (b) If text column present, check if text drifts within same id
  let drift: Array<{ Q: string; distinctTexts: number }> = [];
  if (qTextCol && qTextCol !== qIdCol) {
    const d = await query<{ Q: string; D: number }>(
      conn,
      `SELECT ${qIdCol} AS Q, COUNT(DISTINCT ${qTextCol}) AS D
       FROM ${VIEW}
       WHERE ${qIdCol} IS NOT NULL
       GROUP BY ${qIdCol}
       HAVING COUNT(DISTINCT ${qTextCol}) > 1
       ORDER BY D DESC FETCH FIRST 15 ROWS ONLY`,
    );
    drift = d.map((r) => ({ Q: String(r.Q), distinctTexts: Number(r.D) }));
    console.log(`  Question-text drift (same id, multiple texts) — top 15:`);
    if (drift.length === 0) console.log('    none — text is stable per id ✓');
    for (const r of drift) console.log(`    ${r.Q.padEnd(10)} ${r.distinctTexts} distinct texts`);
  }
  writeFixture('question-stability', {
    view: VIEW,
    questionIdCol: qIdCol,
    questionTextCol: qTextCol,
    presenceTop30: presence.map((r) => ({ id: String(r.Q), yearSemBuckets: Number(r.YS) })),
    textDrift: drift,
  });
}

// ── [7] score scale ─────────────────────────────────────────────────────
async function runScoreScale(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  console.log('\n[7] Score scale:');
  const scoreCols = colMatch(cols, /SCORE|RATING|RESULT|VALUE|AVG|MEAN|PERCENT|RATIO/i);
  const out: Array<{ column: string; min: number; max: number; distinct: number; sample: number[] }> = [];
  for (const c of scoreCols) {
    if (!['NUMBER', 'FLOAT', 'INTEGER', 'BINARY_FLOAT', 'BINARY_DOUBLE'].includes(c.DATA_TYPE)) {
      continue;
    }
    try {
      const r = await query<{ MN: number; MX: number; D: number }>(
        conn,
        `SELECT MIN(${c.COLUMN_NAME}) AS MN, MAX(${c.COLUMN_NAME}) AS MX,
                COUNT(DISTINCT ${c.COLUMN_NAME}) AS D
         FROM ${VIEW}`,
      );
      const distinctSample = await query<{ V: number; N: number }>(
        conn,
        `SELECT ${c.COLUMN_NAME} AS V, COUNT(*) AS N
         FROM ${VIEW} WHERE ${c.COLUMN_NAME} IS NOT NULL
         GROUP BY ${c.COLUMN_NAME}
         ORDER BY COUNT(*) DESC FETCH FIRST 10 ROWS ONLY`,
      );
      const mn = Number(r[0]?.MN ?? 0);
      const mx = Number(r[0]?.MX ?? 0);
      const d = Number(r[0]?.D ?? 0);
      console.log(
        `  ${c.COLUMN_NAME.padEnd(28)} min=${mn}  max=${mx}  distinct=${d}`,
      );
      console.log(
        `    top values: ${distinctSample.map((s) => `${s.V}(×${Number(s.N).toLocaleString()})`).join(', ')}`,
      );
      out.push({
        column: c.COLUMN_NAME,
        min: mn,
        max: mx,
        distinct: d,
        sample: distinctSample.map((s) => Number(s.V)),
      });
    } catch (err) {
      console.log(
        `  ${c.COLUMN_NAME.padEnd(28)} (failed: ${err instanceof Error ? err.message : err})`,
      );
    }
  }
  writeFixture('score-scale', { view: VIEW, scoreColumns: out });
}

// ── [8] response unit — pre-aggregated or per-student? ──────────────────
async function runResponseUnit(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  console.log('\n[8] Response unit — pre-aggregated or per-student?');
  const yearCol = firstCol(cols, /ACAD.?YEAR|^YEAR$/i);
  const semCol = firstCol(cols, /SEMESTER|^TERM$/i);
  const subjectCol = firstCol(cols, /SUBJECT.?CODE|COURSE.?CODE/i);
  const sectionCol = firstCol(cols, /SECTION|GROUP/i);
  const instructorCol = firstCol(cols, /INSTRUCTOR|TEACHER|LECTURER|KKUMAIL|EMPLOYEE/i);
  const qIdCol = firstCol(cols, /QUESTION.?(ID|NO|CODE|SEQ)/i);
  console.log(
    `  grouping by: ${yearCol}, ${semCol}, ${subjectCol}, ${sectionCol}, ${instructorCol}, ${qIdCol}`,
  );
  if (!yearCol || !semCol || !subjectCol || !qIdCol) {
    console.log('  (missing grouping columns — skip)');
    return;
  }
  // If row count per (year,sem,subject,section,instructor,question) > 1,
  // the table is per-student. If ≤ 1, it's pre-aggregated.
  const groupKeys = [yearCol, semCol, subjectCol, sectionCol, instructorCol, qIdCol].filter(
    Boolean,
  );
  const dupes = await query<{ N: number; MX: number; AVG: number }>(
    conn,
    `SELECT COUNT(*) AS N, MAX(C) AS MX, AVG(C) AS AVG FROM (
       SELECT ${groupKeys.join(', ')}, COUNT(*) AS C
       FROM ${VIEW}
       GROUP BY ${groupKeys.join(', ')}
     ) WHERE C > 1`,
  );
  const dup = dupes[0]!;
  console.log(
    `  groups with >1 row: ${Number(dup.N).toLocaleString()}  max rows-per-group=${dup.MX ?? 0}  avg=${dup.AVG?.toFixed?.(2) ?? 0}`,
  );
  // Look for an N / RESPONDENTS / COUNT column
  const respondentCol = firstCol(cols, /RESPOND|N_STUDENT|STUDENT.?COUNT|COUNT|^N$/i);
  console.log(`  respondent-count column candidate: ${respondentCol ?? '(none)'}`);
  writeFixture('response-unit', {
    view: VIEW,
    groupKeys,
    groupsWithMultipleRows: Number(dup.N),
    maxRowsPerGroup: Number(dup.MX ?? 0),
    avgRowsPerGroup: Number(dup.AVG ?? 0),
    respondentColCandidate: respondentCol ?? null,
  });
}

// ── [9] join keys ───────────────────────────────────────────────────────
async function runJoinKeys(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  console.log('\n[9] Join-key viability against our entities:');
  // We want to map this view's rows to:
  //   - FacultyMember (via employeeId OR kkumail)
  //   - Course        (via courseCode)
  //   - ClassOffering (via courseCode + section + acadYear + semester)
  //   - Faculty       (via faculty name match)
  const candidates: Array<[string, RegExp]> = [
    ['instructorKey', /KKUMAIL|MAIL|EMPLOYEE|EMP.?CODE|STAFF.?CODE/i],
    ['courseCode', /SUBJECT.?CODE|COURSE.?CODE/i],
    ['section', /SECTION|GROUP/i],
    ['facultyName', /FACULTY.?NAME|FACULTY/i],
    ['programName', /PROGRAM.?NAME|CURRIC.?NAME/i],
    ['departmentName', /DEPART.?NAME|DIVISION/i],
  ];
  for (const [label, re] of candidates) {
    for (const c of colMatch(cols, re)) {
      const r = await query<{ NN: number; T: number; SAMPLE: string }>(
        conn,
        `SELECT SUM(CASE WHEN ${c.COLUMN_NAME} IS NOT NULL AND TRIM(${c.COLUMN_NAME}) <> '' THEN 1 ELSE 0 END) AS NN,
                COUNT(*) AS T,
                MAX(${c.COLUMN_NAME}) AS SAMPLE
         FROM ${VIEW}`,
      );
      const pct = Number(r[0]?.T ?? 1) ? ((Number(r[0]?.NN ?? 0) / Number(r[0]?.T ?? 1)) * 100).toFixed(1) : '0';
      console.log(
        `  ${label.padEnd(15)} ${c.COLUMN_NAME.padEnd(28)} populated=${pct}%  sample=${mask(r[0]?.SAMPLE)}`,
      );
    }
  }
}

// ── [10] PII audit ──────────────────────────────────────────────────────
async function runPiiAudit(
  conn: Parameters<typeof query>[0],
  cols: ColumnRow[],
): Promise<void> {
  console.log('\n[10] PII audit:');
  const suspects = cols.filter((c) => PII_PATTERNS.some((re) => re.test(c.COLUMN_NAME)));
  if (suspects.length === 0) {
    console.log('  (no PII-looking columns detected by name) ✓');
    writeFixture('pii-audit', { view: VIEW, suspects: [], comments: 'none-by-name' });
    return;
  }
  for (const c of suspects) {
    console.log(`  ⚠ ${c.COLUMN_NAME}  type=${c.DATA_TYPE}  len=${c.DATA_LENGTH}`);
  }
  writeFixture('pii-audit', {
    view: VIEW,
    suspects: suspects.map((c) => ({
      column: c.COLUMN_NAME,
      type: c.DATA_TYPE,
      length: c.DATA_LENGTH,
    })),
  });
}

// ── main ────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const sections = (process.argv[2] ?? 'all').toLowerCase();
  const wanted = new Set(
    sections === 'all'
      ? ['schema', 'counts', 'sample', 'coverage', 'cardinalities', 'questions', 'score', 'unit', 'joins', 'pii']
      : sections.split(','),
  );
  console.log(`▶ Probing ${VIEW}  (sections: ${[...wanted].join(',')})…`);

  const cfg = configFromEnv('KKU_REGISTRY_DB');
  await withConnection(cfg, async (conn) => {
    const cols = wanted.has('schema') || wanted.size > 0 ? await runSchema(conn) : await fetchColumns(conn);
    if (cols.length === 0) return;
    if (wanted.has('counts')) await runCounts(conn);
    if (wanted.has('sample')) await runSample(conn);
    if (wanted.has('coverage')) await runCoverage(conn, cols);
    if (wanted.has('cardinalities')) await runCardinalities(conn, cols);
    if (wanted.has('questions')) await runQuestionStability(conn, cols);
    if (wanted.has('score')) await runScoreScale(conn, cols);
    if (wanted.has('unit')) await runResponseUnit(conn, cols);
    if (wanted.has('joins')) await runJoinKeys(conn, cols);
    if (wanted.has('pii')) await runPiiAudit(conn, cols);
    console.log('\n✓ done.');
  });
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});

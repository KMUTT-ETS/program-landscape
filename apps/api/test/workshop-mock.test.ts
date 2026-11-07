import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getImportDataset } from '@kku/db';
import { buildTcasMatchIndex, findOwnProgrammeMatch } from '@kku/shared';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkMockDir, readTcasFile, universityFromToml } from '../scripts/workshop/check-mock';
import { parseImportWorkbook } from '../src/import/parse';

const repo = path.resolve(__dirname, '../../..');
const mockDir = path.join(repo, 'scripts', 'workshop-mock');
const fixtureTcas = path.join(mockDir, 'fixtures', 'tcas-sample.xlsx');
const fixtureInput = path.join(mockDir, 'tests', 'fixture-input.toml');
const PYTHON = process.env.WORKSHOP_MOCK_PYTHON ?? 'python3';

const depsOk =
  spawnSync(PYTHON, ['-c', 'import openpyxl, pypdf'], { stdio: 'ignore' }).status === 0;
const skipNote = `SKIPPED: ${PYTHON} cannot import openpyxl and pypdf (set WORKSHOP_MOCK_PYTHON)`;
if (!depsOk) console.warn(`[workshop-mock] ${skipNote}`);

function py(code: string, input?: string): string {
  return execFileSync(PYTHON, ['-c', code], { cwd: mockDir, input, encoding: 'utf8' });
}

function sheet(file: string, name: string): Record<string, unknown>[] {
  const r = parseImportWorkbook(fs.readFileSync(file), name);
  if (!r.ok) throw new Error(r.error);
  return r.parsed.rows.map((x) => ({ ...x }));
}

describe.skipIf(!depsOk)(`workshop mock data${depsOk ? '' : ` (${skipNote})`}`, () => {
  let out = '';
  const university = universityFromToml(fixtureInput);
  const tcasRows = readTcasFile(fixtureTcas);

  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-mock-'));
    const r = spawnSync(
      PYTHON,
      ['generate.py', fixtureInput, '--out', out, '--tcas-file', `${fixtureTcas}:2567:3`],
      { cwd: mockDir, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`generate.py exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  }, 120_000);

  afterAll(() => {
    if (out) fs.rmSync(out, { recursive: true, force: true });
  });

  it('every file passes the importer and every bachelor programme matches TCAS', () => {
    const result = checkMockDir(out, tcasRows, university);
    expect(result.errors).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.matched.some((m) => m.includes('วิศวกรรมวัสดุ'))).toBe(true);
  });

  it('every bachelor Thai programme name is byte-identical to a TCAS หลักสูตร cell', () => {
    const wb = XLSX.read(fs.readFileSync(fixtureTcas), { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0] as string]!;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
    const col = (matrix[0] ?? []).map((h) => String(h ?? '').trim()).indexOf('หลักสูตร');
    expect(col).toBeGreaterThanOrEqual(0);
    const names = new Set(matrix.slice(1).map((r) => r[col]).filter((v) => typeof v === 'string'));
    const bachelors = sheet(path.join(out, '03-programmes.xlsx'), 'Programmes').filter(
      (r) => r['Level'] === 'BACHELOR',
    );
    expect(bachelors.length).toBeGreaterThan(0);
    for (const b of bachelors) expect(names.has(String(b['Name (Thai)'])), String(b['Name (Thai)'])).toBe(true);
  });

  it('Python SHEETS equals the registry (sheet names and header order)', () => {
    const sheets = JSON.parse(
      py('import json; from wsmock.datasets import SHEETS; print(json.dumps(SHEETS, ensure_ascii=False))'),
    ) as Record<string, [string, string[]]>;
    for (const [slug, [sheetName, headers]] of Object.entries(sheets)) {
      const d = getImportDataset(slug);
      expect(sheetName, slug).toBe(d.sheetName);
      expect(headers, slug).toEqual(d.columns.map((c) => c.header));
    }
    expect(Object.keys(sheets).length).toBe(20);
  });

  it('Python PAGE_TITLES equals the dataset titles', () => {
    const titles = JSON.parse(
      py('import json; from wsmock.write import PAGE_TITLES; print(json.dumps(PAGE_TITLES, ensure_ascii=False))'),
    ) as Record<string, string>;
    for (const [slug, title] of Object.entries(titles)) expect(title, slug).toBe(getImportDataset(slug).title);
  });

  it('Python link_rows and findOwnProgrammeMatch link the same rows to the same programmes', () => {
    const facName = new Map(
      sheet(path.join(out, '01-faculties.xlsx'), 'Faculties').map((r) => [
        String(r['Faculty Code']),
        String(r['Name (Thai)']),
      ]),
    );
    const bachelors = sheet(path.join(out, '03-programmes.xlsx'), 'Programmes')
      .filter((r) => r['Level'] === 'BACHELOR')
      .map((r) => ({
        code: String(r['Programme Code']),
        name_th: String(r['Name (Thai)']),
        faculty_name_th: facName.get(String(r['Faculty Code'])) ?? '',
        level: 'BACHELOR',
      }));
    const pyOut = JSON.parse(
      py(
        [
          'import json, sys, types',
          'from pathlib import Path',
          'from wsmock.tcas import load_rows, own_rows',
          'from wsmock.tcas_match import link_rows',
          'req = json.load(sys.stdin)',
          'rows = own_rows(load_rows(Path("."), offline=True, files=[(Path(req["file"]), 2567, "3")]), req["university"])',
          'progs = [types.SimpleNamespace(**p) for p in req["programmes"]]',
          'print(json.dumps({k: sorted(r.course_code for r in v) for k, v in link_rows(progs, rows).items()}))',
        ].join('\n'),
        JSON.stringify({ file: fixtureTcas, university, programmes: bachelors }),
      ),
    ) as Record<string, string[]>;

    const idx = buildTcasMatchIndex(
      bachelors.map((b) => ({ id: b.code, nameTh: b.name_th, majors: [], facultyNameTh: b.faculty_name_th })),
    );
    const ts: Record<string, string[]> = Object.fromEntries(bachelors.map((b) => [b.code, []]));
    for (const t of tcasRows) {
      if (t.institution !== university) continue;
      const m = findOwnProgrammeMatch(idx, t.faculty, t.programme, t.major ?? '');
      if (m) ts[m.id]!.push(t.code ?? '');
    }
    for (const k of Object.keys(ts)) ts[k]!.sort();
    expect(pyOut).toEqual(ts);
    expect(Object.values(ts).some((v) => v.length > 0)).toBe(true);
  });
});

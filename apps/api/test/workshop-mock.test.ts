import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkMockDir, readTcasFile, universityFromInput } from '../scripts/workshop/check-mock';
import { parseImportWorkbook } from '../src/import/parse';

const repo = path.resolve(__dirname, '../../..');
const fixtures = path.join(repo, 'apps', 'ingestion', 'test', 'fixtures', 'workshop-mock');
const generator = path.join(repo, 'apps', 'ingestion', 'src', 'scripts', 'workshop-mock', 'generate.ts');
const fixtureTcas = path.join(fixtures, 'tcas-sample.xlsx');
const fixtureInput = path.join(fixtures, 'fixture-input.json');

function sheet(file: string, name: string): Record<string, unknown>[] {
  const r = parseImportWorkbook(fs.readFileSync(file), name);
  if (!r.ok) throw new Error(r.error);
  return r.parsed.rows.map((x) => ({ ...x }));
}

describe('workshop mock data', () => {
  let out = '';
  const university = universityFromInput(fixtureInput);
  const tcasRows = readTcasFile(fixtureTcas);

  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-mock-'));
    const tsx = path.join(path.dirname(require.resolve('tsx/package.json', { paths: [path.join(repo, 'apps', 'ingestion')] })), 'dist', 'cli.mjs');
    const r = spawnSync(
      process.execPath,
      [tsx, generator, fixtureInput, '--out', out, '--tcas-file', `${fixtureTcas}:2567:3`],
      { cwd: repo, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`generate.ts exited ${r.status}\n${r.stdout}\n${r.stderr}`);
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
});

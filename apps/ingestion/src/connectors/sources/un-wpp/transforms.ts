import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { Readable } from 'node:stream';

// UN World Population Prospects 2024 — "Population on 1 January by single age
// and sex, medium variant" bulk CSV. Pure parsing, no network: the connector
// hands this a stream, the tests hand it a small gzip built in memory.

export const UN_WPP_SOURCE = 'UN-WPP2024';

export const COHORTS = [
  { label: '15-17', from: 15, to: 17 },
  { label: '18-22', from: 18, to: 22 },
  { label: '23-29', from: 23, to: 29 },
] as const;

export interface WppCohortRow {
  year: number;
  ageCohort: string;
  /** Persons (the file is in thousands). */
  population: number;
}

export interface WppFilter {
  iso3: string;
  fromYear: number;
  toYear: number;
}

/** One CSV record: handles quoted fields and doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export class WppSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WppSchemaError';
  }
}

const REQUIRED_COLUMNS = ['ISO3_code', 'Variant', 'Time', 'AgeGrpStart', 'PopTotal'] as const;

/**
 * Reads the CSV line by line and sums single ages into the three cohorts for
 * one country, the Medium variant and the requested year window.
 */
export async function aggregateWppLines(
  lines: AsyncIterable<string>,
  filter: WppFilter,
): Promise<WppCohortRow[]> {
  let index: Record<string, number> | null = null;
  const sums = new Map<string, number>(); // `${year}|${cohort}` -> thousands
  for await (const rawLine of lines) {
    let line = rawLine;
    if (index === null) {
      if (line.charCodeAt(0) === 0xfeff) line = line.slice(1);
      if (line.trim() === '') continue;
      const header = parseCsvLine(line).map((h) => h.trim());
      const found: Record<string, number> = {};
      for (const col of REQUIRED_COLUMNS) {
        const at = header.indexOf(col);
        if (at < 0) throw new WppSchemaError(`The UN WPP file has no "${col}" column.`);
        found[col] = at;
      }
      index = found;
      continue;
    }
    if (line.trim() === '') continue;
    const cells = parseCsvLine(line);
    if (cells[index.ISO3_code!]?.trim() !== filter.iso3) continue;
    if (cells[index.Variant!]?.trim() !== 'Medium') continue;
    const year = Number(cells[index.Time!]);
    if (!Number.isInteger(year) || year < filter.fromYear || year > filter.toYear) continue;
    const age = Number(cells[index.AgeGrpStart!]);
    if (!Number.isInteger(age)) continue;
    const cohort = COHORTS.find((c) => age >= c.from && age <= c.to);
    if (!cohort) continue;
    const popThousands = Number(cells[index.PopTotal!]);
    if (!Number.isFinite(popThousands)) continue;
    const key = `${year}|${cohort.label}`;
    sums.set(key, (sums.get(key) ?? 0) + popThousands);
  }
  if (index === null) throw new WppSchemaError('The UN WPP file is empty.');
  return [...sums.entries()]
    .map(([key, thousands]) => {
      const [year, ageCohort] = key.split('|') as [string, string];
      return { year: Number(year), ageCohort, population: Math.round(thousands * 1000) };
    })
    .sort((a, b) => a.year - b.year || a.ageCohort.localeCompare(b.ageCohort));
}

/** Lines of a gzip-compressed CSV stream, without holding the file in memory. */
export function gunzipLines(source: Readable): AsyncIterable<string> {
  const gunzip = createGunzip();
  source.on('error', (err) => gunzip.destroy(err));
  return createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
}

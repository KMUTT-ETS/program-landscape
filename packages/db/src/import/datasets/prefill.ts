import type { PrismaClient } from '@prisma/client';

import { getAcademicYearContext } from '../../academic-year';
import { withCanonical } from '../../canonical-programs';
import type { ImportDataset, ImportRow, PrefillOptions } from '../types';

/** How many years a template covers when the operator asks for no range. */
const DEFAULT_YEARS = 5;

/**
 * Rows for every canonical active programme crossed with a year range.
 *
 * Every tier-1 dataset is keyed on a programme code and a year, and an
 * empty template makes the operator type both — which is where reference
 * errors come from, since a mistyped code fails the whole file and a
 * correct-looking code for a non-canonical programme loads into
 * invisibility.
 *
 * Only the key columns are filled. A value this function could guess would
 * be a figure the institution never stated, arriving in a template that
 * looks authoritative.
 */
export function programmeYearPrefill(config: {
  yearKey: string;
  /** Further key columns, emitted blank — present so the row shape is whole. */
  extraKeys?: readonly string[];
}): NonNullable<ImportDataset['prefill']> {
  return async (prisma: PrismaClient, opts: PrefillOptions): Promise<readonly ImportRow[]> => {
    const programmes = await prisma.program.findMany({
      where: withCanonical({ status: 'ACTIVE' }),
      select: { code: true },
      orderBy: { code: 'asc' },
    });
    if (programmes.length === 0) return [];

    const years = await resolveYears(opts);
    const blanks = Object.fromEntries((config.extraKeys ?? []).map((k) => [k, null]));

    const rows: ImportRow[] = [];
    for (const programme of programmes) {
      for (const year of years) {
        rows.push({ programmeCode: programme.code, [config.yearKey]: year, ...blanks });
      }
    }
    return rows;
  };
}

async function resolveYears(opts: PrefillOptions): Promise<number[]> {
  if (opts.fromYear !== undefined || opts.toYear !== undefined) {
    const to = opts.toYear ?? opts.fromYear ?? 0;
    const from = opts.fromYear ?? to;
    if (to < from) return [];
    return range(from, to);
  }
  // The academic year context is Buddhist-era; every import column is CE.
  const { currentAcademicYearBE } = await getAcademicYearContext();
  const current = currentAcademicYearBE - 543;
  return range(current - (DEFAULT_YEARS - 1), current);
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let y = from; y <= to; y += 1) out.push(y);
  return out;
}

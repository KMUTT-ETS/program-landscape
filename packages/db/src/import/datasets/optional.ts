import type { ImportCellValue } from '../types';

// A column the uploaded sheet does not carry arrives as `undefined`; a blank
// cell in a column that IS carried arrives as `null`. Update paths skip
// `undefined` (Prisma ignores it), so a sheet without an optional column never
// erases what is stored. On insert `undefined` falls to the column default.

export function optNum(v: ImportCellValue | undefined): number | null | undefined {
  return v === undefined ? undefined : v === null ? null : Number(v);
}

export function optStr(v: ImportCellValue | undefined): string | null | undefined {
  return v === undefined ? undefined : v === null ? null : String(v);
}

export function optDate(v: ImportCellValue | undefined): Date | null | undefined {
  return v === undefined ? undefined : v instanceof Date ? v : null;
}

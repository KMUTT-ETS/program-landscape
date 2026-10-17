// ─────────────────────────────────────────────────────────────────────────────
// Thai national ID detection.
//
// Used by the spreadsheet importer to refuse a file carrying personal
// identifiers. The connectors never face this: they hash national IDs inside
// SQL Server and MySQL before the application sees one. An uploaded workbook
// has no such guarantee, so the importer has to recognise one itself.
//
// The mod-11 checksum is load-bearing. A bare "13 digits" test would flag
// course codes, class ids and other long numerics, and an importer that
// cries wolf gets its rule removed.
// ─────────────────────────────────────────────────────────────────────────────

/** Separators a person might type inside an ID. */
const SEPARATORS = /[\s-]/g;

/**
 * True when `value` is a syntactically valid Thai national ID — exactly 13
 * digits once spaces and hyphens are removed, whose 13th digit matches the
 * mod-11 check over the first 12.
 *
 * Never throws. Callers must not echo a value this returns true for.
 */
export function looksLikeThaiNationalId(value: string): boolean {
  const digits = value.replace(SEPARATORS, '');
  if (!/^\d{13}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (13 - i);
  }
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

// ─────────────────────────────────────────────────────────────────────────
// Canonical 297 active programs — the curriculum landscape.
//
// "Canonical" = present in the KKU master Google Sheet seed
// (sequenceNoFromSheet IS NOT NULL). Anything else (legacy mock-seed
// rows, programs that arrived only via ingestion side-effects) is
// excluded from the curriculum landscape view but stays referenceable
// for staff / education dashboards that join through registry, HR, and
// student records.
//
// Use IS_CANONICAL_PROGRAM as a Prisma `where` fragment whenever a
// Council-facing surface needs to enumerate "the 297 programs" so
// filter divergence between modules can't reintroduce the legacy rows.
// ─────────────────────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client';

export const IS_CANONICAL_PROGRAM = {
  sequenceNoFromSheet: { not: null },
} as const satisfies Prisma.ProgramWhereInput;

export function withCanonical<T extends Prisma.ProgramWhereInput>(
  where: T | undefined,
): Prisma.ProgramWhereInput {
  if (!where || Object.keys(where).length === 0) return IS_CANONICAL_PROGRAM;
  return { AND: [IS_CANONICAL_PROGRAM, where] };
}

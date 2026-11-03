import type { Prisma } from '@prisma/client';

/**
 * The RankedUniversity rows the peer selector may choose from: one ranking
 * year, minus the institution running the app. The own institution is
 * recognised by name only — a spreadsheet row's University must equal the
 * organisation profile's English name for it to be left out.
 */
export function peerCandidateWhere(
  rankingYear: number,
  ownNameEn: string,
): Prisma.RankedUniversityWhereInput {
  return { rankingYear, name: { not: ownNameEn.trim() } };
}

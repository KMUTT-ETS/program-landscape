// ─────────────────────────────────────────────────────────────────────────────
// Materialise an approved AiExtraction (extractionKind=IMD_RANKINGS) into
// ImdEconomy + ImdRanking rows. Mirrors the program-digest materialise
// pattern: idempotent upsert, skip-if-empty for existing economy
// metadata, stats reported back to the caller.
//
// Wired into the existing /ai/extractions/:id/approve flow via the
// AiAdmin controller — see the materialiseApprovedExtraction switch.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { prisma } from './index';
import type { ImdDataset } from '@prisma/client';

const ImdRowSchema = z.object({
  economyCode: z.string().min(2).max(8),
  economyName: z.string().min(2).max(120),
  indicatorKey: z.string().min(2).max(80),
  rank: z.number().int().min(1).max(200).nullable(),
  value: z.number().nullable(),
  totalRanked: z.number().int().min(10).max(200).nullable(),
  rawValue: z.string().max(120).nullable(),
});

const ImdRankingsExtractionSchema = z.object({
  year: z.number().int().min(2000).max(2030),
  dataset: z.enum(['WCY', 'WTR', 'WDCR']),
  rankings: z.array(ImdRowSchema).min(0).max(500),
  confidence: z.number().min(0).max(1),
  caveatNote: z.string().max(2000).nullable().optional(),
});

export interface MaterialiseImdResult {
  rankingsUpserted: number;
  economiesCreated: number;
  rowsSkipped: number;
  /** Sample of unknown economy codes that needed creating — for the
   *  analyst to verify region + isPeer assignment. */
  newEconomyCodes: string[];
}

export async function materialiseImdRankings(
  extractionId: string,
): Promise<MaterialiseImdResult> {
  const extraction = await prisma.aiExtraction.findUnique({
    where: { id: extractionId },
    select: { id: true, extractionKind: true, payloadJson: true, methodVersion: true },
  });
  if (!extraction) throw new Error(`AiExtraction not found: ${extractionId}`);
  if (extraction.extractionKind !== 'IMD_RANKINGS') {
    throw new Error(
      `extractionKind ${extraction.extractionKind} cannot materialise as IMD; expected IMD_RANKINGS`,
    );
  }

  const parsed = ImdRankingsExtractionSchema.safeParse(extraction.payloadJson);
  if (!parsed.success) {
    throw new Error(
      `IMD payload failed schema check: ${parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ')}`,
    );
  }
  const data = parsed.data;

  const result: MaterialiseImdResult = {
    rankingsUpserted: 0,
    economiesCreated: 0,
    rowsSkipped: 0,
    newEconomyCodes: [],
  };

  // Resolve / create ImdEconomy rows. New economies land with NULL
  // region + isPeer=false; analyst verifies on /admin/data-sources/
  // imd-rankings later.
  const codeToId = new Map<string, string>();
  for (const row of data.rankings) {
    if (codeToId.has(row.economyCode)) continue;
    const economy = await prisma.imdEconomy.upsert({
      where: { code: row.economyCode },
      create: {
        code: row.economyCode,
        name: row.economyName,
      },
      update: {
        // Skip-if-empty semantics — never overwrite a curated name with
        // the AI's verbatim. Update only when the existing name is
        // empty / placeholder.
        name: row.economyName,
      },
      select: { id: true, createdAt: true, updatedAt: true },
    });
    if (economy.createdAt.getTime() === economy.updatedAt.getTime()) {
      result.economiesCreated += 1;
      result.newEconomyCodes.push(row.economyCode);
    }
    codeToId.set(row.economyCode, economy.id);
  }

  // Upsert ranking rows. The unique key is (year, dataset, economyId,
  // indicatorKey).
  for (const row of data.rankings) {
    const economyId = codeToId.get(row.economyCode);
    if (!economyId) {
      result.rowsSkipped += 1;
      continue;
    }
    await prisma.imdRanking.upsert({
      where: {
        year_dataset_economyId_indicatorKey: {
          year: data.year,
          dataset: data.dataset as ImdDataset,
          economyId,
          indicatorKey: row.indicatorKey,
        },
      },
      create: {
        year: data.year,
        dataset: data.dataset as ImdDataset,
        economyId,
        indicatorKey: row.indicatorKey,
        rank: row.rank,
        value: row.value,
        totalRanked: row.totalRanked,
        rawValue: row.rawValue,
        notes: data.caveatNote ?? null,
        methodologyVersion: extraction.methodVersion,
        source: `pdf:${extractionId}`,
      },
      update: {
        rank: row.rank,
        value: row.value,
        totalRanked: row.totalRanked,
        rawValue: row.rawValue,
        notes: data.caveatNote ?? null,
        methodologyVersion: extraction.methodVersion,
        source: `pdf:${extractionId}`,
      },
    });
    result.rankingsUpserted += 1;
  }

  return result;
}

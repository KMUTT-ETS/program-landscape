import { prisma } from '@kku/db';
import {
  buildCareerKmitlMappingMessages,
  CareerKmitlMappingSchema,
  CAREER_KMITL_MAPPING_VERSION,
  type AiService,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Per-program career → KMITL career-id mapping.
//
// Reads:
//   - Program.careersThJson (Thai career labels — populated by program-digest
//     materialise; if missing, falls back to AiExtraction.payloadJson.careerPathsTh)
//   - KmitlCareer rows (the full career taxonomy, ~400 entries)
//
// Calls Gemini once with the FULL KMITL list as context; returns
// kmitlCareerIds per program-career. Persists the resolved id set on
// `Program.kmitlCareerIds` (Int[] column). Careers that don't map to
// any KMITL entry land in `unmappedCareers` for the Phase-2 external-
// grounded-search fallback to consume.
//
// Idempotent: re-running overwrites Program.kmitlCareerIds with the new
// mapping. Force-flag exists for debugging; no skip-if-exists logic
// because re-mapping is cheap and may be triggered after KMITL taxonomy
// updates.
// ─────────────────────────────────────────────────────────────────────────────

export interface MapCareersParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type MapCareersOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      careersTotal: number;
      kmitlMatched: number;
      kmitlUnmatched: number;
      kmitlCareerIds: number[];
      unmappedCareers: string[];
      mappingSummary: Array<{ career: string; kmitlIds: number[]; reasoning: string }>;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

/** Pull the program's career list — prefer Program.careersThJson, fall
 *  back to the most recent PROGRAM_DIGEST AiExtraction's careerPathsTh. */
async function loadProgramCareers(programId: string): Promise<string[]> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { careersThJson: true },
  });
  const direct = program?.careersThJson as string[] | null | undefined;
  if (Array.isArray(direct) && direct.length > 0) return direct;

  // Fallback: read from existing program-digest extraction
  const digest = await prisma.aiExtraction.findFirst({
    where: {
      sourceEntityType: 'program',
      sourceEntityId: programId,
      extractionKind: 'PROGRAM_DIGEST',
    },
    orderBy: { createdAt: 'desc' },
    select: { payloadJson: true },
  });
  const payload = digest?.payloadJson as { careerPathsTh?: string[] } | null;
  return payload?.careerPathsTh ?? [];
}

export async function mapProgramCareers(params: MapCareersParams): Promise<MapCareersOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      code: true,
      nameTh: true,
      faculty: { select: { nameTh: true } },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };

  const careers = await loadProgramCareers(params.programId);
  if (careers.length === 0) {
    return {
      status: 'SKIPPED',
      reason: 'no career list found — run program-digest first to populate careerPathsTh',
    };
  }

  // Snapshot the full KMITL career taxonomy
  const kmitlRows = await prisma.kmitlCareer.findMany({
    select: {
      kmitlCareerId: true,
      careerName: true,
      groupName: true,
      subGroupName: true,
    },
    orderBy: [{ groupName: 'asc' }, { subGroupName: 'asc' }, { careerName: 'asc' }],
  });
  if (kmitlRows.length === 0) {
    return { status: 'SKIPPED', reason: 'no KmitlCareer rows loaded — run kmitl-skill-mapping connector' };
  }

  const messages = buildCareerKmitlMappingMessages({
    programDegree: program.nameTh,
    programFaculty: program.faculty.nameTh,
    programCareers: careers,
    kmitlCareers: kmitlRows.map((k) => ({
      id: k.kmitlCareerId,
      name: k.careerName,
      group: k.groupName,
      subGroup: k.subGroupName,
    })),
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'career-kmitl-mapping',
        userId: params.triggeredByUserId ?? null,
        traceId: `career-mapping-${program.id}`,
      },
      messages,
      methodVersion: CAREER_KMITL_MAPPING_VERSION,
      // Bumped 8000 → 50000 on 2026-05-13 — see program-digest/run.ts.
      maxOutputTokens: 50000,
    },
    CareerKmitlMappingSchema,
  );

  // Validate IDs against the snapshot — drop hallucinated ones.
  const validIds = new Set(kmitlRows.map((k) => k.kmitlCareerId));
  const allIds = new Set<number>();
  const unmapped: string[] = [];
  const summary: MapCareersOutcome extends infer R
    ? R extends { mappingSummary: infer S }
      ? S
      : never
    : never = [];
  for (const m of response.parsed.mappings) {
    const filteredIds = m.kmitlCareerIds.filter((id) => validIds.has(id));
    for (const id of filteredIds) allIds.add(id);
    summary.push({ career: m.careerLabel, kmitlIds: filteredIds, reasoning: m.reasoning ?? '' });
    if (m.noKmitlMatch || filteredIds.length === 0) unmapped.push(m.careerLabel);
  }

  const sortedIds = [...allIds].sort((a, b) => a - b);

  await prisma.program.update({
    where: { id: program.id },
    data: { kmitlCareerIds: sortedIds, careersThJson: careers },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    careersTotal: careers.length,
    kmitlMatched: careers.length - unmapped.length,
    kmitlUnmatched: unmapped.length,
    kmitlCareerIds: sortedIds,
    unmappedCareers: unmapped,
    mappingSummary: summary,
  };
}

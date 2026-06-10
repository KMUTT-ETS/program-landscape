import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Benchmarking-overview — single payload for the redesigned page.
//
// Backed by:
//   - ProgramPeerSelection (4,109 rows, 252 programs)  — AI-picked peers per program
//   - ProgramPeerReview (237 rows)                     — AI comparative review
//   - RankedUniversity (57 rows)                       — real QS/THE rankings
//
// Drops dependence on the original prompt-10 tables (PeerSet,
// PeerSetMember, PeerProgram, PeerRanking) which are all empty.
// ─────────────────────────────────────────────────────────────────────────────

export const BENCHMARKING_OVERVIEW_VERSION = 'benchmarking-overview.v1';

export type ContentModernity = 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER';

export interface BenchmarkingHero {
  programsBenchmarked: number; // programs with at least one peer selection
  programsReviewed: number;    // programs with a full AI peer review
  totalActivePrograms: number;
  modernityCounts: { OLD_SCHOOL: number; IN_BETWEEN: number; FRONTIER: number; UNKNOWN: number };
}

export interface CitedPeerRow {
  rankedUniversityId: string;
  name: string;
  country: string;
  qsWorldRank: number | null;
  theWorldRank: number | null;
  selectionCount: number; // how many KKU programs picked this peer
  /** Per-tier breakdown. */
  byTier: { WORLD: number; ASIA: number; SOUTHEAST_ASIA: number; THAILAND_PEER: number };
}

export interface RecentReviewRow {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  contentModernity: ContentModernity | null;
  modernityNarrative: string | null;
  topStrength: string | null;
  topWeakness: string | null;
  topContentGap: { topic: string; severity: 'major' | 'moderate' | 'minor' } | null;
  topPeer: { name: string; country: string; tier: string } | null;
  generatedAt: Date;
}

export interface ProgramBenchmarkRow {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  contentModernity: ContentModernity | null;
  peerCount: number;
  topPeerName: string | null;
  topPeerCountry: string | null;
  topGapTopic: string | null;
  hasReview: boolean;
}

export interface BenchmarkingOverview {
  methodologyVersion: string;
  generatedAt: Date;
  hero: BenchmarkingHero;
  citedPeers: CitedPeerRow[];          // top 10
  recentReviews: RecentReviewRow[];    // 8 most recent
  programs: ProgramBenchmarkRow[];     // all benchmarked programs (sortable client-side)
}

export async function getBenchmarkingOverview(): Promise<BenchmarkingOverview> {
  const [
    totalActivePrograms,
    programsBenchmarked,
    reviews,
    selections,
  ] = await Promise.all([
    prisma.program.count({
      where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    }),
    // Gate to ACTIVE canonical programs so the benchmarked / reviewed
    // counts share the 297 denominator — peer data also exists for a few
    // paused / non-canonical programs, which previously pushed this past
    // totalActivePrograms (the "300 / 297" bug).
    prisma.programPeerSelection
      .groupBy({
        by: ['programId'],
        where: { program: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } } },
      })
      .then((r) => r.length),
    prisma.programPeerReview.findMany({
      where: { program: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } } },
      orderBy: { generatedAt: 'desc' },
      include: {
        program: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameTh: true,
            faculty: { select: { code: true } },
          },
        },
      },
    }),
    prisma.programPeerSelection.findMany({
      where: { program: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } } },
      include: {
        program: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameTh: true,
            faculty: { select: { code: true } },
          },
        },
        rankedUniversity: {
          select: { id: true, name: true, country: true, qsWorldRank: true, theWorldRank: true },
        },
      },
      orderBy: [{ programId: 'asc' }, { tier: 'asc' }, { rankInTier: 'asc' }],
    }),
  ]);

  // Modernity counts
  const modernityCounts = { OLD_SCHOOL: 0, IN_BETWEEN: 0, FRONTIER: 0, UNKNOWN: 0 };
  for (const r of reviews) {
    const p = r.payloadJson as { contentModernity?: { verdict?: string } } | null;
    const verdict = p?.contentModernity?.verdict;
    if (verdict === 'OLD_SCHOOL' || verdict === 'IN_BETWEEN' || verdict === 'FRONTIER') {
      modernityCounts[verdict]++;
    } else {
      modernityCounts.UNKNOWN++;
    }
  }

  // Cited-peer aggregation — count selections per rankedUniversity, with tier breakdown.
  type CitedAccum = { ru: typeof selections[number]['rankedUniversity']; total: number; byTier: CitedPeerRow['byTier'] };
  const cited = new Map<string, CitedAccum>();
  for (const s of selections) {
    const ruId = s.rankedUniversityId;
    let entry = cited.get(ruId);
    if (!entry) {
      entry = { ru: s.rankedUniversity, total: 0, byTier: { WORLD: 0, ASIA: 0, SOUTHEAST_ASIA: 0, THAILAND_PEER: 0 } };
      cited.set(ruId, entry);
    }
    entry.total++;
    const t = s.tier as keyof CitedPeerRow['byTier'];
    if (t in entry.byTier) entry.byTier[t]++;
  }
  const citedPeers: CitedPeerRow[] = [...cited.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((c) => ({
      rankedUniversityId: c.ru.id,
      name: c.ru.name,
      country: c.ru.country,
      qsWorldRank: c.ru.qsWorldRank,
      theWorldRank: c.ru.theWorldRank,
      selectionCount: c.total,
      byTier: c.byTier,
    }));

  // Recent reviews — pull payload for each, surface top strength/weakness/gap.
  const recentReviews: RecentReviewRow[] = reviews.slice(0, 8).map((r) => {
    const p = r.payloadJson as {
      contentModernity?: { verdict?: ContentModernity; narrative?: string };
      strengths?: Array<{ claim: string }>;
      weaknesses?: Array<{ claim: string }>;
      contentGaps?: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor' }>;
    } | null;

    // Top peer = highest-tier WORLD pick
    const programSelections = selections.filter((s) => s.programId === r.programId);
    const topSel = programSelections.find((s) => s.tier === 'WORLD' && s.rankInTier === 1)
      ?? programSelections.find((s) => s.rankInTier === 1)
      ?? programSelections[0];

    return {
      programId: r.program.id,
      programCode: r.program.code,
      programNameEn: r.program.nameEn,
      programNameTh: r.program.nameTh,
      facultyCode: r.program.faculty.code,
      contentModernity: p?.contentModernity?.verdict ?? null,
      modernityNarrative: p?.contentModernity?.narrative ?? null,
      topStrength: p?.strengths?.[0]?.claim ?? null,
      topWeakness: p?.weaknesses?.[0]?.claim ?? null,
      topContentGap: p?.contentGaps?.[0]
        ? { topic: p.contentGaps[0].topic, severity: p.contentGaps[0].severity }
        : null,
      topPeer: topSel
        ? { name: topSel.rankedUniversity.name, country: topSel.rankedUniversity.country, tier: topSel.tier }
        : null,
      generatedAt: r.generatedAt,
    };
  });

  // Program-level benchmark table — for every program with ≥1 selection
  type ProgramAccum = {
    programId: string;
    program: typeof selections[number]['program'];
    peerCount: number;
    topPeer: typeof selections[number]['rankedUniversity'] | null;
  };
  const programAccum = new Map<string, ProgramAccum>();
  for (const s of selections) {
    let entry = programAccum.get(s.programId);
    if (!entry) {
      entry = { programId: s.programId, program: s.program, peerCount: 0, topPeer: null };
      programAccum.set(s.programId, entry);
    }
    entry.peerCount++;
    // Top peer = first WORLD-tier rank-1, else first by tier order
    if (!entry.topPeer && s.tier === 'WORLD' && s.rankInTier === 1) {
      entry.topPeer = s.rankedUniversity;
    }
  }
  // For programs without WORLD-tier rank-1, fall back to any rank-1 selection
  for (const s of selections) {
    const entry = programAccum.get(s.programId);
    if (entry && !entry.topPeer && s.rankInTier === 1) {
      entry.topPeer = s.rankedUniversity;
    }
  }

  // Index reviews by programId for the modernity + topGap joins
  const reviewByProgram = new Map<string, typeof reviews[number]>();
  for (const r of reviews) reviewByProgram.set(r.programId, r);

  const programs: ProgramBenchmarkRow[] = [...programAccum.values()].map((a) => {
    const review = reviewByProgram.get(a.programId);
    const payload = review?.payloadJson as {
      contentModernity?: { verdict?: ContentModernity };
      contentGaps?: Array<{ topic: string; severity: string }>;
    } | null;
    return {
      programId: a.programId,
      programCode: a.program.code,
      programNameEn: a.program.nameEn,
      programNameTh: a.program.nameTh,
      facultyCode: a.program.faculty.code,
      contentModernity: payload?.contentModernity?.verdict ?? null,
      peerCount: a.peerCount,
      topPeerName: a.topPeer?.name ?? null,
      topPeerCountry: a.topPeer?.country ?? null,
      topGapTopic: payload?.contentGaps?.[0]?.topic ?? null,
      hasReview: !!review,
    };
  });
  // Sort: OLD_SCHOOL first (need attention), then alphabetical by code
  const modernityRank: Record<string, number> = { OLD_SCHOOL: 0, IN_BETWEEN: 1, FRONTIER: 2 };
  programs.sort((a, b) => {
    const ar = a.contentModernity ? modernityRank[a.contentModernity] ?? 3 : 4;
    const br = b.contentModernity ? modernityRank[b.contentModernity] ?? 3 : 4;
    if (ar !== br) return ar - br;
    return a.programCode.localeCompare(b.programCode);
  });

  return {
    methodologyVersion: BENCHMARKING_OVERVIEW_VERSION,
    generatedAt: new Date(),
    hero: {
      programsBenchmarked,
      programsReviewed: reviews.length,
      totalActivePrograms,
      modernityCounts,
    },
    citedPeers,
    recentReviews,
    programs,
  };
}

import { Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import { detectResearchTrends, type FacultyResearchRow } from './research-trends';

// Six continuous trend monitors. Each scans internal data and emits
// zero-or-more TrendSignal rows, fanned out as Notifications to matching
// subscribers. `research` is LIVE; the other five are INERT (they emit
// nothing — NOT mock data) until their real data source exists. See
// docs/trend-monitors.md for each one's status + what's needed to build it.

export type MonitorKind =
  | 'policy'
  | 'job-market'
  | 'research'
  | 'peer-programs'
  | 'tech-signals'
  | 'patents';

export interface MonitorOutcome {
  kind: MonitorKind;
  signalsCreated: number;
  notificationsSent: number;
  runId?: string;
}

const logger = new Logger('TrendMonitor');

// Cron cadence per monitor. Prompt 07 text calls out these windows.
export const MONITOR_CADENCE: Record<MonitorKind, string> = {
  policy: '0 */6 * * *',            // every 6h
  'job-market': '0 3 * * *',        // daily 03:00
  research: '0 4 * * 1',            // weekly Mon 04:00
  'peer-programs': '0 5 * * 6',     // weekly Sat 05:00
  'tech-signals': '0 4 * * 2',      // weekly Tue 04:00
  patents: '0 6 1 * *',             // monthly 1st 06:00
};

// ──────────────────────────────────────────────────────────────────────────
// Monitor implementations. `research` is LIVE (real kku-publications data).
// The other five are INERT no-ops until their real data source exists — they
// emit nothing rather than fabricate signals (no-mock policy). Each one's
// blocker + what's needed to build it is in docs/trend-monitors.md.
// ──────────────────────────────────────────────────────────────────────────

export async function runPolicyMonitor(): Promise<MonitorOutcome> {
  logger.log('policy monitor: inert — covered by curated connectors; see docs/trend-monitors.md');
  // Real: enqueue ANALYZE_POLICY_DOC for every PdfDocument with
  // sourceCategory=POLICY + processingStatus=COMPLETED that doesn't
  // yet have a TrendSignal linked. That AI path produces a real
  // summary + impact score + affectedProgramIds.
  return { kind: 'policy', signalsCreated: 0, notificationsSent: 0 };
}

export async function runJobMarketMonitor(): Promise<MonitorOutcome> {
  logger.log('job-market monitor: inert — no per-posting job source; see docs/trend-monitors.md');
  // Real: diff last N days of JobPosting rows against prior windows.
  // Detect anomalies → TrendSignal(signalType='MARKET').
  return { kind: 'job-market', signalsCreated: 0, notificationsSent: 0 };
}

// Faculty-level research trend monitor. Aggregates Scopus-Q1 ResearchOutput
// counts per faculty for the latest COMPLETE year vs the prior year, and emits
// a RESEARCH TrendSignal for each faculty with a notable rise. Real data from
// the kku-publications mirror; see docs/trend-monitors.md.
export async function runResearchMonitor(): Promise<MonitorOutcome> {
  // Latest COMPLETE year: never the in-progress current calendar year (its
  // partial counts would mask real rises). Y = min(max year in data, thisYear-1).
  const maxRow = await prisma.$queryRaw<Array<{ maxy: number | null }>>(
    Prisma.sql`SELECT MAX(year) AS maxy FROM research_outputs WHERE quartile = 1`,
  );
  const maxYear = maxRow[0]?.maxy ?? null;
  if (maxYear === null) {
    logger.log('research monitor: no Q1 research data — nothing to scan');
    return { kind: 'research', signalsCreated: 0, notificationsSent: 0 };
  }
  const year = Math.min(maxYear, new Date().getUTCFullYear() - 1);
  const prevYear = year - 1;

  // Per-faculty Q1 counts for the two years, pivoted in JS.
  const counts = await prisma.$queryRaw<
    Array<{ faculty_id: string; name_en: string; name_th: string; year: number; q1: number }>
  >(Prisma.sql`
    SELECT f.id AS faculty_id, f.name_en, f.name_th, ro.year, COUNT(*)::int AS q1
    FROM research_outputs ro
    JOIN faculty_members fm ON fm.id = ro.faculty_member_id
    JOIN faculties f ON f.id = fm.faculty_id
    WHERE ro.quartile = 1 AND ro.year IN (${year}, ${prevYear})
    GROUP BY f.id, f.name_en, f.name_th, ro.year
  `);

  const byFaculty = new Map<string, FacultyResearchRow>();
  for (const c of counts) {
    const cur = byFaculty.get(c.faculty_id) ?? {
      facultyId: c.faculty_id,
      facultyNameEn: c.name_en,
      facultyNameTh: c.name_th,
      yCount: 0,
      prevCount: 0,
    };
    if (c.year === year) cur.yCount = c.q1;
    else cur.prevCount = c.q1;
    byFaculty.set(c.faculty_id, cur);
  }

  const trends = detectResearchTrends([...byFaculty.values()], year);

  let signalsCreated = 0;
  let notificationsSent = 0;
  for (const t of trends) {
    const title = `${t.facultyNameEn} — rise in high-quartile (Q1) research output (${prevYear}→${year})`;
    // Dedup: deterministic title makes weekly re-runs idempotent.
    const existing = await prisma.trendSignal.findFirst({
      where: { signalType: 'RESEARCH', title },
      select: { id: true },
    });
    if (existing) continue;

    const pctText = t.pct === null ? '' : ` (+${t.pct}%)`;
    const summaryEn =
      `KKU's ${t.facultyNameEn} recorded ${t.yCount} Scopus-Q1 publications in ${year}, ` +
      `up from ${t.prevCount} in ${prevYear}${pctText}.`;
    const summaryTh =
      `${t.facultyNameTh} ตีพิมพ์ผลงานระดับ Scopus Q1 จำนวน ${t.yCount} เรื่องในปี ${year} ` +
      `เพิ่มขึ้นจาก ${t.prevCount} เรื่องในปี ${prevYear}${pctText}`;
    const impactScore =
      t.pct === null ? 0.55 : Math.min(0.85, 0.45 + t.pct / 200);

    const { notificationsSent: sent } = await createSignal({
      signalType: 'RESEARCH',
      title,
      summaryEn,
      summaryTh,
      impactScore,
    });
    signalsCreated += 1;
    notificationsSent += sent;
  }

  logger.log(
    `research monitor: ${year} vs ${prevYear} — ${trends.length} faculty rise(s), ${signalsCreated} new signal(s)`,
  );
  return { kind: 'research', signalsCreated, notificationsSent };
}

export async function runPeerProgramsMonitor(): Promise<MonitorOutcome> {
  logger.log('peer-programs monitor: inert — no real peer-catalogue feed; see docs/trend-monitors.md');
  return { kind: 'peer-programs', signalsCreated: 0, notificationsSent: 0 };
}

export async function runTechSignalsMonitor(): Promise<MonitorOutcome> {
  logger.log('tech-signals monitor: inert — no tech-news feed; see docs/trend-monitors.md');
  return { kind: 'tech-signals', signalsCreated: 0, notificationsSent: 0 };
}

export async function runPatentsMonitor(): Promise<MonitorOutcome> {
  logger.log('patents monitor: inert — no patent API; see docs/trend-monitors.md');
  return { kind: 'patents', signalsCreated: 0, notificationsSent: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
// Notification fan-out. Shared by every monitor + the /trends/:id
// admin "notify subscribers" action. Reads SignalSubscription and
// writes Notification rows, idempotent by the (user, signal) pair.
// ──────────────────────────────────────────────────────────────────────────

export async function fanoutSignalToSubscribers(signalId: string): Promise<number> {
  const signal = await prisma.trendSignal.findUnique({ where: { id: signalId } });
  if (!signal) return 0;

  const subs = await prisma.signalSubscription.findMany({
    where: {
      isActive: true,
      minImpactScore: { lte: signal.impactScore },
      OR: [
        { filterType: 'signal_type', filterValue: signal.signalType },
        { filterType: 'program', filterValue: { in: signal.affectedProgramIds } },
        { filterType: 'skill', filterValue: { in: signal.affectedSkillIds } },
        // Sector + freetext matching lives in the TrendSignal.tags
        // column we haven't added yet. For now, title substring.
      ],
    },
  });

  let sent = 0;
  for (const sub of subs) {
    const already = await prisma.notification.findFirst({
      where: {
        userId: sub.userId,
        entityType: 'trend_signal',
        entityId: signal.id,
      },
    });
    if (already) continue;
    const severity =
      signal.impactScore >= 0.7 ? 'high' : signal.impactScore >= 0.4 ? 'medium' : 'low';
    await prisma.notification.create({
      data: {
        userId: sub.userId,
        kind: 'trend_signal',
        title: signal.title,
        bodyEn: signal.summaryEn ?? undefined,
        bodyTh: signal.summaryTh ?? undefined,
        entityType: 'trend_signal',
        entityId: signal.id,
        severity,
      },
    });
    sent++;
  }
  return sent;
}

// Convenience for tests + admin "trigger fan-out" button.
export async function createSignal(input: {
  signalType: 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';
  title: string;
  summaryTh?: string;
  summaryEn?: string;
  sourceUrl?: string;
  impactScore: number;
  affectedProgramIds?: string[];
  affectedSkillIds?: string[];
  aiInferenceId?: string;
}): Promise<{ id: string; notificationsSent: number }> {
  const created = await prisma.trendSignal.create({
    data: {
      signalType: input.signalType,
      title: input.title,
      summaryTh: input.summaryTh ?? null,
      summaryEn: input.summaryEn ?? null,
      sourceUrl: input.sourceUrl ?? null,
      detectedDate: new Date(),
      impactScore: input.impactScore,
      affectedProgramIds: input.affectedProgramIds ?? [],
      affectedSkillIds: input.affectedSkillIds ?? [],
      aiInferenceId: input.aiInferenceId ?? null,
    } satisfies Prisma.TrendSignalUncheckedCreateInput,
  });
  const notificationsSent = await fanoutSignalToSubscribers(created.id);
  return { id: created.id, notificationsSent };
}

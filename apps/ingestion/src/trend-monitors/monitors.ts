import { Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';

// Six continuous trend monitors. Each produces zero-or-more
// TrendSignal rows and fans them out as Notifications to matching
// subscribers. Sources are MOCKED today (connectors in prompt 03
// return sample data); prompt 14 replaces the bodies with real API
// calls.

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
// Monitor implementations
//
// v1 SCAFFOLD: each monitor creates at most 1 synthetic signal per run
// representing "I ran and found nothing new" — the seeded 29 signals
// carry the feed. Prompt 14 replaces fetch bodies with real API/scrape
// calls and real AI analysis (ANALYZE_POLICY_DOC is the obvious first
// flip for MonitorPolicyDocs — pipe new PDFs through the existing
// ai-jobs queue).
// ──────────────────────────────────────────────────────────────────────────

export async function runPolicyMonitor(): Promise<MonitorOutcome> {
  logger.log('policy monitor: scanning MHESI / NESDC / NXPO / BOI / EECO (mocked)');
  // Real: enqueue ANALYZE_POLICY_DOC for every PdfDocument with
  // sourceCategory=POLICY + processingStatus=COMPLETED that doesn't
  // yet have a TrendSignal linked. That AI path produces a real
  // summary + impact score + affectedProgramIds.
  return { kind: 'policy', signalsCreated: 0, notificationsSent: 0 };
}

export async function runJobMarketMonitor(): Promise<MonitorOutcome> {
  logger.log('job-market monitor: scanning JobThai + JobsDB (mocked)');
  // Real: diff last N days of JobPosting rows against prior windows.
  // Detect anomalies → TrendSignal(signalType='MARKET').
  return { kind: 'job-market', signalsCreated: 0, notificationsSent: 0 };
}

export async function runResearchMonitor(): Promise<MonitorOutcome> {
  logger.log('research monitor: scanning OpenAlex + Scopus (mocked)');
  return { kind: 'research', signalsCreated: 0, notificationsSent: 0 };
}

export async function runPeerProgramsMonitor(): Promise<MonitorOutcome> {
  logger.log('peer-programs monitor: scanning peer catalogues (mocked)');
  return { kind: 'peer-programs', signalsCreated: 0, notificationsSent: 0 };
}

export async function runTechSignalsMonitor(): Promise<MonitorOutcome> {
  logger.log('tech-signals monitor: scanning vendor announcements (mocked)');
  return { kind: 'tech-signals', signalsCreated: 0, notificationsSent: 0 };
}

export async function runPatentsMonitor(): Promise<MonitorOutcome> {
  logger.log('patents monitor: scanning S-curve patent activity (mocked)');
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

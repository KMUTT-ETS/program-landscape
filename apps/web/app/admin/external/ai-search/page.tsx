import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Button, Card } from '@kku/ui';
import { ArrowLeft, Globe2, RadioTower } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI search & synthesis — Admin' };

// ─────────────────────────────────────────────────────────────────────────
// AI search & synthesis — Phase 5 placeholder.
//
// URL reserved at IA-restructure time (Phase 1, 2026-05-12). The full
// implementation lands in Phase 5 — the biggest piece of the admin-
// console redesign — with:
//   - Source catalog: WEF, IMD, BOI, World Bank, Google News, etc.
//   - Two source kinds:
//       1. URL list  — pre-configured RSS / report URLs per source
//       2. Web search — queries via Google Custom Search / Bing /
//                       Brave seeded by KKU-relevant keywords
//   - Cron schedule per source + manual re-sync + active/inactive
//     toggle (inactive sources still keep their history visible)
//   - LLM summarisation pipeline — every fetched item gets distilled
//     into a TrendSignal row (existing table — already AI-consumed
//     downstream by the analyst, deep-dive, cockpit briefs).
//
// Until Phase 5: trend signals come from the existing 6 seeded
// connectors (policy / research / market / tech / news monitors). This
// page just sets expectations and reserves the URL.
// ─────────────────────────────────────────────────────────────────────────

export default async function AdminAiSearchPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  return (
    <AuthedAppShell user={user}>
      <div className="flex flex-col gap-6">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Admin
              </Link>
            </Button>
            <span className="text-xs uppercase tracking-wide text-text-tertiary">
              External data · AI search & synthesis
            </span>
          </div>
          <Badge tone="info">Phase 5</Badge>
        </div>

        <header className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
            <Globe2 className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight">
              AI search & synthesis
            </h1>
            <p className="mt-1 max-w-[640px] text-sm text-text-secondary">
              External intelligence feeds (WEF, IMD, BOI, World Bank, Google News, etc.) — AI-summarised into the existing <code>trend_signals</code> table. URL reserved at IA-restructure time; full implementation lands in Phase 5.
            </p>
          </div>
        </header>

        <Card>
          <h2 className="text-sm font-semibold">What lands in Phase 5</h2>
          <ul className="mt-3 ml-5 list-disc text-sm text-text-secondary [&>li]:mt-1">
            <li>
              <strong>Source catalog.</strong> WEF, IMD, BOI, World Bank, Google News, OECD, UNESCO, ASEAN HE statistics, etc. Each source has a row carrying name, kind, cadence, status, and last-fetch metadata.
            </li>
            <li>
              <strong>Two source kinds.</strong>{' '}
              <em>URL list</em> — pre-configured RSS or report-index URLs per source (WEF Global Risks Report, IMD World Competitiveness, etc.).{' '}
              <em>Web search</em> — Google Custom Search / Bing / Brave queries seeded by KKU-relevant keywords (Google News falls here).
            </li>
            <li>
              <strong>Cron + manual + active/inactive.</strong> Per-source schedule (matches the DB/API connectors UX). Manual re-sync button. Inactive sources keep their history visible but stop fetching.
            </li>
            <li>
              <strong>LLM summarisation.</strong> Every fetched item is distilled into a <code>TrendSignal</code> row (existing table — already AI-consumed downstream by the analyst, deep-dive trend cards, cockpit briefs). Methodology version stamped on each summary for audit.
            </li>
          </ul>
        </Card>

        <Card tone="quiet">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                For now: existing trend monitors
              </h3>
              <p className="mt-1 text-xs text-text-tertiary">
                The 6 seeded trend-signal monitors (policy / research / market / tech / news / patents) still run; they're configured under DB/API connectors. Phase 5 supplements them — it doesn't replace them.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/data-sources">
                <RadioTower className="h-3.5 w-3.5" aria-hidden />
                Open connectors
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </AuthedAppShell>
  );
}

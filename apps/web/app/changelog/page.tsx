import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: "What's new" };

// ─────────────────────────────────────────────────────────────────────────
// User-facing changelog. Kept as static content in code — the source of
// truth is git log, but readers shouldn't need git to know what changed.
// When you ship a feature visible to Councils / executives / analysts,
// add an entry here.
//
// Entries are ordered newest-first.
// ─────────────────────────────────────────────────────────────────────────

interface ChangelogEntry {
  date: string;
  version: string;
  title: string;
  audience: ('Council' | 'Executive' | 'Analyst' | 'Admin')[];
  bullets: string[];
}

const ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-04-24',
    version: 'v0.13.0 · Hardening',
    title: 'Security, observability, AI governance',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'Security headers (CSP / HSTS / Secure cookies) enforced end-to-end.',
      'Rate limiting on AI endpoints + per-user daily USD budget.',
      'Model fallback: primary → secondary on transient errors (Gemini ↔ Claude).',
      'AI output guardrails: citizen IDs, phone numbers, personal emails redacted from responses.',
      'New pages: /admin/system-status · /admin/data-quality · /admin/ai-cost.',
      'Structured logging (pino) across api + ingestion.',
      'Backup + disaster-recovery drill documented; pre-deploy Postgres snapshots on every migration.',
      'AI evaluation suite (25 gold questions; expanding to 50 for launch).',
      'PDPA posture + DSAR workflow documented.',
    ],
  },
  {
    date: '2026-04-24',
    version: 'v0.12.1 · Program management (bonus)',
    title: 'Admin CRUD + create-from-PDF wizard + Gemini extractor',
    audience: ['Admin', 'Analyst', 'Executive'],
    bullets: [
      'Full admin page: /admin/programs — list, create, edit, attach/detach PDFs.',
      'New-from-PDF wizard reads มคอ.2 with Gemini 3 Flash Preview — restores Thai tone marks even when pdfjs drops them.',
      'Duplicate-program detection (hard code match + soft name/degree match).',
      'Thai filename UTF-8 fix + one-click backfill for pre-fix rows.',
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.12.0 · Decision Workspace',
    title: 'Council decisions — full lifecycle + outcome review',
    audience: ['Council', 'Executive', 'Analyst'],
    bullets: [
      'PROPOSED → COUNCIL_REVIEWED → APPROVED → IN_IMPLEMENTATION → COMPLETED lifecycle.',
      'Snapshot of portfolio state captured at Council review — immutable.',
      'Automatic outcome-review horizons at 6mo / 1yr / 3yr — compare actual vs projected.',
      '3 new Council Pack PDF templates: quarterly review, annual strategic review, faculty-level review.',
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.11.0 · AI Analyst',
    title: 'Tool-use conversational agent',
    audience: ['Council', 'Executive', 'Analyst'],
    bullets: [
      '12 tools wrapping modules 5-10 compute helpers.',
      '7 pre-built Council briefs (state-of-portfolio, programs-at-risk, demographic-stress, etc.).',
      'Rule-based safety gate refuses personal info / salary asks / decision commitments / prompt injection.',
      'Bilingual — mirrors the user\'s language (Thai or English).',
    ],
  },
  {
    date: '2026-04-23',
    version: 'v0.10.0 · Benchmarking',
    title: 'Peer comparison + white-space detection',
    audience: ['Executive', 'Analyst'],
    bullets: [
      '3 seeded peer sets: Thai Top-10, ASEAN Top-20, Global Subject Leaders.',
      'White-space detection: skills peers teach we don\'t.',
      'Distinctiveness score per KKU program.',
    ],
  },
];

export default async function ChangelogPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="What's new"
        subtitle="Feature additions and fixes visible to users. Tagged by audience — filter mentally by whether it's relevant to your role."
      />
      <div className="flex flex-col gap-4">
        {ENTRIES.map((entry) => (
          <Card key={entry.version}>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-text-tertiary">
                    {entry.date}
                  </div>
                  <h3 className="text-lg font-semibold">{entry.title}</h3>
                  <div className="text-xs text-text-secondary">{entry.version}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {entry.audience.map((a) => (
                    <span
                      key={a}
                      className="rounded-sm border border-border-subtle bg-surface-1 px-1.5 py-0.5 text-xs text-text-secondary"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {entry.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>
    </AuthedAppShell>
  );
}

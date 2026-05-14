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
    date: '2026-05-14',
    version: 'v1.1.5 · Multi-scope sessions + UI polish',
    title: 'Multi-scope respect across every module; BCG tooltip + radar layout',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Multi-scope session model — a user whose primary role is PROGRAM_USER but who holds a UserScope grant of UNIVERSITY_USER (or FACULTY_USER) is now treated at the elevated tier in every module. The JWT carries the highest-rank grant; the DB row keeps the original assignment as audit. Applies to risks, cockpit, executive landscape, /programs directory, education + staff dashboards, and the admin gates. Multi-scope SSO users who are auto-assigned to N programs see one of those programs in single-scope views (cockpit, executive landscape, /programs) and the union across all of them in risks.',
      'Strategic Matrix (BCG) on Executive Landscape — hover now shows a floating tooltip card next to the cursor with axis values, size, and contribution. Edge-aware: flips left/up near the right/bottom edges.',
      'Likelihood-drivers radar on /risks/[id] — compact L1/L2/L3 axis markers replace the longer labels that overlapped the right-side KPI cards.',
      'Risk Management drivers chart\'s automation-risk panel now shows only skills taught by programs in scope (was the global skill taxonomy regardless of scope). Indicator histograms + severity counts clamp consistently with the breach list.',
      'Top-bar scope dropdown removed — scope is now entirely role-driven from the session, so the dropdown wasn\'t the source of truth for any module\'s data fetch. The command-palette search trigger now fills the row.',
    ],
  },
  {
    date: '2026-05-13',
    version: 'v1.1.3 · Pipeline reliability',
    title: 'Run-pipeline button works end-to-end on production',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'Worker-spawned CLI scripts (programs-pipeline + 5 phase children) now ship as self-contained esbuild bundles — phases 2 / 4 / 8 run cleanly under the prod node runtime.',
      'Pipeline child-process logs persist on the host and stream live in /admin/programs/[id]?tab=pipeline.',
      'Deep-dive sections (TCAS3 scores, Cohort distribution, Demand funnel) now resolve real-data provenance correctly — silent-empty UI bug fixed.',
      'Pedagogy assessment accepts domain-standard acronyms (PBL, OSCE, EBM, Lab) — fixes ~75% of medical / dental / science programs that previously failed pedagogy extraction.',
      'Container UID drift + read-only filesystem mount issues resolved.',
    ],
  },
  {
    date: '2026-05-13',
    version: 'v1.1.2 · Auto-approve queue + extractor capacity',
    title: 'Extraction review backlog cleared; PROGRAM_DIGEST + IMD materialise on write',
    audience: ['Admin', 'Analyst'],
    bullets: [
      'PROGRAM_DIGEST + IMD_RANKINGS auto-approve + materialise the moment they are extracted — no more pending-review backlog.',
      'PROPOSED_SKILL + PROGRAM_FACULTY_LIST extractions auto-approve at write time too (taxonomy growth path).',
      'AI extractor maxOutputTokens raised 12k → 50k on heavy per-program calls — avoids mid-response truncation on Pro models.',
      'Job queue UI surfaces handler-reported FAILED verdict + per-program target chip + live activity feed.',
      'Programs directory: Faculty filter excludes BUs with no canonical programs.',
    ],
  },
  {
    date: '2026-05-10',
    version: 'v1.1.0 · Streaming Analyst + per-user profile',
    title: 'AI Analyst streams responses · /profile page · live publications',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'AI Analyst streams responses token-by-token with status events ("calling tool …", "synthesising …"). Conversation history can be deleted per-user.',
      'New /profile page — per-user academic resume: education, publications, KKU role linkage, AI expertise narrative (bilingual TH + EN).',
      'Avatar upload + crop (MinIO-backed); appears in top-bar dropdown + profile hero.',
      'APA 7 citation rendering with owner surname bolded; 20-per-page pagination.',
      'Live Scopus publication pathway for /profile (cold load 45s → 5s; 1998–2025 coverage; full author lists).',
      'Universal home-page KPIs cached for <100ms first paint.',
      '/education + /staff dashboards opened to FACULTY_USER role.',
      'Programs directory adds curriculum-year (BE) + language filters.',
      'KKU logo replaces placeholder monogram in sidebar + browser favicon.',
    ],
  },
  {
    date: '2026-05-07',
    version: 'v1.0.x · Internal research warehouse',
    title: 'kkuscholar publications mirror replaces public APIs',
    audience: ['Analyst', 'Admin'],
    bullets: [
      'Research connector pivoted from OpenAlex + Scopus public APIs to KKU Library\'s internal publications warehouse (kkuscholar).',
      'Coverage: Scopus 29.9k + PubMed 29.5k = 59.4k unique (paper × KKU author) pairs spanning 1948–2026.',
      'FacultyMember rows backfilled from kkuscholar.people (1,375 new researchers across 36 faculties).',
      'Match rate 57% → 99.6% — virtually every KKU-authored paper now links to a person + faculty.',
      'On-network connector run finishes in ~5 minutes end-to-end.',
    ],
  },
  {
    date: '2026-05-01',
    version: 'v1.0.x · Curriculum digestion + skill demand',
    title: '297 programs seeded · KMITL labour-market signal live',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Full KKU master curriculum sheet loaded — 297 programs (101 BSc · 111 MSc · 68 PhD · 17 Higher Grad Dip).',
      '228 programs digested by Gemini against the source มคอ.2 PDF — degree details, course list, learning outcomes, skill extraction, Thai recruitment summary.',
      'KMITL Skill Mapping connector live — 2,841 skills × 401 careers from LinkedIn (Thailand + Global, profiles + job postings; data owned by LinkedIn, subscribed by MHESI, API hosted by KMITL).',
      'Health score "demand" dimension now factors a labour-market-alignment driver (formerly null).',
      'Gap Analyzer supply ↔ demand chart switches automatically to KMITL data when available.',
    ],
  },
  {
    date: '2026-04-28',
    version: 'v0.14.x · KKU institutional data live',
    title: 'HR · Finance · Registry · Research connectors flipped real',
    audience: ['Council', 'Executive', 'Analyst'],
    bullets: [
      'KKU Registry (Oracle) — student enrollment, demographics, cohort distribution, TCAS round 3 funnel.',
      'KKU HR (SQL Server) — faculty member registry, rank, compensation aggregates (PDPA-suppressed at source).',
      'KKU Finance (Oracle + SQL Server) — tuition revenue + per-faculty / per-fund budget allocations.',
      'OpenAlex research output v1 — 35.7k papers, 1,045 ID-enriched FacultyMember rows.',
      'Every row carries IngestionRun provenance; per-source monitoring at /admin/data-sources/[slug].',
      'mytcas.com TCAS62–TCAS68 maxmin xlsx connector — 26.5k admission rows + funnel rollups across 7 cohorts.',
    ],
  },
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

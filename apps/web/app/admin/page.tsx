import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, EdgeGlow, Stat } from '@kku/ui';
import {
  Activity,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  GitBranch,
  Globe2,
  Layers,
  Settings2,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Admin console — the operational front door for KKU Curriculum Landscape.
//
// IA restructured 2026-05-12 to three nouns matching the operator's
// mental model: Programs / External data / Application. Each group
// carries tile cards with live state badges. Phase-gated tiles
// (Phase 3-5) ship as visible placeholders with a "Phase N" badge so
// the URL surface is reserved and expectations are set.
//
// Phase plan tracked in commit history (search 'admin IA Phase').
//   Phase 1 (this commit): 3-group landing + 3 placeholder pages
//   Phase 2: Programs admin — batch actions, dup-check, status edit
//   Phase 3: AI settings — per-task model picker + cost
//   Phase 4: PDF library — non-curriculum PDF lifecycle
//   Phase 5: External AI search & synthesis (trend_signals feed)
//   Phase 6: Job queue realtime status enhancements
//
// Reference look: Linear's settings overview + Stripe Dashboard's
// "Today" page. Dense without feeling busy. Every tile has an obvious
// affordance (chevron + hover lift). Subtle gradient glow on the hero
// icon + accent edge on the primary CTA.
// ─────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin console' };

// Console viewer-roles. Post legacy-removal there's no separate
// ANALYST role — admin-grade is the read+write surface, super-grade is
// admin-grade plus queue management.
const ADMIN_GRADE: ReadonlyArray<SessionUser['role']> = ['SUPER_ADMIN', 'SYSTEM_ADMIN'];
const SUPER_GRADE: ReadonlyArray<SessionUser['role']> = ['SUPER_ADMIN'];

interface DataSetupStats {
  programs: { total: number; withCurriculumPdf: number; missingCurriculumPdf: number };
  curriculumDocs: { total: number };
  externalDocs: { total: number };
  facultyStaff: { total: number; active: number };
  dataFeeds: { total: number; live: number; mocked: number };
  researchOutputs: { total: number };
}

interface SystemStatus {
  generatedAt: string;
  ai24h: {
    calls: number;
    costUsd: number;
    avgConfidence: number | null;
  };
  pendingExtractions: number;
  ingestionRuns7d: Array<{ status: string; count: number }>;
  dataFreshness: Array<{ metric: string; stale: boolean }>;
}

export default async function AdminConsolePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.role)) redirect('/no-access');

  // Pull live numbers in parallel; degrade gracefully if either endpoint
  // is reachable. The console renders fine without them — the badges
  // just disappear and the stat strip falls back to "—".
  const [dataStats, sysStatus] = await Promise.all([
    apiFetch<DataSetupStats>('/admin/data-setup/stats').catch(() => null),
    apiFetch<SystemStatus>('/admin/system-status').catch(() => null),
  ]);

  const heroStats = buildHeroStats(dataStats, sysStatus);
  const groups = buildGroups({ dataStats, sysStatus, role: user.role });

  return (
    <AuthedAppShell user={user}>
      <div className="flex flex-col gap-8">
        <Hero greetingFor={user} stats={heroStats} />

        {groups.map((g) =>
          g.tiles.length === 0 ? null : <CommandBay key={g.label} group={g} />,
        )}
      </div>
    </AuthedAppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────────

// Common Thai + English titles to strip before greeting. Many KKU SSO
// profiles arrive with a leading "นาย" / "นาง" / "ดร." prefix; using
// `name.split(' ')[0]` blindly produces "Welcome back, นาย" instead of
// the person's actual given name.
const TITLE_PREFIXES = new Set([
  // Thai
  'นาย',
  'นาง',
  'นางสาว',
  'น.ส.',
  'น.ส',
  'ดร.',
  'ดร',
  'ผศ.',
  'ผศ',
  'ผศ.ดร.',
  'ผศ.ดร',
  'รศ.',
  'รศ',
  'รศ.ดร.',
  'รศ.ดร',
  'ศ.',
  'ศ',
  'ศ.ดร.',
  'ศ.ดร',
  'อ.',
  'อ',
  // English
  'Mr.',
  'Mr',
  'Mrs.',
  'Mrs',
  'Ms.',
  'Ms',
  'Miss',
  'Dr.',
  'Dr',
  'Prof.',
  'Prof',
  'Asst.',
  'Assoc.',
]);

function stripTitles(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TITLE_PREFIXES.has(tokens[0]!)) {
    tokens.shift();
  }
  return tokens.join(' ');
}

function greetingNameFor(user: SessionUser): string {
  const stripped = stripTitles(user.name ?? '');
  if (stripped) return stripped;
  // Fallback: email local part (e.g. "denpong" from "denpong@kku.ac.th").
  return user.email.split('@')[0]!;
}

function Hero({
  greetingFor,
  stats,
}: {
  greetingFor: SessionUser;
  stats: HeroStat[];
}) {
  const greeting = greetingNameFor(greetingFor);
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border-subtle bg-surface-1">
      {/* Layered gradient + warm bloom — same recipe as the signin pane,
          dialled down so the hero doesn't drown the content below. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-90"
        style={{
          background:
            'linear-gradient(135deg, oklch(var(--color-surface-1)) 0%, oklch(var(--color-surface-1)) 55%, oklch(var(--color-accent-default) / 0.08) 100%)',
        }}
      />
      <div
        aria-hidden
        className="absolute -top-32 -right-24 h-[420px] w-[420px] rounded-full blur-[120px] opacity-25"
        style={{ background: 'oklch(var(--color-accent-default))' }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-24 h-[360px] w-[360px] rounded-full blur-[120px] opacity-15"
        style={{ background: 'oklch(var(--color-brand-cardinal))' }}
      />
      {/* Faint dot grid for texture, kept low so it reads as paper, not noise */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, oklch(var(--color-text-primary)) 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative z-10 px-7 py-8 sm:px-9 sm:py-10">
        {/* Top row: brand mark + breadcrumb-style eyebrow + role chip */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0">
              <div
                aria-hidden
                className="absolute inset-0 rounded-2xl blur-md opacity-50"
                style={{ background: 'oklch(var(--color-accent-default))' }}
              />
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-default/30 bg-accent-default/10 text-accent-default">
                <Wrench className="h-6 w-6" aria-hidden />
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
                <span>Admin</span>
                <span aria-hidden className="opacity-40">
                  /
                </span>
                <span className="text-text-secondary">Console</span>
              </div>
              <h1 className="mt-1 text-[26px] font-medium tracking-tight text-text-primary sm:text-[30px]">
                Welcome back, {greeting}
              </h1>
              <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-text-secondary">
                Operational tools for keeping the curriculum-landscape data
                fresh, accurate, and trustworthy. Tile visibility tracks
                your role's permissions.
              </p>
            </div>
          </div>
          <RoleChip role={greetingFor.role} />
        </div>

        {/* Stat strip */}
        {stats.length > 0 && (
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <Card
                key={s.label}
                padding="sm"
                elevation="sm"
                className="bg-surface-0/70 backdrop-blur-sm"
              >
                <Stat label={s.label} value={s.value} hint={s.hint} icon={s.icon} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RoleChip({ role }: { role: SessionUser['role'] }) {
  const tone =
    role === 'SUPER_ADMIN'
      ? 'danger'
      : role === 'SYSTEM_ADMIN'
        ? 'warning'
        : 'info';
  const label =
    role === 'SUPER_ADMIN'
      ? 'Super admin'
      : role === 'SYSTEM_ADMIN'
        ? 'System admin'
        : role === 'UNIVERSITY_USER'
          ? 'University user'
          : role === 'FACULTY_USER'
            ? 'Faculty user'
            : 'Program user';
  return (
    <Badge tone={tone} className="hidden items-center gap-1 sm:inline-flex">
      <ShieldCheck className="h-3 w-3" aria-hidden />
      {label}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Command bay — section with grouped tiles
// ─────────────────────────────────────────────────────────────────────────

function CommandBay({ group }: { group: ConsoleGroup }) {
  return (
    <section>
      <header className="mb-3 flex items-baseline justify-between gap-3 border-b border-border-subtle pb-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            {group.eyebrow}
          </div>
          <h2 className="mt-0.5 text-[16px] font-medium tracking-tight text-text-primary">
            {group.label}
          </h2>
        </div>
        <p className="hidden max-w-[420px] text-[12px] leading-relaxed text-text-tertiary md:block">
          {group.caption}
        </p>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {group.tiles.map((t) => (
          <Tile key={t.href} tile={t} />
        ))}
      </div>
    </section>
  );
}

function Tile({ tile }: { tile: ConsoleTile }) {
  return (
    <Link href={tile.href} className="group block">
      <Card
        padding="md"
        elevation="sm"
        className="relative h-full overflow-hidden transition-all hover:border-border-strong hover:shadow-elevation-3"
      >
        {/* Subtle gradient sweep on hover */}
        <div
          aria-hidden
          className="absolute inset-0 -z-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(135deg, transparent 0%, transparent 60%, oklch(var(--color-accent-default) / 0.06) 100%)',
          }}
        />

        <div className="relative flex items-start gap-3">
          {/* Icon halo — gradient ring + tinted fill */}
          <div className="relative flex-shrink-0">
            <div
              aria-hidden
              className="absolute -inset-px rounded-xl opacity-0 blur-sm transition-opacity duration-200 group-hover:opacity-60"
              style={{ background: 'oklch(var(--color-accent-default) / 0.6)' }}
            />
            <div
              className={[
                'relative flex h-10 w-10 items-center justify-center rounded-xl border',
                tile.tone === 'super'
                  ? 'border-danger/25 bg-danger/8 text-danger'
                  : tile.tone === 'warn'
                    ? 'border-warning-default/30 bg-warning-default/10 text-warning-default'
                    : 'border-border-default bg-surface-2 text-text-secondary',
                'transition-all group-hover:scale-[1.02] group-hover:border-accent-default/40',
              ].join(' ')}
            >
              {tile.icon}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-medium text-text-primary">
                {tile.label}
              </div>
              {tile.badge && (
                <Badge
                  tone={tile.badge.tone ?? 'neutral'}
                                    className="tabular-nums"
                >
                  {tile.badge.label}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-[12px] leading-relaxed text-text-tertiary line-clamp-3">
              {tile.description}
            </div>
            {tile.meta && (
              <div className="mt-2 text-[11px] text-text-tertiary/80">
                {tile.meta}
              </div>
            )}
          </div>

          <ArrowUpRight
            className="absolute right-3 top-3 h-3.5 w-3.5 text-text-tertiary opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-accent-default"
            aria-hidden
          />
        </div>
      </Card>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stat + group composition
// ─────────────────────────────────────────────────────────────────────────

interface HeroStat {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
}

interface ConsoleTile {
  href: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  meta?: string;
  badge?: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' };
  tone?: 'default' | 'super' | 'warn';
  roles?: ReadonlyArray<SessionUser['role']>;
}

interface ConsoleGroup {
  eyebrow: string;
  label: string;
  caption: string;
  tiles: ConsoleTile[];
}

function buildHeroStats(
  data: DataSetupStats | null,
  sys: SystemStatus | null,
): HeroStat[] {
  const stats: HeroStat[] = [];
  if (data) {
    stats.push({
      label: 'KKU programs',
      value: data.programs.total.toLocaleString(),
      hint: `${data.programs.withCurriculumPdf} with curriculum PDF`,
      icon: <Building2 className="h-3.5 w-3.5" />,
    });
    stats.push({
      label: 'Live data feeds',
      value: `${data.dataFeeds.live} / ${data.dataFeeds.total}`,
      hint: `${data.dataFeeds.mocked} still mocked`,
      icon: <Database className="h-3.5 w-3.5" />,
    });
  }
  if (sys) {
    stats.push({
      label: 'Pending review',
      value: sys.pendingExtractions.toLocaleString(),
      hint: 'AI extractions awaiting approval',
      icon: <ClipboardCheck className="h-3.5 w-3.5" />,
    });
    stats.push({
      label: 'AI spend · 24h',
      value: `$ ${sys.ai24h.costUsd.toFixed(2)}`,
      hint: `${sys.ai24h.calls.toLocaleString()} calls`,
      icon: <CircleDollarSign className="h-3.5 w-3.5" />,
    });
  }
  // If both endpoints failed, fall back to a single placeholder card.
  if (stats.length === 0) {
    stats.push({
      label: 'Stats',
      value: '—',
      hint: 'Live numbers unavailable; admin tools below still work.',
    });
  }
  return stats;
}

function buildGroups({
  dataStats,
  sysStatus,
  role,
}: {
  dataStats: DataSetupStats | null;
  sysStatus: SystemStatus | null;
  role: SessionUser['role'];
}): ConsoleGroup[] {
  // ── 1) Programs ────────────────────────────────────────────────────
  // Curriculum-centric ops collapse to one tile — the program list.
  // The list page owns the "Add new program" affordance (Phase 2)
  // instead of a separate tile, and the AI-extraction review queue
  // folds into Job queues under Application (Phase 6).
  const programs: ConsoleTile[] = [
    {
      href: '/admin/programs',
      label: 'Program list',
      description:
        'Full table of the 297 KKU programs — filter by metadata, edit status / faculty / level, run pipeline (per-row or batch), add new program via PDF upload.',
      icon: <Building2 className="h-5 w-5" />,
      badge: dataStats
        ? { label: dataStats.programs.total.toLocaleString(), tone: 'neutral' }
        : undefined,
      meta: dataStats
        ? `${dataStats.programs.missingCurriculumPdf} missing curriculum`
        : undefined,
    },
  ];

  // ── 2) External data ──────────────────────────────────────────────
  // Sources outside KKU's own systems. Connectors handle structured
  // data (DBs + APIs). AI search & synthesis handles unstructured
  // intelligence feeds. PDF library handles non-curriculum docs.
  const external: ConsoleTile[] = [
    {
      href: '/admin/data-sources',
      label: 'DB / API connectors',
      description:
        'Structured-data sources — KKU Registrar, KKU HR, KKU Finance, KMITL skill mapping. Manage cron schedules and fire manual re-syncs.',
      icon: <Database className="h-5 w-5" />,
      badge: dataStats
        ? {
            label: `${dataStats.dataFeeds.live} live`,
            tone: dataStats.dataFeeds.live > 0 ? 'success' : 'neutral',
          }
        : undefined,
      meta: dataStats ? `${dataStats.dataFeeds.mocked} still mocked` : undefined,
    },
    {
      href: '/admin/external/ai-search',
      label: 'AI search & synthesis',
      description:
        'External intelligence feeds — WEF, IMD, BOI, World Bank, Google News. URL-list + web-search sources, AI-summarised into trend_signals.',
      icon: <Globe2 className="h-5 w-5" />,
      badge: { label: 'Phase 5', tone: 'info' },
    },
    {
      href: '/admin/pdf-review',
      label: 'PDF library',
      description:
        'Non-curriculum PDFs — Thai government / MHESI / KKU / faculty policy documents and reports. Re-extract, archive, deprecate, delete.',
      icon: <FileSearch className="h-5 w-5" />,
    },
    {
      href: '/admin/registry-mapping',
      label: 'Registry mapping',
      description:
        'Resolve unmatched registrar tuples to canonical Program rows — analyst-driven crosswalk for the kku-registry connector.',
      icon: <GitBranch className="h-5 w-5" />,
    },
    {
      href: '/admin/data-quality',
      label: 'Data quality',
      description:
        'Completeness + year-on-year drift detection across enrollment, financials, outcome series. Surfaces when an external feed turns flaky.',
      icon: <ClipboardCheck className="h-5 w-5" />,
      badge: sysStatus
        ? (() => {
            const stale = sysStatus.dataFreshness.filter((f) => f.stale).length;
            return stale > 0
              ? { label: `${stale} stale`, tone: 'warning' as const }
              : { label: 'fresh', tone: 'success' as const };
          })()
        : undefined,
    },
  ];

  // ── 3) Application ────────────────────────────────────────────────
  // Operational + observability surfaces. Most tiles SYSTEM_ADMIN+;
  // AI settings is super-admin-only because it controls per-task
  // model overrides + cost dashboards.
  const application: ConsoleTile[] = [
    {
      href: '/admin/users',
      label: 'Users & access',
      description:
        'Pre-provision KKU staff, assign roles, and bind faculty scope to user accounts.',
      icon: <Users className="h-5 w-5" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/app/ai-settings',
      label: 'AI settings',
      description:
        'Per-task model picker + cost dashboard. Override the default model for any methodVersion, view spend per user / module / 7-30 days.',
      icon: <Settings2 className="h-5 w-5" />,
      roles: SUPER_GRADE,
      tone: 'super',
      badge: { label: 'Phase 3', tone: 'info' },
      meta: sysStatus
        ? `Today $ ${sysStatus.ai24h.costUsd.toFixed(2)} · ${sysStatus.ai24h.calls} calls`
        : undefined,
    },
    {
      href: '/admin/queues',
      label: 'Job queues',
      description:
        'Live BullMQ state with realtime tiles + recent-activity stream + per-queue throughput. Human-review queues (AI + PDF extractions awaiting sign-off) surface inline; pause, resume, retry, clean from the same page.',
      icon: <Layers className="h-5 w-5" />,
      roles: ADMIN_GRADE,
      // Two signals folded into this tile: BullMQ run failures (system
      // health) + pending AI-extraction reviews (analyst-attention).
      // The badge gets the human-review count when there's something
      // to look at — it's the more frequently actionable signal.
      badge:
        sysStatus && sysStatus.pendingExtractions > 0
          ? {
              label: `${sysStatus.pendingExtractions} pending review`,
              tone: sysStatus.pendingExtractions > 50 ? 'warning' : 'info',
            }
          : undefined,
      tone: sysStatus && sysStatus.pendingExtractions > 50 ? 'warn' : 'default',
      meta: sysStatus
        ? (() => {
            const failed =
              sysStatus.ingestionRuns7d.find((r) => r.status === 'FAILED')?.count ?? 0;
            return failed > 0 ? `${failed} run failures · 7d` : 'no run failures · 7d';
          })()
        : undefined,
    },
    {
      href: '/admin/system-status',
      label: 'System status',
      description:
        'Database / Redis / MinIO / Gotenberg / AI provider health and dependency probes.',
      icon: <Activity className="h-5 w-5" />,
      roles: ADMIN_GRADE,
      badge: sysStatus
        ? (() => {
            const stale = sysStatus.dataFreshness.filter((f) => f.stale).length;
            return stale > 0
              ? { label: 'attention', tone: 'warning' as const }
              : { label: 'healthy', tone: 'success' as const };
          })()
        : undefined,
    },
    {
      href: '/admin/pdf-generation',
      label: 'PDF generation',
      description:
        'Every Council Pack, brief, and report routed through Gotenberg — generation history, durations, failures.',
      icon: <FileText className="h-5 w-5" />,
    },
  ];

  // Per-tile role gate: visibility tracks the viewer's permissions so a
  // SYSTEM_ADMIN doesn't see "AI settings" greyed out — it just disappears.
  const filterByRole = (t: ConsoleTile) =>
    t.roles ? t.roles.includes(role) : ADMIN_GRADE.includes(role);

  return [
    {
      eyebrow: 'Group 1',
      label: 'Programs',
      caption:
        'Curriculum-centric operations. The program list owns the table, the new-program wizard, and per-row / batch pipeline actions — one tile, one destination.',
      tiles: programs.filter(filterByRole),
    },
    {
      eyebrow: 'Group 2',
      label: 'External data',
      caption:
        'Sources outside KKU — connectors, AI-summarised intelligence feeds, non-curriculum PDFs, and data-quality monitoring.',
      tiles: external.filter(filterByRole),
    },
    {
      eyebrow: 'Group 3',
      label: 'Application',
      caption:
        'Operations + observability. AI settings is super-admin only; everything else is system-admin-and-up.',
      tiles: application.filter(filterByRole),
    },
  ];
}

// EdgeGlow is reserved for future "currently running" callouts on a
// running pipeline. Keep the import live so future callers don't have
// to reach for it.
void EdgeGlow;

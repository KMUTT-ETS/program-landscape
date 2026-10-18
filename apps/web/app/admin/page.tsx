import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminGrade, type ApiMeta, type ApiSuccess, type SessionUser } from '@kku/shared';
import { RAW_RETENTION_DAYS } from '@kku/db';
import { auth } from '@/lib/auth';
import { apiFetch, apiFetchEnvelope } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Badge, Card, EdgeGlow, FreshnessBadge, ProvenanceButton, Sparkline } from '@kku/ui';
import { HeroBanner, type HeroBannerStat } from '@/components/hero-banner';
import { DataSourceMark } from '@/components/data-source-mark';
import { mergeCaveats, pageCaveats, USAGE_FALLBACK_META } from '../usage/types';
import type { UsageSummaryT } from '../usage/types';
import {
  pickGreetingName,
  resolveUserChrome,
  timeOfDayGreeting,
} from '@/lib/display-name';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  Eye,
  FileSearch,
  FileText,
  FileUp,
  GitBranch,
  Globe2,
  GraduationCap,
  KeyRound,
  Layers,
  LogIn,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Share2,
  Users,
  Wrench,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────
// Admin console — the operational front door for KKU Program Landscape.
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
  dataFeeds: { total: number; live: number; mocked: number; deprecated: number };
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

// Trimmed shape of ExternalAiSourceRow — we only need status + the
// recent-signal count to surface a meaningful tile badge. See
// apps/api/src/admin/external-ai/external-ai.service.ts.
interface ExternalAiSourceLite {
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  recentSignalCount: number;
}

// ── Usage tiles ────────────────────────────────────────────────────────
//
// The hero's last three tiles answer "is anyone actually using this?" from
// the same endpoint /usage reads, on a fixed 7-day window.
//
// `excludeAdmins` is FALSE here, unlike /usage's default: this strip is the
// console's "is anyone in the building" glance, and the administrators
// reading it are part of the answer. On an install whose only readers so
// far are administrators (dev today) the /usage default would render every
// tile as 0 — a true answer to a question the console is not asking. The
// drawer says which accounts are counted; /usage keeps the leadership view
// with admins hidden. A failed fetch renders "—" and says so, never a 0.
const USAGE_DAYS = 7;
const USAGE_EXCLUDE_ADMINS = false;
const USAGE_QUERY = `/usage/summary?days=${USAGE_DAYS}&excludeAdmins=${USAGE_EXCLUDE_ADMINS}`;
// The api answers in well under a second; two seconds is the point past
// which an operator's console is being held up by a figure that is not why
// they came. Past it the tiles render their unavailable state.
const USAGE_TIMEOUT_MS = 2000;

/**
 * What the three usage tiles are built from.
 *
 * `summary` is null when the call failed or timed out — which the tiles
 * must render as "unavailable", never as zeros. `meta` is present either
 * way, because Council-readiness rule 1 is about the surface and not the
 * happy path: the render where a reader most wants to ask where a figure
 * came from is the one where it is missing.
 */
interface UsageHero {
  // `UsageSummaryT` already carries `medianDwellMs` — the committed mirror
  // folds in what UsageService.summary() adds, so no intersection is needed.
  summary: UsageSummaryT | null;
  meta: ApiMeta;
  excludeAdmins: boolean;
  /** When this page was built — /usage reports no freshnessDate, because
   *  every figure is computed at read time, so render time IS freshness. */
  computedAt: string;
}

export default async function AdminConsolePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (!isAdminGrade(user.effectiveRole ?? user.role)) redirect('/no-access');

  // Pull live numbers in parallel; degrade gracefully if either endpoint
  // is reachable. The console renders fine without them — the badges
  // just disappear and the stat strip falls back to "—".
  const [dataStats, sysStatus, externalAi, usageEnvelope, chrome] = await Promise.all([
    apiFetch<DataSetupStats>('/admin/data-setup/stats').catch(() => null),
    apiFetch<SystemStatus>('/admin/system-status').catch(() => null),
    // External-AI source list — used to surface "X feeds active" on the
    // AI search & synthesis tile. Gated on pdf:admin so only the admin
    // grades that already see this console can read it.
    apiFetch<ExternalAiSourceLite[]>('/admin/external-ai-sources').catch(
      () => null as ExternalAiSourceLite[] | null,
    ),
    // Usage summary — read through the ENVELOPE rather than apiFetch so the
    // tiles carry the api's own sources and caveats into the provenance
    // drawer. `apiFetchEnvelope` throws on an error envelope, so the catch
    // is the whole failure path and what it returns is the success arm of
    // the union — the same assertion /usage's server page makes.
    apiFetchEnvelope<UsageSummaryT>(USAGE_QUERY, {
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    })
      .then((e) => e as ApiSuccess<UsageSummaryT>)
      .catch(() => null),
    // Same name source as the home page — when the operator is on the
    // FacultyMember roster their rank-prefixed name comes through; SSO
    // honorifics (นาย / ดร. / Asst. Prof.) get stripped at fallback.
    resolveUserChrome(user.userId).catch(() => ({
      name: null,
      avatarUrl: null,
    })),
  ]);

  // The page's own caveats ride on top of the api's, with only the true
  // duplicates dropped — same merge /usage performs, and the same text, so
  // the two surfaces cannot end up describing the same figures differently.
  const usage: UsageHero = {
    summary: usageEnvelope?.data ?? null,
    meta: {
      ...(usageEnvelope?.meta ?? USAGE_FALLBACK_META),
      caveats: mergeCaveats(usageEnvelope?.meta.caveats ?? [], usageCaveats(USAGE_EXCLUDE_ADMINS)),
    },
    excludeAdmins: USAGE_EXCLUDE_ADMINS,
    computedAt: new Date().toISOString(),
  };

  const heroStats = buildHeroStats(dataStats, sysStatus, usage);
  const groups = buildGroups({ dataStats, sysStatus, externalAi, role: user.role });

  return (
    <AuthedAppShell user={user}>
      <div className="flex flex-col gap-8">
        <Hero greetingFor={user} chrome={chrome} stats={heroStats} />

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

// Greeting uses the shared HeroBanner so /admin and / read as the same
// chrome. Name resolution goes through pickGreetingName — same source
// of truth as the home page (FacultyMember English → FacultyMember Thai
// → stripped SSO name → email local-part).

function Hero({
  greetingFor,
  chrome,
  stats,
}: {
  greetingFor: SessionUser;
  chrome: { name: { th: string; en: string } | null } | null;
  stats: HeroStat[];
}) {
  const greetingName = pickGreetingName({ chrome, user: greetingFor });
  const tod = timeOfDayGreeting();
  return (
    <HeroBanner
      eyebrow={
        <>
          <span>Admin</span>
          <span aria-hidden className="opacity-40">/</span>
          <span className="text-text-secondary">Console</span>
        </>
      }
      title={`${tod}, ${greetingName}`}
      subtitle="Operational tools for keeping the curriculum-landscape data fresh, accurate, and trustworthy. Tile visibility tracks your role's permissions."
      icon={<Wrench className="size-icon-xl" aria-hidden />}
      right={<RoleChip role={greetingFor.role} />}
      stats={stats}
    />
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
      <ShieldCheck className="size-icon-xs" aria-hidden />
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
        padding="lg"
        elevation="sm"
        className="relative h-full overflow-hidden transition-all hover:border-border-strong hover:shadow-elevation-3"
      >
        {/* Warm gradient sweep on hover — super-tier tiles get the
            KKU cardinal accent; the rest get the warm-neutral accent.
            Adds the "this is a place you can go" warmth to each tile. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          style={{
            background:
              tile.tone === 'super'
                ? 'linear-gradient(135deg, transparent 0%, transparent 50%, oklch(var(--color-brand-cardinal) / 0.08) 100%)'
                : 'linear-gradient(135deg, transparent 0%, transparent 50%, oklch(var(--color-accent-default) / 0.08) 100%)',
          }}
        />

        <div className="relative flex items-start gap-4">
          {/* Icon — 56px badge with a soft glow on hover. Bumped from
              40px so the icon reads at a glance instead of as a tiny
              chip in the corner. */}
          <div className="relative flex-shrink-0">
            <div
              aria-hidden
              className="absolute -inset-1 rounded-2xl opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-70"
              style={{
                background:
                  tile.tone === 'super'
                    ? 'oklch(var(--color-brand-cardinal) / 0.55)'
                    : 'oklch(var(--color-accent-default) / 0.6)',
              }}
            />
            <div
              className={[
                'relative flex h-14 w-14 items-center justify-center rounded-2xl border',
                tile.tone === 'super'
                  ? 'border-danger/30 bg-danger/8 text-danger'
                  : tile.tone === 'warn'
                    ? 'border-warning/35 bg-warning/10 text-warning'
                    : 'border-border-default bg-surface-2 text-text-secondary',
                'transition-all duration-200 group-hover:scale-[1.04] group-hover:border-accent-default/45',
              ].join(' ')}
            >
              {tile.icon}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            {/* The count chip and the hover arrow both belong to the
                tile's top-right. They used to compete for it — the arrow
                was absolutely positioned at the card corner and, once
                icons rendered at their true 16px, its box ran over the
                chip's digits. Rendering both in the same flex cluster
                makes the collision structurally impossible at any card
                width or chip length. */}
            <div className="flex items-center justify-between gap-2">
              <div className="text-[15px] font-medium text-text-primary">
                {tile.label}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                {tile.badge && (
                  <Badge tone={tile.badge.tone ?? 'neutral'} className="tabular-nums">
                    {tile.badge.label}
                  </Badge>
                )}
                <ArrowUpRight
                  className="size-icon-md text-text-tertiary opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-accent-default"
                  aria-hidden
                />
              </div>
            </div>
            <div className="mt-1.5 text-[12.5px] leading-relaxed text-text-tertiary line-clamp-3">
              {tile.description}
            </div>
            {tile.meta && (
              <div className="mt-2.5 text-[11px] text-text-tertiary/80">
                {tile.meta}
              </div>
            )}
          </div>

        </div>
      </Card>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stat + group composition
// ─────────────────────────────────────────────────────────────────────────

// Re-export the shared HeroBanner stat shape under the page-local alias
// so the rest of the file keeps reading naturally.
type HeroStat = HeroBannerStat;

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

/**
 * The console's own caveats, on top of the api's.
 *
 * `pageCaveats` is imported rather than restated so the two surfaces cannot
 * drift into describing the same figures differently; the two sentences
 * added here are true of THIS strip and of nothing on /usage — the window
 * is fixed at 7 days with no control to change it, and the sparkline beside
 * the first figure is drawn over a different, longer window than the figure
 * itself.
 */
function usageCaveats(excludeAdmins: boolean): string[] {
  return [
    ...pageCaveats({ rawRetentionDays: RAW_RETENTION_DAYS, excludeAdmins }),
    `These three figures cover a fixed ${USAGE_DAYS}-day window, with no control on this page to widen it. Open Usage & access for any other window.`,
    excludeAdmins
      ? 'Because administrators are excluded, an installation whose only readers so far are operators shows 0 here. That 0 is an answer, not a failure — a figure that could not be read says “unavailable” instead. Turn “Exclude admin accounts” off on Usage & access to see operator activity.'
      : 'Administrators are counted here alongside everyone else, so operator activity is part of every figure above.',
    'The sparkline is daily active users over the last 30 Bangkok days — a longer window than the figure beside it — and carries a point only for days with activity, so it is not 30 points wide.',
  ];
}

/**
 * The value cell for a usage tile: the figure, an optional sparkline, and
 * the provenance + freshness pair the Council rules require. They live in
 * the VALUE because `HeroBannerStat.hint` is a plain string — the shared
 * banner is left untouched rather than grown a slot for one caller.
 */
function UsageStatValue({
  figure,
  series,
  title,
  meta,
  computedAt,
}: {
  figure: string;
  /** Daily active users, oldest first. Omitted when there is no line to
   *  draw — the caller decides that, since it is a fact about the data. */
  series?: number[];
  title: string;
  meta: ApiMeta;
  computedAt: string;
}) {
  return (
    <span className="flex flex-col gap-[6px]">
      <Link
        href="/usage"
        className="flex items-center gap-[10px] transition-colors hover:text-accent-default"
      >
        <span>{figure}</span>
        {series && (
          <span className="h-[28px] w-[72px] flex-shrink-0" aria-hidden>
            <Sparkline data={series} />
          </span>
        )}
      </Link>
      <span className="flex items-center gap-[6px] font-sans text-[12px] font-normal leading-normal">
        <ProvenanceButton size="xs" title={title} meta={meta} />
        <FreshnessBadge freshnessDate={computedAt} label="these figures" />
      </span>
    </span>
  );
}

// Exported for `test/admin-usage-hero.test.ts`: the strip is a pure
// function of three already-fetched values precisely so its honesty about a
// failed fetch can be asserted without a session, the api, or a DOM.
export function buildHeroStats(
  data: DataSetupStats | null,
  sys: SystemStatus | null,
  usage: UsageHero,
): HeroStat[] {
  const stats: HeroStat[] = [];
  if (data) {
    stats.push({
      label: 'KKU programs',
      value: data.programs.total.toLocaleString(),
      hint: `${data.programs.withCurriculumPdf} with curriculum PDF`,
      icon: <Building2 className="size-icon-sm" />,
    });
    stats.push({
      label: 'Live data feeds',
      value: `${data.dataFeeds.live} / ${data.dataFeeds.total}`,
      // live + mocked + deprecated reconciles to total; without naming the
      // superseded ones the figures look like they do not add up.
      hint:
        data.dataFeeds.deprecated > 0
          ? `${data.dataFeeds.mocked} still mocked · ${data.dataFeeds.deprecated} superseded`
          : `${data.dataFeeds.mocked} still mocked`,
      icon: <Database className="size-icon-sm" />,
    });
  }
  if (sys) {
    stats.push({
      label: 'Pending review',
      value: sys.pendingExtractions.toLocaleString(),
      hint: 'AI extractions awaiting approval',
      icon: <ClipboardCheck className="size-icon-sm" />,
    });
    stats.push({
      label: 'AI spend · 24h',
      value: `$ ${sys.ai24h.costUsd.toFixed(2)}`,
      hint: `${sys.ai24h.calls.toLocaleString()} calls`,
      icon: <CircleDollarSign className="size-icon-sm" />,
    });
  }
  // If both endpoints failed, fall back to a single placeholder card. The
  // test is on the two endpoints rather than on `stats.length`, which the
  // usage tiles below now fill unconditionally.
  if (!data && !sys) {
    stats.push({
      label: 'Stats',
      value: '—',
      hint: 'Live numbers unavailable; admin tools below still work.',
    });
  }

  // ── Usage ───────────────────────────────────────────────────────────
  // Always three tiles, whether or not the call landed: a strip that
  // silently loses a figure teaches the operator the figure is zero.
  const u = usage.summary;
  // Who the figures are about. "non-admin" is not decoration — it is the
  // difference between "nobody used the platform" and "nobody outside this
  // room did", and only one of those is a problem.
  const audience = usage.excludeAdmins ? 'non-admin accounts' : 'all accounts';
  // A percentage against a zero baseline is not a percentage; say nothing
  // rather than divide by it.
  const delta = (cur: number, prev: number): string =>
    prev === 0
      ? ''
      : ` · ${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)}% vs prior ${USAGE_DAYS}d`;
  const UNAVAILABLE = 'Unavailable — the usage service did not answer';
  const tile = (
    label: string,
    figure: string | null,
    hint: string,
    icon: React.ReactNode,
    series?: number[],
  ): HeroStat => ({
    label,
    value: (
      <UsageStatValue
        figure={figure ?? '—'}
        series={figure === null ? undefined : series}
        title={label}
        meta={usage.meta}
        computedAt={usage.computedAt}
      />
    ),
    hint: figure === null ? UNAVAILABLE : hint,
    icon,
  });

  stats.push(
    tile(
      `Active users · ${USAGE_DAYS}d`,
      u ? u.current.activeUsers.toLocaleString() : null,
      `${audience}${u ? delta(u.current.activeUsers, u.previous.activeUsers) : ''}`,
      <Users className="size-icon-sm" />,
      // A single point draws no line, and an empty line chart reads as a
      // rendering failure rather than as a short history.
      u && u.dailyActiveUsers.length > 1 ? u.dailyActiveUsers.map((d) => d.users) : undefined,
    ),
    tile(
      `Page views · ${USAGE_DAYS}d`,
      u ? u.current.views.toLocaleString() : null,
      u
        ? `in ${u.current.sessions.toLocaleString()} sessions · ${audience}${delta(u.current.views, u.previous.views)}`
        : '',
      <Eye className="size-icon-sm" />,
    ),
    tile(
      'Sign-ins today',
      u ? u.signinsToday.toLocaleString() : null,
      u ? `${u.current.signins.toLocaleString()} in the last ${USAGE_DAYS} days · ${audience}` : '',
      <LogIn className="size-icon-sm" />,
    ),
  );

  return stats;
}

function buildGroups({
  dataStats,
  sysStatus,
  externalAi,
  role,
}: {
  dataStats: DataSetupStats | null;
  sysStatus: SystemStatus | null;
  externalAi: ExternalAiSourceLite[] | null;
  role: SessionUser['role'];
}): ConsoleGroup[] {
  // ── 1) Programs ────────────────────────────────────────────────────
  // Curriculum-centric ops. Two tiles: the program list (browse / edit
  // / batch pipeline), and curriculum submission (register a new
  // programme OR attach a revised curriculum to an existing one).
  // These used to collapse to one tile under a "one tile, one
  // destination" rule — the list page owned the "Add new program"
  // affordance instead of a separate tile. That no longer holds:
  // submission now covers both new AND revised curricula, which is a
  // distinct operation from browsing/editing the list and earns its
  // own destination. The AI-extraction review queue still folds into
  // Job queues under Application (Phase 6).
  const programs: ConsoleTile[] = [
    {
      href: '/admin/programs',
      label: 'Program list',
      description:
        'Full table of every KKU program — filter by metadata, edit status / faculty / level, run pipeline (per-row or batch).',
      icon: <Building2 className="size-icon-xl" />,
      badge: dataStats
        ? { label: dataStats.programs.total.toLocaleString(), tone: 'neutral' }
        : undefined,
      meta: dataStats
        ? `${dataStats.programs.missingCurriculumPdf} missing curriculum`
        : undefined,
    },
    {
      href: '/admin/programs/from-pdf',
      label: 'Submit curriculum file',
      description:
        'Upload a มคอ.2 — either to register a new programme, or to attach a revised curriculum to an existing one. Runs the full analysis pipeline on submit.',
      icon: <FileUp className="size-icon-xl" />,
      badge: dataStats
        ? { label: `${dataStats.programs.missingCurriculumPdf} missing`, tone: 'warning' }
        : undefined,
    },
  ];

  // ── 2) External data ──────────────────────────────────────────────
  // Sources outside KKU's own systems. Connectors handle structured
  // data (DBs + APIs). AI search & synthesis handles unstructured
  // intelligence feeds. PDF library handles non-curriculum docs.
  const external: ConsoleTile[] = [
    {
      // First in the group because it is the overview the others are
      // detail views of — and, on an installation with no connectors, the
      // only way in: the spreadsheet import for faculties, departments and
      // programmes lives behind it.
      href: '/admin/data-setup',
      label: 'Data setup',
      description:
        'Every input category in one place — curriculum documents, students, staff, finance, labour market, research — with what is loaded, what is missing, and where it came from. Faculties, departments and programmes can be imported from a spreadsheet here.',
      icon: <Layers className="size-icon-xl" />,
      badge: dataStats
        ? {
            label: `${dataStats.programs.total.toLocaleString()} programmes`,
            tone: dataStats.programs.total > 0 ? 'neutral' : 'warning',
          }
        : undefined,
      meta: dataStats
        ? `${dataStats.dataFeeds.live} live feeds · ${dataStats.dataFeeds.mocked} mocked`
        : undefined,
    },
    {
      href: '/admin/data-sources',
      label: 'DB / API connectors',
      description:
        'Structured-data sources — KKU Registrar, KKU HR, KKU Finance, KMITL skill mapping. Manage cron schedules and fire manual re-syncs.',
      icon: <Database className="size-icon-xl" />,
      badge: dataStats
        ? {
            label: `${dataStats.dataFeeds.live} live`,
            tone: dataStats.dataFeeds.live > 0 ? 'success' : 'neutral',
          }
        : undefined,
      meta: dataStats ? `${dataStats.dataFeeds.mocked} still mocked` : undefined,
    },
    {
      href: '/admin/dashboard-data-fetch',
      label: 'Dashboard data fetch',
      description:
        'Manually rebuild Education + Staff dashboard cubes from their underlying Oracle / MSSQL warehouses. Was on /education + /staff before; consolidated here in v1.2.8 since only operators can fire it.',
      icon: <RefreshCw className="size-icon-xl" />,
    },
    {
      href: '/admin/application-topology',
      label: 'Application topology',
      description:
        'Whole-application data flow — every active connector → Postgres tables → every consuming dashboard (Education, Staff, Cockpit, Deep-Dive, Risk, Trends, Gap, Benchmarking, Scenarios, Decisions, Analyst). Live connector status inline.',
      icon: <Share2 className="size-icon-xl" />,
    },
    {
      href: '/admin/external/ai-search',
      label: 'AI search & synthesis',
      description:
        'External intelligence feeds — WEF, IMD, BOI, World Bank, Google News. URL-list + web-search sources, AI-summarised into trend_signals.',
      icon: <Globe2 className="size-icon-xl" />,
      badge: externalAi
        ? (() => {
            const active = externalAi.filter((s) => s.status === 'ACTIVE').length;
            return active > 0
              ? { label: `${active} active`, tone: 'success' as const }
              : { label: 'all paused', tone: 'neutral' as const };
          })()
        : undefined,
      meta: externalAi
        ? (() => {
            const signals = externalAi.reduce((sum, s) => sum + (s.recentSignalCount ?? 0), 0);
            return `${signals} signal${signals === 1 ? '' : 's'} from ${externalAi.length} feeds · 30d`;
          })()
        : undefined,
    },
    {
      href: '/admin/external/api-clients',
      label: 'API clients',
      description: 'Keys and section grants for systems that read staff profiles through the external API.',
      icon: <KeyRound className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/trend-documents',
      label: 'Add signal from document',
      description:
        'Upload a document — PDF, Word, Excel, PowerPoint or HTML (e.g. a manpower-demand / job-posting report) — or paste a URL. AI reads it, drafts a trend signal, and publishes it to the Trends Radar with the KKU programs/skills it affects + recommended actions.',
      icon: <FileUp className="size-icon-xl" />,
    },
    {
      href: '/admin/jobthai',
      label: 'JobThai drops',
      description:
        'Upload the XLSX job-posting files JobThai sends. Each becomes a batch: postings are parsed, skills matched against the taxonomy, and occupations derived from the job categories. Gives province and industry-sector demand detail the LinkedIn-via-MHESI feed cannot.',
      icon: <DataSourceMark source="jobthai" size={28} />,
    },
    {
      href: '/admin/job-fields',
      label: 'Job fields',
      description:
        'Review the fields of study clustered from JobThai postings and the programmes assigned to each. These are the rows of the Gap Analyzer; proposed rows are shown there as unreviewed until approved here.',
      icon: <DataSourceMark source="jobthai" size={28} />,
    },
    {
      href: '/admin/pdf-review',
      label: 'PDF library',
      description:
        'Non-curriculum PDFs — Thai government / MHESI / KKU / faculty policy documents and reports. Re-extract, archive, deprecate, delete.',
      icon: <FileSearch className="size-icon-xl" />,
    },
    {
      href: '/admin/scholar',
      label: 'Google Scholar fetch',
      description:
        'Pull a staff member’s Google Scholar publication record on demand, one person or many. Every page fetched from Google costs ScrapingBee credits, so every run is priced before it is sent.',
      icon: <GraduationCap className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/registry-mapping',
      label: 'Registry mapping',
      description:
        'Resolve unmatched registrar tuples to canonical Program rows — analyst-driven crosswalk for the kku-registry connector.',
      icon: <GitBranch className="size-icon-xl" />,
    },
    {
      href: '/admin/data-quality',
      label: 'Data quality',
      description:
        'Completeness + year-on-year drift detection across enrollment, financials, outcome series. Surfaces when an external feed turns flaky.',
      icon: <ClipboardCheck className="size-icon-xl" />,
      // Badge only when there's something to act on. When everything
      // is fresh, no badge — the tile reads as "all good" by default,
      // and only lights up when an operator needs to attend.
      badge: sysStatus
        ? (() => {
            const stale = sysStatus.dataFreshness.filter((f) => f.stale).length;
            return stale > 0
              ? { label: `${stale} need attention`, tone: 'warning' as const }
              : undefined;
          })()
        : undefined,
      meta: sysStatus
        ? (() => {
            const stale = sysStatus.dataFreshness.filter((f) => f.stale).length;
            const total = sysStatus.dataFreshness.length;
            return stale === 0
              ? `All ${total} feeds up to date`
              : `${total - stale} of ${total} feeds up to date`;
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
      icon: <Users className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/app/ai-settings',
      label: 'AI settings',
      description:
        'Per-task model picker + cost dashboard. Override the default model for any methodVersion, view spend per user / module / 7-30 days.',
      icon: <Settings2 className="size-icon-xl" />,
      roles: SUPER_GRADE,
      tone: 'super',
      // No badge — the meta line below carries the operator-useful
      // signal (today's AI spend + call count). "Phase 3" was a dev
      // tag that shouldn't reach the live UI.
      meta: sysStatus
        ? `Today $ ${sysStatus.ai24h.costUsd.toFixed(2)} · ${sysStatus.ai24h.calls} calls`
        : undefined,
    },
    {
      href: '/admin/organization',
      label: 'Organisation',
      description:
        'Your institution’s names, short names, region, contact email and public URL — used for TCAS matching, AI text and outbound requests.',
      icon: <Building2 className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/app/academic-year',
      label: 'Academic year',
      description:
        'Set when the academic year rolls over. Drives which entry year counts as complete vs in-progress across recruitment, the program funnel, and risk.',
      icon: <CalendarClock className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/queues',
      label: 'Job queues',
      description:
        'Live BullMQ state with realtime tiles + recent-activity stream + per-queue throughput. Human-review queues (AI + PDF extractions awaiting sign-off) surface inline; pause, resume, retry, clean from the same page.',
      icon: <Layers className="size-icon-xl" />,
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
      icon: <Activity className="size-icon-xl" />,
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
      href: '/usage',
      label: 'Usage & access',
      description:
        'Who opens which parts of the platform — active users, modules, programmes, faculties, roles — plus the per-person access log and session timelines.',
      icon: <BarChart3 className="size-icon-xl" />,
      roles: ADMIN_GRADE,
    },
    {
      href: '/admin/pdf-generation',
      label: 'PDF generation',
      description:
        'Every Council Pack, brief, and report routed through Gotenberg — generation history, durations, failures.',
      icon: <FileText className="size-icon-xl" />,
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
        'Curriculum-centric operations. The program list owns browsing, editing, and per-row / batch pipeline actions; curriculum submission (new or revised) is its own destination.',
      tiles: programs.filter(filterByRole),
    },
    {
      eyebrow: 'Group 2',
      label: 'Data',
      caption:
        'Where everything the platform analyses comes from — the data-setup overview, connectors, spreadsheet imports, AI-summarised intelligence feeds, non-curriculum PDFs, and data-quality monitoring.',
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

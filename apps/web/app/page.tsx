import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@kku/ui';
import {
  ArrowRight,
  Building2,
  GraduationCap,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  ThumbCockpit,
  ThumbExecutive,
  ThumbPrograms,
  ThumbAnalyst,
} from '@/components/dashboard/quick-action-thumbnails';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { prisma } from '@kku/db';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { apiFetchAsUniversityUser } from '@/lib/api-client';
import {
  pickGreetingName,
  resolveUserChrome,
  timeOfDayGreeting,
} from '@/lib/display-name';
import { PublicationsSparkline } from '@/components/dashboard/publications-sparkline';
import { CopyrightFooter } from '@/components/copyright-footer';
import { getHomePublicationsSnapshot } from '@/lib/profile-data';
import { HeroBanner, type HeroBannerStat } from '@/components/hero-banner';

// Lightweight welcome home. ~75% of the page is content shared across
// every signed-in user (university KPIs, quick actions); ~25% is a
// personal slice (their scope card, publications sparkline if academic
// staff, their assigned programs). Designed to render in <300ms cold so
// the moment after SSO sign-in feels instant.
//
// The heavy executive dashboard (BCG matrix, full health scores,
// lifecycle verdict, alerts) lives at /dashboards/executive-landscape
// and is one click away via the sidebar.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home · Curriculum Landscape · KKU' };

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super admin',
  SYSTEM_ADMIN: 'System admin',
  UNIVERSITY_USER: 'University access',
  FACULTY_USER: 'Faculty access',
  PROGRAM_USER: 'Program access',
};

// Year window for the research-output snapshot in the hero KPI strip.
// 10 years is meaningful for "current research vitality" — older work
// is in the all-time roll-up, but for at-a-glance we want recency.
const RESEARCH_YEARS_BACK = 10;

// ─── In-process cache for universal KPIs ─────────────────────────────
// The "KKU at a glance" KPI strip is the same numbers for every
// signed-in user: active programs, total students, staff headcount,
// 10-year papers + citations. These aggregations cost ~50-200ms cold
// (mostly the citation sum over ~165k research_output rows). Cache
// the merged result at module scope with a 5-minute TTL so the first
// load fills it and the next ~250 requests hit memory.
//
// Same pattern as `apps/web/src/lib/news/today.ts` — single Node
// worker per container, module-scope variable, TTL based on
// freshness expectations (KKU's student/staff headcount rarely
// changes within a 5-min window; citation counts drift on ingestion
// runs but we don't need to-the-minute accuracy here).

interface KpiCache {
  data: UniversityKpis;
  expiresAt: number;
}
const KPI_TTL_MS = 5 * 60 * 1000;
let kpiCache: KpiCache | null = null;

interface UniversityKpis {
  enrolledTotal: number;
  activeProgramCount: number;
  staffCounts: {
    total: number;
    academic: number;
    support: number;
    leadership: number;
  };
}

async function loadUniversityKpisCached(
  caller: Pick<SessionUser, 'userId' | 'email' | 'name'>,
): Promise<UniversityKpis> {
  const now = Date.now();
  if (kpiCache && kpiCache.expiresAt > now) {
    return kpiCache.data;
  }

  // v1.2.9 — dropped the /staff-dashboard/research fetch from the home
  // page hero. The research endpoint reads the publications mirror
  // (~50k+ rows joined to FacultyMember) which dominated the cold-cache
  // home-page TTFB. Papers + Citations KPIs are surfaced on /staff/research.
  const [studentInfoResp, activeProgramCount, workforceResp] =
    await Promise.all([
      apiFetchAsUniversityUser<{ totalActive: number }>(
        caller,
        '/education/student-info',
      ).catch(() => ({ totalActive: 0 })),
      prisma.program
        .count({
          where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
        })
        .catch(() => 0),
      apiFetchAsUniversityUser<{
        headcount: {
          total: number;
          academic: number;
          support: number;
          executives: number;
          unknownTrack: number;
        };
      }>(caller, '/staff-dashboard/workforce').catch(() => ({
        headcount: {
          total: 0,
          academic: 0,
          support: 0,
          executives: 0,
          unknownTrack: 0,
        },
      })),
    ]);

  const data: UniversityKpis = {
    enrolledTotal: studentInfoResp.totalActive ?? 0,
    activeProgramCount,
    staffCounts: {
      total: workforceResp.headcount.total,
      academic: workforceResp.headcount.academic,
      support: workforceResp.headcount.support,
      leadership: workforceResp.headcount.executives,
    },
  };

  // Only cache the row when at least one field came back non-zero —
  // an all-zeros payload means every upstream call failed, and we
  // don't want a degraded result pinned for 5 minutes.
  const allZero =
    data.enrolledTotal === 0 &&
    data.activeProgramCount === 0 &&
    data.staffCounts.total === 0;
  if (!allZero) {
    kpiCache = { data, expiresAt: now + KPI_TTL_MS };
  }
  return data;
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;

  const currentYear = new Date().getUTCFullYear();
  // researchYearFrom retained for the per-user PublicationsSparkline
  // below — the *hero* no longer fetches research-window data.
  const researchYearFrom = currentYear - RESEARCH_YEARS_BACK + 1;

  // ─── Parallel fetch of all blocks. Each query is cheap; the slowest
  // is the citations sum across ~165k research_output rows (~50ms with
  // index scan).
  // Reuse the EXISTING dashboard endpoints — same data the /education
  // and /staff dashboards already aggregate. No new query logic, no
  // duplicate "compute total students" pass. The endpoints are gated
  // to assertUniversityWide(); apiFetchAsUniversityUser mints a
  // 5-minute synthetic UNIVERSITY_USER JWT keyed off the real caller's
  // userId so audit logs stay attributable.
  const callerForFetch = {
    userId: user.userId,
    email: user.email,
    name: user.name ?? null,
  };

  // Universal KPIs come from a 5-minute in-process cache shared across
  // all users (see loadUniversityKpisCached above). Personal slices —
  // chrome, faculty name, publications, scopes — are fetched per-user.
  const [kpis, chrome, facultyName, pubsSnapshot, userScopes] = await Promise.all([
    loadUniversityKpisCached(callerForFetch),
    resolveUserChrome(user.userId).catch(() => ({ name: null, avatarUrl: null })),
    user.facultyId
      ? prisma.faculty
          .findUnique({
            where: { id: user.facultyId },
            select: { nameTh: true, nameEn: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    // Publications sparkline — wired to LIVE Scopus through the same
    // stale-while-revalidate cache the profile page uses. Cache hit
    // returns in ~5ms; cache miss blocks on the live pipeline (~3-5s
    // with Scopus AU-ID lookup). Returns null when the user isn't
    // matched to a FacultyMember row.
    getHomePublicationsSnapshot(user.userId).catch(() => null),
    prisma.userScope
      .findMany({
        where: { userId: user.userId, role: 'PROGRAM_USER' },
        select: {
          program: {
            select: { id: true, code: true, nameEn: true, nameTh: true, level: true, status: true },
          },
        },
        take: 12,
      })
      .catch(() => []),
  ]);

  const {
    enrolledTotal,
    activeProgramCount,
    staffCounts,
  } = kpis;

  const publicationsByYear = pubsSnapshot?.byYear ?? [];
  const totalPapersPersonal = pubsSnapshot?.totalPapers ?? 0;

  // Personal: programs the user has explicit scope for.
  const myPrograms = userScopes
    .filter((s) => s.program !== null)
    .map((s) => s.program!)
    .slice(0, 6);
  const myProgramsExtra = Math.max(0, userScopes.length - myPrograms.length);

  // Canonical greeting resolution — shared with /admin via
  // pickGreetingName so the same user sees the same name everywhere.
  const greetingName = pickGreetingName({ chrome, user });
  const greeting = timeOfDayGreeting();
  const roleLabel = ROLE_LABEL[user.role] ?? user.role;
  const isAcademicStaff = totalPapersPersonal > 0;

  // v1.2.9 — hero KPI strip absorbed the previous "KKU at a glance"
  // card. Papers + Citations + Leadership-roles KPIs removed entirely
  // (Papers/Citations live on /staff/research; the heavy
  // /staff-dashboard/research fetch dominated cold-cache TTFB).
  const heroStats: HeroBannerStat[] = [
    {
      label: 'Active programs',
      value: activeProgramCount.toLocaleString('en-US'),
      hint: 'status = ACTIVE',
      icon: <Building2 className="h-3.5 w-3.5" />,
    },
    {
      label: 'Total students',
      value:
        enrolledTotal > 0 ? enrolledTotal.toLocaleString('en-US') : '—',
      hint: 'all enrolled',
      icon: <GraduationCap className="h-3.5 w-3.5" />,
    },
    {
      label: 'Total staff',
      value:
        staffCounts.total > 0
          ? staffCounts.total.toLocaleString('en-US')
          : '—',
      hint: 'KKU HR roster',
      icon: <Sparkles className="h-3.5 w-3.5" />,
    },
    {
      label: 'Academic staff',
      value:
        staffCounts.academic > 0
          ? staffCounts.academic.toLocaleString('en-US')
          : '—',
      hint: 'faculty + researchers',
      icon: <GraduationCap className="h-3.5 w-3.5" />,
    },
    {
      label: 'Support staff',
      value:
        staffCounts.support > 0
          ? staffCounts.support.toLocaleString('en-US')
          : '—',
      hint: 'admin + technical',
      icon: <Users className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <AuthedAppShell user={user}>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 p-6">
        {/* HERO ─── shared HeroBanner used by /admin too ───────────────── */}
        <HeroBanner
          eyebrow={
            <>
              <span>KKU</span>
              <span aria-hidden className="opacity-40">/</span>
              <span className="text-text-secondary">Welcome back</span>
            </>
          }
          title={`${greeting}, ${greetingName}`}
          subtitle={
            facultyName ? `${roleLabel} · ${facultyName.nameEn}` : roleLabel
          }
          icon={<Sparkles className="h-6 w-6" aria-hidden />}
          stats={heroStats}
          // 5 stats → 2/3 on mobile/sm, 5 across at md+. Replaces the
          // default sm:grid-cols-4 fit so nothing wraps awkwardly.
          statsGridClass="grid-cols-2 sm:grid-cols-3 md:grid-cols-5"
        />

        {/* QUICK ACTIONS ─── 1 row × 4 tiles (compact, landscape) ─────── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <QuickAction href="/cockpit" label="Portfolio Cockpit" thumbnail={<ThumbCockpit />} />
          <QuickAction href="/dashboards/executive-landscape" label="Executive Landscape" thumbnail={<ThumbExecutive />} />
          <QuickAction href="/programs" label="Programs" thumbnail={<ThumbPrograms />} />
          <QuickAction href="/analyst" label="AI Analyst" thumbnail={<ThumbAnalyst />} />
        </div>

        {/* PERSONAL SLICE ─── 25% (3 cards in a row on desktop) ────────── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Your scope card */}
          <Card padding="md" className="flex flex-col gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
              Your access
            </p>
            <p className="text-sm text-text-primary">
              <span className="font-semibold">{roleLabel}</span>
              {facultyName && <> · {facultyName.nameEn}</>}
            </p>
            {myPrograms.length > 0 ? (
              <p className="text-[11px] text-text-tertiary">
                Scoped to {myPrograms.length + myProgramsExtra} program
                {myPrograms.length + myProgramsExtra > 1 ? 's' : ''} via your assignments.
              </p>
            ) : (
              <p className="text-[11px] text-text-tertiary">
                No specific program assignments yet.{' '}
                <Link href="/programs" className="text-accent-default hover:underline">
                  Browse all →
                </Link>
              </p>
            )}
          </Card>

          {/* Publications sparkline — academic staff only */}
          {isAcademicStaff ? (
            <Card padding="md">
              <PublicationsSparkline
                data={publicationsByYear}
                yearsBack={5}
                label="Your publications"
                sub="Last 5 years · Scopus + PubMed"
              />
              <Link
                href="/profile"
                className="mt-3 inline-flex items-center gap-1 text-[11px] text-accent-default hover:underline"
              >
                Open my profile <ArrowRight className="size-3" />
              </Link>
            </Card>
          ) : (
            <Card padding="md" className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                Profile
              </p>
              <p className="text-xs text-text-secondary">
                Manage your account and view your activity.
              </p>
              <Link
                href="/profile"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-default hover:underline"
              >
                Open my profile <ArrowRight className="size-3" />
              </Link>
            </Card>
          )}

          {/* My programs — UserScope-driven */}
          {myPrograms.length > 0 ? (
            <Card padding="md" className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                Your programs
              </p>
              <ul className="flex flex-col gap-1.5">
                {myPrograms.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/programs/${p.id}`}
                      className="group flex items-baseline justify-between gap-2 rounded px-2 py-1 -mx-2 hover:bg-surface-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-text-primary group-hover:text-accent-default">
                          {p.code}
                        </p>
                        <p className="truncate text-[11px] text-text-tertiary">
                          {p.nameEn}
                        </p>
                      </div>
                      <ArrowRight className="size-3 shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
              {(myPrograms.length > 5 || myProgramsExtra > 0) && (
                <Link
                  href="/programs"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-default hover:underline"
                >
                  See all {myPrograms.length + myProgramsExtra} programs <ArrowRight className="size-3" />
                </Link>
              )}
            </Card>
          ) : (
            <Card padding="md" className="flex flex-col gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                All KKU programs
              </p>
              <p className="text-xs text-text-secondary">
                Browse all programs across every faculty.
              </p>
              <Link
                href="/programs"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-default hover:underline"
              >
                Open Programs <ArrowRight className="size-3" />
              </Link>
            </Card>
          )}
        </div>

        {/* FOOTER ──────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          <p className="text-center text-[11px] text-text-tertiary">
            Looking for the strategic dashboard?{' '}
            <Link href="/dashboards/executive-landscape" className="text-accent-default hover:underline">
              Open Executive Landscape →
            </Link>
          </p>
          <CopyrightFooter />
        </div>
      </div>
    </AuthedAppShell>
  );
}

function QuickAction({
  href,
  label,
  thumbnail,
}: {
  href: string;
  label: string;
  thumbnail: React.ReactNode;
}) {
  // Compact landscape tile — 5:3 outer aspect (matches the SVG
  // viewBox so thumbnails fit edge-to-edge with no cropping).
  // Thumbnail fills the top ~75%; title sits in a 25% strip below.
  return (
    <Link
      href={href}
      className="group flex aspect-[5/3] flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-1 transition-colors hover:border-accent-default/40 hover:bg-surface-2"
    >
      <div className="flex flex-[3] items-center justify-center overflow-hidden">
        {thumbnail}
      </div>
      <div className="flex flex-1 items-center justify-between gap-2 border-t border-border-subtle bg-surface-2/30 px-3">
        <span className="truncate text-[13px] font-medium text-text-primary group-hover:text-accent-default">
          {label}
        </span>
        <ArrowRight className="size-3 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </Link>
  );
}

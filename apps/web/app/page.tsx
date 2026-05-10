import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  CardTitle,
  KPI,
  PageHeader,
} from '@kku/ui';
import { ArrowRight } from 'lucide-react';
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
import { resolveUserChrome } from '@/lib/display-name';
import { PublicationsSparkline } from '@/components/dashboard/publications-sparkline';
import { CopyrightFooter } from '@/components/copyright-footer';
import type { PublicationEntry } from '@/lib/profile-types';

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

// Greeting respecting Asia/Bangkok wall-clock — most KKU users are
// local. Server-side render so it's correct at first paint.
function timeOfDayGreeting(): string {
  // Force Bangkok TZ. Intl is more reliable than Date.getHours() since
  // the server may be UTC.
  const fmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
  const hour = parseInt(fmt.format(new Date()), 10);
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Hello';
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString('en-US');
}

export default async function HomePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;

  const currentYear = new Date().getUTCFullYear();
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

  const [
    studentInfoResp,
    activeProgramCount,
    workforceResp,
    researchResp,
    chrome,
    facultyName,
    pubsCacheRow,
    userScopes,
  ] = await Promise.all([
    // Total students — calls /education/student-info, same endpoint that
    // backs the /education dashboard headline.
    apiFetchAsUniversityUser<{ totalActive: number }>(
      callerForFetch,
      '/education/student-info',
    ).catch(() => ({ totalActive: 0 })),
    // Active programs — same predicate as getDashboardOverview()
    // (status='ACTIVE' + sequenceNoFromSheet not null). Programs aren't
    // exposed via a one-shot KPI endpoint, so this 1-query count is
    // the cheapest reuse — it's literally the same `where` clause.
    prisma.program
      .count({ where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } } })
      .catch(() => 0),
    // Staff headcount — calls /staff-dashboard/workforce, same endpoint
    // that backs the /staff dashboard. Returns headcount.{total,
    // academic, support, executives, unknownTrack}.
    apiFetchAsUniversityUser<{
      headcount: {
        total: number;
        academic: number;
        support: number;
        executives: number;
        unknownTrack: number;
      };
    }>(callerForFetch, '/staff-dashboard/workforce').catch(() => ({
      headcount: { total: 0, academic: 0, support: 0, executives: 0, unknownTrack: 0 },
    })),
    // Total papers + citations — calls /staff-dashboard/research, same
    // endpoint backing the /staff/research dashboard. Returns
    // { yearFrom, yearTo, totalPapers, totalCitations, ... }.
    apiFetchAsUniversityUser<{
      yearFrom: number;
      yearTo: number;
      totalPapers: number;
      totalCitations: number;
    }>(callerForFetch, '/staff-dashboard/research').catch(() => ({
      yearFrom: researchYearFrom,
      yearTo: currentYear,
      totalPapers: 0,
      totalCitations: 0,
    })),
    resolveUserChrome(user.userId).catch(() => ({ name: null, avatarUrl: null })),
    user.facultyId
      ? prisma.faculty
          .findUnique({
            where: { id: user.facultyId },
            select: { nameTh: true, nameEn: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    prisma.userPublicationsCache
      .findUnique({ where: { userId: user.userId }, select: { payloadJson: true, paperCount: true } })
      .catch(() => null),
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

  const enrolledTotal = studentInfoResp.totalActive ?? 0;
  const staffCounts = {
    total: workforceResp.headcount.total,
    academic: workforceResp.headcount.academic,
    support: workforceResp.headcount.support,
    leadership: workforceResp.headcount.executives,
  };
  const totalPapersWindow = researchResp.totalPapers ?? 0;
  const totalCitationsWindow = researchResp.totalCitations ?? 0;
  const researchYearLabel = `${researchResp.yearFrom}–${researchResp.yearTo}`;

  // Personal: extract publications-by-year from the cache.
  let publicationsByYear: Array<{ year: number; count: number }> = [];
  let totalPapersPersonal = 0;
  if (pubsCacheRow?.payloadJson) {
    const entries = pubsCacheRow.payloadJson as unknown as PublicationEntry[];
    if (Array.isArray(entries)) {
      totalPapersPersonal = entries.length;
      const byYear = new Map<number, number>();
      for (const e of entries) {
        if (typeof e?.year === 'number') {
          byYear.set(e.year, (byYear.get(e.year) ?? 0) + 1);
        }
      }
      publicationsByYear = [...byYear.entries()].map(([year, count]) => ({ year, count }));
    }
  }

  // Personal: programs the user has explicit scope for.
  const myPrograms = userScopes
    .filter((s) => s.program !== null)
    .map((s) => s.program!)
    .slice(0, 6);
  const myProgramsExtra = Math.max(0, userScopes.length - myPrograms.length);

  // chrome.name is { th, en } when the user is on the FacultyMember
  // roster; null otherwise. Prefer English here. Fall back to user.name
  // (from SSO claims) and finally a generic greeting.
  const greetingName =
    chrome.name?.en ??
    chrome.name?.th ??
    user.name ??
    user.email?.split('@')[0] ??
    'there';
  const greeting = timeOfDayGreeting();
  const roleLabel = ROLE_LABEL[user.role] ?? user.role;
  const isAcademicStaff = totalPapersPersonal > 0;

  return (
    <AuthedAppShell user={user}>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 p-6">
        {/* HERO ────────────────────────────────────────────────────────── */}
        <PageHeader
          eyebrow="Welcome back"
          title={`${greeting}, ${greetingName}`}
          subtitle={
            facultyName
              ? `${roleLabel} · ${facultyName.nameEn}`
              : roleLabel
          }
        />

        {/* UNIVERSITY KPI STRIP ─── 75% (universal) ─────────────────────── */}
        <Card padding="md">
          <CardHeader className="mb-3">
            <CardTitle className="text-xs uppercase tracking-wide text-text-tertiary">
              KKU at a glance
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {/* Row 1 — institutional scale + leadership highlight */}
            <KPI
              label="Active programs"
              value={activeProgramCount.toLocaleString('en-US')}
            />
            <KPI
              label="Total students"
              value={enrolledTotal > 0 ? enrolledTotal.toLocaleString('en-US') : '—'}
            />
            <KPI
              label="Total staff"
              value={
                staffCounts.total > 0 ? staffCounts.total.toLocaleString('en-US') : '—'
              }
            />
            <KPI
              label="Leadership roles"
              value={
                staffCounts.leadership > 0
                  ? staffCounts.leadership.toLocaleString('en-US')
                  : '—'
              }
            />
            {/* Row 2 — staff breakdown + research outputs */}
            <KPI
              label="Academic staff"
              value={
                staffCounts.academic > 0
                  ? staffCounts.academic.toLocaleString('en-US')
                  : '—'
              }
            />
            <KPI
              label="Support staff"
              value={
                staffCounts.support > 0
                  ? staffCounts.support.toLocaleString('en-US')
                  : '—'
              }
            />
            <KPI
              label={`Papers (${researchYearLabel})`}
              value={totalPapersWindow > 0 ? compactNumber(totalPapersWindow) : '—'}
            />
            <KPI
              label={`Citations (${researchYearLabel})`}
              value={
                totalCitationsWindow > 0 ? compactNumber(totalCitationsWindow) : '—'
              }
            />
          </div>
        </Card>

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

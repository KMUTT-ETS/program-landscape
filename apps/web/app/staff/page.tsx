import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  canSeeFacultyDashboards,
  canSeeProgramAwareDashboards,
  isUniversityWide,
  type SessionUser,
} from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { Users, BookOpen, Microscope, Wallet, ClipboardList, MessageSquare, Award } from 'lucide-react';
// StaffRefreshBar relocated to /admin/dashboard-data-fetch in v1.2.8.
// The component still lives in ./refresh-bar — the admin page imports
// it from there.
import {
  WorkforceThumb,
  FacultyByProgramThumb,
  ResearchThumb,
  CompensationThumb,
  TeachingWorkloadThumb,
  TeachingEvaluationsThumb,
  TeachingTalentThumb,
} from './thumbnails';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff dashboard' };

// `programAware` marks tiles a PROGRAM_USER can open. Others 403 at
// the API guard, so the hub hides them to avoid dead-link UX.
const TILES: Array<{
  href: string;
  icon: typeof Users;
  title: string;
  blurb: string;
  Thumb: typeof WorkforceThumb;
  programAware?: boolean;
}> = [
  {
    href: '/staff/workforce',
    icon: Users,
    title: 'Who works here',
    blurb:
      'How many people work at KKU and who they are — by age, years of service, and recent arrivals and departures. Includes a five-year heads-up on who is approaching retirement, with academic and support staff shown side by side.',
    Thumb: WorkforceThumb,
  },
  {
    href: '/staff/faculty-by-program',
    icon: BookOpen,
    title: 'Programs and their staff',
    blurb:
      'See which staff teach in each program, from faculty down to the individual program. Programs with fewer than five อาจารย์ผู้รับผิดชอบหลักสูตร (responsible instructors) are flagged for attention.',
    Thumb: FacultyByProgramThumb,
  },
  {
    href: '/staff/research',
    icon: Microscope,
    title: 'Research and publications',
    blurb:
      'Every paper KKU staff have published, including retired faculty. Leads with journal-quality tiers — Tier 1 and Q1, the signal behind QS and THE rankings — then shows how output has grown year by year and which faculties and individuals contribute most.',
    Thumb: ResearchThumb,
  },
  {
    href: '/staff/compensation',
    icon: Wallet,
    title: 'Salaries and funding',
    blurb:
      "Where each person's pay comes from — government budget versus university revenue — and the mix of income levels in each faculty. To protect privacy, figures appear only where at least five people share a category.",
    Thumb: CompensationThumb,
  },
  {
    href: '/staff/teaching-workload',
    icon: ClipboardList,
    title: 'Teaching workload',
    blurb:
      'How many teaching hours each instructor carries per week across all their classes. Spot who is over- and under-loaded, compare faculties, see how many students each one reaches, and explore the ranking right down to individual teachers.',
    Thumb: TeachingWorkloadThumb,
    programAware: true,
  },
  {
    href: '/staff/teaching',
    icon: MessageSquare,
    title: 'Teaching evaluations',
    blurb:
      "What students think of their instructors, from the official course-evaluation survey. Browse every instructor's average rating, then open anyone to see results question by question and course by course. You see your own record (program staff) or your faculty's (faculty leaders).",
    Thumb: TeachingEvaluationsThumb,
    programAware: true,
  },
  {
    href: '/staff/teaching-talent',
    icon: Award,
    title: 'Teaching and learning talent',
    blurb:
      'Who students rate highly year after year. A talent cleared the chosen bar in every one of the last three completed academic years — sustained quality, not one good semester. Covers every evaluated instructor, mapped to a curriculum or not, and exports the qualifying list to Excel.',
    Thumb: TeachingTalentThumb,
    programAware: true,
  },
];

export default async function StaffHubPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  // Refresh moved to /admin/dashboard-data-fetch (v1.2.8) — was here
  // but only admins could fire it.
  const canRefresh = isUniversityWide(role);

  const isProgramOnly = !canSeeFacultyDashboards(role);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Staff dashboard"
        subtitle={
          canRefresh
            ? "A live view of KKU's workforce — academic and support staff together. Refreshes automatically every morning; manual rebuilds live in /admin/dashboard-data-fetch."
            : isProgramOnly
              ? "Workforce views. Teaching workload is clamped to your program's courses; the rest roll up to your program's faculty."
              : "Your faculty's workforce — academic and support staff together. Refreshed nightly across the whole university."
        }
      />

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {TILES.map((t) => {
          const Icon = t.icon;
          const Thumb = t.Thumb;
          return (
            <Link key={t.href} href={t.href} className="block">
              <Card className="flex h-full flex-col gap-3 p-0 transition-colors hover:bg-surface-2">
                <div className="aspect-[2/1] w-full overflow-hidden rounded-t-md">
                  <Thumb />
                </div>
                <div className="flex items-start gap-3 px-4 pb-4">
                  <div className="rounded-md bg-accent-subtle p-2 text-accent">
                    <Icon className="size-icon-lg" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">{t.title}</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">{t.blurb}</p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </AuthedAppShell>
  );
}

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
import { Users, BookOpen, Microscope, Wallet, ClipboardList } from 'lucide-react';
// StaffRefreshBar relocated to /admin/dashboard-data-fetch in v1.2.8.
// The component still lives in ./refresh-bar — the admin page imports
// it from there.
import {
  WorkforceThumb,
  FacultyByProgramThumb,
  ResearchThumb,
  CompensationThumb,
  TeachingWorkloadThumb,
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
      'Headcount, age, tenure, recent hires and departures — plus a 5-year heads-up on who is nearing retirement. Side-by-side academic and support views.',
    Thumb: WorkforceThumb,
  },
  {
    href: '/staff/faculty-by-program',
    icon: BookOpen,
    title: 'Programs and their staff',
    blurb:
      'Drill from faculty into each program to see who teaches there. Programs with fewer than 5 อาจารย์ผู้รับผิดชอบหลักสูตร are flagged.',
    Thumb: FacultyByProgramThumb,
  },
  {
    href: '/staff/research',
    icon: Microscope,
    title: 'Research and publications',
    blurb:
      "All KKU staff publications (Scopus + PubMed, incl. retired) from the internal kku-publications mirror. Year-trend, faculty heatmap, source / output-type breakdowns, top venues, top-30 authors, productivity-by-rank, and Faculty → Author drill-down.",
    Thumb: ResearchThumb,
  },
  {
    href: '/staff/compensation',
    icon: Wallet,
    title: 'Salaries and funding',
    blurb:
      "Where each person's salary comes from (government allocation vs university revenue) and the income-band mix per faculty. Numbers only shown where at least 5 people fall in a bucket.",
    Thumb: CompensationThumb,
  },
  {
    href: '/staff/teaching-workload',
    icon: ClipboardList,
    title: 'Teaching workload',
    blurb:
      "Contact hours per teacher per week, summed across every section they teach. A workload-distribution histogram surfaces the under- and over-loaded tails, a faculty pulse compares the houses, a students-taught chart shows reach, and a Faculty → Teacher drill-down ranks individuals.",
    Thumb: TeachingWorkloadThumb,
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
                    <Icon className="h-5 w-5" />
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

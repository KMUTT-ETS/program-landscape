import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import { Users, BookOpen, Microscope, Wallet, Library } from 'lucide-react';
import type { RefreshStatus } from './types';
import { StaffRefreshBar } from './refresh-bar';
import {
  WorkforceThumb,
  FacultyByProgramThumb,
  ResearchThumb,
  CompensationThumb,
  PublicationsThumb,
} from './thumbnails';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff dashboard' };

const TILES = [
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
      "Last 5 years' publications and citations per faculty. Drill in to see each author's track record and h-index. Filter by faculty or rank.",
    Thumb: ResearchThumb,
  },
  {
    href: '/staff/publications',
    icon: Library,
    title: 'Publications corpus (kku-publications)',
    blurb:
      'The full Scopus + PubMed corpus from the internal kku-publications mirror — 81k+ papers across 36 faculties. Drill faculty → department → author. Year-trend, top venues, source/type breakdown.',
    Thumb: PublicationsThumb,
  },
  {
    href: '/staff/compensation',
    icon: Wallet,
    title: 'Salaries and funding',
    blurb:
      "Where each person's salary comes from (government allocation vs university revenue) and the income-band mix per faculty. Numbers only shown where at least 5 people fall in a bucket.",
    Thumb: CompensationThumb,
  },
];

export default async function StaffHubPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const status = await apiFetch<RefreshStatus>('/staff-dashboard/refresh/status').catch(
    () => null,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Staff dashboard"
        subtitle="A live view of KKU's workforce — academic and support staff together. Refreshes automatically every morning."
      />

      <StaffRefreshBar initialStatus={status} />

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

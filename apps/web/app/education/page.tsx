import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { Card, PageHeader } from '@kku/ui';
import {
  GraduationCap,
  MapPin,
  Layers,
  Globe2,
  Coins,
  TrendingUp,
} from 'lucide-react';
import type { RefreshStatus } from './types';
import { EducationRefreshBar } from './refresh-bar';
import {
  ActivePivotThumb,
  InternationalThumb,
  LocationThumb,
  PerformanceThumb,
  StudentInfoThumb,
  TuitionThumb,
} from './thumbnails';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Education dashboard' };

const TILES = [
  {
    href: '/education/student-info',
    icon: GraduationCap,
    title: 'Student info',
    blurb:
      'Headcount by program level, recruitment method, gender, nationality, Thai / non-Thai. Filter by faculty, level, program, and student status.',
    Thumb: StudentInfoThumb,
  },
  {
    href: '/education/location',
    icon: MapPin,
    title: 'Student by location',
    blurb:
      "Where this year's intake comes from — by school, province, and Thailand region. Filter by entry year and region.",
    Thumb: LocationThumb,
  },
  {
    href: '/education/active-pivot',
    icon: Layers,
    title: 'Active students by entry year',
    blurb:
      'Pivot table — entry-year columns × Faculty → Program Level → Program drill-down. Currently-enrolled students only.',
    Thumb: ActivePivotThumb,
  },
  {
    href: '/education/international',
    icon: Globe2,
    title: 'International students',
    blurb:
      'Headcount by country, with a Faculty → Program drill-down × program-level pivot.',
    Thumb: InternationalThumb,
  },
  {
    href: '/education/tuition',
    icon: Coins,
    title: 'Tuition fee incomes',
    blurb:
      'Revenue by year, faculty, semester. Drill-down pivot Faculty → Program Level → Program × academic year.',
    Thumb: TuitionThumb,
  },
  {
    href: '/education/performance',
    icon: TrendingUp,
    title: 'Student performance',
    blurb:
      'Undergraduate GPAs and entry test scores. Faculty → Program drill-down on average GPA, plus a Region → Province → School → Faculty → Program location view, plus a per-subject score pivot.',
    Thumb: PerformanceThumb,
  },
];

export default async function EducationHubPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const status = await apiFetch<RefreshStatus>('/education/refresh/status').catch(
    () => null,
  );

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Education dashboard"
        subtitle="Interactive views of registrar data — student demographics, location, tuition, and international cohorts. Click Refresh to pull the latest snapshot from the registrar."
      />

      <EducationRefreshBar initialStatus={status} />

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {TILES.map((t) => {
          const Icon = t.icon;
          const Thumb = t.Thumb;
          return (
            <Link key={t.href} href={t.href} className="block">
              <Card className="flex h-full flex-col gap-3 p-0 transition-colors hover:bg-surface-2">
                {/* Thumbnail sits at the top of the tile and gets to set
                    its own aspect ratio (240×120 viewBox = 2:1). The
                    `aspect-[2/1]` on the wrapper keeps the SVG fully
                    visible no matter the tile width. */}
                <div className="aspect-[2/1] w-full overflow-hidden rounded-t-md">
                  <Thumb />
                </div>
                <div className="flex items-start gap-3 px-4 pb-4">
                  <div className="rounded-md bg-accent-subtle p-2 text-accent">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold">{t.title}</h3>
                    <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                      {t.blurb}
                    </p>
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

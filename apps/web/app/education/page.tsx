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
import {
  GraduationCap,
  MapPin,
  Layers,
  Globe2,
  Coins,
  TrendingUp,
  Filter,
  CalendarRange,
  MessageSquare,
  Radar,
} from 'lucide-react';
// EducationRefreshBar relocated to /admin/dashboard-data-fetch in v1.2.8.
// The component still lives in ./refresh-bar — the admin page imports
// it from there. Dropping the import here drops it from this page.
import {
  ActivePivotThumb,
  ClassOfferingsThumb,
  InternationalThumb,
  LocationThumb,
  PerformanceThumb,
  RecruitmentThumb,
  SatisfactionThumb,
  StudentDqThumb,
  StudentInfoThumb,
  TuitionThumb,
} from './thumbnails';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Education dashboard' };

// `programAware` flags the tiles a PROGRAM_USER can open. The rest are
// faculty-scope-only and would 403 if opened — we filter them out of the
// hub for PROGRAM_USER instead of showing dead links.
const TILES: Array<{
  href: string;
  icon: typeof Filter;
  title: string;
  blurb: string;
  Thumb: typeof RecruitmentThumb;
  programAware?: boolean;
}> = [
  {
    href: '/education/recruitment-campaigns',
    icon: Filter,
    title: 'Undergraduate recruitment',
    blurb:
      'Full TCAS round 1–4 funnel at the practical campaign grain — per intake / track (competency, language, exam option, quota type, branch-campus). Plan → seats → applicants → passed → Clearinghouse → enrolled, with competition rate, year-over-year trend, declining / empty tracks, and a Faculty → program → sub-program → round drill. Source: POWERBI.ADMISSION_STAT.',
    Thumb: RecruitmentThumb,
  },
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
  {
    href: '/education/student-dq',
    icon: Radar,
    title: 'Student DQ',
    blurb:
      "Every undergraduate's results on the university's Digital Intelligence competency test, drilled from faculty down to programme, with a module-by-module radar.",
    Thumb: StudentDqThumb,
  },
  {
    href: '/education/class-offerings',
    icon: CalendarRange,
    title: 'Subject offerings & fulfilment',
    blurb:
      "Every course-section the registrar opened in a given semester. See how well classes are filling, where empty sections are piling up, who's running the General-Education catalogue, and drill from faculty → program level → course to find the long tail of under-filled subjects.",
    Thumb: ClassOfferingsThumb,
    programAware: true,
  },
  {
    href: '/education/satisfaction',
    icon: MessageSquare,
    title: 'Student evaluations',
    blurb:
      'Course satisfaction from 1.4M student-evaluation responses across 5 years. Heatmap of Faculty → Program Level → Program → Course ratings, semester trend, and per-course question-by-question detail on hover.',
    Thumb: SatisfactionThumb,
  },
];

export default async function EducationHubPage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  // Refresh moved to /admin/dashboard-data-fetch (v1.2.8) — was here
  // as a top-strip but only admins could actually fire it. The legacy
  // status fetch is removed to keep this page snappy for everyone else.
  const canRefresh = isUniversityWide(role);

  // Everyone with a usable grant sees every tile — per-endpoint
  // clamping narrows the data, not the menu. (PROGRAM_USER on a
  // faculty-grain tile lands on their program's faculty's data,
  // rolled up via clampFacultyNameFilter; on the two program-aware
  // tiles they see only their program's courses.)
  const isProgramOnly = !canSeeFacultyDashboards(role);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Education dashboard"
        subtitle={
          canRefresh
            ? 'Interactive views of registrar data — student demographics, location, tuition, and international cohorts. Snapshots refresh nightly; manual rebuilds live in /admin/dashboard-data-fetch.'
            : isProgramOnly
              ? "Interactive views of registrar data. The two program-aware tiles are clamped to your program's courses; the rest show your program's faculty for context."
              : "Interactive views of your faculty's registrar data — student demographics, location, tuition, and international cohorts. Snapshots refresh nightly across the whole university."
        }
      />

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

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
import { getBenchmarkingOverview, getDashboardOverview, prisma, type DashboardOverview } from '@kku/db';
import {
  Card,
  CardHeader,
  CardTitle,
  FreshnessBadge,
  PageHeader,
  ProvenanceButton,
  Stat,
} from '@kku/ui';
import type { SessionUser } from '@kku/shared';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { StrategicMatrixHero } from '@/components/dashboard/strategic-matrix-hero';
import type { CockpitMatrix } from '../../cockpit/types';
import { AlertColumn } from '@/components/dashboard/alert-card';
import { LevelMix } from '@/components/dashboard/level-mix';
import { PulseStrip } from '@/components/dashboard/pulse-strip';
import { LifecycleVerdictViz } from '@/components/dashboard/lifecycle-verdict';
import { HealthByFaculty } from '@/components/dashboard/health-by-faculty';
import { CurriculumModernity } from '@/components/dashboard/curriculum-modernity';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Executive Landscape · KKU' };

export default async function ExecutiveLandscapePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;

  // Scope-aware home page. Admin-grade + UNIVERSITY_USER see the full
  // 297-program rollup; FACULTY_USER sees their faculty's slice;
  // PROGRAM_USER sees their assigned program(s). Multi-grant users
  // (e.g. PROGRAM_USER in 3 programs) see the UNION — fan-out below.
  const isUniversityWide =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'SYSTEM_ADMIN' ||
    user.role === 'UNIVERSITY_USER';

  // Resolve effective scope (primary + UserScope rows) for multi-grant
  // detection. Same logic as scope-guards.ts resolveEffectiveScope but
  // inlined to keep the page self-contained.
  const seesAll =
    user.role === 'SUPER_ADMIN' ||
    user.role === 'SYSTEM_ADMIN' ||
    user.role === 'UNIVERSITY_USER';
  let grantedFacultyIds: string[] = [];
  let grantedProgramIds: string[] = [];
  if (!seesAll) {
    const scopes = await prisma.userScope.findMany({
      where: { userId: user.userId },
      select: { role: true, facultyId: true, programId: true },
    });
    if (scopes.some((s) => s.role === 'SUPER_ADMIN' || s.role === 'SYSTEM_ADMIN' || s.role === 'UNIVERSITY_USER')) {
      // Elevated via UserScope — treat as university-wide.
    } else {
      const fids = new Set<string>();
      const pids = new Set<string>();
      if (user.role === 'FACULTY_USER' && user.facultyId) fids.add(user.facultyId);
      if (user.role === 'PROGRAM_USER' && user.programId) pids.add(user.programId);
      for (const s of scopes) {
        if (s.role === 'FACULTY_USER' && s.facultyId) fids.add(s.facultyId);
        if (s.role === 'PROGRAM_USER' && s.programId) pids.add(s.programId);
      }
      grantedFacultyIds = [...fids];
      grantedProgramIds = [...pids];
    }
  }
  const isElevatedByUserScope = !seesAll && !isUniversityWide && grantedFacultyIds.length === 0 && grantedProgramIds.length === 0;
  const effectivelyUniversityWide = isUniversityWide || isElevatedByUserScope;

  // Build the fan-out target list (one per granted scope). Drop
  // program grants whose faculty is already covered by a faculty
  // grant — otherwise the program shows twice (once rolled up under
  // the faculty target, once via its own).
  let overviewTargets: Array<{ programId?: string; facultyId?: string }>;
  if (effectivelyUniversityWide) {
    overviewTargets = [{}];
  } else {
    let programGrantsToFanOut = grantedProgramIds;
    if (grantedFacultyIds.length > 0 && grantedProgramIds.length > 0) {
      const facultySet = new Set(grantedFacultyIds);
      const progs = await prisma.program.findMany({
        where: { id: { in: grantedProgramIds } },
        select: { id: true, facultyId: true },
      });
      const facByProgram = new Map(progs.map((p) => [p.id, p.facultyId]));
      programGrantsToFanOut = grantedProgramIds.filter((pid) => {
        const fid = facByProgram.get(pid);
        return !fid || !facultySet.has(fid);
      });
    }
    overviewTargets = [
      ...grantedFacultyIds.map((fid) => ({ facultyId: fid })),
      ...programGrantsToFanOut.map((pid) => ({ programId: pid })),
    ];
  }

  // For the matrix we let the cockpit endpoint do its own fan-out
  // (already multi-scope-aware via cockpitScopeTargets). Just pass the
  // requested scope; the API unions internally.
  const matrixQuery = effectivelyUniversityWide
    ? 'scope=university'
    : grantedFacultyIds.length === 1 && grantedProgramIds.length === 0
      ? `scope=faculty&scopeId=${encodeURIComponent(grantedFacultyIds[0]!)}`
      : grantedProgramIds.length === 1 && grantedFacultyIds.length === 0
        ? `scope=program&scopeId=${encodeURIComponent(grantedProgramIds[0]!)}`
        : 'scope=university'; // API clamps; multi-target fan-out happens server-side

  // Run the overview fan-out (1 call for single-grant; N for multi).
  const overviewParts = await Promise.all(overviewTargets.map((t) => getDashboardOverview(t)));
  const overview = overviewParts.length === 1 ? overviewParts[0]! : combineDashboardOverviews(overviewParts);

  const strategicMatrix = await apiFetch<CockpitMatrix>(`/cockpit/matrix?${matrixQuery}`).catch(() => null);

  // Portfolio-level curriculum-modernity counts (university-wide AI peer review)
  // — sits beside the Strategic Matrix.
  const modernityCounts = await getBenchmarkingOverview()
    .then((o) => o.hero.modernityCounts)
    .catch(() => null);

  // Scope label injected into every PanelFrame's provenance drawer so
  // the user can see which slice they're looking at.
  const provenanceScope: { level: 'university' | 'faculty' | 'program'; id: string | null } =
    effectivelyUniversityWide
      ? { level: 'university', id: null }
      : grantedProgramIds.length > 0 && grantedFacultyIds.length === 0
        ? { level: 'program', id: grantedProgramIds[0] ?? null }
        : { level: 'faculty', id: grantedFacultyIds[0] ?? null };
  const k = overview.kpis;
  const bulkRunning = k.bulkPipelineProgress.done < k.bulkPipelineProgress.total;
  const generatedAtIso = overview.generatedAt.toISOString();

  return (
    <AuthedAppShell user={user}>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 p-6">
        {/* HEADER */}
        <PageHeader
          eyebrow="Module 00 · Executive Landscape"
          title="Curriculum Landscape"
          subtitle={
            isUniversityWide
              ? `Strategic snapshot of all ${k.programCount} KKU programs across ${k.facultyCount} faculties.`
              : user.role === 'PROGRAM_USER'
                ? `Strategic snapshot of the program assigned to your account.`
                : `Strategic snapshot of ${k.programCount} programs in your faculty.`
          }
          actions={<FreshnessBadge freshnessDate={generatedAtIso} label="dashboard sync" />}
        />

        {/* HERO STATS */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <HeroStat
            tone="default"
            label="Programs"
            value={k.programCount.toLocaleString('en-US')}
            sub={`${k.facultyCount} faculties`}
          />
          <HeroStat
            tone="default"
            label="Currently enrolled"
            value={k.latestEnrolled.toLocaleString('en-US')}
            sub="all active students (status 10–39)"
          />
          <HeroStat
            tone="positive"
            label="Net contribution"
            value={`฿${(k.netContributionThb / 1_000_000).toFixed(0)}M`}
            sub="FY 2024+ aggregate"
          />
          <HeroStat
            tone="warning"
            label="Crashing"
            value={k.crashingCount.toString()}
            sub="−50%+ enrolment in 3 yrs"
          />
          <HeroStat
            tone="danger"
            label="BACHELOR · below KKU floor"
            value={k.intakePolicy.bachelorBreach.toString()}
            sub={`< ${30} intake · closure-track per Council policy`}
          />
        </div>
        {(k.intakePolicy.bachelorBreach > 0 || k.intakePolicy.postgradWatch > 0) && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-text-secondary">
            <strong className="text-warning">KKU intake-floor policy:</strong>{' '}
            {k.intakePolicy.bachelorBreach} BACHELOR programs in <strong>breach</strong> (intake &lt; 30 — closure-track),{' '}
            {k.intakePolicy.postgradWatch} postgrad programs on <strong>watch list</strong> (intake &lt; 8). {' '}
            {k.intakePolicy.bachelorCompliant + k.intakePolicy.postgradCompliant} compliant ·{' '}
            {k.intakePolicy.unknownCount} unknown (no recent intake data).
          </div>
        )}

        {/* PULSE STRIP — only visible while bulk running */}
        {bulkRunning && (
          <PulseStrip
            done={k.bulkPipelineProgress.done}
            total={k.bulkPipelineProgress.total}
            lastCompletedCode={k.bulkPipelineProgress.lastCompletedCode}
            lastCompletedAt={k.bulkPipelineProgress.lastCompletedAt?.toISOString() ?? null}
            pulse={overview.pulse.map((p) => ({ ...p, generatedAt: p.generatedAt.toISOString() }))}
          />
        )}

        {/* HERO — BCG-style Strategic Matrix at university scope.
            Re-uses the cockpit's matrix view as the home-page anchor.
            Same data, click-to-deep-dive, matches what users see when
            they navigate to /cockpit/matrix. */}
        {strategicMatrix && (
          <div className={modernityCounts ? 'grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]' : ''}>
            <PanelFrame
              title="BCG-style Strategic Matrix"
              description={`X = ${strategicMatrix.axisX.label} · Y = ${strategicMatrix.axisY.label}. Each dot is one program. Click any dot to open the program's deep-dive. Same view as the cockpit's Strategic Matrix at university scope.`}
              freshnessDate={generatedAtIso}
              provenanceMeta={{
                freshnessDate: generatedAtIso,
                sources: [
                  { id: 'health_score', name: 'KKU health score (drives axes)' },
                  { id: 'financial_metrics', name: 'KKU Finance · revenue & contribution' },
                ],
                methodologyVersion: strategicMatrix.methodologyVersion,
                scope: provenanceScope,
              }}
            >
              <StrategicMatrixHero matrix={strategicMatrix} />
            </PanelFrame>
            {modernityCounts && (
              <PanelFrame
                title="Curriculum modernity verdict"
                description="Where KKU's AI-reviewed curricula sit on the old-school → frontier spectrum, judged against named peer programs."
                freshnessDate={generatedAtIso}
                provenanceMeta={{
                  freshnessDate: generatedAtIso,
                  sources: [{ id: 'peer_review', name: 'AI peer review · content modernity' }],
                  methodologyVersion: 'program-peer-review.v3',
                  scope: provenanceScope,
                }}
              >
                <CurriculumModernity counts={modernityCounts} variant="compact" />
              </PanelFrame>
            )}
          </div>
        )}

        {/* ROW: LIFECYCLE VERDICT + FACULTY HEALTH */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <PanelFrame
            title="Lifecycle verdict"
            description="Forward-looking trajectory across all programs. Combines AI readiness, content modernity, enrolment + financial trends, capability strength, demographic resilience."
            freshnessDate={overview.lifecycle.latestComputedAt?.toISOString() ?? generatedAtIso}
            provenanceMeta={{
              freshnessDate: overview.lifecycle.latestComputedAt?.toISOString() ?? generatedAtIso,
              sources: [
                { id: 'health_score', name: 'KKU health score (5 dimensions)' },
                { id: 'ai_readiness', name: 'AI readiness assessment (per-program)' },
                { id: 'peer_review', name: 'AI peer review · content modernity' },
              ],
              methodologyVersion:
                overview.lifecycle.methodologyVersions[0] ?? overview.methodologyVersion,
              scope: provenanceScope,
            }}
          >
            <LifecycleVerdictViz
              total={overview.lifecycle.total}
              expectedTotal={overview.lifecycle.expectedTotal}
              counts={overview.lifecycle.counts}
              methodologyVersions={overview.lifecycle.methodologyVersions}
              latestComputedAt={overview.lifecycle.latestComputedAt?.toISOString() ?? null}
              programs={overview.lifecycle.programs}
            />
          </PanelFrame>

          <PanelFrame
            title={
              isUniversityWide
                ? 'Health score · by faculty'
                : user.role === 'PROGRAM_USER'
                  ? 'Health score · your program'
                  : 'Health score · by department'
            }
            description="Equal-weighted across 5 dimensions: attractiveness, financial, capability, outcomes, relevance. Click any row to drill in."
            freshnessDate={generatedAtIso}
            provenanceMeta={{
              freshnessDate: generatedAtIso,
              sources: [
                { id: 'enrollment_metrics', name: 'KKU Registry · enrolment metrics' },
                { id: 'financial_metrics', name: 'KKU Finance · revenue + cost' },
                { id: 'graduate_outcomes', name: 'KKU Alumni · outcomes' },
                { id: 'kmitl_demand', name: 'LinkedIn labour-market skill demand · subscribed by MHESI (API hosted by KMITL)' },
              ],
              methodologyVersion: 'health-score.v1',
              scope: provenanceScope,
            }}
          >
            <HealthByFaculty
              rows={overview.facultyHealth.map((r) => ({ ...r }))}
              methodologyVersion="health-score.v1"
            />
          </PanelFrame>
        </div>

        {/* DEMOGRAPHIC MIX */}
        <Card padding="md" className="flex flex-col gap-4">
          <CardHeader className="mb-0">
            <CardTitle className="text-sm">Demographic mix</CardTitle>
          </CardHeader>
          <LevelMix rows={overview.levelMix} />
          <p className="text-[11px] text-text-tertiary">
            Thailand 18–22 cohort declines ~1.8%/yr. Bachelor's exposure is highest;
            Doctoral programs already average &lt;2 students each.
          </p>
        </Card>

        {/* RISK + MOMENTUM */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card padding="md">
            <AlertColumn
              tone="urgent"
              alerts={overview.urgent}
              title="Urgent review"
              emptyHint="No programs in the urgent-review window."
            />
          </Card>
          <Card padding="md">
            <AlertColumn
              tone="momentum"
              alerts={overview.momentum}
              title="Momentum (3-yr enrolment growth)"
              emptyHint="No high-growth programs detected in the 3-yr window."
            />
          </Card>
        </div>

        {/* FOOTER STAT GRID — for analyst eyes */}
        <Card padding="md" className="bg-surface-2/40">
          <CardHeader className="mb-3">
            <CardTitle className="text-xs uppercase tracking-wide text-text-tertiary">
              Coverage & data quality
            </CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat
              label="Matrix coverage"
              value={`${strategicMatrix?.bubbles.length ?? 0}/${k.programCount}`}
            />
            <Stat label="Surging programs" value={k.surgingCount} />
            <Stat label="Crashing programs" value={k.crashingCount} />
            <Stat
              label="Strategic narratives"
              value={`${k.bulkPipelineProgress.done}/${k.bulkPipelineProgress.total}`}
            />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">
            Methodology version: <span className="font-tabular text-text-secondary">{overview.methodologyVersion}</span>
            <span className="mx-2 opacity-60">·</span>
            Scope:{' '}
            {isUniversityWide
              ? 'university · all 24 faculties'
              : user.role === 'PROGRAM_USER'
                ? 'program · your assigned program'
                : 'faculty · your assigned faculty'}
            <span className="mx-2 opacity-60">·</span>
            <Link href="/cockpit" className="text-accent-default hover:underline">
              Drill into the cockpit →
            </Link>
          </p>
        </Card>
      </div>
    </AuthedAppShell>
  );
}

function PanelFrame({
  title,
  description,
  freshnessDate,
  provenanceMeta,
  children,
}: {
  title: string;
  description?: string;
  freshnessDate: string;
  provenanceMeta: React.ComponentProps<typeof ProvenanceButton>['meta'];
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-1 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-text-primary">{title}</h3>
            <ProvenanceButton size="xs" title={title} meta={provenanceMeta} />
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-text-tertiary">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FreshnessBadge freshnessDate={freshnessDate} label={title} />
        </div>
      </header>
      {children}
    </section>
  );
}

function HeroStat({
  tone,
  label,
  value,
  sub,
}: {
  tone: 'default' | 'positive' | 'warning' | 'danger';
  label: string;
  value: string;
  sub: string;
}) {
  const valueClass = {
    default: 'text-text-primary',
    positive: 'text-positive',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-4">
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`font-tabular text-2xl font-semibold ${valueClass}`}>{value}</p>
      <p className="text-[11px] text-text-tertiary">{sub}</p>
    </div>
  );
}

// Combine N single-scope DashboardOverview responses for multi-grant
// users. Per user spec only the headline KPI hero needs the multi-
// grant union — other panels (urgent / momentum / facultyTiles /
// lifecycle / pulse / facultyHealth) keep the first part's data,
// scoped to their granted programs naturally (each part is per
// program/faculty so the rows already belong to the user).
//
// KPIs:
//   programCount, facultyCount: COUNT DISTINCT (since multiple
//     programs in the same faculty shouldn't double-count faculties)
//   latestEnrolled, netContributionThb, *Count, intakePolicy.*: SUM
//   bulkPipelineProgress: SUM done+total; pick max lastCompletedAt
function combineDashboardOverviews(parts: DashboardOverview[]): DashboardOverview {
  if (parts.length === 0) throw new Error('combineDashboardOverviews requires at least one part');
  if (parts.length === 1) return parts[0]!;
  const first = parts[0]!;

  const sumN = (key: keyof typeof first.kpis): number =>
    parts.reduce<number>((acc, p) => acc + ((p.kpis[key] as number | null | undefined) ?? 0), 0);

  // No-op block kept for the comment below — counts now sum directly
  // (each fan-out call returns the count for its own scope; summing
  // gives the union total). Earlier we tried COUNT DISTINCT from
  // quadrant.points, but quadrant excludes programs without recent
  // enrollment data, so a sparse-data program would silently drop
  // out of the KPI count.

  let lastCompletedAt: Date | null = null;
  let lastCompletedCode: string | null = null;
  let bulkDone = 0;
  let bulkTotal = 0;
  for (const p of parts) {
    const b = p.kpis.bulkPipelineProgress;
    bulkDone += b.done;
    bulkTotal += b.total;
    if (b.lastCompletedAt && (!lastCompletedAt || b.lastCompletedAt > lastCompletedAt)) {
      lastCompletedAt = b.lastCompletedAt;
      lastCompletedCode = b.lastCompletedCode;
    }
  }

  // Return the first part's overview with the rolled-up KPIs spliced in.
  // Other fields (urgent / momentum / facultyTiles / facultyHealth /
  // lifecycle / pulse / quadrant / levelMix) are taken from the first
  // part — those panels are per-row lists that don't need merging for
  // the user's current need (only the KPI hero summary).
  return {
    ...first,
    kpis: {
      programCount: sumN('programCount'),
      facultyCount: sumN('facultyCount'),
      latestEnrolled: sumN('latestEnrolled'),
      netContributionThb: sumN('netContributionThb'),
      zeroEnrollmentCount: sumN('zeroEnrollmentCount'),
      crashingCount: sumN('crashingCount'),
      surgingCount: sumN('surgingCount'),
      intakePolicy: {
        bachelorBreach: parts.reduce((a, p) => a + p.kpis.intakePolicy.bachelorBreach, 0),
        postgradWatch: parts.reduce((a, p) => a + p.kpis.intakePolicy.postgradWatch, 0),
        bachelorCompliant: parts.reduce((a, p) => a + p.kpis.intakePolicy.bachelorCompliant, 0),
        postgradCompliant: parts.reduce((a, p) => a + p.kpis.intakePolicy.postgradCompliant, 0),
        unknownCount: parts.reduce((a, p) => a + p.kpis.intakePolicy.unknownCount, 0),
      },
      bulkPipelineProgress: {
        done: bulkDone,
        total: bulkTotal,
        lastCompletedAt,
        lastCompletedCode,
      },
    },
  };
}

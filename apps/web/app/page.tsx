import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { getDashboardOverview } from '@kku/db';
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
import { HeroQuadrant } from '@/components/dashboard/hero-quadrant';
import { FacultyTreemap } from '@/components/dashboard/faculty-treemap';
import { AlertColumn } from '@/components/dashboard/alert-card';
import { LevelMix } from '@/components/dashboard/level-mix';
import { PulseStrip } from '@/components/dashboard/pulse-strip';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curriculum Landscape · KKU' };

export default async function HomePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;

  const overview = await getDashboardOverview();
  const k = overview.kpis;
  const bulkRunning = k.bulkPipelineProgress.done < k.bulkPipelineProgress.total;
  const generatedAtIso = overview.generatedAt.toISOString();

  // Caveat for the hero quadrant: every program shows positive net
  // contribution today because cost-allocation methodology is still
  // pending Finance Committee approval (see CLAUDE.md). Be honest about
  // it on the chart.
  const quadrantCaveat =
    overview.quadrant.points.filter((p) => p.quadrant === 'dog' || p.quadrant === 'question').length === 0
      ? 'Cost-allocation methodology pending — every program shows positive net contribution because allocated costs are zero. True "Dog" / "Question" quadrants will appear once cost methodology is approved.'
      : undefined;

  return (
    <AuthedAppShell user={user}>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 p-6">
        {/* HEADER */}
        <PageHeader
          eyebrow="Module 00 · Executive Landscape"
          title="Curriculum Landscape"
          subtitle={`Strategic snapshot of all ${k.programCount} KKU programs across ${k.facultyCount} faculties.`}
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
            sub="latest academic year"
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

        {/* HERO QUADRANT */}
        <PanelFrame
          title="Lifecycle × Revenue Quadrant"
          description="Each dot is one program. X = 3-year enrolment change. Y = net contribution. Click any dot to drill into the program."
          freshnessDate={generatedAtIso}
          provenanceMeta={{
            freshnessDate: generatedAtIso,
            sources: [
              { id: 'enrollment_metrics', name: 'KKU Registry · enrolment metrics' },
              { id: 'financial_metrics', name: 'KKU Finance · tuition revenue' },
            ],
            methodologyVersion: overview.methodologyVersion,
            scope: { level: 'university', id: null },
          }}
        >
          <HeroQuadrant
            points={overview.quadrant.points}
            excludedCount={overview.quadrant.excludedCount}
            caveat={quadrantCaveat}
          />
        </PanelFrame>

        {/* ROW: TREEMAP + ALERTS */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PanelFrame
              title="Portfolio composition"
              description="Box size = current enrolment. Colour intensity = net contribution per student. Click a faculty to scope the cockpit."
              freshnessDate={generatedAtIso}
              provenanceMeta={{
                freshnessDate: generatedAtIso,
                sources: [{ id: 'enrollment_metrics', name: 'KKU Registry' }],
                methodologyVersion: overview.methodologyVersion,
                scope: { level: 'university', id: null },
              }}
            >
              <FacultyTreemap tiles={overview.facultyTiles} height={420} />
            </PanelFrame>
          </div>

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
        </div>

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
              label="Quadrant coverage"
              value={`${overview.quadrant.points.length}/${k.programCount}`}
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
            Scope: university · all 24 faculties
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

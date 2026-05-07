import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api-client';
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
import { StrategicMatrixHero } from '@/components/dashboard/strategic-matrix-hero';
import type { CockpitMatrix } from './cockpit/types';
import { AlertColumn } from '@/components/dashboard/alert-card';
import { LevelMix } from '@/components/dashboard/level-mix';
import { PulseStrip } from '@/components/dashboard/pulse-strip';
import { LifecycleVerdictViz } from '@/components/dashboard/lifecycle-verdict';
import { HealthByFaculty } from '@/components/dashboard/health-by-faculty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Curriculum Landscape · KKU' };

export default async function HomePage() {
  const session = await auth();
  if (!session?.user || !(session.user as SessionUser).userId) {
    redirect('/signin');
  }
  const user = session.user as SessionUser;

  const [overview, strategicMatrix] = await Promise.all([
    getDashboardOverview(),
    apiFetch<CockpitMatrix>('/cockpit/matrix?scope=university').catch(() => null),
  ]);
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
              scope: { level: 'university', id: null },
            }}
          >
            <StrategicMatrixHero matrix={strategicMatrix} />
          </PanelFrame>
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
              scope: { level: 'university', id: null },
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
            title="Health score · by faculty"
            description="Equal-weighted across 5 dimensions: attractiveness, financial, capability, outcomes, relevance. Click any row to drill into the cockpit."
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
              scope: { level: 'university', id: null },
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

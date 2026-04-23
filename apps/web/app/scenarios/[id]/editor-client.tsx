'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, Tornado, type TornadoRow } from '@kku/ui';
import type { ScenarioDetail, ScenarioEngineOutput, SensitivityEntryDto } from '../types';

type Tab = 'setup' | 'assumptions' | 'simulation' | 'comparison' | 'discussion';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'setup', label: 'Setup' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'comparison', label: 'Comparison' },
  { id: 'discussion', label: 'Discussion' },
];

const ASSUMPTION_LABELS: Record<string, { en: string; unit: string }> = {
  tuitionGrowthPct: { en: 'Tuition growth (annual)', unit: '% / year' },
  costInflationPct: { en: 'Cost inflation (annual)', unit: '% / year' },
  demandGrowthPct: { en: 'Demand growth (annual)', unit: '% / year' },
  retentionRate: { en: 'Retention rate', unit: '0–1' },
  demographicShockPct: { en: 'Demographic shock', unit: '% (added)' },
  financialShockPct: { en: 'Financial shock (revenue)', unit: '%' },
  aiDisplacementPct: { en: 'AI displacement', unit: '% of grads' },
};

export function ScenarioEditorClient({
  scenario,
  initialTab,
  userRole,
}: {
  scenario: ScenarioDetail;
  initialTab: Tab;
  userRole: string;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>(initialTab);

  const goTab = (next: Tab) => {
    setTab(next);
    const qs = new URLSearchParams(window.location.search);
    qs.set('tab', next);
    window.history.replaceState(null, '', `?${qs}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-subtle">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => goTab(t.id)}
            className={
              'border-b-2 px-3 py-2 text-sm transition-colors ' +
              (tab === t.id
                ? 'border-accent-default text-text-primary'
                : 'border-transparent text-text-tertiary hover:text-text-primary')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' && <SetupTab scenario={scenario} />}
      {tab === 'assumptions' && <AssumptionsTab scenario={scenario} onReload={() => router.refresh()} />}
      {tab === 'simulation' && <SimulationTab scenario={scenario} onReload={() => router.refresh()} userRole={userRole} />}
      {tab === 'comparison' && <ComparisonTab scenario={scenario} />}
      {tab === 'discussion' && <DiscussionTab scenario={scenario} userRole={userRole} />}
    </div>
  );
}

// ─── Setup tab ─────────────────────────────────────────────────────
function SetupTab({ scenario }: { scenario: ScenarioDetail }) {
  return (
    <Card padding="md">
      <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name" value={scenario.name} />
        <Field label="Scenario type" value={<Badge tone="outline">{scenario.scenarioType}</Badge>} />
        <Field label="Horizon" value={`${scenario.horizonYears} years`} />
        <Field label="Methodology" value={<code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">{scenario.methodologyVersion}</code>} />
        <Field label="Owner" value={scenario.user?.name ?? scenario.user?.email ?? '—'} />
        <Field label="Updated" value={new Date(scenario.updatedAt).toLocaleString('en-GB')} />
        <Field
          label="Affected programs"
          value={scenario.affectedProgramIds.length === 0 ? '(portfolio-wide)' : `${scenario.affectedProgramIds.length} programs`}
        />
        <Field label="Collaborators" value={scenario.collaboratorIds.length === 0 ? '(none)' : scenario.collaboratorIds.join(', ')} />
      </dl>
      {scenario.descriptionTh ? (
        <div className="mt-4 rounded-md border border-subtle bg-surface-1 p-3 text-sm leading-relaxed text-text-secondary">
          {scenario.descriptionTh}
        </div>
      ) : null}
      {scenario.parent ? (
        <p className="mt-3 text-xs text-text-tertiary">
          Branched from{' '}
          <Link href={`/scenarios/${scenario.parent.id}`} className="underline">
            {scenario.parent.name}
          </Link>
        </p>
      ) : null}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="mt-1 text-sm text-text-primary">{value}</dd>
    </div>
  );
}

// ─── Assumptions tab ──────────────────────────────────────────────
function AssumptionsTab({ scenario, onReload }: { scenario: ScenarioDetail; onReload: () => void }) {
  const [draft, setDraft] = React.useState<Record<string, number>>(scenario.assumptionsJson);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/proxy/scenarios/${scenario.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assumptions: draft }),
      });
      if (!res.ok) throw new Error('patch failed');
      onReload();
    } catch {
      alert('Save failed. Check the server log.');
    } finally {
      setSaving(false);
    }
  };

  const isDirty = Object.entries(draft).some(([k, v]) => v !== scenario.assumptionsJson[k]);

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">Assumptions</h3>
        <span className="text-xs text-text-tertiary">
          Overrides vs system defaults. Bump ± to explore.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
              <th className="py-2 pr-3">Assumption</th>
              <th className="py-2 pr-3 text-right">Current</th>
              <th className="py-2 pr-3">Unit</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft).map(([key, value]) => {
              const meta = ASSUMPTION_LABELS[key] ?? { en: key, unit: '—' };
              return (
                <tr key={key} className="border-b border-subtle last:border-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-text-primary">{meta.en}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{key}</div>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      type="number"
                      step={0.01}
                      value={value}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key]: parseFloat(e.target.value) || 0 }))
                      }
                      className="w-24 rounded-sm border border-default bg-surface-1 px-2 py-1 text-right font-mono text-xs text-text-primary"
                    />
                  </td>
                  <td className="py-2 pr-3 text-xs text-text-tertiary">{meta.unit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={!isDirty}
          onClick={() => setDraft(scenario.assumptionsJson)}
          className="rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs text-text-primary disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          disabled={!isDirty || saving}
          onClick={save}
          className="rounded-md bg-accent-default px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save assumptions'}
        </button>
      </div>
    </Card>
  );
}

// ─── Simulation tab ─────────────────────────────────────────────────
function SimulationTab({ scenario, onReload, userRole: _userRole }: { scenario: ScenarioDetail; onReload: () => void; userRole: string }) {
  const latest = scenario.runs[0];
  const projection = latest?.projectionJson as ScenarioEngineOutput | undefined;
  const [running, setRunning] = React.useState(false);

  const runEngine = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/proxy/scenarios/${scenario.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monteCarloN: 100 }),
      });
      if (!res.ok) throw new Error('run failed');
      onReload();
    } catch {
      alert('Run failed. Check the server log.');
    } finally {
      setRunning(false);
    }
  };

  if (!projection) {
    return (
      <Card padding="lg">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-text-secondary">
            No run yet. Click Run to execute the engine against this scenario's assumptions + interventions.
          </p>
          <button
            type="button"
            disabled={running}
            onClick={runEngine}
            className="rounded-md bg-accent-default px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
          >
            {running ? 'Running…' : 'Run scenario'}
          </button>
        </div>
      </Card>
    );
  }

  const tornadoRows: TornadoRow[] = projection.sensitivity.map((s: SensitivityEntryDto) => ({
    assumptionKey: s.assumptionKey,
    label: ASSUMPTION_LABELS[s.assumptionKey]?.en ?? s.assumptionKey,
    lowOutcomeDelta: s.lowOutcomeDelta,
    highOutcomeDelta: s.highOutcomeDelta,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Year-by-year projection</h3>
              <p className="text-xs text-text-tertiary">
                {projection.scenario.years.length} years · baseline vs scenario · methodology{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">{projection.methodologyVersion}</code>
              </p>
            </div>
            <button
              type="button"
              disabled={running}
              onClick={runEngine}
              className="rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs text-text-primary disabled:opacity-50"
            >
              {running ? 'Re-running…' : 'Re-run'}
            </button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                  <th className="py-2 pr-3">Year</th>
                  <th className="py-2 pr-3 text-right">Enrolled</th>
                  <th className="py-2 pr-3 text-right">Graduates</th>
                  <th className="py-2 pr-3 text-right">Revenue</th>
                  <th className="py-2 pr-3 text-right">Cost</th>
                  <th className="py-2 pr-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {projection.scenario.years.map((y) => (
                  <tr key={y.year} className="border-b border-subtle last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{y.year}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(y.enrolled)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(y.graduates)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(y.revenue)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(y.cost)}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">
                      <span className={y.netContribution >= 0 ? 'text-success' : 'text-danger'}>
                        {fmt(y.netContribution)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-default font-semibold">
                  <td className="py-2 pr-3">Totals</td>
                  <td />
                  <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(projection.scenario.graduatesCumulative)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(projection.scenario.totalRevenue)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">{fmt(projection.scenario.totalCost)}</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">
                    <span className={projection.scenario.totalNetContribution >= 0 ? 'text-success' : 'text-danger'}>
                      {fmt(projection.scenario.totalNetContribution)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card padding="md">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Sensitivity (tornado)</h3>
          <p className="mb-2 text-xs text-text-tertiary">
            Which assumption most changes the net contribution when perturbed ±10%?
          </p>
          <Tornado rows={tornadoRows} width={700} />
        </Card>
      </div>

      <aside className="flex flex-col gap-3">
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Vs baseline (no interventions)</h3>
          <dl className="space-y-1 text-sm">
            <Delta label="Revenue" value={projection.deltaTotalRevenue} />
            <Delta label="Cost" value={projection.deltaTotalCost} invert />
            <Delta label="Net contribution" value={projection.deltaTotalNetContribution} />
          </dl>
        </Card>

        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Monte Carlo (N={projection.monteCarloN})</h3>
          <dl className="space-y-1 text-sm">
            <Field label="Mean net contribution" value={fmt(projection.monteCarlo.totalNetContributionMean)} />
            <Field
              label="80% CI"
              value={`[${fmt(projection.monteCarlo.totalNetContributionCi80[0])}, ${fmt(projection.monteCarlo.totalNetContributionCi80[1])}]`}
            />
            <Field label="Std dev" value={fmt(projection.monteCarlo.totalNetContributionStdDev)} />
          </dl>
          <p className="mt-2 text-[10px] leading-relaxed text-text-tertiary">
            Seed={projection.seed}. Reproducible — same seed yields the same band across machines.
          </p>
        </Card>
      </aside>
    </div>
  );
}

function Delta({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? value < 0 : value > 0;
  const colour = value === 0 ? 'text-text-secondary' : good ? 'text-success' : 'text-danger';
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-xs text-text-tertiary">{label}</dt>
      <dd className={`font-mono text-xs ${colour}`}>
        {value >= 0 ? '+' : ''}
        {fmt(value)}
      </dd>
    </div>
  );
}

// ─── Comparison tab ───────────────────────────────────────────────
function ComparisonTab({ scenario: _scenario }: { scenario: ScenarioDetail }) {
  return (
    <Card padding="md">
      <h3 className="text-sm font-semibold text-text-primary">Comparison</h3>
      <p className="mt-2 text-sm text-text-secondary">
        Side-by-side with up to 3 other scenarios (max 4 total). Pick scenarios from the library, then return here. The comparison view with AI narrative lights up after each scenario has a completed run.
      </p>
      <p className="mt-2 text-xs text-text-tertiary">
        Implementation note: the comparison endpoint is live at{' '}
        <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">POST /scenarios/:id/compare</code>. Wiring the multi-select picker here is a small deliverable — today the comparison data is fetched via the API, but the picker UX lives in a follow-up pass.
      </p>
    </Card>
  );
}

// ─── Discussion tab ───────────────────────────────────────────────
function DiscussionTab({ scenario, userRole }: { scenario: ScenarioDetail; userRole: string }) {
  const canCouncilReview = ['EXECUTIVE', 'ADMIN'].includes(userRole);
  const canDecide = ['EXECUTIVE', 'COUNCIL', 'ADMIN'].includes(userRole);
  return (
    <Card padding="md">
      <h3 className="text-sm font-semibold text-text-primary">Workflow + discussion</h3>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={scenario.workflowStatus === 'DECIDED' ? 'success' : scenario.workflowStatus === 'COUNCIL_REVIEWED' ? 'warning' : 'neutral'}>
          {scenario.workflowStatus}
        </Badge>
        <span className="text-xs text-text-tertiary">
          {scenario.workflowStatus === 'DRAFT' && 'Share with collaborators to promote to SHARED.'}
          {scenario.workflowStatus === 'SHARED' && canCouncilReview && 'You can mark this as Council-reviewed.'}
          {scenario.workflowStatus === 'SHARED' && !canCouncilReview && 'Awaiting Executive or Admin to mark Council-reviewed.'}
          {scenario.workflowStatus === 'COUNCIL_REVIEWED' && canDecide && 'You can finalise a decision on this scenario.'}
          {scenario.workflowStatus === 'DECIDED' && 'Decision recorded. Linked to a CouncilDecision row.'}
        </span>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-text-tertiary">
        Threaded comments + evidence attachments live in the Decision Workspace (prompt 12). For now, record context via the Annotation API (same
        <code className="mx-1 rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">/programs/:id/disagreements</code>
        pattern, entityType=<code className="mx-1 rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">scenario</code>).
      </p>
    </Card>
  );
}

// ─── utils ─────────────────────────────────────────────────────────
function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toFixed(0);
}

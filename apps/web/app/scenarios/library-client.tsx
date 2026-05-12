'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@kku/ui';
import { FilterField, FilterRail, FilterSelect } from '@/components/filter-rail';
import type { ScenarioListRow, ScenarioTemplate, WorkflowStatus } from './types';

const STATUS_OPTIONS: Array<{ value: '' | WorkflowStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SHARED', label: 'Shared' },
  { value: 'COUNCIL_REVIEWED', label: 'Council-reviewed' },
  { value: 'DECIDED', label: 'Decided' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'SUNSET', label: 'Sunset' },
  { value: 'MERGE', label: 'Merge' },
  { value: 'LAUNCH', label: 'Launch' },
  { value: 'RESHAPE', label: 'Reshape' },
  { value: 'REBALANCE', label: 'Rebalance' },
];

const STATUS_TONE: Record<WorkflowStatus, 'neutral' | 'outline' | 'warning' | 'success' | 'accent'> = {
  DRAFT: 'outline',
  SHARED: 'neutral',
  COUNCIL_REVIEWED: 'warning',
  DECIDED: 'success',
  ARCHIVED: 'outline',
};

export function ScenariosLibraryClient({
  scenarios,
  templates,
  initialFilters,
}: {
  scenarios: ScenarioListRow[];
  templates: ScenarioTemplate[];
  initialFilters: { status: string; scenarioType: string };
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState(initialFilters);
  const [creating, setCreating] = React.useState(false);

  const applyFilters = (next: typeof filters) => {
    const qs = new URLSearchParams();
    if (next.status) qs.set('status', next.status);
    if (next.scenarioType) qs.set('scenarioType', next.scenarioType);
    router.push(`/scenarios${qs.toString() ? '?' + qs : ''}`);
  };

  const createFromTemplate = async (slug: string, templateName: string) => {
    setCreating(true);
    try {
      const res = await fetch('/api/proxy/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${templateName} — copy`,
          scenarioType: templates.find((t) => t.slug === slug)?.scenarioType ?? 'REBALANCE',
          templateSlug: slug,
        }),
      });
      if (!res.ok) throw new Error('create failed');
      const envelope = (await res.json()) as { data: { id: string } };
      router.push(`/scenarios/${envelope.data.id}`);
    } catch {
      alert('Failed to create scenario from template. Check the server log.');
    } finally {
      setCreating(false);
    }
  };

  const createBlank = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/proxy/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New scenario',
          scenarioType: 'RESHAPE',
          horizonYears: 5,
        }),
      });
      if (!res.ok) throw new Error('create failed');
      const envelope = (await res.json()) as { data: { id: string } };
      router.push(`/scenarios/${envelope.data.id}`);
    } catch {
      alert('Failed to create scenario. Check the server log.');
    } finally {
      setCreating(false);
    }
  };

  const userScenarios = scenarios.filter((s) => !s.isTemplate);
  const templateScenarios = scenarios.filter((s) => s.isTemplate);

  return (
    <div className="flex flex-col gap-5">
      {/* Filter + create bar */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="flex-1">
          <FilterRail cols={2}>
            <FilterField label="Status">
              <FilterSelect
                value={filters.status}
                onChange={(e) => {
                  const next = { ...filters, status: e.target.value };
                  setFilters(next);
                  applyFilters(next);
                }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>
            <FilterField label="Type">
              <FilterSelect
                value={filters.scenarioType}
                onChange={(e) => {
                  const next = { ...filters, scenarioType: e.target.value };
                  setFilters(next);
                  applyFilters(next);
                }}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </FilterSelect>
            </FilterField>
          </FilterRail>
        </div>
        <div className="md:pb-2">
          <button
            type="button"
            onClick={createBlank}
            disabled={creating}
            className="rounded-md border border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
          >
            + New blank scenario
          </button>
        </div>
      </div>

      {/* Templates panel */}
      {templates.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-tertiary">
            Start from a template
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {templates.map((t) => (
              <Card key={t.slug} padding="md" className="flex flex-col">
                <div className="flex items-center justify-between">
                  <Badge tone="accent">{t.scenarioType}</Badge>
                  <span className="text-xs text-text-tertiary">{t.horizonYears}yr</span>
                </div>
                <h3 className="mt-2 text-sm font-semibold text-text-primary">{t.name}</h3>
                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-text-secondary">
                  {t.descriptionTh}
                </p>
                <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-text-tertiary">
                  {t.caveatTh}
                </p>
                <button
                  type="button"
                  onClick={() => createFromTemplate(t.slug, t.name)}
                  disabled={creating}
                  className="mt-3 rounded-md bg-accent-default px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50"
                >
                  Use this template →
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Scenario list */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-tertiary">
          Your scenarios + shared
        </h2>
        {userScenarios.length === 0 ? (
          <Card padding="lg">
            <p className="text-center text-sm text-text-tertiary">
              No scenarios yet — create a blank one or start from a template above.
            </p>
          </Card>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Horizon</th>
                  <th className="py-2 pr-3 text-right">Runs</th>
                  <th className="py-2 pr-3">Updated</th>
                  <th className="py-2 pr-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {userScenarios.map((s) => (
                  <tr key={s.id} className="border-b border-subtle last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/scenarios/${s.id}`} className="font-medium text-text-primary hover:underline">
                        {s.name}
                      </Link>
                      {s.descriptionTh ? (
                        <div className="line-clamp-1 text-xs text-text-tertiary">{s.descriptionTh}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone="outline">{s.scenarioType}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[s.workflowStatus]}>{s.workflowStatus}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{s.horizonYears}yr</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{s._count.runs}</td>
                    <td className="py-2 pr-3 text-xs text-text-tertiary">
                      {new Date(s.updatedAt).toLocaleDateString('en-GB')}
                    </td>
                    <td className="py-2 pr-3 text-xs text-text-tertiary">
                      {s.user?.name ?? s.user?.email ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {templateScenarios.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-tertiary">
            System templates (read-only)
          </h2>
          <p className="text-xs text-text-tertiary">
            {templateScenarios.length} reference template{templateScenarios.length > 1 ? 's' : ''} seeded with baseline assumptions.
          </p>
        </section>
      )}
    </div>
  );
}


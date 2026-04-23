'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@kku/ui';
import type { DecisionListRow, DecisionStatus } from './types';

const STATUS_OPTIONS: Array<{ value: '' | DecisionStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PROPOSED', label: 'Proposed' },
  { value: 'COUNCIL_REVIEWED', label: 'Council-reviewed' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'IN_IMPLEMENTATION', label: 'In implementation' },
  { value: 'IMPLEMENTED', label: 'Implemented' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'SUPERSEDED', label: 'Superseded' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'CLOSE', label: 'Close' },
  { value: 'MERGE', label: 'Merge' },
  { value: 'LAUNCH', label: 'Launch' },
  { value: 'RESTRUCTURE', label: 'Restructure' },
  { value: 'KEEP_AS_IS', label: 'Keep as is' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_TONE: Record<
  DecisionStatus,
  'neutral' | 'outline' | 'warning' | 'success' | 'danger' | 'accent'
> = {
  PROPOSED: 'outline',
  COUNCIL_REVIEWED: 'warning',
  APPROVED: 'accent',
  IN_IMPLEMENTATION: 'warning',
  IMPLEMENTED: 'success',
  COMPLETED: 'success',
  REJECTED: 'danger',
  SUPERSEDED: 'neutral',
  ARCHIVED: 'outline',
};

export function DecisionsLibraryClient({
  decisions,
  initialFilters,
}: {
  decisions: DecisionListRow[];
  initialFilters: { status: string; decisionType: string };
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState(initialFilters);

  const applyFilters = (next: typeof filters) => {
    const qs = new URLSearchParams();
    if (next.status) qs.set('status', next.status);
    if (next.decisionType) qs.set('decisionType', next.decisionType);
    router.push(`/decisions${qs.toString() ? '?' + qs : ''}`);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Filter bar */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Selector
            label="Status"
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={(v) => {
              const next = { ...filters, status: v };
              setFilters(next);
              applyFilters(next);
            }}
          />
          <Selector
            label="Type"
            value={filters.decisionType}
            options={TYPE_OPTIONS}
            onChange={(v) => {
              const next = { ...filters, decisionType: v };
              setFilters(next);
              applyFilters(next);
            }}
          />
          <div className="ml-auto flex items-center gap-2 text-xs">
            <Link
              href="/decisions/lessons-learned"
              className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2"
            >
              Lessons learned →
            </Link>
          </div>
        </div>
      </Card>

      {/* Decision cards */}
      {decisions.length === 0 ? (
        <Card padding="lg">
          <p className="text-center text-sm text-text-tertiary">
            No decisions match these filters. Council decisions flow in from the Scenario Planner when a scenario is marked DECIDED, or can be created directly here.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {decisions.map((d) => (
            <Link
              key={d.id}
              href={`/decisions/${d.id}`}
              className="block rounded-lg border border-subtle bg-surface-1 p-4 transition-colors hover:border-default hover:bg-surface-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
                    <Badge tone="outline">{d.decisionType}</Badge>
                    {d.version > 1 ? <Badge tone="neutral">v{d.version}</Badge> : null}
                    {d.hasSupersedingDecision ? <Badge tone="outline">superseded</Badge> : null}
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-text-primary">{d.title}</h3>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-text-tertiary">
                <Stat label="Programs" value={d.affectedProgramIds.length} />
                <Stat label="Milestones" value={d.milestoneCount} />
                <Stat label="Approvers" value={d.approverCount} />
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-text-tertiary">
                <span>
                  Effective: {d.effectiveDate ? new Date(d.effectiveDate).toLocaleDateString('en-GB') : '—'}
                </span>
                <span>Updated: {new Date(d.updatedAt).toLocaleDateString('en-GB')}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-default bg-surface-1 px-2 py-1.5 text-sm text-text-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide">{label}</div>
      <div className="font-mono text-sm text-text-primary">{value}</div>
    </div>
  );
}

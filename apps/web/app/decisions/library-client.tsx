'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card, Stat, StatStrip } from '@kku/ui';
import { Archive, CheckCircle2, Clock, Gavel, Play, Sparkles } from 'lucide-react';
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

// Decisions that get the cardinal accent-stripe treatment on their
// card — those actively on the decision path (council-reviewed,
// approved, in implementation).
const ACTIVE_STATUSES: ReadonlySet<DecisionStatus> = new Set<DecisionStatus>([
  'COUNCIL_REVIEWED',
  'APPROVED',
  'IN_IMPLEMENTATION',
]);

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

  const counts = React.useMemo(() => {
    const c = {
      proposed: 0,
      approved: 0,
      inImplementation: 0,
      completed: 0,
      archived: 0,
    };
    for (const d of decisions) {
      if (d.status === 'PROPOSED' || d.status === 'COUNCIL_REVIEWED') c.proposed++;
      else if (d.status === 'APPROVED') c.approved++;
      else if (d.status === 'IN_IMPLEMENTATION') c.inImplementation++;
      else if (d.status === 'IMPLEMENTED' || d.status === 'COMPLETED') c.completed++;
      else if (d.status === 'ARCHIVED' || d.status === 'SUPERSEDED') c.archived++;
    }
    return c;
  }, [decisions]);

  return (
    <div className="flex flex-col gap-5">
      <StatStrip columns={5}>
        <Stat
          moduleKey="decisions"
          icon={<Sparkles />}
          label="In discussion"
          value={counts.proposed}
        />
        <Stat
          moduleKey="decisions"
          icon={<Gavel />}
          label="Approved"
          value={counts.approved}
        />
        <Stat
          moduleKey="decisions"
          icon={<Play />}
          label="Implementing"
          value={counts.inImplementation}
        />
        <Stat
          moduleKey="decisions"
          icon={<CheckCircle2 />}
          label="Completed"
          value={counts.completed}
          deltaTone="positive"
        />
        <Stat
          moduleKey="decisions"
          icon={<Archive />}
          label="Archived"
          value={counts.archived}
        />
      </StatStrip>

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
              className="rounded-md px-2.5 py-1 font-medium text-module-decisions hover:bg-module-decisions/10"
            >
              Lessons learned →
            </Link>
          </div>
        </div>
      </Card>

      {decisions.length === 0 ? (
        <Card padding="lg">
          <p className="text-center text-sm text-text-tertiary">
            No decisions match these filters. Council decisions flow in from the Scenario Planner when a scenario is marked DECIDED, or can be created directly here.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {decisions.map((d) => (
            <Link key={d.id} href={`/decisions/${d.id}`} className="block focus:outline-none">
              <Card
                interactive
                accent={ACTIVE_STATUSES.has(d.status) ? 'decisions' : undefined}
                className="cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={STATUS_TONE[d.status]}>{d.status.replace('_', ' ')}</Badge>
                      <Badge tone="outline">{d.decisionType}</Badge>
                      {d.version > 1 ? <Badge tone="neutral">v{d.version}</Badge> : null}
                      {d.hasSupersedingDecision ? <Badge tone="outline">superseded</Badge> : null}
                    </div>
                    <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-text-primary">
                      {d.title}
                    </h3>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <MiniStat label="Programs" value={d.affectedProgramIds.length} />
                  <MiniStat label="Milestones" value={d.milestoneCount} />
                  <MiniStat label="Approvers" value={d.approverCount} />
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3 text-[11px] text-text-tertiary">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden />
                    {d.effectiveDate
                      ? `Effective ${new Date(d.effectiveDate).toLocaleDateString('en-GB')}`
                      : 'No effective date'}
                  </span>
                  <span>Updated {new Date(d.updatedAt).toLocaleDateString('en-GB')}</span>
                </div>
              </Card>
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
      <span className="font-semibold uppercase tracking-[0.1em]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 text-sm text-text-primary transition-colors duration-fast hover:border-border-default focus:outline-none focus:ring-2 focus:ring-accent-default/30"
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

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[16px] font-semibold tabular-nums text-text-primary">
        {value}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@kku/ui';
import type { DecisionDetail, DecisionMilestoneDto, MilestoneStatus, OutcomeReviewHorizon } from '../types';

type Tab = 'overview' | 'milestones' | 'approvers' | 'outcomes' | 'discussion';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'approvers', label: 'Approvers' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'discussion', label: 'Discussion' },
];

const MILESTONE_TONE: Record<MilestoneStatus, 'outline' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  PLANNED: 'outline',
  IN_PROGRESS: 'warning',
  DONE: 'success',
  BLOCKED: 'danger',
  CANCELLED: 'neutral',
};

const HORIZON_LABEL: Record<OutcomeReviewHorizon, string> = {
  SIX_MONTHS: '6 months',
  ONE_YEAR: '1 year',
  THREE_YEARS: '3 years',
};

export function DecisionDetailClient({
  decision,
  initialTab,
  userRole,
  userId: _userId,
}: {
  decision: DecisionDetail;
  initialTab: Tab;
  userRole: string;
  userId: string;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>(initialTab);

  const goTab = (next: Tab) => {
    setTab(next);
    const qs = new URLSearchParams(window.location.search);
    qs.set('tab', next);
    window.history.replaceState(null, '', `?${qs}`);
  };

  const canApprove = ['COUNCIL', 'EXECUTIVE', 'ADMIN'].includes(userRole);
  const canCouncilReview = ['EXECUTIVE', 'ADMIN'].includes(userRole);

  const runStatusTransition = async (toStatus: string) => {
    const res = await fetch(`/api/proxy/decisions/${decision.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toStatus }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(`Transition failed: ${(body as { error?: { message?: string } })?.error?.message ?? res.statusText}`);
      return;
    }
    router.refresh();
  };

  const runOutcomeReview = async (horizon: OutcomeReviewHorizon) => {
    const res = await fetch(`/api/proxy/decisions/${decision.id}/outcome-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horizon }),
    });
    if (!res.ok) {
      alert('Outcome review failed — check the server log.');
      return;
    }
    router.refresh();
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

      {tab === 'overview' && (
        <OverviewTab
          decision={decision}
          canCouncilReview={canCouncilReview}
          canApprove={canApprove}
          onStatus={runStatusTransition}
        />
      )}
      {tab === 'milestones' && <MilestonesTab decision={decision} />}
      {tab === 'approvers' && <ApproversTab decision={decision} />}
      {tab === 'outcomes' && <OutcomesTab decision={decision} onRunReview={runOutcomeReview} canTrigger={canApprove} />}
      {tab === 'discussion' && <DiscussionTab decision={decision} />}
    </div>
  );
}

// ─── Overview ──────────────────────────────────────────────────────
function OverviewTab({
  decision,
  canCouncilReview,
  canApprove,
  onStatus,
}: {
  decision: DecisionDetail;
  canCouncilReview: boolean;
  canApprove: boolean;
  onStatus: (to: string) => void;
}) {
  const snapshot = decision.snapshotJson as
    | { capturedAt: string; recentTrendCount: number; methodologyVersion: string }
    | null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-4">
        <Card padding="md">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Decision</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Rationale (Thai)" value={decision.rationaleTh ?? '—'} />
            {decision.rationaleEn ? <Field label="Rationale (English)" value={decision.rationaleEn} /> : null}
            {decision.dissentingViewsTh ? (
              <Field label="Dissenting views" value={decision.dissentingViewsTh} />
            ) : null}
            <Field
              label="Effective date"
              value={decision.effectiveDate ? new Date(decision.effectiveDate).toLocaleDateString('en-GB') : '—'}
            />
            <Field label="Council session ref" value={decision.councilSessionRef ?? '—'} />
            <Field
              label="Affected programs"
              value={
                decision.affectedProgramIds.length === 0
                  ? '—'
                  : `${decision.affectedProgramIds.length} programs`
              }
            />
          </dl>
        </Card>

        <Card padding="md">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Strategic context (snapshot)</h3>
          {snapshot ? (
            <>
              <p className="text-xs text-text-tertiary">
                Captured {new Date(snapshot.capturedAt).toLocaleString('en-GB')} · methodology{' '}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
                  {snapshot.methodologyVersion}
                </code>
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                Frozen at decision time — this is what the outcomes review will diff against. The raw
                snapshot JSON is preserved in <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">
                  council_decisions.snapshot_json
                </code>
                .
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <Field label="Recent trend signals" value={snapshot.recentTrendCount} />
              </dl>
            </>
          ) : (
            <p className="text-sm text-text-tertiary">
              No snapshot yet. A snapshot is captured automatically when the decision transitions to COUNCIL_REVIEWED.
            </p>
          )}
        </Card>

        {decision.scenario ? (
          <Card padding="md">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Originating scenario</h3>
            <Link href={`/scenarios/${decision.scenario.id}`} className="text-sm text-accent-default hover:underline">
              {decision.scenario.name} ({decision.scenario.scenarioType}, {decision.scenario.workflowStatus})
            </Link>
          </Card>
        ) : null}

        {decision.amendments.length > 0 ? (
          <Card padding="md">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Amendments</h3>
            <ul className="space-y-1 text-sm">
              {decision.amendments.map((a) => (
                <li key={a.id}>
                  <Link href={`/decisions/${a.id}`} className="text-accent-default hover:underline">
                    v{a.version}: {a.title}
                  </Link>{' '}
                  <span className="text-text-tertiary">({a.status})</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {decision.supersededBy ? (
          <Card padding="md">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">Superseded by</h3>
            <Link href={`/decisions/${decision.supersededBy.id}`} className="text-sm text-accent-default hover:underline">
              {decision.supersededBy.title} ({decision.supersededBy.status})
            </Link>
          </Card>
        ) : null}
      </div>

      <aside className="flex flex-col gap-3">
        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Workflow</h3>
          <p className="text-xs text-text-tertiary">
            Current: <Badge tone="outline">{decision.status.replace('_', ' ')}</Badge>
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {decision.status === 'PROPOSED' && canCouncilReview ? (
              <button
                type="button"
                onClick={() => onStatus('COUNCIL_REVIEWED')}
                className="rounded-md bg-accent-default px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
              >
                Mark Council-reviewed
              </button>
            ) : null}
            {decision.status === 'COUNCIL_REVIEWED' && canApprove ? (
              <>
                <button
                  type="button"
                  onClick={() => onStatus('APPROVED')}
                  className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-text-inverse hover:opacity-90"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onStatus('REJECTED')}
                  className="rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/5"
                >
                  Reject
                </button>
              </>
            ) : null}
            {decision.status === 'APPROVED' && canApprove ? (
              <button
                type="button"
                onClick={() => onStatus('IN_IMPLEMENTATION')}
                className="rounded-md bg-accent-default px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover"
              >
                Start implementation
              </button>
            ) : null}
            {decision.status === 'IN_IMPLEMENTATION' && canApprove ? (
              <button
                type="button"
                onClick={() => onStatus('COMPLETED')}
                className="rounded-md bg-success px-3 py-1.5 text-xs font-medium text-text-inverse hover:opacity-90"
              >
                Mark completed
              </button>
            ) : null}
          </div>
        </Card>

        <Card padding="md">
          <h3 className="mb-2 text-sm font-semibold text-text-primary">Owner</h3>
          <p className="text-sm text-text-primary">{decision.user.name ?? decision.user.email}</p>
          <p className="text-xs text-text-tertiary">{decision.user.role}</p>
        </Card>
      </aside>
    </div>
  );
}

// ─── Milestones ────────────────────────────────────────────────────
function MilestonesTab({ decision }: { decision: DecisionDetail }) {
  const router = useRouter();
  const [newTitle, setNewTitle] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const addMilestone = async () => {
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    const res = await fetch(`/api/proxy/decisions/${decision.id}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle }),
    });
    setCreating(false);
    if (res.ok) {
      setNewTitle('');
      router.refresh();
    } else {
      alert('Create failed');
    }
  };

  const patchMilestone = async (milestoneId: string, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/proxy/decisions/${decision.id}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) router.refresh();
    else alert('Update failed');
  };

  return (
    <Card padding="md">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text-primary">
          Milestones — {decision.milestones.length}
        </h3>
        <span className="text-xs text-text-tertiary">
          {decision.milestones.filter((m) => m.status === 'DONE').length} done ·{' '}
          {decision.milestones.filter((m) => m.status === 'IN_PROGRESS').length} in progress
        </span>
      </div>
      {decision.milestones.length === 0 ? (
        <p className="text-sm text-text-tertiary">No milestones yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decision.milestones.map((m) => (
            <MilestoneRow key={m.id} milestone={m} onPatch={patchMilestone} />
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-2 border-t border-subtle pt-3">
        <input
          type="text"
          placeholder="Add a milestone…"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="flex-1 rounded-md border border-default bg-surface-1 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={!newTitle.trim() || creating}
          onClick={addMilestone}
          className="rounded-md bg-accent-default px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </Card>
  );
}

function MilestoneRow({
  milestone,
  onPatch,
}: {
  milestone: DecisionMilestoneDto;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
}) {
  const next: Record<MilestoneStatus, MilestoneStatus> = {
    PLANNED: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
    DONE: 'DONE',
    BLOCKED: 'IN_PROGRESS',
    CANCELLED: 'PLANNED',
  };
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-subtle bg-surface-1 p-3">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Badge tone={MILESTONE_TONE[milestone.status]}>{milestone.status.replace('_', ' ')}</Badge>
          <span className="text-sm font-medium text-text-primary">{milestone.title}</span>
        </div>
        {milestone.descriptionTh ? (
          <p className="mt-1 text-xs text-text-tertiary">{milestone.descriptionTh}</p>
        ) : null}
        <div className="mt-1 flex gap-3 text-[11px] text-text-tertiary">
          {milestone.owner ? <span>Owner: {milestone.owner.name ?? milestone.owner.email}</span> : null}
          {milestone.targetDate ? (
            <span>Target: {new Date(milestone.targetDate).toLocaleDateString('en-GB')}</span>
          ) : null}
          {milestone.completedDate ? (
            <span>Done: {new Date(milestone.completedDate).toLocaleDateString('en-GB')}</span>
          ) : null}
        </div>
      </div>
      {milestone.status !== 'DONE' ? (
        <button
          type="button"
          onClick={() => onPatch(milestone.id, { status: next[milestone.status] })}
          className="rounded-md border border-default bg-surface-1 px-2.5 py-1 text-xs hover:bg-surface-2"
        >
          → {next[milestone.status].replace('_', ' ')}
        </button>
      ) : null}
    </li>
  );
}

// ─── Approvers ─────────────────────────────────────────────────────
function ApproversTab({ decision }: { decision: DecisionDetail }) {
  return (
    <Card padding="md">
      <h3 className="mb-3 text-sm font-semibold text-text-primary">
        Approvers — {decision.approvers.length}
      </h3>
      {decision.approvers.length === 0 ? (
        <p className="text-sm text-text-tertiary">No approvers recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {decision.approvers.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-md border border-subtle bg-surface-1 p-3 text-sm"
            >
              <div>
                <span className="font-medium text-text-primary">{a.user.name ?? a.user.email}</span>
                <span className="ml-2 text-xs text-text-tertiary">({a.user.role})</span>
                {a.noteTh ? <p className="mt-1 text-xs text-text-secondary">{a.noteTh}</p> : null}
              </div>
              <div className="text-right text-xs text-text-tertiary">
                <Badge tone="outline">{a.role}</Badge>
                <div className="mt-1">
                  {new Date(a.approvedAt).toLocaleDateString('en-GB')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-text-tertiary">
        E-signature integration is placeholder — real KKU e-sign wires in post-launch.
      </p>
    </Card>
  );
}

// ─── Outcomes ──────────────────────────────────────────────────────
function OutcomesTab({
  decision,
  onRunReview,
  canTrigger,
}: {
  decision: DecisionDetail;
  onRunReview: (h: OutcomeReviewHorizon) => void;
  canTrigger: boolean;
}) {
  const horizons: OutcomeReviewHorizon[] = ['SIX_MONTHS', 'ONE_YEAR', 'THREE_YEARS'];
  const byHorizon = new Map(decision.outcomeReviews.map((r) => [r.horizon, r]));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3">
        {horizons.map((h) => {
          const review = byHorizon.get(h);
          return (
            <Card key={h} padding="md">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-text-primary">{HORIZON_LABEL[h]}</h4>
                {review ? (
                  <Badge tone="success">Generated</Badge>
                ) : (
                  <Badge tone="outline">Pending</Badge>
                )}
              </div>
              {review ? (
                <div className="text-xs text-text-tertiary">
                  Generated {new Date(review.generatedAt).toLocaleDateString('en-GB')}
                </div>
              ) : (
                <>
                  <p className="text-xs text-text-tertiary">Not yet generated.</p>
                  {canTrigger && decision.snapshotJson ? (
                    <button
                      type="button"
                      onClick={() => onRunReview(h)}
                      className="mt-2 rounded-md bg-accent-default px-2.5 py-1 text-xs font-medium text-accent-fg"
                    >
                      Run review
                    </button>
                  ) : null}
                </>
              )}
            </Card>
          );
        })}
      </div>

      {decision.outcomeReviews.length > 0 ? (
        <Card padding="md">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Reviews</h3>
          <div className="flex flex-col gap-4">
            {decision.outcomeReviews.map((r) => (
              <div key={r.id} className="rounded-md border border-subtle bg-surface-1 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Badge tone="accent">{HORIZON_LABEL[r.horizon]}</Badge>
                  <span className="text-xs text-text-tertiary">
                    {new Date(r.generatedAt).toLocaleString('en-GB')} · {r.methodologyVersion}
                  </span>
                </div>
                <p className="whitespace-pre-line text-sm text-text-secondary">{r.narrativeTh}</p>
                {r.whatWorkedJson.th.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-success">
                      สิ่งที่ได้ผล
                    </div>
                    <ul className="ml-4 list-disc text-sm text-text-secondary">
                      {r.whatWorkedJson.th.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {r.whatDidntWorkJson.th.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-danger">
                      สิ่งที่ไม่ได้ผล
                    </div>
                    <ul className="ml-4 list-disc text-sm text-text-secondary">
                      {r.whatDidntWorkJson.th.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {r.lessonsJson.th.length > 0 ? (
                  <div className="mt-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-accent-default">
                      บทเรียน
                    </div>
                    <ul className="ml-4 list-disc text-sm text-text-secondary">
                      {r.lessonsJson.th.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ─── Discussion ────────────────────────────────────────────────────
function DiscussionTab({ decision: _decision }: { decision: DecisionDetail }) {
  return (
    <Card padding="md">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">Discussion</h3>
      <p className="text-sm text-text-secondary">
        Annotations with visibility=COUNCIL attached to this decision will render here. The
        annotation API (<code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">POST /annotations</code>) is live; the threaded UI with inline evidence attachment is a follow-up pass.
      </p>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wide text-text-tertiary">{label}</dt>
      <dd className="text-sm text-text-primary">{value}</dd>
    </div>
  );
}

'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button, Card } from '@kku/ui';
import { Layers, Play, RefreshCw, Settings2 } from 'lucide-react';

// Buttons on /admin/data-setup → "Full program documents" card.
// Two run modes:
//   • Full run    — all 9 phases on every canonical program (or just the
//                   not-yet-narrated subset via Resume).
//   • Partial run — pick which phases to run; expands a checkbox panel.
//
// Phase 7 (strategic narrative) is the "done" marker the pipeline status
// uses — Resume mode skips programs that already have one.
// Phase 5 is the AI benchmarking step (peer selection + peer review).
//
// Keep this list in sync with the 9 phases in
// apps/ingestion/src/scripts/programs-pipeline.ts (+ ProgramPipelinePhase
// in apps/api/src/ai-jobs/ai-jobs-queue.service.ts).

type Phase =
  | 'phase1'
  | 'phase2'
  | 'phase2b'
  | 'phase3'
  | 'phase4'
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8';

const PHASES: Array<{ id: Phase; label: string; cost: string; hint: string }> = [
  { id: 'phase1', label: 'PDF extraction', cost: '~$0.04', hint: 'digest + faculty + skills + pedagogy (parallel)' },
  { id: 'phase2', label: 'Approve + materialise', cost: 'free', hint: 'DB-only — writes ProgramSkill rows' },
  { id: 'phase2b', label: 'Course-code extraction', cost: '~$0.02', hint: 'focused รายวิชา slice (parallel with phase 1)' },
  { id: 'phase3', label: 'Careers + demand match', cost: '~$0.02', hint: 'sequential, Flash' },
  { id: 'phase4', label: 'Oracle / MSSQL linkage', cost: 'free', hint: 'cohorts + alumni + financials (parallel)' },
  { id: 'phase5', label: 'AI benchmarking (peer comparison)', cost: '~$0.20', hint: 'peer select + peer review (Pro reasoning)' },
  { id: 'phase6', label: 'AI readiness', cost: '~$0.05', hint: 'AI-readiness scorer (Pro) — runs before narrative' },
  { id: 'phase7', label: 'Strategic narrative', cost: '~$0.30', hint: 'Pro thinking — runs LAST, depends on 1-6' },
  { id: 'phase8', label: 'Risk analysis', cost: '~$0.10', hint: 'deterministic + Pro narrative — depends on 4-5' },
];

export function ProgramsPipelineLauncher() {
  const [mode, setMode] = React.useState<'idle' | 'partial'>('idle');
  const [selected, setSelected] = React.useState<Set<Phase>>(new Set(PHASES.map((p) => p.id)));
  const [submitting, setSubmitting] = React.useState(false);

  const togglePhase = (id: Phase) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const submit = async (
    label: string,
    body: {
      phases?: Phase[];
      resume?: boolean;
      force?: boolean;
    },
    confirmMsg: string,
  ) => {
    if (!confirm(confirmMsg)) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/admin-programs/pipeline/run-pipeline-bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const j = await res.json();
      const { enqueued, skipped } = j.data as { enqueued: number; skipped: number };
      toast.success(
        `${label}: enqueued ${enqueued} job${enqueued === 1 ? '' : 's'}` +
          (skipped > 0 ? ` (${skipped} already complete, skipped)` : ''),
        {
          description:
            'Jobs run in the background — refresh the curriculum-pipeline page to track progress.',
        },
      );
    } catch (err) {
      toast.error(`Pipeline enqueue failed: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const runFullAll = () =>
    submit(
      'Full run',
      { resume: false },
      'Run the FULL 9-phase pipeline (incl. AI benchmarking + AI readiness) on all 297 canonical programs?\n\n' +
        'Each program takes ~5-10 min and ~$0.70 in LLM cost. Total ≈ $210 + 30h of worker time.\n\n' +
        'For an incremental run that skips already-narrated programs, use "Resume" instead.',
    );

  const runResume = () =>
    submit(
      'Resume run',
      { resume: true },
      'Resume the pipeline — skip programs that already have a strategic narrative?',
    );

  const runPartial = () => {
    const phases = Array.from(selected);
    if (phases.length === 0) {
      toast.warning('Select at least one phase to run.');
      return;
    }
    if (phases.length === PHASES.length) {
      // All phases selected = same as Resume (or Full — confirm wants Full)
      void runResume();
      return;
    }
    void submit(
      `Partial run (${phases.join(', ')})`,
      { phases, resume: false },
      `Run ${phases.length} phase${phases.length === 1 ? '' : 's'} (${phases.join(', ')}) ` +
        `on all 297 canonical programs?\n\nNote: phases that depend on prior phases ` +
        `will fail if the prior phase hasn't run yet (e.g. phase7 narrative needs 1-6; ` +
        `phase5 AI benchmarking needs phase 2's materialised skills).`,
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={runFullAll} disabled={submitting}>
          <Play className="size-icon-md" aria-hidden />
          Run full pipeline (all 297)
        </Button>
        <Button variant="outline" onClick={runResume} disabled={submitting}>
          <RefreshCw className="size-icon-md" aria-hidden />
          Resume incomplete
        </Button>
        <Button
          variant="ghost"
          onClick={() => setMode(mode === 'partial' ? 'idle' : 'partial')}
          disabled={submitting}
        >
          <Settings2 className="size-icon-md" aria-hidden />
          {mode === 'partial' ? 'Hide partial run' : 'Partial run…'}
        </Button>
      </div>

      {mode === 'partial' && (
        <Card padding="md" tone="quiet" className="flex flex-col gap-3">
          <div className="flex items-start gap-2 text-xs text-text-secondary">
            <Layers className="mt-0.5 size-icon-sm shrink-0 text-accent-default" aria-hidden />
            <span>
              Select the phases to (re)run on every canonical program. Useful for retrying
              one phase after a fix — e.g. only phase 5 + 6 after seeding peer programs.
            </span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {PHASES.map((p) => (
              <li key={p.id} className="flex items-start gap-3">
                <input
                  id={`phase-${p.id}`}
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => togglePhase(p.id)}
                  className="mt-0.5 h-4 w-4 rounded border-border-default"
                  aria-label={`Toggle ${p.label}`}
                />
                <label htmlFor={`phase-${p.id}`} className="flex flex-1 flex-col text-sm">
                  <span className="font-medium text-text-primary">
                    <span className="font-tabular text-text-tertiary">{p.id}</span> · {p.label}{' '}
                    <span className="text-xs font-normal text-text-tertiary">({p.cost})</span>
                  </span>
                  <span className="text-xs text-text-tertiary">{p.hint}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
            <span className="text-xs text-text-tertiary">
              {selected.size} of {PHASES.length} phase{selected.size === 1 ? '' : 's'} selected
            </span>
            <Button variant="primary" size="sm" onClick={runPartial} disabled={submitting}>
              <Play className="size-icon-md" aria-hidden />
              Run selected phases on all 297
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

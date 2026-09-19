'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Button, ConfidenceBadge, RightPanel } from '@kku/ui';
import type { GapPageParams } from './types';

// The only client leaf on the page. Everything else — chips, faculty strip,
// thresholds, the open row's three panels — is server-rendered, so the map
// filters without any JavaScript at all.

interface BriefT {
  output: {
    findings: Array<{
      title: string;
      fieldNameEn: string;
      verdict: string;
      evidence: string;
      implication: string;
    }>;
    cannotTell: string[];
    confidence: number;
    reasoning: string;
  } | null;
  rawText: string;
  model: string;
  aiInferenceId: string | null;
  confidence: number;
  methodologyVersion: string;
  sources: Array<{ id: string; name: string }>;
  rowsBriefed: number;
}

export function BriefPanelTrigger({ params }: { params: GapPageParams }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [brief, setBrief] = React.useState<BriefT | null>(null);
  const [showReasoning, setShowReasoning] = React.useState(false);
  const [disagree, setDisagree] = React.useState('');

  async function generate(): Promise<void> {
    setBusy(true);
    setOpen(true);
    try {
      const res = await fetch('/api/gap-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: params.scope,
          scopeId: params.scopeId ?? undefined,
          verdict: params.verdict,
          facultyId: params.facultyId ?? undefined,
          under: params.under,
          over: params.over,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { data?: BriefT; error?: { message?: string } };
      if (!res.ok || !j.data) {
        toast.error(j.error?.message ?? 'The brief could not be generated.');
        return;
      }
      setBrief(j.data);
    } finally {
      setBusy(false);
    }
  }

  async function sendDisagreement(): Promise<void> {
    if (!disagree.trim() || !brief) return;
    const res = await fetch('/api/gap-brief/disagreements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiInferenceId: brief.aiInferenceId ?? undefined, bodyEn: disagree.trim() }),
    });
    if (res.ok) {
      toast.success('Disagreement recorded');
      setDisagree('');
    } else {
      toast.error('Could not record the disagreement.');
    }
  }

  return (
    <>
      <Button size="sm" onClick={generate} disabled={busy}>
        {busy ? 'Writing…' : 'Council brief ✦'}
      </Button>
      <RightPanel open={open} onOpenChange={setOpen} title="Council brief — gap map">
        {!brief && (
          <p className="text-sm text-text-tertiary">
            {busy ? 'Reading the rows on screen…' : 'Generate a brief to see it here.'}
          </p>
        )}
        {brief && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <ConfidenceBadge value={brief.confidence} rationale={brief.output?.reasoning} />
              <span className="text-xs text-text-tertiary">
                {brief.rowsBriefed} rows on screen · {brief.methodologyVersion} · {brief.model}
              </span>
            </div>
            {!brief.output && <p className="text-text-secondary">{brief.rawText}</p>}
            {brief.output?.findings.map((f) => (
              <div key={`${f.fieldNameEn}-${f.title}`} className="rounded border border-default p-3">
                <div className="font-medium">{f.title}</div>
                <div className="text-xs text-text-tertiary">
                  {f.fieldNameEn} · {f.verdict}
                </div>
                <p className="mt-1 text-text-secondary">{f.evidence}</p>
                <p className="mt-1">{f.implication}</p>
              </div>
            ))}
            {brief.output && brief.output.cannotTell.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-text-tertiary">
                  What this data cannot tell
                </div>
                <ul className="list-disc pl-4 text-text-secondary">
                  {brief.output.cannotTell.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wide text-text-tertiary">Sources</div>
              <ul className="text-xs text-text-secondary">
                {brief.sources.map((s) => (
                  <li key={s.id}>{s.name}</li>
                ))}
              </ul>
            </div>
            {brief.output && (
              <button type="button" className="text-xs underline" onClick={() => setShowReasoning((s) => !s)}>
                {showReasoning ? 'Hide reasoning' : 'Show reasoning'}
              </button>
            )}
            {showReasoning && brief.output && (
              <p className="text-xs text-text-secondary">{brief.output.reasoning}</p>
            )}
            <div className="space-y-1">
              <label htmlFor="gap-brief-disagree" className="text-xs uppercase tracking-wide text-text-tertiary">
                Disagree
              </label>
              <textarea
                id="gap-brief-disagree"
                className="w-full rounded border border-default bg-surface-1 p-2 text-xs"
                rows={3}
                value={disagree}
                onChange={(e) => setDisagree(e.target.value)}
                placeholder="What is wrong, and what the numbers should say"
              />
              <Button size="sm" variant="ghost" onClick={sendDisagreement} disabled={!disagree.trim()}>
                Send disagreement
              </Button>
            </div>
          </div>
        )}
      </RightPanel>
    </>
  );
}

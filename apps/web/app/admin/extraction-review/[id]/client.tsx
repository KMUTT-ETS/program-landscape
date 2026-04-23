'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Card, Input, Label } from '@kku/ui';
import {
  approveAiExtractionAction,
  rejectAiExtractionAction,
} from '@/lib/actions/ai-extraction';
import type { AiExtractionDetail } from './page';

export function ReviewClient({ extraction }: { extraction: AiExtractionDetail }) {
  const router = useRouter();
  const [notes, setNotes] = React.useState('');
  const [edited, setEdited] = React.useState<string>(
    JSON.stringify(extraction.payloadJson, null, 2),
  );
  const [saving, setSaving] = React.useState(false);

  const canAct = extraction.reviewStatus === 'PENDING_REVIEW' ||
    extraction.reviewStatus === 'AUTO_APPROVED';

  const onApprove = async () => {
    setSaving(true);
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(edited);
    } catch {
      toast.error('Edited JSON is not parseable — fix before approving');
      setSaving(false);
      return;
    }
    const res = await approveAiExtractionAction(extraction.id, notes || undefined, parsed);
    setSaving(false);
    if (res.ok) {
      toast.success('Extraction approved');
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  const onReject = async () => {
    if (!notes.trim()) {
      toast.error('Rejection reason required');
      return;
    }
    setSaving(true);
    const res = await rejectAiExtractionAction(extraction.id, notes);
    setSaving(false);
    if (res.ok) {
      toast.success('Extraction rejected');
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Prompt</h3>
          <pre className="max-h-72 overflow-auto rounded-md border border-border-default bg-surface-0 p-3 text-xs">
            {extraction.aiInference?.prompt ?? '<no prompt recorded>'}
          </pre>
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Raw LLM response</h3>
          <pre className="max-h-72 overflow-auto rounded-md border border-border-default bg-surface-0 p-3 text-xs">
            {extraction.aiInference?.response ?? '<no response recorded>'}
          </pre>
        </Card>
        {extraction.reasoning && (
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Reasoning</h3>
            <p className="text-sm text-text-secondary">{extraction.reasoning}</p>
          </Card>
        )}
        {extraction.aiInference && (
          <Card>
            <h3 className="mb-2 text-sm font-semibold">Inference metadata</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-text-tertiary">Model</dt>
              <dd className="font-mono">{extraction.aiInference.model}</dd>
              <dt className="text-text-tertiary">Module</dt>
              <dd>{extraction.aiInference.module}</dd>
              <dt className="text-text-tertiary">Kind</dt>
              <dd>{extraction.aiInference.kind ?? '—'}</dd>
              <dt className="text-text-tertiary">Tokens (in/out)</dt>
              <dd className="font-tabular">
                {extraction.aiInference.tokensInput ?? '—'} /{' '}
                {extraction.aiInference.tokensOutput ?? '—'}
              </dd>
              <dt className="text-text-tertiary">Latency</dt>
              <dd className="font-tabular">
                {extraction.aiInference.latencyMs
                  ? `${(extraction.aiInference.latencyMs / 1000).toFixed(2)}s`
                  : '—'}
              </dd>
              <dt className="text-text-tertiary">Cost</dt>
              <dd className="font-tabular">
                {extraction.aiInference.costEstimateUsd !== null
                  ? `$${extraction.aiInference.costEstimateUsd.toFixed(4)}`
                  : '—'}
              </dd>
            </dl>
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Structured payload (editable)</h3>
          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            disabled={!canAct}
            className="h-96 w-full rounded-md border border-border-default bg-surface-0 p-3 font-mono text-xs"
            spellCheck={false}
          />
        </Card>

        {canAct ? (
          <Card>
            <div className="flex flex-col gap-2">
              <Label>Review notes</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  extraction.reviewStatus === 'PENDING_REVIEW'
                    ? 'Optional — required for reject'
                    : 'Override note'
                }
              />
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => void onApprove()} disabled={saving}>
                  {extraction.reviewStatus === 'PENDING_REVIEW' ? 'Approve' : 'Re-approve'}
                </Button>
                <Button variant="danger" size="sm" onClick={() => void onReject()} disabled={saving}>
                  Reject
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-text-tertiary">
              Extraction already {extraction.reviewStatus.toLowerCase().replace('_', ' ')}
              {extraction.reviewedBy
                ? ` by ${extraction.reviewedBy.name ?? extraction.reviewedBy.email}`
                : ''}
              {extraction.reviewedAt ? ` on ${new Date(extraction.reviewedAt).toLocaleString()}` : ''}.
            </p>
            {extraction.reviewNotes && (
              <p className="mt-2 text-sm">{extraction.reviewNotes}</p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Card } from '@kku/ui';

// Mirrors SetupChecklist in packages/db/src/program-setup-checklist.ts (the
// API response of GET /admin/programs/:id/setup-checklist).
export type ChecklistStatus = 'ok' | 'empty' | 'not-applicable' | 'degraded';

export interface SetupChecklistData {
  programId: string;
  programCode: string;
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  generatedAt: string;
  summary: { ok: number; empty: number; notApplicable: number; degraded: number; ready: number };
  items: Array<{
    key: string;
    group: string;
    title: string;
    status: ChecklistStatus;
    note: string | null;
    waitingOn: Array<{ kind: string; slug: string; label: string; href: string }>;
  }>;
}

const CHIP: Record<ChecklistStatus, { label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' }> = {
  ok: { label: 'OK', tone: 'success' },
  empty: { label: 'Missing', tone: 'danger' },
  'not-applicable': { label: 'N/A', tone: 'neutral' },
  degraded: { label: 'Degraded', tone: 'warning' },
};

export function SetupChecklistView({ checklist }: { checklist: SetupChecklistData }) {
  const groups = new Map<string, SetupChecklistData['items']>();
  for (const item of checklist.items) {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        <span className="font-tabular font-medium text-text-primary">
          {checklist.summary.ready} of {checklist.items.length} ready
        </span>{' '}
        · {checklist.summary.empty} missing · {checklist.summary.degraded} degraded
      </p>
      {[...groups.entries()].map(([group, items]) => (
        <Card key={group} className="p-4">
          <h3 className="mb-2 text-sm font-semibold">{group}</h3>
          <ul className="divide-y divide-border-subtle">
            {items.map((item) => {
              const chip = CHIP[item.status];
              return (
                <li key={item.key} className="flex flex-wrap items-start gap-3 py-2">
                  <Badge tone={chip.tone}>{chip.label}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{item.title}</div>
                    {item.note && <div className="text-xs text-text-tertiary">{item.note}</div>}
                    {item.status === 'empty' && item.waitingOn.length > 0 && (
                      <div className="mt-1 text-xs text-text-secondary">
                        Waiting on:{' '}
                        {item.waitingOn.map((w, i) => (
                          <React.Fragment key={`${w.kind}-${w.slug}`}>
                            {i > 0 && ', '}
                            <Link href={w.href.replace('{programId}', checklist.programId)} className="underline">
                              {w.label}
                            </Link>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}

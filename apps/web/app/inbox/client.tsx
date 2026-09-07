'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge, Button, Card } from '@kku/ui';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/actions/trends';
import type { NotificationDto } from './page';

export function InboxClient({ initial }: { initial: NotificationDto[] }) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const r = await markAllNotificationsRead();
            if (r.ok) {
              toast.success('All marked read');
              router.refresh();
            } else {
              toast.error(r.message);
            }
          }}
        >
          Mark all read
        </Button>
      </div>
      {initial.map((n) => (
        <Card key={n.id} className={n.readAt ? 'opacity-70' : ''}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={severityTone(n.severity)}>{n.severity}</Badge>
                <span className="text-xs text-text-tertiary">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
              <h3 className="mt-1 text-sm font-semibold">{n.title}</h3>
              {n.bodyTh && (
                <p className="mt-1 text-sm text-text-secondary" lang="th">
                  {n.bodyTh}
                </p>
              )}
              {n.bodyEn && !n.bodyTh && (
                <p className="mt-1 text-sm text-text-secondary">{n.bodyEn}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {n.entityType === 'trend_signal' && n.entityId && (
                <Link href={`/trends/${n.entityId}`}>
                  <Button size="xs" variant="outline">
                    Open signal
                  </Button>
                </Link>
              )}
              {n.entityType === 'ai_model_override' && (
                <Link href="/admin/app/ai-settings">
                  <Button size="xs" variant="outline">
                    Open AI settings
                  </Button>
                </Link>
              )}
              {!n.readAt && (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    const r = await markNotificationRead(n.id);
                    if (r.ok) router.refresh();
                    else toast.error(r.message);
                  }}
                >
                  Mark read
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function severityTone(s: 'low' | 'medium' | 'high'): 'neutral' | 'warning' | 'danger' {
  if (s === 'high') return 'danger';
  if (s === 'medium') return 'warning';
  return 'neutral';
}

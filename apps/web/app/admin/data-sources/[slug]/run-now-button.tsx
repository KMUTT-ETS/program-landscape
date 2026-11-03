'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@kku/ui';
import { runNowAction } from '@/lib/actions/data-sources';

// Same action as the per-row "Run now" on /admin/data-sources: enqueues a
// MANUAL job for the ingestion worker. The worker's own env decides
// real vs mock (CONNECTOR_<SLUG>_MODE), not this page.

export function RunNowButton({ dataSourceId, name }: { dataSourceId: string; name: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const onClick = async () => {
    setPending(true);
    const res = await runNowAction(dataSourceId);
    setPending(false);
    if (res.ok) {
      toast.success(`Queued run for ${name}`);
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => void onClick()}>
      {pending ? 'Queuing…' : 'Run now'}
    </Button>
  );
}

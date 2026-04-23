'use client';

import * as React from 'react';
import { Button } from '@kku/ui';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { markReviewedAction } from '@/lib/actions/trends';
import { Check } from 'lucide-react';

export function MarkReviewedButton({ signalId }: { signalId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await markReviewedAction(signalId);
        setBusy(false);
        if (r.ok) {
          toast.success('Marked as reviewed');
          router.refresh();
        } else {
          toast.error(r.message);
        }
      }}
    >
      <Check className="h-4 w-4" />
      {busy ? 'Marking…' : 'Mark reviewed'}
    </Button>
  );
}

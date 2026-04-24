'use client';

import * as React from 'react';
import { Button } from '@kku/ui';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Wand2 } from 'lucide-react';

// One-click backfill for PDFs uploaded before the multipart UTF-8 fix
// shipped. Calls /pdfs/fix-filenames (gated on pdf:admin). The first
// click dry-runs so the admin can preview; the second commits.
export function FixFilenamesButton() {
  const router = useRouter();
  const [phase, setPhase] = React.useState<'idle' | 'previewed' | 'running'>(
    'idle',
  );
  const [preview, setPreview] = React.useState<{
    scanned: number;
    fixed: number;
    changes: Array<{ id: string; from: string; to: string }>;
  } | null>(null);

  const run = async (dryRun: boolean) => {
    setPhase('running');
    try {
      const res = await fetch('/api/admin-pdfs/fix-filenames', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun, limit: 5000 }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      }
      const data = json.data as typeof preview;
      if (!data) throw new Error('no data in response');
      if (dryRun) {
        setPreview(data);
        setPhase('previewed');
        toast.info(
          `${data.fixed} of ${data.scanned} PDFs have mojibake filenames that can be fixed.`,
        );
      } else {
        setPreview(null);
        setPhase('idle');
        toast.success(`Rewrote ${data.fixed} filenames.`);
        router.refresh();
      }
    } catch (err) {
      setPhase('idle');
      toast.error(`Fix failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {phase === 'idle' && (
        <Button variant="outline" size="sm" onClick={() => void run(true)}>
          <Wand2 className="h-4 w-4" aria-hidden />
          Check filenames
        </Button>
      )}
      {phase === 'running' && (
        <Button variant="outline" size="sm" disabled>
          Running…
        </Button>
      )}
      {phase === 'previewed' && preview && (
        <>
          <span className="text-xs text-text-secondary">
            <span className="font-tabular font-medium text-text-primary">
              {preview.fixed}
            </span>
            {' / '}
            <span className="font-tabular">{preview.scanned}</span> will be rewritten
          </span>
          <Button size="sm" onClick={() => void run(false)}>
            Rewrite now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreview(null);
              setPhase('idle');
            }}
          >
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}

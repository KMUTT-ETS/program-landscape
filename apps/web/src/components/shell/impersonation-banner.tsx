'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ScopeSelectorEntities } from '@kku/ui';
import { ShieldOff, UserCog } from 'lucide-react';
import { clearImpersonationAction } from '@/lib/actions/impersonation';

// Banner shown at the top of every authed page while impersonation is
// active. Sticky so it stays visible while the operator scrolls. Hard
// to ignore — that's the point: the operator should never forget that
// what they see right now is NOT their actual access surface.

export function ImpersonationBanner({
  role,
  facultyId,
  programId,
  entities,
}: {
  role: string;
  facultyId: string | null;
  programId: string | null;
  entities: ScopeSelectorEntities;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const facultyName = facultyId
    ? entities.faculties.find((f) => f.id === facultyId)?.nameEn ?? facultyId
    : null;
  const programLabel = programId
    ? entities.programs.find((p) => p.id === programId)?.nameEn ?? programId
    : null;

  const scopeLabel = programLabel
    ? `${programLabel} (${facultyName ?? 'unknown faculty'})`
    : facultyName
      ? facultyName
      : 'university-wide';

  function stop() {
    startTransition(async () => {
      await clearImpersonationAction();
      router.refresh();
    });
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 border-b border-warning-default/40 bg-warning-subtle/90 backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-3 px-5 py-2 text-[12px] text-warning-default">
        <div className="flex min-w-0 items-center gap-2">
          <UserCog className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
          <span className="font-semibold uppercase tracking-[0.12em]">
            Impersonation
          </span>
          <span className="hidden text-warning-default/80 sm:inline">·</span>
          <span className="truncate">
            Viewing as{' '}
            <span className="font-semibold text-text-primary">
              {role.replaceAll('_', ' ')}
            </span>{' '}
            <span className="text-text-tertiary">·</span>{' '}
            <span className="text-text-secondary">{scopeLabel}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={stop}
          disabled={pending}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-warning-default/40 bg-surface-0/60 px-2.5 py-1 text-[11px] font-medium text-warning-default transition-colors hover:bg-surface-0 disabled:opacity-50"
        >
          <ShieldOff className="h-3 w-3" aria-hidden />
          {pending ? 'Stopping…' : 'Stop impersonating'}
        </button>
      </div>
    </div>
  );
}

import * as React from 'react';
import Link from 'next/link';
import { TrendingDown, TrendingUp, XCircle } from 'lucide-react';

interface ProgramAlert {
  programId: string;
  code: string;
  name: string;
  facultyCode: string;
  level: string;
  enrolledLatest: number;
  enrolledThreeYearsAgo: number | null;
  deltaPct: number | null;
  netContributionThb: number | null;
  caption: string;
}

interface Props {
  tone: 'urgent' | 'momentum';
  alerts: ProgramAlert[];
  title: string;
  emptyHint: string;
}

// Compact alert column. Server-rendered. Each row deep-links into the
// program. Tone drives icon + ring colour.
export function AlertColumn({ tone, alerts, title, emptyHint }: Props) {
  const accent = tone === 'urgent' ? 'text-danger' : 'text-positive';
  const ring = tone === 'urgent' ? 'ring-danger/30' : 'ring-positive/30';
  const dotBg = tone === 'urgent' ? 'bg-danger-subtle' : 'bg-positive-subtle';

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          {title}
        </h3>
        <span className="text-[10px] text-text-tertiary">
          {alerts.length} {alerts.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      {alerts.length === 0 ? (
        <p className="text-sm text-text-tertiary">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => {
            const isDead = a.enrolledLatest === 0;
            const Icon = isDead ? XCircle : tone === 'urgent' ? TrendingDown : TrendingUp;
            return (
              <li key={a.programId}>
                <Link
                  href={`/programs/${a.programId}`}
                  className={`group flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-1 p-3 ring-1 ring-transparent transition hover:${ring} hover:bg-surface-2`}
                >
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${dotBg}`}>
                    <Icon className={`size-icon-md ${accent}`} aria-hidden />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent-default">
                      {shortenName(a.name)}
                    </p>
                    <p className="text-[11px] text-text-tertiary">
                      <span className="font-tabular">{a.code}</span>
                      <span className="mx-1.5 opacity-60">·</span>
                      <span>{a.facultyCode}</span>
                      <span className="mx-1.5 opacity-60">·</span>
                      <span>{prettyLevel(a.level)}</span>
                    </p>
                    <p className="text-[11px] text-text-secondary">
                      <span className="font-tabular">
                        {a.enrolledThreeYearsAgo ?? '—'} → {a.enrolledLatest}
                      </span>
                      <span className="mx-1.5 opacity-60">students</span>
                      <span className={`font-tabular font-semibold ${accent}`}>
                        {a.caption}
                      </span>
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function shortenName(name: string): string {
  // Trim "Bachelor of X Program in" → "Y" — the discipline matters,
  // not the degree wrapper (already shown via Level).
  return name.replace(/^(Bachelor|Master|Doctor|Higher Graduate Diploma) (of|in) [^P]*Program in /i, '');
}

function prettyLevel(l: string): string {
  switch (l) {
    case 'BACHELOR': return 'BSc';
    case 'MASTER': return 'MSc';
    case 'DOCTORAL': return 'PhD';
    case 'HIGHER_GRAD_DIPLOMA': return 'HGD';
    default: return l;
  }
}

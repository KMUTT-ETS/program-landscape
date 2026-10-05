import type { ChapterAnswer } from '@kku/db';

export function ChapterHeader({
  id,
  number,
  kicker,
  question,
  answer,
}: {
  id: string;
  number: number;
  kicker: string;
  question: string;
  answer: ChapterAnswer | null;
}) {
  return (
    <header data-chapter={id} className="border-t-2 border-strong pt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        Chapter {number} · {kicker}
      </p>
      <h2 className="mt-1 text-lg font-semibold text-text-primary">{question}</h2>
      {answer && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-tabular text-3xl font-semibold text-text-primary">{answer.figure ?? '—'}</span>
          <span className="text-sm text-text-secondary">{answer.sentence}</span>
        </p>
      )}
    </header>
  );
}

export function ChapterUnavailable({ message }: { message?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-default bg-surface-1 p-4 text-sm text-text-secondary">
      {message ?? 'This chapter could not load. Reload the page to try again.'}
    </div>
  );
}

export function ChapterSkeleton({ id, number, kicker }: { id: string; number: number; kicker: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p data-chapter={id} className="border-t-2 border-strong pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        Chapter {number} · {kicker}
      </p>
      <div className="h-[18rem] animate-shimmer rounded-lg bg-surface-2" aria-hidden />
    </div>
  );
}

/** "Listed, not plotted" — what a chart could not place, with reasons. */
const SINGULAR: Record<string, string> = { programmes: 'programme', fields: 'field', faculties: 'faculty' };

export function UnplottedList({ items, noun = 'programmes' }: { items: Array<{ id: string; label: string; reason: string }>; noun?: string }) {
  if (items.length === 0) return null;
  const word = items.length === 1 ? (SINGULAR[noun] ?? noun) : noun;
  return (
    <details className="text-xs text-text-tertiary">
      <summary className="cursor-pointer">
        {items.length} {word} not plotted
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((u) => (
          <li key={u.id}>
            {u.label} — {u.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

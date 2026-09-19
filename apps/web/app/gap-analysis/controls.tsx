import * as React from 'react';
import Link from 'next/link';
import {
  VERDICT_LABEL,
  VERDICT_ORDER,
  gapHref,
  type GapMapT,
  type GapPageParams,
  type GapVerdictT,
} from './types';

// Every control is a link or a plain GET form, so the page needs no client
// JavaScript to filter, the state is the URL, and the render test can mount
// this without a Next router. Changing a filter closes any open row.

const GLYPH: Record<GapVerdictT, string> = {
  'white-space': '⬜',
  'under-served': '◔',
  served: '●',
  'over-served': '◉',
  'supply-unknown': '◌',
  'too-few-postings': '○',
};

// `w-16` is 32px on this scale (half stock), which clips "0.75"; the width is
// stated in pixels so the number it holds is fully readable.
const INPUT =
  'ml-1 w-[64px] rounded border border-default bg-surface-1 px-2 py-0.5 text-text-primary';

export function GapControls({
  params,
  verdictCounts,
  total,
  facultyStrip,
}: {
  params: GapPageParams;
  verdictCounts: GapMapT['verdictCounts'];
  total: number;
  facultyStrip: GapMapT['facultyStrip'];
}): React.JSX.Element {
  const href = (patch: Partial<GapPageParams>) => gapHref(params, { ...patch, field: null });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={params.verdict === 'all'} href={href({ verdict: 'all' })}>
          All · {total}
        </Chip>
        {VERDICT_ORDER.map((v) => (
          <Chip key={v} active={params.verdict === v} href={href({ verdict: v })}>
            <span aria-hidden className="mr-1">
              {GLYPH[v]}
            </span>
            {VERDICT_LABEL[v]} · {verdictCounts[v]}
          </Chip>
        ))}
        <span className="flex-1" />
        <details className="text-xs">
          <summary className="cursor-pointer text-text-secondary">
            Thresholds ⚙ under {params.under} · over {params.over}
          </summary>
          <form method="get" action="/gap-analysis" className="mt-2 flex flex-wrap items-center gap-2">
            {params.scope !== 'university' && <input type="hidden" name="scope" value={params.scope} />}
            {params.scopeId && <input type="hidden" name="scopeId" value={params.scopeId} />}
            {params.verdict !== 'all' && <input type="hidden" name="verdict" value={params.verdict} />}
            {params.facultyId && <input type="hidden" name="faculty" value={params.facultyId} />}
            <label>
              Under-served below
              <input name="under" className={INPUT} defaultValue={String(params.under)} inputMode="decimal" />
            </label>
            <label>
              Over-served above
              <input name="over" className={INPUT} defaultValue={String(params.over)} inputMode="decimal" />
            </label>
            <button type="submit" className="rounded border border-default bg-surface-1 px-2 py-0.5">
              Apply
            </button>
            <Link href={href({ under: 0.5, over: 2 })} className="underline">
              Reset
            </Link>
          </form>
        </details>
      </div>

      {facultyStrip.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {facultyStrip.map((f) => {
            const on = params.facultyId === f.facultyId;
            return (
              <Link
                key={f.facultyId}
                href={href({ facultyId: on ? null : f.facultyId })}
                aria-pressed={on}
                className={`min-w-[168px] shrink-0 rounded border px-2 py-1 text-left text-xs ${
                  on
                    ? 'border-[oklch(var(--color-accent-default))] bg-accent-subtle'
                    : 'border-default bg-surface-1'
                }`}
              >
                <div className="truncate font-medium">{f.nameEn}</div>
                {/* Six counts on one line: each pair is its own span and the
                    separator is explicit, so "◔ 1" and "● 2" never read as
                    one number. */}
                <div className="mt-0.5 flex flex-wrap items-center text-text-tertiary">
                  {VERDICT_ORDER.map((v, i) => (
                    <span key={v} className="whitespace-nowrap">
                      {i > 0 && <span aria-hidden className="px-1">·</span>}
                      <span aria-hidden>{GLYPH[v]}</span>
                      <span className="sr-only">{VERDICT_LABEL[v]}</span> {f.counts[v]}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  href,
  children,
}: {
  active: boolean;
  href: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs ${
        active
          ? 'border-[oklch(var(--color-accent-default))] bg-accent-subtle font-semibold'
          : 'border-default bg-surface-1 text-text-secondary'
      }`}
    >
      {children}
    </Link>
  );
}

import * as React from 'react';
import Link from 'next/link';
// Runtime value from the client-safe subpath, not the root barrel — see the
// HARD CONSTRAINT this whole page is built under: the root barrel pulls
// node:crypto and a value import of it fails the build.
import { DEFAULT_DEMAND_BASIS, DEMAND_BASES, type DemandBasis } from '@kku/shared/demand/sources';
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
            {/* Without this, "Apply" on the thresholds form would silently
                drop whichever demand basis the reader had selected — this
                form is a plain GET submitting only the inputs it lists,
                unlike every other control on the page which is a link that
                carries the whole state forward. */}
            {params.basis !== DEFAULT_DEMAND_BASIS && <input type="hidden" name="basis" value={params.basis} />}
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

      <BasisControl params={params} href={href} />

      {facultyStrip.length > 0 && <FacultyFilter params={params} href={href} facultyStrip={facultyStrip} />}
    </div>
  );
}

/** Labels written for a Council reader, not the source slugs — matches the
 *  wording `DEMAND_BASIS_LABELS` in the api's gap.controller.ts uses for the
 *  provenance drawer, so the control and the drawer agree on what "both
 *  markets" means. */
const BASIS_LABEL: Record<DemandBasis, string> = {
  all: 'Both markets',
  private: 'Private only',
  public: 'Government only',
};

/** Three-way, URL-shareable via `?basis=`, following the same GET-link
 *  pattern as the verdict chips above — no client JavaScript, and a shared
 *  link carries the basis a reader chose. */
function BasisControl({
  params,
  href,
}: {
  params: GapPageParams;
  href: (patch: Partial<GapPageParams>) => string;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-text-secondary">Demand counted from</span>
      {DEMAND_BASES.map((b) => (
        <Chip key={b} active={params.basis === b} href={href({ basis: b })}>
          {BASIS_LABEL[b]}
        </Chip>
      ))}
    </div>
  );
}

/** The faculty filter: every faculty visible at once, none of it behind a
 *  sideways scroll.
 *
 *  It used to be a `overflow-x-auto` strip, which on a 23-faculty portfolio
 *  showed about four and hid the rest behind a gesture most readers never
 *  make — a control that conceals its own options. This is a wrapped set
 *  inside a `<details>`: the summary names the current selection and the
 *  number of faculties, opening it reveals all of them on as many lines as
 *  it takes, and the first entry clears the filter. `<details>` and links
 *  are plain HTML, so the whole control still works with client JavaScript
 *  switched off — which is the property the rest of this strip is built
 *  for. Ordering is alphabetical rather than by count, because a reader
 *  comes here looking for one particular faculty, usually their own. */
function FacultyFilter({
  params,
  href,
  facultyStrip,
}: {
  params: GapPageParams;
  href: (patch: Partial<GapPageParams>) => string;
  facultyStrip: GapMapT['facultyStrip'];
}): React.JSX.Element {
  const ordered = [...facultyStrip].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
  const selected = ordered.find((f) => f.facultyId === params.facultyId) ?? null;
  return (
    <details className="text-xs" open={selected != null}>
      <summary className="cursor-pointer text-text-secondary">
        Faculty:{' '}
        <span className="font-medium text-text-primary">
          {selected ? selected.nameEn : 'all faculties'}
        </span>
        <span className="text-text-tertiary">
          {' '}
          — choose from {ordered.length} with fields of study
        </span>
      </summary>
      <div className="mt-4 flex flex-wrap gap-4">
        <Link
          href={href({ facultyId: null })}
          aria-pressed={selected == null}
          className={`w-[200px] rounded border px-2 py-1 text-left leading-tight ${
            selected == null
              ? 'border-[oklch(var(--color-accent-default))] bg-accent-subtle'
              : 'border-default bg-surface-1'
          }`}
        >
          <div className="font-medium">All faculties</div>
          <div className="mt-0.5 text-text-tertiary">no faculty filter</div>
        </Link>
        {ordered.map((f) => {
          const on = params.facultyId === f.facultyId;
          return (
            <Link
              key={f.facultyId}
              href={href({ facultyId: on ? null : f.facultyId })}
              aria-pressed={on}
              className={`w-[200px] rounded border px-2 py-1 text-left leading-tight ${
                on
                  ? 'border-[oklch(var(--color-accent-default))] bg-accent-subtle'
                  : 'border-default bg-surface-1'
              }`}
            >
              <div className="font-medium">{f.nameEn}</div>
              <div lang="th" className="text-text-tertiary">
                {f.nameTh}
              </div>
              {/* Six counts on one line: each pair is its own span and the
                  separator is explicit, so "◔ 1" and "● 2" never read as
                  one number. */}
              <div className="mt-0.5 flex flex-wrap items-center text-text-tertiary">
                {VERDICT_ORDER.map((v, i) => (
                  <span key={v} className="whitespace-nowrap">
                    {i > 0 && (
                      <span aria-hidden className="px-1">
                        ·
                      </span>
                    )}
                    <span aria-hidden>{GLYPH[v]}</span>
                    <span className="sr-only">{VERDICT_LABEL[v]}</span> {f.counts[v]}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </details>
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

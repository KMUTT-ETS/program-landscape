'use client';

import * as React from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Layout language for dense evidence pages (/teaching-learning/[programId],
// and the deep-dive next). Approved from a mock on 2026-09-04; the mock is
// kept at docs/design/aunqa-evidence-mock.html.
//
// THE RULE THESE EXIST TO ENFORCE — invert the hierarchy.
//
// Before, a section heading, a sub-heading and a data card all carried roughly
// the same visual weight, and the card was often the LOUDEST thing on screen
// (each criterion was wrapped in one big <Card>). The page read as one flat
// column — "texts after texts without focus".
//
// Three levels, each visibly quieter than the one above:
//
//   SectionBand   big tabular numeral + title + coverage line + state chip,
//                 closed by a 2px rule. The loudest thing on the page.
//   SubSection    hangs off a vertical spine; its number sits ON the line.
//   EvidenceCard  deliberately the QUIETEST layer — muted header, dashed
//                 divider, source footer. Its NUMBER is prominent, its
//                 chrome is not.
//
// Tokens only — no literal colours (ESLint enforces this). Semantic state
// (success / warning / tertiary) is deliberately separate from the accent.
// ─────────────────────────────────────────────────────────────────────────────

export type EvidenceState = 'evidenced' | 'partial' | 'absent';

const STATE_CHIP: Record<EvidenceState, string> = {
  evidenced: 'bg-success/10 text-success',
  partial: 'bg-warning/10 text-warning',
  // Grey, never red: "no evidence yet" describes OUR data coverage, not a
  // failing programme. The page copy is emphatic about that and a red chip
  // would contradict it.
  absent: 'bg-surface-2 text-text-tertiary',
};

export function StateChip({
  state,
  children,
  dot = false,
}: {
  state: EvidenceState;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5',
        'text-[10px] font-semibold tracking-wide',
        STATE_CHIP[state],
      ].join(' ')}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Level 1 — the banded section header. */
export function SectionBand({
  id,
  no,
  title,
  coverage,
  chip,
  stat,
  statLabel,
  className,
  children,
}: {
  id: string;
  /**
   * Displayed large in the accent, on the LEFT. Use only where the number is
   * real — AUN-QA criterion ids are the framework's own labels, and the
   * missing 6 and 7 carry meaning. Sections that are merely a sequence of
   * topics should pass `stat` instead than invent a numbering.
   */
  no?: React.ReactNode;
  title: string;
  coverage?: string;
  chip?: React.ReactNode;
  /** Headline figure shown on the RIGHT, for sections that are not numbered. */
  stat?: React.ReactNode;
  statLabel?: string;
  /**
   * Replaces the default vertical rhythm. Pass `''` where the parent already
   * spaces its children (the deep-dive stacks sections with `gap-10`) —
   * otherwise the two add up.
   */
  className?: string;
  children: React.ReactNode;
}) {
  // mt in rem for the same reason as SubSection's padding below — `mt-10` on
  // this scale is 20px, too little air between two bands.
  return (
    <section
      id={id}
      // scroll-mt is applied unconditionally: it is what keeps a rail anchor
      // from landing this heading under the 72px topbar, so a caller passing
      // `className` for spacing must not silently drop it (that is exactly
      // what `className ?? default` used to do). 5rem, arbitrary for the same
      // half-scale reason as the rail — scroll-mt-6 here was 12px, not 24px.
      className={['scroll-mt-[5rem]', className ?? 'mt-[2.25rem] first:mt-0'].join(' ')}
    >
      {/* The rule is what makes the band read as a heading rather than a
          caption, so it must be the ink colour. `border-text-primary` is NOT
          a utility here — the preset restricts borderColor to the `border`
          family (subtle/default/strong), so that class silently fell back to
          the default border and drew a faint line. The darkest border token
          is 70% lightness; text-primary is 19%. Hence the arbitrary value,
          which the no-literal-colour lint allows because it wraps a token. */}
      <header className="flex items-end gap-4 border-b-2 border-b-[oklch(var(--color-text-primary))] pb-3">
        {no !== undefined && (
          <span className="font-tabular self-center text-2xl font-bold leading-none tracking-tight text-accent-default">
            {no}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-balance text-base font-semibold tracking-tight text-text-primary">
            {title}
          </h2>
          {coverage && <p className="mt-0.5 text-xs text-text-secondary">{coverage}</p>}
        </div>
        {/* Explicit rem gap below: `gap-1.5` is 3px on this project's
            half-scale, which renders "81" and "OVERALL" as one run. A number
            followed immediately by its unit needs real separation, not a
            token gap that happens to be tiny here. */}
        {stat !== undefined && (
          <span className="flex shrink-0 items-baseline gap-[0.45rem]">
            <b className="font-tabular text-xl font-bold tracking-tight text-text-primary">
              {stat}
            </b>
            {statLabel && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                {statLabel}
              </span>
            )}
          </span>
        )}
        {chip}
      </header>
      {children}
    </section>
  );
}

/**
 * The spine chrome on its own — vertical line, and a marker sitting on it.
 *
 * Use this to nest blocks that already render their own heading and body
 * (the deep-dive's sub-blocks are whole components). SubSection below is
 * this plus a heading, for pages that let the caller supply the title.
 */
export function SpineItem({
  id,
  last = false,
  emphasis = false,
  children,
}: {
  id?: string;
  last?: boolean;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  // Structural spacing in explicit rem — this project's spacing scale is half
  // Tailwind's, so `pl-10` would be 20px and the marker would sit on top of
  // the content rather than clear of it.
  return (
    <div
      id={id}
      className={[
        'relative scroll-mt-[5rem] py-[1.15rem] pl-[2.25rem]',
        last ? 'border-l border-transparent' : 'border-l border-border-default',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'absolute left-0 top-[1.6rem] size-2 -translate-x-1/2 rounded-full border-2 bg-surface-0',
          emphasis ? 'border-accent-default' : 'border-border-strong',
        ].join(' ')}
      />
      {children}
    </div>
  );
}

/** Level 2 — a sub-section hanging off the spine. */
export function SubSection({
  id,
  no,
  title,
  chip,
  note,
  children,
  last = false,
  emphasis = false,
}: {
  id?: string;
  /**
   * The marker on the spine. A string draws it as a numbered chip (AUN-QA
   * sub-criteria, where "1.2" is a real label); omitting it draws a dot,
   * for blocks that are named but not numbered.
   */
  no?: string;
  title: React.ReactNode;
  chip?: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
  /** The spine should stop at the last item rather than run into space. */
  last?: boolean;
  /** Accent the dot — marks the block that matters most in its section. */
  emphasis?: boolean;
}) {
  // Structural spacing in explicit rem, NOT scale utilities: this project
  // replaces Tailwind's spacing scale with one at half the usual values
  // (packages/design/src/tokens/spacing.ts), so `pl-10` is 20px, not 40px —
  // too tight for the marker to sit clear of the text.
  return (
    <div
      id={id}
      className={[
        'relative scroll-mt-[5rem] py-[1.15rem] pl-[2.25rem]',
        last ? 'border-l border-transparent' : 'border-l border-border-default',
      ].join(' ')}
    >
      {/* The marker sits ON the spine: -50% pulls it onto the line, and the
          page-ground background makes the line appear to pass behind it. */}
      {no !== undefined ? (
        <span
          className={[
            'absolute left-0 top-[1.15rem] -translate-x-1/2 rounded border border-border-strong',
            'bg-surface-0 px-1 py-px font-tabular text-[10px] font-bold text-text-secondary',
          ].join(' ')}
        >
          {no}
        </span>
      ) : (
        <span
          aria-hidden
          className={[
            'absolute left-0 top-[1.4rem] size-2 -translate-x-1/2 rounded-full border-2 bg-surface-0',
            emphasis ? 'border-accent-default' : 'border-border-strong',
          ].join(' ')}
        />
      )}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold tracking-tight text-text-primary">{title}</span>
        {chip}
      </div>
      {note && <p className="mt-1 max-w-prose text-xs text-text-secondary">{note}</p>}
      {children}
    </div>
  );
}

/** Level 3 — deliberately the quietest layer. */
export function EvidenceCard({
  name,
  freshness,
  source,
  children,
}: {
  name: string;
  freshness?: React.ReactNode;
  source?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border-subtle bg-surface-1">
      <div className="flex items-baseline justify-between gap-4 border-b border-dashed border-border-subtle px-3 py-2">
        <span className="text-xs font-semibold text-text-secondary">{name}</span>
        {freshness && <span className="shrink-0 text-[10px] text-text-tertiary">{freshness}</span>}
      </div>
      {children}
      {source && (
        <div className="border-t border-border-subtle bg-surface-2 px-3 py-1.5 text-[10px] text-text-tertiary">
          {source}
        </div>
      )}
    </div>
  );
}

/** The row of figures inside an EvidenceCard. */
export function EvidenceBodyRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-x-8 gap-y-4 p-3">{children}</div>;
}

/** One figure. The number is the loud part; the label and caption are not. */
export function Stat({
  label,
  value,
  unit,
  caption,
  children,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  caption?: React.ReactNode;
  /** e.g. a ScaleBar, rendered between the value and the caption. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <span className="font-tabular text-xl font-bold leading-tight tracking-tight text-text-primary">
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-text-secondary">{unit}</span>}
      </span>
      {children}
      {caption && <span className="text-[10px] text-text-tertiary">{caption}</span>}
    </div>
  );
}

/**
 * A measurement caveat, folded away.
 *
 * The notes are worth keeping — they say what a figure does and does not
 * cover — but at full size, repeated under every card, they competed with the
 * data. Closed by default; the summary reads as a question so opening it is
 * an obvious act.
 */
export function Caveat({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-dashed border-border-subtle">
      <summary
        className={[
          'flex cursor-pointer list-none items-center gap-1.5 px-3 py-2',
          'text-[10px] font-semibold text-warning',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
          'group-open:border-b group-open:border-dashed group-open:border-border-subtle',
          '[&::-webkit-details-marker]:hidden',
        ].join(' ')}
      >
        <span
          aria-hidden
          className="grid size-3 place-items-center rounded-full border border-current text-[8px] font-bold"
        >
          !
        </span>
        {summary}
      </summary>
      <div className="max-w-prose px-3 py-2 text-xs text-text-secondary">{children}</div>
    </details>
  );
}

/** Coverage ring. One of only two SVGs in this language — keep it that way. */
export function CoverageRing({
  value,
  total,
  size = 52,
}: {
  value: number;
  total: number;
  size?: number;
}) {
  const r = size / 2 - 4;
  const circumference = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="5"
        className="stroke-border-subtle"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${circumference * pct} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={pct >= 1 ? 'stroke-success' : 'stroke-warning'}
      />
    </svg>
  );
}

/** A 1–5 (or 0–max) scale bar, so a mean is read against its range. */
export function ScaleBar({ value, max = 5 }: { value: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <svg
      viewBox="0 0 200 6"
      preserveAspectRatio="none"
      className="h-1.5 w-full max-w-60"
      aria-hidden
    >
      <rect x="0" y="2" width="200" height="2" rx="1" className="fill-border-subtle" />
      <rect x="0" y="1" width={(pct / 100) * 200} height="4" rx="2" className="fill-accent-default" />
    </svg>
  );
}

export interface RailItem {
  /** Element id to scroll to. */
  href: string;
  /**
   * Short marker, e.g. "C1". Omitted on pages whose sections are not
   * numbered — the deep-dive's sections are a tour of a programme, not a
   * numbered framework, so numbering them would invent a sequence.
   */
  marker?: string;
  label: string;
  /** e.g. "4/4", "none" for a section that holds nothing, or a headline figure. */
  meta?: string;
  absent?: boolean;
  /** Second level: the named blocks inside this section. */
  subs?: Array<{ href: string; label: string }>;
}

/**
 * Sticky section rail with a scroll-spy.
 *
 * Sections that hold nothing are listed in place and greyed rather than
 * parked at the bottom of the page — their absence is a stated fact, not
 * something the reader discovers after 9,000px of scrolling.
 */
export function SectionRail({ label, items }: { label: string; items: RailItem[] }) {
  const [active, setActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ids = items.map((i) => i.href.replace(/^#/, ''));
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(`#${e.target.id}`);
      },
      // Top 10%..30% band: a section counts as "current" once its header
      // reaches the upper part of the viewport, not when it merely appears.
      { rootMargin: '-10% 0px -70% 0px' },
    );
    for (const n of nodes) obs.observe(n);
    return () => obs.disconnect();
  }, [items]);

  return (
    // Sticky travel is bounded by the containing block, so the PARENT must
    // span the full column height — a parent with h-fit / self-start /
    // items-start shrink-wraps this nav and sticky silently does nothing.
    //
    // Offsets are arbitrary values on purpose: this repo's spacing scale is
    // half of stock Tailwind, so top-20 would read as 5rem but render 2.5rem.
    // 5rem clears the 72px md+ topbar (packages/ui top-bar.tsx) with a small
    // gap; max-h keeps a long rail scrollable rather than running off-screen.
    <nav
      aria-label={label}
      className="sticky top-[5rem] flex max-h-[calc(100vh-6rem)] flex-col gap-3 overflow-y-auto"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        {label}
      </div>
      <div className="flex flex-col gap-px">
        {items.map((it) => {
          const current = active === it.href;
          return (
            <React.Fragment key={it.href + (it.marker ?? it.label)}>
              <a
                href={it.href}
                aria-current={current ? 'true' : undefined}
                className={[
                  'grid items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-xs',
                  it.marker ? 'grid-cols-[2.2rem_1fr_auto]' : 'grid-cols-[1fr_auto]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
                  current
                    ? 'border-l-accent-default bg-surface-1 font-semibold text-text-primary'
                    : 'border-l-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary',
                  it.absent && !current ? 'text-text-tertiary' : '',
                ].join(' ')}
              >
                {it.marker && (
                  <span
                    className={[
                      'rounded border px-1 py-px text-center font-tabular text-[10px] font-bold',
                      current
                        ? 'border-accent-default text-accent-default'
                        : 'border-border-strong text-text-tertiary',
                    ].join(' ')}
                  >
                    {it.marker}
                  </span>
                )}
                <span className="truncate">{it.label}</span>
                {it.meta && (
                  <span
                    className={[
                      'font-tabular shrink-0 text-[10px]',
                      current ? 'text-accent-default' : 'text-text-tertiary',
                      it.absent ? 'italic' : '',
                    ].join(' ')}
                  >
                    {it.meta}
                  </span>
                )}
              </a>
              {it.subs && it.subs.length > 0 && (
                <div className="mb-1 ml-3 flex flex-col gap-px border-l border-border-subtle pl-2">
                  {it.subs.map((s) => (
                    <a
                      key={s.href}
                      href={s.href}
                      className={[
                        'truncate rounded px-1.5 py-0.5 text-[11px] text-text-tertiary',
                        'hover:bg-surface-2 hover:text-text-secondary',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-default',
                      ].join(' ')}
                    >
                      {s.label}
                    </a>
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}

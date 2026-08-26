import * as React from 'react';
import Link from 'next/link';
import { Card, Input, Label, cn } from '@kku/ui';
import { ArrowUpRight, Search } from 'lucide-react';
import { FilterAutoSubmit } from './filter-auto-submit';

// Filter-rail primitives — codify the canonical filter UI established
// on /admin/programs so every page renders the same chrome:
//
//   <FilterRail cols={5}>
//     <FilterField label="Search">
//       <FilterSearch
//         value={q}
//         onChange={setQ}
//         placeholder="Code, name (TH or EN)"
//         span={2}
//       />
//     </FilterField>
//     <FilterField label="Status">
//       <FilterSelect value={status} onChange={setStatus}>
//         <option value="">All statuses</option>
//         …
//       </FilterSelect>
//     </FilterField>
//   </FilterRail>
//
// Components are pure (no hooks, no client-state) so the file is
// "shared" — usable from both server and client component trees. The
// onSubmit prop only crosses into the client when a parent client
// component supplies it. Server-component pages (e.g. /programs/page)
// can pass `action="/programs"` for a plain GET form instead.

export interface FilterRailProps {
  /** Children rendered inside the grid. Wrap each one in <FilterField>. */
  children: React.ReactNode;
  /** Max columns on `md+` breakpoints. Default 5 matches /admin/programs. */
  cols?: 2 | 3 | 4 | 5 | 6;
  /** Client-side submit handler — only valid in a client tree. */
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  /** Server-form action target — use this in server components instead
   *  of onSubmit. The browser submits a plain GET request to the URL. */
  action?: string;
  /** Optional form method when using `action`. Defaults to `get`. */
  method?: 'get' | 'post';
  /** Server-form only: auto-commit the form whenever a `<select>` value
   *  changes (including picking "All …" which clears the filter). Defaults
   *  to true when `action` is set — server forms have no visible submit
   *  button and otherwise leave dropdown changes stranded. Has no effect
   *  in client-island (`onSubmit`) mode. */
  autoSubmit?: boolean;
  className?: string;
}

const COLS_CLASS: Record<NonNullable<FilterRailProps['cols']>, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
};

export function FilterRail({
  children,
  cols = 5,
  onSubmit,
  action,
  method = 'get',
  autoSubmit,
  className,
}: FilterRailProps) {
  // Two modes:
  //   1. action="…" — server-rendered GET form; the browser navigates
  //      to the URL with the controls' name/value pairs as query string.
  //   2. onSubmit — client island; intercept submit and run the handler.
  // Don't intercept submit when an action is provided.
  //
  // Auto-commit on select change defaults ON for server forms because
  // they have no visible submit button — without it, picking "All …"
  // from a dropdown does nothing. Client islands manage their own
  // commit cadence so we leave them alone.
  const enableAutoSubmit = autoSubmit ?? Boolean(action);
  return (
    <Card padding="sm" tone="quiet" className={className}>
      <form
        className={`grid grid-cols-1 gap-3 ${COLS_CLASS[cols]}`}
        action={action}
        method={action ? method : undefined}
        onSubmit={
          onSubmit
            ? (e) => {
                e.preventDefault();
                onSubmit(e);
              }
            : undefined
        }
      >
        {children}
        {action && enableAutoSubmit && <FilterAutoSubmit />}
      </form>
    </Card>
  );
}

export interface FilterFieldProps {
  label: string;
  children: React.ReactNode;
  /** How many grid columns this field spans on `md+`. Default 1. */
  span?: 1 | 2 | 3 | 4;
  className?: string;
}

const SPAN_CLASS: Record<NonNullable<FilterFieldProps['span']>, string> = {
  1: '',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
};

export function FilterField({
  label,
  children,
  span = 1,
  className,
}: FilterFieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${SPAN_CLASS[span]} ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// Two modes:
//   • Controlled (`value` + `onChange`) — for client islands wired to
//     React state. Updates fire on every keystroke; caller decides when
//     to commit (typically the FilterRail's onSubmit).
//   • Uncontrolled (`name` + `defaultValue`) — for plain server-form
//     submission. Pass-through to the underlying <input> so it lands
//     in the query string when the form submits.
export type FilterSearchProps =
  | {
      value: string;
      onChange: (v: string) => void;
      placeholder?: string;
      id?: string;
      name?: string;
    }
  | {
      defaultValue?: string;
      name: string;
      placeholder?: string;
      id?: string;
    };

export function FilterSearch(props: FilterSearchProps) {
  const isControlled = 'value' in props;
  // Arithmetic below is on THIS project's spacing scale, which is half
  // of Tailwind's default (packages/design/src/tokens/spacing.ts):
  // `3` = 6px, `10` = 20px, `16` = 32px. Icon sizes come from the
  // separate `size-icon-*` scale, so `size-icon-md` is a true 16px.
  //
  // Icon: left-3 = 6px inset — the same inset as the Input's own
  // px-3 text padding — centred vertically via top-1/2 plus
  // -translate-y-1/2. Its right edge therefore lands at 6 + 16 = 22px.
  // Input: pl-16 = 32px, leaving 10px of clearance between the icon
  // and the text caret — enough for Thai glyph side-bearings and for
  // placeholder italics that would otherwise lean into the icon.
  //
  // The previous pl-10 was 20px on this scale, i.e. the caret started
  // 2px INSIDE the icon. It only ever looked correct while icons were
  // rendering at half size (8px) off the spacing scale.
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 z-10 size-icon-md -translate-y-1/2 text-text-tertiary"
        aria-hidden
      />
      {isControlled ? (
        <Input
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className="pl-16"
        />
      ) : (
        <Input
          id={props.id}
          name={props.name}
          defaultValue={props.defaultValue}
          placeholder={props.placeholder}
          className="pl-16"
        />
      )}
    </div>
  );
}

// Cross-link rendered inside a FilterRail row at filter-control height
// (h-9, matches Input + Select). Used on /risks and any other page
// where a filter row hosts navigation chips to sibling views.
//
// Tone palette mirrors the Badge primitive so the chip reads as a
// scoped action, not chrome. Default tone is "accent" — visible enough
// to invite a click without competing with the page's filter focus.
export type FilterCrossLinkTone = 'accent' | 'cardinal' | 'success' | 'warning' | 'neutral';

const CROSS_LINK_TONE: Record<FilterCrossLinkTone, string> = {
  accent:
    'border-accent-default/40 bg-accent-default/10 text-accent-default hover:bg-accent-default/20',
  cardinal:
    'border-brand-cardinal/40 bg-brand-cardinal/10 text-brand-cardinal hover:bg-brand-cardinal/20',
  success: 'border-success/40 bg-success/10 text-success hover:bg-success/20',
  warning: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20',
  neutral:
    'border-border-default bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary',
};

export interface FilterCrossLinkProps {
  href: string;
  children: React.ReactNode;
  tone?: FilterCrossLinkTone;
  className?: string;
  /** Open in a new tab. Defaults to false. */
  external?: boolean;
}

export function FilterCrossLink({
  href,
  children,
  tone = 'accent',
  className,
  external,
}: FilterCrossLinkProps) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
        CROSS_LINK_TONE[tone],
        className,
      )}
    >
      {children}
      <ArrowUpRight className="size-icon-sm shrink-0" aria-hidden />
    </Link>
  );
}

// Companion: a row of cross-links inside a FilterField, sized to share
// the row with FilterSelect / FilterSearch. Wraps onto a second line
// when the row narrows.
export function FilterCrossLinkGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export type FilterSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function FilterSelect({ className, children, ...props }: FilterSelectProps) {
  return (
    <select className={`kku-select ${className ?? ''}`} {...props}>
      {children}
    </select>
  );
}

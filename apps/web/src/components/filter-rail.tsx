import * as React from 'react';
import { Card, Input, Label } from '@kku/ui';
import { Search } from 'lucide-react';

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
  className,
}: FilterRailProps) {
  // Two modes:
  //   1. action="…" — server-rendered GET form; the browser navigates
  //      to the URL with the controls' name/value pairs as query string.
  //   2. onSubmit — client island; intercept submit and run the handler.
  // Don't intercept submit when an action is provided.
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
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-text-tertiary"
        aria-hidden
      />
      {isControlled ? (
        <Input
          id={props.id}
          name={props.name}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className="pl-8"
        />
      ) : (
        <Input
          id={props.id}
          name={props.name}
          defaultValue={props.defaultValue}
          placeholder={props.placeholder}
          className="pl-8"
        />
      )}
    </div>
  );
}

export type FilterSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export function FilterSelect({ className, children, ...props }: FilterSelectProps) {
  return (
    <select className={`kku-select ${className ?? ''}`} {...props}>
      {children}
    </select>
  );
}

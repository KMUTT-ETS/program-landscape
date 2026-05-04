'use client';

import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

// Lightweight multi-select dropdown — checkbox list inside a popover,
// no external dep. Click outside or press Escape to close. Selected
// values appear as removable chips inside the trigger button.

export interface MultiSelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface MultiSelectFieldProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Show a search input above the option list. Defaults to true when
   *  there are more than 8 options. */
  searchable?: boolean;
  /** Truncate the trigger label to this many chips before showing
   *  "+N more". Default 3. */
  maxVisibleChips?: number;
  className?: string;
  disabled?: boolean;
  /** When true, the option list is left in caller-supplied order
   *  (used for things like status codes 0→99 or canonical level
   *  ranks). Default = sort options Thai-collator alphabetically. */
  preserveOrder?: boolean;
}

// Thai-aware collator for the option list. Matches the api-side
// `compareThai` helper so dropdown ordering lines up with every
// rendered list across the dashboards.
const TH_COLLATOR = new Intl.Collator('th', {
  numeric: true,
  sensitivity: 'base',
});

export function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  placeholder = '— All —',
  searchable,
  maxVisibleChips = 3,
  className,
  disabled,
  preserveOrder,
}: MultiSelectFieldProps) {
  const sortedOptions = React.useMemo(() => {
    if (preserveOrder) return options;
    return [...options].sort((a, b) =>
      TH_COLLATOR.compare(a.label, b.label),
    );
  }, [options, preserveOrder]);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const showSearch = searchable ?? sortedOptions.length > 8;
  const filtered = React.useMemo(() => {
    if (!query.trim()) return sortedOptions;
    const q = query.toLowerCase();
    return sortedOptions.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [sortedOptions, query]);

  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const labelOf = (v: string) =>
    options.find((o) => o.value === v)?.label ?? v;

  return (
    <div
      ref={rootRef}
      className={`relative flex flex-col gap-1 text-xs text-text-tertiary ${className ?? ''}`}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        className={`flex min-h-[34px] min-w-[200px] items-center gap-1.5 rounded border border-border-subtle bg-surface-1 px-2 py-1 text-left text-sm text-text-primary disabled:opacity-50 hover:bg-surface-2`}
      >
        {selected.length === 0 ? (
          <span className="text-text-tertiary">{placeholder}</span>
        ) : (
          <span className="flex flex-1 flex-wrap gap-1">
            {selected.slice(0, maxVisibleChips).map((v) => (
              <span
                key={v}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(v);
                }}
                className="inline-flex items-center gap-0.5 rounded-sm bg-accent/15 px-1.5 py-0.5 text-[0.7rem] text-accent"
                title="Click to remove"
              >
                <span className="max-w-[160px] truncate">{labelOf(v)}</span>
                <X className="h-2.5 w-2.5" />
              </span>
            ))}
            {selected.length > maxVisibleChips && (
              <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-[0.7rem] text-text-secondary">
                +{selected.length - maxVisibleChips}
              </span>
            )}
          </span>
        )}
        {selected.length > 0 && (
          <span
            onClick={clear}
            className="text-text-tertiary hover:text-text-primary"
            title="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-[max(100%,260px)] overflow-hidden rounded border border-border-subtle bg-surface-0 text-text-primary shadow-lg">
          {showSearch && (
            <div className="border-b border-border-subtle p-1.5">
              <input
                autoFocus
                type="text"
                placeholder="Search…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded border border-border-subtle bg-surface-1 px-2 py-1 text-sm text-text-primary outline-none focus:border-accent"
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto py-1 text-sm">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-text-tertiary">No matches.</li>
            ) : (
              filtered.map((o) => {
                const checked = selected.includes(o.value);
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      onClick={() => toggle(o.value)}
                      className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-surface-2"
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          checked
                            ? 'border-accent bg-accent text-surface-0'
                            : 'border-border-strong'
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="flex-1 truncate" title={o.label}>
                        {o.label}
                      </span>
                      {o.hint && (
                        <span className="text-[0.7rem] text-text-tertiary">
                          {o.hint}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex items-center justify-between border-t border-border-subtle px-2 py-1.5 text-[0.7rem] text-text-tertiary">
            <span>{selected.length} selected</span>
            <div className="flex gap-2">
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="hover:text-text-primary"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="hover:text-text-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

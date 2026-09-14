'use client';

// Shared EN/TH toggle button used by /docs/methodology and
// /docs/acknowledgements. Purely presentational — callers own the `lang`
// state and the click handler (URL sync, local state, whatever fits).

export type Lang = 'en' | 'th';

export function LangBtn({
  current,
  value,
  label,
  onClick,
}: {
  current: Lang;
  value: Lang;
  label: string;
  onClick: (v: Lang) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={`flex-1 rounded-sm px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-surface-2 text-text-primary shadow-sm'
          : 'text-text-secondary hover:text-text-primary'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

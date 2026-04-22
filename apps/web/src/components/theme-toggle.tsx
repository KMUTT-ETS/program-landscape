'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { setThemePreferenceAction } from '@/lib/actions/theme';

const THEMES: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    // Prevent hydration mismatch — no theme label until after mount.
    return <div className="h-8 w-20" aria-hidden />;
  }

  const onChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as (typeof THEMES)[number]['value'];
    setTheme(value);
    void setThemePreferenceAction(
      value === 'light' ? 'LIGHT' : value === 'dark' ? 'DARK' : 'SYSTEM',
    );
  };

  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      <span className="sr-only">Theme</span>
      <select
        value={theme ?? 'system'}
        onChange={onChange}
        className="rounded-sm border border-border bg-surface-raised px-2 py-1 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
      >
        {THEMES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </label>
  );
}

'use client';

import { useState } from 'react';

// Stub only. Analysis content (AI narratives, briefs) is Thai-primary with
// an on-demand English translation (prompt 04+). UI labels are English-only
// by design — this toggle does NOT flip UI language.
export function LanguageToggle() {
  const [lang, setLang] = useState<'TH' | 'EN'>('TH');
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'TH' ? 'EN' : 'TH')}
      className="rounded-sm border border-border bg-surface-raised px-2 py-1 text-xs text-fg-muted hover:text-fg"
      title="Analysis content language"
    >
      Analysis: {lang}
    </button>
  );
}

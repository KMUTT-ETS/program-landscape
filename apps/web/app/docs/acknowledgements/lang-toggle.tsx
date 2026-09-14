'use client';

// Only the language toggle needs client interactivity on this page — the
// list itself is a server component. Clicking EN/TH updates ?lang= in the
// URL; the server page re-renders with the new language. No local state:
// `lang` always reflects what the server rendered.

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { LangBtn, type Lang } from '@/components/lang-toggle';

export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setLang = useCallback(
    (next: Lang) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('lang', next);
      router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex items-center gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
        Language / ภาษา
      </p>
      <div className="flex rounded-md border border-border-subtle p-0.5">
        <LangBtn current={lang} value="en" label="EN" onClick={setLang} />
        <LangBtn current={lang} value="th" label="TH" onClick={setLang} />
      </div>
    </div>
  );
}

'use client';

// Client wrapper for the public methodology document. Owns:
//   - language state (en | th) — synced to ?lang=… in the URL so links
//     and bookmarks survive
//   - sticky table-of-contents with anchor links
//   - print stylesheet (will be the foundation for the PDF download
//     route shipping in a follow-up)

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Button } from '@kku/ui';
import { Languages, Printer } from 'lucide-react';
import { LangBtn, type Lang } from '@/components/lang-toggle';
import { MethodologyContentEn } from './content-en';
import { MethodologyContentTh } from './content-th';

const TOC_EN: { id: string; label: string; section?: string }[] = [
  { id: 'provenance', label: 'Document provenance' },
  { id: 'abstract', label: 'Abstract' },
  { id: 'introduction', label: 'Introduction', section: '1' },
  { id: 'health-score', label: 'Program Health Score', section: '2' },
  { id: 'lifecycle', label: 'Lifecycle Verdict', section: '3' },
  { id: 'deep-dive', label: 'Deep-Dive methodology', section: '4' },
  { id: 'risk-management', label: 'Risk Management', section: '5' },
  { id: 'gap-map', label: 'Gap Analyzer', section: '6' },
  { id: 'program-overlap', label: 'Program overlap', section: '7' },
  { id: 'data-sources', label: 'Data sources', section: '8' },
  { id: 'governance', label: 'Governance & audit', section: '9' },
  { id: 'limitations', label: 'Limitations', section: '10' },
  { id: 'glossary', label: 'Glossary', section: '11' },
  { id: 'references', label: 'References', section: '12' },
  { id: 'appendix-a', label: 'Appendix A — Versions' },
];

const TOC_TH: { id: string; label: string; section?: string }[] = [
  { id: 'provenance', label: 'การเปิดเผยที่มา' },
  { id: 'abstract', label: 'บทคัดย่อ' },
  { id: 'introduction', label: 'บทนำ', section: '1' },
  { id: 'health-score', label: 'คะแนนสุขภาพหลักสูตร', section: '2' },
  { id: 'lifecycle', label: 'คำตัดสินวงจรชีวิต', section: '3' },
  { id: 'deep-dive', label: 'ระเบียบวิธี Deep-Dive', section: '4' },
  { id: 'risk-management', label: 'การบริหารความเสี่ยง', section: '5' },
  { id: 'gap-map', label: 'ตัววิเคราะห์ช่องว่าง', section: '6' },
  { id: 'program-overlap', label: 'ความซ้ำซ้อนของหลักสูตร', section: '7' },
  { id: 'data-sources', label: 'แหล่งข้อมูล', section: '8' },
  { id: 'governance', label: 'ธรรมาภิบาล', section: '9' },
  { id: 'limitations', label: 'ข้อจำกัด', section: '10' },
  { id: 'glossary', label: 'อภิธานศัพท์', section: '11' },
  { id: 'references', label: 'แหล่งอ้างอิง', section: '12' },
  { id: 'appendix-a', label: 'ภาคผนวก ก — เวอร์ชัน' },
];

export function MethodologyClient({ initialLang }: { initialLang: Lang }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<Lang>(initialLang);
  const [activeId, setActiveId] = useState<string>('provenance');

  // ── URL ↔ state sync ───────────────────────────────────────────────────
  const setLangAndUrl = useCallback(
    (next: Lang) => {
      setLang(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set('lang', next);
      router.replace(`/docs/methodology?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // ── Active-section tracking via IntersectionObserver ──────────────────
  useEffect(() => {
    const sections = (lang === 'en' ? TOC_EN : TOC_TH)
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [lang]);

  const toc = useMemo(() => (lang === 'en' ? TOC_EN : TOC_TH), [lang]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* ── Sidebar TOC + controls ───────────────────────────────────── */}
      {/* Offsets are arbitrary values on purpose: this project's spacing
          scale is half of stock Tailwind, so `top-16` read as 4rem but
          rendered 2rem — pinning this TOC under the 72px topbar. 5rem clears
          it, matching the evidence-page rail. */}
      <aside className="sticky top-[5rem] hidden h-fit max-h-[calc(100vh-6rem)] overflow-y-auto lg:block print:hidden">
        <Card padding="md">
          <div className="flex flex-col gap-3">
            {/* Lang toggle */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
                Language / ภาษา
              </p>
              <div className="flex rounded-md border border-border-subtle p-0.5">
                <LangBtn current={lang} value="en" label="EN" onClick={setLangAndUrl} />
                <LangBtn current={lang} value="th" label="TH" onClick={setLangAndUrl} />
              </div>
            </div>

            {/* Print / download */}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.print()}
                className="w-full justify-center gap-1.5"
              >
                <Printer className="size-icon-sm" />
                {lang === 'en' ? 'Print / save PDF' : 'พิมพ์ / บันทึก PDF'}
              </Button>
              <p className="mt-1 text-[10px] text-text-tertiary">
                {lang === 'en'
                  ? 'Server-rendered PDF download is coming next.'
                  : 'ดาวน์โหลด PDF ที่สร้างจากเซิร์ฟเวอร์ จะมีในรุ่นถัดไป'}
              </p>
            </div>

            <div className="border-t border-border-subtle pt-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
                {lang === 'en' ? 'Contents' : 'สารบัญ'}
              </p>
              <nav className="flex flex-col gap-0.5 text-[13px]">
                {toc.map((entry) => {
                  const active = entry.id === activeId;
                  return (
                    <a
                      key={entry.id}
                      href={`#${entry.id}`}
                      className={`flex items-baseline gap-2 rounded px-2 py-1 transition-colors ${
                        active
                          ? 'bg-accent-subtle text-text-primary'
                          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                      }`}
                    >
                      {entry.section && (
                        <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                          {entry.section}
                        </span>
                      )}
                      <span className="leading-snug">{entry.label}</span>
                    </a>
                  );
                })}
              </nav>
            </div>

            <div className="border-t border-border-subtle pt-2 text-[11px] text-text-tertiary">
              <Languages className="mb-1 inline size-icon-xs" />{' '}
              {lang === 'en'
                ? 'Switch language at any time — anchors persist.'
                : 'สลับภาษาได้ตลอด — anchor จะคงไว้'}
            </div>
          </div>
        </Card>
      </aside>

      {/* ── Document body ──────────────────────────────────────────────── */}
      <article
        className="min-w-0 max-w-3xl break-words"
        // Subtle reading-width cap; long-form prose reads better at ~70ch
      >
        {lang === 'en' ? <MethodologyContentEn /> : <MethodologyContentTh />}
      </article>
    </div>
  );
}

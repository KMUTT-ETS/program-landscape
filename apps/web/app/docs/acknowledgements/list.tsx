// Server component — no 'use client'. Pure render of the ACKNOWLEDGEMENTS
// registry; the only state on this page (the language) lives in the URL and
// is owned by the server page + <LangToggle>, so this component needs no
// hooks and can be unit-tested with renderToStaticMarkup.

import { Card, Badge } from '@kku/ui';
import { ExternalLink } from 'lucide-react';
import { DataSourceMark } from '@/components/data-source-mark';
import type { Lang } from '@/components/lang-toggle';
import { ACKNOWLEDGEMENTS, KIND_LABEL } from './registry';

const INTRO: Record<Lang, string> = {
  en: 'Program Landscape is built on data and support contributed by partner organisations. This page records them, what each contributes, and what that makes possible for Khon Kaen University and for Thai universities that adopt the platform.',
  th: 'Program Landscape สร้างขึ้นจากข้อมูลและการสนับสนุนขององค์กรพันธมิตร หน้านี้บันทึกรายชื่อองค์กรเหล่านั้น สิ่งที่แต่ละองค์กรมอบให้ และสิ่งที่การสนับสนุนนั้นทำให้เป็นไปได้สำหรับมหาวิทยาลัยขอนแก่นและมหาวิทยาลัยไทยที่นำระบบไปใช้',
};

const SINCE_LABEL: Record<Lang, string> = { en: 'since', th: 'ตั้งแต่' };
const DETAIL_LINK_LABEL: Record<Lang, string> = { en: 'Full document', th: 'เอกสารฉบับเต็ม' };

// `th-TH` renders the year in the Buddhist Era (e.g. 2569 for CE 2026) —
// that's intentional, it's how Thai dates read to a Thai reader.
// `iso` must be a bare `YYYY-MM-DD` (no time component) — the UTC
// midnight parse below assumes that shape, and the registry test in
// test/acknowledgements-registry.test.ts guards every entry's `since`.
function formatSince(iso: string, lang: Lang): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function AcknowledgementsList({
  lang,
  showDetailLinks,
}: {
  lang: Lang;
  showDetailLinks: boolean;
}) {
  return (
    // `contents` (not `flex flex-col gap-4`) — the page wrapper around
    // <LangToggle> + this list already supplies that layout; stacking a
    // second gapped flex container here would double the spacing.
    <div lang={lang} className="contents">
      <p className="max-w-[70ch] text-sm leading-relaxed text-text-secondary">{INTRO[lang]}</p>

      {ACKNOWLEDGEMENTS.map((a) => (
        <Card key={a.slug} padding="lg">
          <article id={a.slug} className="scroll-mt-[5rem]">
            <div className="flex flex-wrap items-center gap-2">
              {a.logo && (
                <span aria-hidden>
                  <DataSourceMark source={a.logo} size={28} />
                </span>
              )}
              <h2 className="text-lg font-semibold text-text-primary">{a.name}</h2>
              <Badge tone="neutral">{KIND_LABEL[a.kind]}</Badge>
              <span className="text-xs text-text-tertiary">
                {SINCE_LABEL[lang]} {formatSince(a.since, lang)}
              </span>
            </div>

            <p className="mt-2 text-sm font-medium text-text-secondary">{a.contributes[lang]}</p>

            <div className="mt-3 flex max-w-[70ch] flex-col gap-3 text-sm leading-relaxed text-text-secondary">
              {a.body[lang]}
            </div>

            {/* The repo is private, so the long-form record on GitHub is only
                reachable — and therefore only useful — to admin-grade users;
                everyone else gets the short in-app form above and nothing
                that looks like a dead link. */}
            {showDetailLinks && a.detailUrl && (
              <a
                href={a.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${DETAIL_LINK_LABEL[lang]} — ${a.name}`}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-default hover:underline"
              >
                {DETAIL_LINK_LABEL[lang]}
                <ExternalLink className="size-icon-xs" aria-hidden />
              </a>
            )}
          </article>
        </Card>
      ))}
    </div>
  );
}

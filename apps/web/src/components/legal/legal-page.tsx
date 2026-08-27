'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, PageHeader } from '@kku/ui';

export type LegalLang = 'en' | 'th';

interface LegalPageProps {
  titleEn: string;
  titleTh: string;
  bodyEn: React.ReactNode;
  bodyTh: React.ReactNode;
  // One per language: the Thai view must show a Thai-rendered date
  // (Buddhist-era year, Thai month name), not the English string.
  lastUpdatedEn?: string;
  lastUpdatedTh?: string;
}

const ROUTES = [
  { href: '/copyright', en: 'Copyright', th: 'ลิขสิทธิ์' },
  { href: '/terms', en: 'Terms & Conditions', th: 'ข้อกำหนดและเงื่อนไข' },
  { href: '/disclaimer', en: 'Disclaimer', th: 'คำชี้แจง' },
];

export function LegalPage({
  titleEn,
  titleTh,
  bodyEn,
  bodyTh,
  lastUpdatedEn,
  lastUpdatedTh,
}: LegalPageProps) {
  const [lang, setLang] = React.useState<LegalLang>('en');
  const t = lang === 'en' ? bodyEn : bodyTh;
  const title = lang === 'en' ? titleEn : titleTh;
  const lastUpdated = lang === 'en' ? lastUpdatedEn : lastUpdatedTh;

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          lang === 'en'
            ? 'Program Landscape — KKU Curriculum Intelligence Platform'
            : 'แพลตฟอร์ม Program Landscape มหาวิทยาลัยขอนแก่น'
        }
        actions={
          <button
            type="button"
            onClick={() => setLang(lang === 'en' ? 'th' : 'en')}
            className="rounded-md border border-border-subtle bg-surface-1 px-3 py-1 text-xs font-medium text-text-secondary hover:border-accent-default/40 hover:text-accent-default"
            aria-label={lang === 'en' ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'}
          >
            {lang === 'en' ? 'TH' : 'EN'}
          </button>
        }
      />

      <nav className="mb-6 flex flex-wrap gap-2 text-xs">
        {ROUTES.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="rounded-full border border-border-subtle bg-surface-1 px-3 py-1 text-text-secondary hover:border-accent-default/40 hover:text-accent-default"
          >
            {lang === 'en' ? r.en : r.th}
          </Link>
        ))}
      </nav>

      <Card padding="md" className="prose prose-sm max-w-none text-text-primary">
        {t}
      </Card>

      {lastUpdated && (
        <p className="mt-4 text-xs text-text-tertiary">
          {lang === 'en' ? 'Last updated' : 'ปรับปรุงล่าสุด'}: {lastUpdated}
        </p>
      )}
    </div>
  );
}

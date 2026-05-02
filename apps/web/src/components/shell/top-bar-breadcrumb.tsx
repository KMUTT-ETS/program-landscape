'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { appNavSections } from '@/lib/app-nav';

// Lightweight breadcrumb derived from the path + the appNavSections
// table. Returns Module › Sub-route (if any). Kept simple because the
// left nav already carries primary navigation — the breadcrumb is
// supporting chrome, not the star of the show.

const SECTION_OVERRIDES: Record<string, string> = {
  admin: 'Admin',
  inbox: 'Inbox',
  skills: 'Skill Explorer',
  upload: 'Upload PDFs',
  styleguide: 'Styleguide',
};

function prettify(seg: string): string {
  if (SECTION_OVERRIDES[seg]) return SECTION_OVERRIDES[seg];
  return seg
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TopBarBreadcrumb() {
  const pathname = usePathname() ?? '/';
  const segments = pathname.split('/').filter(Boolean);

  const allItems = appNavSections.flatMap((s) => s.items);
  // Find the longest matching module entry (e.g. `/programs/abc` → Programs)
  const moduleEntry = allItems
    .filter((it) => it.href !== '/' && pathname.startsWith(it.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (segments.length === 0) {
    return <span className="font-medium text-text-primary">Home</span>;
  }

  const firstLabel = moduleEntry?.label ?? prettify(segments[0] ?? '');
  const firstHref = moduleEntry?.href ?? `/${segments[0]}`;
  const rest = segments.slice(moduleEntry ? moduleEntry.href.split('/').filter(Boolean).length : 1);

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2">
      <Link
        href={firstHref}
        className="truncate text-base font-semibold tracking-tight text-text-primary transition-colors duration-fast hover:text-accent-default"
      >
        {firstLabel}
      </Link>
      {rest.map((seg, idx) => (
        <React.Fragment key={`${seg}-${idx}`}>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
          <span className="truncate text-base font-medium text-text-secondary">{prettify(seg)}</span>
        </React.Fragment>
      ))}
    </nav>
  );
}

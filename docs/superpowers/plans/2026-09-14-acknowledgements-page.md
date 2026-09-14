# Acknowledgements Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-app `/docs/acknowledgements` page under the REFERENCE nav group, driven by a TypeScript registry so a future contributor is added with one commit; JobThai is the first entry and its brand mark links to it.

**Architecture:** Same shape as `/docs/methodology` — a server `page.tsx` that reads `?lang=` and wraps a small client component that owns the EN/TH toggle. Content comes from `registry.tsx`, a typed list; the page maps over it. `DataSourceMark` gains an optional `href` so the JobThai icon can link to its acknowledgement where it stands alone.

**Tech Stack:** Next.js 14 App Router, `@kku/ui` (`Card`, `Badge`, `PageHeader`, `Button`), lucide icons, Vitest with `react-dom/server` (no DOM in this workspace).

**Spec:** `docs/superpowers/specs/2026-09-14-acknowledgements-and-usage-analytics-design.md`, Part A.

**Conventions that apply (from CLAUDE.md):** UI labels English-only (the acknowledgement *body* is bilingual because it is content, like the methodology paper); no hardcoded colours — tokens only; client components `import type` only from `@kku/shared`; never `git add -A` (three untracked files stay untracked); commit messages via `git commit -F <file>` because the dev-safety hook blocks command strings that mention `.env`, and end with the attribution lines below.

Attribution to append to every commit message:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
```

---

## File structure

| File | Responsibility |
|---|---|
| `apps/web/app/docs/acknowledgements/registry.tsx` (create) | The typed list `ACKNOWLEDGEMENTS` and its types. Content only; no rendering logic beyond JSX bodies. |
| `apps/web/app/docs/acknowledgements/page.tsx` (create) | Server page: auth, `?lang=`, shell. |
| `apps/web/app/docs/acknowledgements/client.tsx` (create) | Client: language toggle synced to the URL, renders the cards. |
| `apps/web/test/acknowledgements-registry.test.ts` (create) | Registry invariants. |
| `apps/web/test/acknowledgements-render.test.tsx` (create) | The page renders every entry in both languages. |
| `apps/web/src/lib/app-nav.tsx` (modify) | New REFERENCE item. |
| `apps/web/src/components/data-source-mark.tsx` (modify) | Optional `href`. |
| `apps/web/app/admin/jobthai/page.tsx`, `apps/web/app/skills/client.tsx`, `apps/web/app/programs/[id]/client.tsx` (modify) | Pass `href` where the JobThai mark stands alone. |
| `docs/acknowledgements/jobthai.md` (modify) | Point at the in-app page. |

---

### Task 1: Registry with tests

**Files:**
- Create: `apps/web/app/docs/acknowledgements/registry.tsx`
- Test: `apps/web/test/acknowledgements-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/acknowledgements-registry.test.ts
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ACKNOWLEDGEMENTS } from '../app/docs/acknowledgements/registry';
import { DATA_SOURCE_MARKS } from '../src/components/data-source-mark';

// The registry is the only place a contributor is recorded. These invariants
// are what let the page render any future entry without further code.

const GITHUB_DOCS = 'https://github.com/khon-kaen-university/program-landscape/blob/main/docs/acknowledgements/';

describe('ACKNOWLEDGEMENTS registry', () => {
  it('has at least JobThai', () => {
    expect(ACKNOWLEDGEMENTS.some((a) => a.slug === 'jobthai')).toBe(true);
  });

  it('every entry carries both languages, non-empty', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      expect(a.contributes.en.trim().length, `${a.slug} contributes.en`).toBeGreaterThan(0);
      expect(a.contributes.th.trim().length, `${a.slug} contributes.th`).toBeGreaterThan(0);
      expect(renderToStaticMarkup(a.body.en).length, `${a.slug} body.en`).toBeGreaterThan(50);
      expect(renderToStaticMarkup(a.body.th).length, `${a.slug} body.th`).toBeGreaterThan(50);
    }
  });

  it('slugs are unique and URL-safe (they are anchor ids)', () => {
    const slugs = ACKNOWLEDGEMENTS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('a logo, when set, exists in DATA_SOURCE_MARKS', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      if (a.logo) expect(Object.keys(DATA_SOURCE_MARKS), `${a.slug} logo`).toContain(a.logo);
    }
  });

  it('a detailUrl, when set, points into this repo’s docs/acknowledgements/', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      if (a.detailUrl) expect(a.detailUrl.startsWith(GITHUB_DOCS), `${a.slug} detailUrl`).toBe(true);
    }
  });

  it('is ordered most recent first', () => {
    const dates = ACKNOWLEDGEMENTS.map((a) => a.since);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const sorted = [...dates].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0));
    expect(dates).toEqual(sorted);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/acknowledgements-registry.test.ts`
Expected: FAIL — `Failed to resolve import "../app/docs/acknowledgements/registry"`.

- [ ] **Step 3: Write the registry**

```tsx
// apps/web/app/docs/acknowledgements/registry.tsx
import type { ReactNode } from 'react';
import type { DataSourceMarkSlug } from '@/components/data-source-mark';

// ─────────────────────────────────────────────────────────────────────────────
// Acknowledgements registry — the one place an external contributor to
// Program Landscape is recorded. /docs/acknowledgements renders this list.
//
// Adding a contributor is one commit: append an entry here; if it has a logo,
// add it to DATA_SOURCE_MARKS with the image under apps/web/public/brand/
// (never hotlinked — CSP is img-src 'self'); optionally write the long form at
// docs/acknowledgements/<slug>.md and set detailUrl. The registry test asserts
// both languages, unique slugs, a known logo and an in-repo detailUrl.
//
// `body` is content, not a UI label, so it is bilingual — the same exemption
// the methodology paper uses.
// ─────────────────────────────────────────────────────────────────────────────

export type AcknowledgementKind = 'data-provider' | 'partner' | 'funder';

export interface Acknowledgement {
  /** Stable anchor id: /docs/acknowledgements#<slug>. */
  slug: string;
  kind: AcknowledgementKind;
  name: string;
  /** Reuses the brand mark shown beside the contributor's data in the app. */
  logo?: DataSourceMarkSlug;
  /** ISO date the contribution began. */
  since: string;
  /** One line for the list. */
  contributes: { en: string; th: string };
  /** The acknowledgement and what the contribution enables. */
  body: { en: ReactNode; th: ReactNode };
  /** Long-form record on GitHub. */
  detailUrl?: string;
}

export const KIND_LABEL: Record<AcknowledgementKind, string> = {
  'data-provider': 'Data provider',
  partner: 'Partner',
  funder: 'Funder',
};

const GITHUB_DOCS = 'https://github.com/khon-kaen-university/program-landscape/blob/main/docs/acknowledgements/';

/** Most recent `since` first. */
export const ACKNOWLEDGEMENTS: readonly Acknowledgement[] = [
  {
    slug: 'jobthai',
    kind: 'data-provider',
    name: 'JobThai',
    logo: 'jobthai',
    since: '2026-09-13',
    contributes: {
      en: 'Thai job postings — the platform’s view of domestic labour-market demand: which fields of study employers ask for, at which level, in which province and industry.',
      th: 'ประกาศรับสมัครงานในไทย — มุมมองอุปสงค์ตลาดแรงงานในประเทศของระบบ: นายจ้างต้องการสาขาวิชาใด ระดับวุฒิใด ในจังหวัดและอุตสาหกรรมใด',
    },
    body: {
      en: (
        <>
          <p>
            Khon Kaen University gratefully acknowledges <strong>JobThai</strong> for providing the
            job-posting data that gives Program Landscape its view of domestic labour-market demand.
          </p>
          <p>
            Before this contribution, the platform’s picture of what employers need came from
            aggregated, career-level skill statistics. JobThai’s postings added something no other
            source in the system provides: employers’ own words about which fields of study they want
            graduates to hold, at which education level, in which province and industry. That is the
            most direct evidence available of the link between a university programme and the jobs
            its graduates enter, and it now informs how the platform scores programme relevance
            (domestic demand weighted 75 : 25 against global demand), which skill gaps it reports to
            university leadership, and which occupations each programme is shown to feed in the
            Program Deep-Dive.
          </p>
          <p>
            Because Program Landscape is made available to Thai universities, this contribution
            reaches beyond Khon Kaen University. JobThai intends to make its data available to other
            universities that use this application under a future memorandum of understanding with
            the Council of University Presidents of Thailand (CUPT, ที่ประชุมอธิการบดีแห่งประเทศไทย —
            ทปอ.), not yet concluded, so that each can run the same analysis on its own programmes.
          </p>
        </>
      ),
      th: (
        <>
          <p>
            มหาวิทยาลัยขอนแก่นขอขอบคุณ <strong>JobThai</strong> ที่ได้มอบข้อมูลประกาศรับสมัครงาน
            ซึ่งทำให้ Program Landscape สามารถมองเห็นความต้องการของตลาดแรงงานในประเทศได้อย่างเป็นรูปธรรม
          </p>
          <p>
            ก่อนหน้านี้ ภาพความต้องการของนายจ้างในระบบมาจากสถิติทักษะระดับอาชีพแบบสรุปรวม
            ข้อมูลของ JobThai เพิ่มสิ่งที่ไม่มีแหล่งอื่นในระบบให้ได้: ถ้อยคำของนายจ้างเองว่าต้องการผู้สำเร็จการศึกษาสาขาวิชาใด
            ในระดับวุฒิการศึกษาใด ในจังหวัดและอุตสาหกรรมใด ซึ่งเป็นหลักฐานที่ชัดเจนที่สุดของความเชื่อมโยงระหว่างหลักสูตรกับงานที่บัณฑิตเข้าสู่
            และปัจจุบันใช้ประกอบการประเมินความสอดคล้องของหลักสูตร (อุปสงค์ในประเทศถ่วงน้ำหนัก 75 : 25 เทียบกับต่างประเทศ)
            การรายงานช่องว่างทักษะต่อผู้บริหาร และการแสดงอาชีพที่แต่ละหลักสูตรป้อนบัณฑิตเข้าสู่ใน Program Deep-Dive
          </p>
          <p>
            เนื่องจาก Program Landscape เปิดให้มหาวิทยาลัยไทยนำไปใช้ได้ การสนับสนุนนี้จึงเป็นประโยชน์เกินกว่ามหาวิทยาลัยขอนแก่น
            JobThai มีเจตนาจะเปิดให้มหาวิทยาลัยอื่นที่ใช้ระบบนี้เข้าถึงข้อมูลได้ ภายใต้บันทึกข้อตกลงความร่วมมือ (MOU)
            กับที่ประชุมอธิการบดีแห่งประเทศไทย (ทปอ.) ที่จะจัดทำขึ้นในอนาคต เพื่อให้แต่ละมหาวิทยาลัยวิเคราะห์หลักสูตรของตนเองด้วยวิธีเดียวกัน
          </p>
        </>
      ),
    },
    detailUrl: `${GITHUB_DOCS}jobthai.md`,
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run test/acknowledgements-registry.test.ts`
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Commit**

Write the message to a scratch file first (the hook blocks `-m` strings that mention env files; a file is the habit here).

```bash
cat > /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack1.txt <<'EOF'
feat(docs): acknowledgements registry with JobThai as the first entry

One typed list drives the coming /docs/acknowledgements page. A future
contributor is one appended entry; the test asserts both languages, unique
URL-safe slugs, a logo that exists in DATA_SOURCE_MARKS, an in-repo detailUrl,
and most-recent-first ordering.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/web/app/docs/acknowledgements/registry.tsx apps/web/test/acknowledgements-registry.test.ts
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack1.txt
```

---

### Task 2: Page, client wrapper and nav item

**Files:**
- Create: `apps/web/app/docs/acknowledgements/page.tsx`
- Create: `apps/web/app/docs/acknowledgements/client.tsx`
- Modify: `apps/web/src/lib/app-nav.tsx` (lucide import block ~line 28; `referenceSection` ~line 157)
- Test: `apps/web/test/acknowledgements-render.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// apps/web/test/acknowledgements-render.test.tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AcknowledgementsList } from '../app/docs/acknowledgements/client';
import { ACKNOWLEDGEMENTS } from '../app/docs/acknowledgements/registry';

// The list is a pure function of (registry, lang) so it can be rendered
// without a DOM. The client wrapper around it owns only the toggle.

describe('AcknowledgementsList', () => {
  it('renders every entry with its anchor id, name and "Full document" link, in English', () => {
    const html = renderToStaticMarkup(<AcknowledgementsList lang="en" />);
    for (const a of ACKNOWLEDGEMENTS) {
      expect(html).toContain(`id="${a.slug}"`);
      expect(html).toContain(a.name);
      expect(html).toContain(a.contributes.en);
      if (a.detailUrl) expect(html).toContain(a.detailUrl);
    }
    expect(html).toContain('Full document');
  });

  it('renders the Thai body and label when lang=th', () => {
    const html = renderToStaticMarkup(<AcknowledgementsList lang="th" />);
    expect(html).toContain(ACKNOWLEDGEMENTS[0]!.contributes.th);
    expect(html).toContain('เอกสารฉบับเต็ม');
    expect(html).not.toContain(ACKNOWLEDGEMENTS[0]!.contributes.en);
  });

  it('shows the contributor logo via the brand mark when one is set', () => {
    const html = renderToStaticMarkup(<AcknowledgementsList lang="en" />);
    expect(html).toContain('/brand/jobthai.png');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/acknowledgements-render.test.tsx`
Expected: FAIL — cannot resolve `../app/docs/acknowledgements/client`.

- [ ] **Step 3: Write the client wrapper**

```tsx
// apps/web/app/docs/acknowledgements/client.tsx
'use client';

// Client wrapper for /docs/acknowledgements. Owns the EN/TH toggle, synced to
// ?lang=… so links survive. The list itself is a pure render of the registry
// (exported separately so it can be tested with react-dom/server).

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { Badge, Card } from '@kku/ui';

import { DataSourceMark } from '@/components/data-source-mark';
import { ACKNOWLEDGEMENTS, KIND_LABEL } from './registry';

type Lang = 'en' | 'th';

const INTRO: Record<Lang, string> = {
  en: 'Program Landscape is built on data and support contributed by partner organisations. This page records them, what each contributes, and what that makes possible for Khon Kaen University and for Thai universities that adopt the platform.',
  th: 'Program Landscape สร้างขึ้นจากข้อมูลและการสนับสนุนขององค์กรพันธมิตร หน้านี้บันทึกรายชื่อองค์กรเหล่านั้น สิ่งที่แต่ละองค์กรมอบให้ และสิ่งที่การสนับสนุนนั้นทำให้เป็นไปได้สำหรับมหาวิทยาลัยขอนแก่นและมหาวิทยาลัยไทยที่นำระบบไปใช้',
};

function formatSince(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return lang === 'th'
    ? d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/** Pure render of the registry for one language. */
export function AcknowledgementsList({ lang }: { lang: Lang }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-text-secondary">{INTRO[lang]}</p>
      {ACKNOWLEDGEMENTS.map((a) => (
        <Card key={a.slug} padding="md">
          <article id={a.slug} className="scroll-mt-24">
            <header className="flex flex-wrap items-center gap-3">
              {a.logo && <DataSourceMark source={a.logo} size={28} />}
              <h2 className="text-lg font-semibold text-text-primary">{a.name}</h2>
              <Badge tone="neutral" size="sm">{KIND_LABEL[a.kind]}</Badge>
              <span className="text-xs text-text-tertiary">
                {lang === 'en' ? 'since' : 'ตั้งแต่'} {formatSince(a.since, lang)}
              </span>
            </header>
            <p className="mt-2 text-sm font-medium text-text-secondary">{a.contributes[lang]}</p>
            <div className="prose-sm mt-3 flex flex-col gap-2 text-sm leading-relaxed text-text-primary">
              {a.body[lang]}
            </div>
            {a.detailUrl && (
              <a
                href={a.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-sm text-accent-default hover:underline"
              >
                {lang === 'en' ? 'Full document' : 'เอกสารฉบับเต็ม'}
                <ExternalLink className="size-icon-xs" aria-hidden />
              </a>
            )}
          </article>
        </Card>
      ))}
    </div>
  );
}

export function AcknowledgementsClient({ initialLang }: { initialLang: Lang }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<Lang>(initialLang);

  const setLangAndUrl = useCallback(
    (next: Lang) => {
      setLang(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set('lang', next);
      router.replace(`/docs/acknowledgements?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">
          Language / ภาษา
        </span>
        <div className="flex rounded-md border border-border-subtle p-0.5">
          {(['en', 'th'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setLangAndUrl(v)}
              aria-pressed={lang === v}
              className={[
                'rounded px-2.5 py-0.5 text-xs font-medium transition-colors',
                lang === v ? 'bg-accent text-accent-fg' : 'text-text-secondary hover:text-text-primary',
              ].join(' ')}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <AcknowledgementsList lang={lang} />
    </div>
  );
}
```

- [ ] **Step 4: Write the server page**

```tsx
// apps/web/app/docs/acknowledgements/page.tsx
import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { PageHeader } from '@kku/ui';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { AcknowledgementsClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Acknowledgements — Program Landscape',
  description: 'Organisations whose data and support Program Landscape is built on.',
};

export default async function AcknowledgementsPage({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const lang = searchParams.lang === 'th' ? 'th' : 'en';

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Acknowledgements"
        subtitle="Partner organisations whose contributions the platform is built on."
      />
      <AcknowledgementsClient initialLang={lang} />
    </AuthedAppShell>
  );
}
```

- [ ] **Step 5: Add the nav item**

In `apps/web/src/lib/app-nav.tsx`, add `Handshake` to the lucide import block (alphabetical, after `GraduationCap`):

```ts
  GraduationCap,
  Handshake,
  History,
```

and in `referenceSection.items`, insert between Methodology and What's new:

```ts
    {
      href: '/docs/acknowledgements',
      label: 'Acknowledgements',
      icon: createElement(Handshake),
      moduleKey: 'neutral',
    },
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `cd apps/web && npx vitest run test/acknowledgements-render.test.tsx test/acknowledgements-registry.test.ts && npx tsc --noEmit -p .`
Expected: `Tests  9 passed (9)`; tsc prints nothing.

- [ ] **Step 7: Check it in the running dev app**

The web dev server picks up new routes without a restart. Sign in at `http://localhost:3000`, open **Reference → Acknowledgements** in the left nav; confirm the JobThai card renders with its logo, the TH button switches the text and the URL gains `?lang=th`, and `#jobthai` in the URL scrolls to the card. (No browser automation exists on this box; this is a manual check.)

- [ ] **Step 8: Commit**

```bash
cat > /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack2.txt <<'EOF'
feat(docs): /docs/acknowledgements page under the Reference nav group

Server page + client language toggle, same shape as /docs/methodology.
The list is a pure render of the registry so it is tested with
react-dom/server in both languages.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/web/app/docs/acknowledgements/page.tsx apps/web/app/docs/acknowledgements/client.tsx apps/web/src/lib/app-nav.tsx apps/web/test/acknowledgements-render.test.tsx
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack2.txt
```

---

### Task 3: The JobThai mark links to its acknowledgement

**Files:**
- Modify: `apps/web/src/components/data-source-mark.tsx`
- Modify: `apps/web/app/admin/jobthai/page.tsx:28`, `apps/web/app/skills/client.tsx:247`, `apps/web/app/programs/[id]/client.tsx` (the `<h4>` marks at ~2776, 2873, 2899 and the "vs JobThai (domestic)" mark at ~2542)
- Test: `apps/web/test/data-source-mark.test.tsx`

Rule from the spec (A.4): the mark renders an `<a>` only when `href` is given. Call sites that sit inside a `Link` or `<button>` (the `/admin` tile, the Segmented toggle trigger) must NOT pass `href` — nested anchors are invalid HTML.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/test/data-source-mark.test.tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { DataSourceMark } from '../src/components/data-source-mark';

describe('DataSourceMark', () => {
  it('is a plain image by default — safe inside links and buttons', () => {
    const html = renderToStaticMarkup(<DataSourceMark source="jobthai" />);
    expect(html.startsWith('<img')).toBe(true);
    expect(html).not.toContain('<a');
  });

  it('wraps the image in a link to the acknowledgement when href is given', () => {
    const html = renderToStaticMarkup(<DataSourceMark source="jobthai" href="/docs/acknowledgements#jobthai" />);
    expect(html).toMatch(/^<a [^>]*href="\/docs\/acknowledgements#jobthai"/);
    expect(html).toContain('<img');
    expect(html).toContain('Acknowledgements');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run test/data-source-mark.test.tsx`
Expected: FAIL on the second case — no `<a` rendered (TypeScript also rejects the unknown `href` prop at typecheck).

- [ ] **Step 3: Add `href` to the component**

Replace the `DataSourceMark` function in `apps/web/src/components/data-source-mark.tsx` with:

```tsx
export function DataSourceMark({
  source,
  size = 14,
  className = '',
  href,
}: {
  source: DataSourceMarkSlug;
  /** Rendered width and height in px. The source image is 32×32. */
  size?: number;
  className?: string;
  /**
   * When set, the mark links here — normally the contributor's entry on
   * /docs/acknowledgements. Leave unset inside a Link or button: nested
   * anchors are invalid HTML.
   */
  href?: string;
}) {
  const mark = DATA_SOURCE_MARKS[source];
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={mark.src}
      alt={`Data from ${mark.name}`}
      title={href ? `Data from ${mark.name} · Acknowledgements` : `Data from ${mark.name}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`inline-block shrink-0 rounded-[3px] align-[-0.125em] ${className}`}
    />
  );
  if (!href) return img;
  return (
    <a href={href} className="inline-flex shrink-0" aria-label={`Data from ${mark.name} — see Acknowledgements`}>
      {img}
    </a>
  );
}
```

Also add a constant next to `DATA_SOURCE_MARKS` so call sites don't repeat the path:

```ts
/** Anchor of a contributor's entry on the Acknowledgements page. */
export function acknowledgementHref(source: DataSourceMarkSlug): string {
  return `/docs/acknowledgements#${source}`;
}
```

- [ ] **Step 4: Pass `href` at the standalone call sites**

Each of these marks stands alone (inside an `<h4>`, a `<div>` or the page title, never inside a `Link`/`button`). Add `href={acknowledgementHref('jobthai')}` and import `acknowledgementHref` alongside `DataSourceMark` in each file:

- `apps/web/app/admin/jobthai/page.tsx` line 28 (page title).
- `apps/web/app/skills/client.tsx` line 247 (the "Recent demand signal" heading).
- `apps/web/app/programs/[id]/client.tsx`: the summary-card mark ("vs JobThai (domestic)", ~2542) and the three `<h4>` marks in `JobThaiDemandCards` (~2776, 2873, 2899).

Do **not** change: the `/admin` tile icon (inside a `Link`), the `SegmentedTrigger` mark (inside a button), `DriverSourceMark` (inside a flex label that may sit in a button on the print page), and the topology SVG `<image>`.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit -p . && npx eslint src/components/data-source-mark.tsx app/admin/jobthai/page.tsx app/skills/client.tsx "app/programs/[id]/client.tsx"`
Expected: all web tests pass (157 + 11 new = 168); tsc silent; eslint reports 0 errors (the pre-existing warnings in `programs/[id]/client.tsx` are not from this change).

- [ ] **Step 6: Manual check**

On `/programs/KKU-SEQ-0062` (a programme with JobThai data), the JobThai icon beside "vs JobThai (domestic)" and on the three demand cards is a link; clicking it opens the acknowledgement. The icon in the source toggle is not a link (it sits in a button).

- [ ] **Step 7: Commit**

```bash
cat > /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack3.txt <<'EOF'
feat(web): the JobThai mark links to its acknowledgement where it stands alone

DataSourceMark gains an optional href and renders an <a> only when it is
given, so call sites inside a Link or button stay valid HTML. Wired on the
JobThai page title, the /skills demand heading and the Deep-Dive JobThai
cards; not on the /admin tile or the source toggle.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add apps/web/src/components/data-source-mark.tsx apps/web/test/data-source-mark.test.tsx apps/web/app/admin/jobthai/page.tsx apps/web/app/skills/client.tsx "apps/web/app/programs/[id]/client.tsx"
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack3.txt
```

---

### Task 4: Docs pointer, changelog entry, memory

**Files:**
- Modify: `docs/acknowledgements/jobthai.md` (the header block, lines 1–13)
- Modify: `apps/web/app/changelog/page.tsx` (the v1.9.5 entry's `bullets`, ~line 30)
- Modify: `/home/denpong/.claude/projects/-home-denpong-projects-program-landscape/memory/feedback_jobthai_mark.md`

- [ ] **Step 1: Point the markdown at the in-app page**

In `docs/acknowledgements/jobthai.md`, after the blockquote that ends "...so it can be re-verified.", add:

```markdown
> The acknowledgement is also shown inside the application at
> **Reference → Acknowledgements** (`/docs/acknowledgements#jobthai`), where the
> JobThai icon beside any JobThai-derived figure links to it. Entries there come
> from `apps/web/app/docs/acknowledgements/registry.tsx`.
```

- [ ] **Step 2: Add a changelog bullet**

The v1.9.5 entry is already shipped; this ships with the next release. Insert a **new** entry at the top of `ENTRIES` in `apps/web/app/changelog/page.tsx`:

```ts
  {
    date: '2026-09-14',
    version: 'v1.9.6 · Acknowledgements',
    title: 'A new Acknowledgements page records the organisations whose data the platform is built on, starting with JobThai',
    audience: ['Council', 'Executive', 'Analyst', 'Admin'],
    bullets: [
      'Reference → Acknowledgements lists each contributing organisation, what it contributes, and what that makes possible — in Thai and English. JobThai is the first entry; the JobThai icon shown beside any JobThai-derived figure now links there.',
      'Future contributors are recorded the same way, so the page grows with the platform.',
    ],
  },
```

(If Plan B ships in the same release, its bullets join this entry rather than creating a second v1.9.6 block.)

- [ ] **Step 3: Update the memory note**

Append to `feedback_jobthai_mark.md` under "How to apply":

```markdown
- Where the mark stands alone (not inside a Link/button) pass `href={acknowledgementHref('jobthai')}` so it links to `/docs/acknowledgements#jobthai`. A new contributor = one entry in `apps/web/app/docs/acknowledgements/registry.tsx` (+ logo in `DATA_SOURCE_MARKS`, + optional `docs/acknowledgements/<slug>.md`).
```

- [ ] **Step 4: Typecheck and run the web suite once more**

Run: `cd apps/web && npx tsc --noEmit -p . && npx vitest run`
Expected: tsc silent; all tests pass.

- [ ] **Step 5: Commit and push**

```bash
cat > /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack4.txt <<'EOF'
docs: point the JobThai acknowledgement at the in-app page; changelog entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ThJmi1n7EpKCbFM8P4VCYj
EOF
git add docs/acknowledgements/jobthai.md apps/web/app/changelog/page.tsx
git commit -F /tmp/claude-1000/-home-denpong-projects-program-landscape/fed599e4-002a-46b3-b580-83c286373407/scratchpad/ack4.txt
git push origin main
```

---

## Release note

This plan adds no migration, env key, bucket or operator script; a static image
already ships in the web image. Nothing to do on prod beyond deploying the next
release. Do not build a release for this alone — it rides with Plan B.

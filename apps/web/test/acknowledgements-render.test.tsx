import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { AcknowledgementsList } from '../app/docs/acknowledgements/list';
import { ACKNOWLEDGEMENTS } from '../app/docs/acknowledgements/registry';

// AcknowledgementsList is a plain server component (no 'use client'), so it
// can be invoked directly and rendered with renderToStaticMarkup — same
// pattern as acknowledgements-registry.test.ts uses for the `body` ReactNodes.

describe('AcknowledgementsList', () => {
  it('en with showDetailLinks: every entry renders id, name, contributes.en, and its detail link', () => {
    const html = renderToStaticMarkup(
      AcknowledgementsList({ lang: 'en', showDetailLinks: true }),
    );
    for (const a of ACKNOWLEDGEMENTS) {
      expect(html, `${a.slug} id anchor`).toContain(`id="${a.slug}"`);
      expect(html, `${a.slug} name`).toContain(a.name);
      expect(html, `${a.slug} contributes.en`).toContain(a.contributes.en);
      if (a.detailUrl) {
        expect(html, `${a.slug} detailUrl`).toContain(a.detailUrl);
      }
    }
    expect(html).toContain('Full document');
    // JobThai's `since` is 2026-09-13; en-GB long-date renders it Gregorian.
    expect(html).toContain('13 September 2026');
  });

  it('th: renders contributes.th and the Thai detail-link label, not contributes.en', () => {
    const html = renderToStaticMarkup(
      AcknowledgementsList({ lang: 'th', showDetailLinks: true }),
    );
    // Looked up by slug rather than `[0]`: the list is sorted most-recent
    // `since` first, and a later entry (job-108, added 2026-09-20) can
    // outrank jobthai in that order without this test caring which one is
    // first — it is specifically about jobthai's dates and Thai body.
    const first = ACKNOWLEDGEMENTS.find((a) => a.slug === 'jobthai')!;
    expect(html).toContain(first.contributes.th);
    expect(html).toContain('เอกสารฉบับเต็ม');
    expect(html).not.toContain(first.contributes.en);

    const bodyTh = renderToStaticMarkup(first.body.th as ReactElement);
    const bodyEn = renderToStaticMarkup(first.body.en as ReactElement);
    expect(html).toContain(bodyTh);
    expect(html).not.toContain(bodyEn);

    // th-TH renders the year in the Buddhist Era (2569 = CE 2026) — see the
    // formatSince comment in list.tsx.
    expect(html).toContain('13 กันยายน 2569');
  });

  it('showDetailLinks=false: no detail link and no detailUrl appears', () => {
    const html = renderToStaticMarkup(
      AcknowledgementsList({ lang: 'en', showDetailLinks: false }),
    );
    expect(html).not.toContain('Full document');
    for (const a of ACKNOWLEDGEMENTS) {
      if (a.detailUrl) {
        expect(html, `${a.slug} detailUrl should be hidden`).not.toContain(a.detailUrl);
      }
    }
  });

  it('renders the logo image for entries that declare one', () => {
    const html = renderToStaticMarkup(
      AcknowledgementsList({ lang: 'en', showDetailLinks: true }),
    );
    expect(html).toContain('/brand/jobthai.png');
  });
});

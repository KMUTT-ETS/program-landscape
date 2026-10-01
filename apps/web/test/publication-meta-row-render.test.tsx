import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicationMetaRow } from '../app/profile/publication-meta-row';
import type { PublicationEntry } from '@/lib/profile-types';

const base: PublicationEntry = {
  id: 'p1', year: 2022, title: 'T', venue: null, citations: 12, doi: null, scopusId: '85012345678', pmid: '123',
  openalexId: null, type: 'JOURNAL', kkuAuthors: [], authors: [{ family: 'A', given: null, initials: null }],
  authorsAreComplete: true, source: 'openalex', scholarPaperId: null,
};

const render = (p: Partial<PublicationEntry>, lang: 'th' | 'en' = 'en') =>
  renderToStaticMarkup(<PublicationMetaRow pub={{ ...base, ...p }} lang={lang} />);

describe('PublicationMetaRow', () => {
  it('shows year, type chip, citations as text (not a chip), source and identifier links', () => {
    const html = render({});
    expect(html).toContain('2022');
    expect(html).toContain('data-meta="type"');
    expect(html).toContain('Journal article');
    expect(html).toMatch(/data-meta="citations"[^>]*>[\s\S]*Cited by 12/);
    expect(html).not.toMatch(/data-meta="citations"[^>]*rounded-full/);
    expect(html).toContain('OpenAlex');
    expect(html).toContain('scopus.com/record/display.uri');
    expect(html).toContain('pubmed.ncbi.nlm.nih.gov/123/');
  });
  it('hides the type for Google Scholar rows and citations at zero', () => {
    const html = render({ source: 'google-scholar', citations: 0 });
    expect(html).not.toContain('data-meta="type"');
    expect(html).not.toContain('Cited by');
    expect(html).toContain('Google Scholar');
  });
  it('states author status only when it is not complete', () => {
    expect(render({})).not.toContain('data-meta="authors"');
    expect(render({ source: 'google-scholar', authorsAreComplete: false })).toContain('list shortened by Google Scholar');
    expect(render({ authors: [], authorsAreComplete: false })).toContain('co-authors unavailable');
  });
  it('speaks Thai when asked', () => {
    expect(render({}, 'th')).toContain('อ้างอิง');
  });
});

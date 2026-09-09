import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ────────────────────────────────────────────────────────────────────────────
// The "Author IDs" row on /profile lists the cross-system identifiers a person
// is known by. Google Scholar joined them once the sync started binding a
// profile id, and it is the only one of the four that a user can create for
// themselves — so it is the one most likely to be present when the others are
// not, and the row must not stay hidden just because Scopus and OpenAlex are
// empty.
//
// Static markup, no jsdom — same constraint as the neighbouring render tests.
// ────────────────────────────────────────────────────────────────────────────

/**
 * The identifier row, reproduced at the shape `profile-view.tsx` renders it.
 * Extracting the real component would mean pulling the whole profile page and
 * its data dependencies into a static render; these assertions are about the
 * link target, the visibility rule and the label spacing, all of which are
 * local to this markup.
 */
function AuthorIds({
  scopusAuthorId,
  openalexAuthorId,
  scholarProfileId,
}: {
  scopusAuthorId: string | null;
  openalexAuthorId: string | null;
  scholarProfileId: string | null;
}): React.JSX.Element | null {
  if (!scopusAuthorId && !openalexAuthorId && !scholarProfileId) return null;
  return (
    <span>
      {scopusAuthorId && (
        <span>
          <span>Scopus </span>
          <a href={`https://www.scopus.com/authid/detail.uri?authorId=${scopusAuthorId}`}>
            {scopusAuthorId}
          </a>
        </span>
      )}
      {openalexAuthorId && (
        <span>
          <span>OpenAlex </span>
          <a href={`https://openalex.org/${openalexAuthorId}`}>{openalexAuthorId}</a>
        </span>
      )}
      {scholarProfileId && (
        <span>
          <span>Google Scholar </span>
          <a href={`https://scholar.google.com/citations?user=${scholarProfileId}`}>
            {scholarProfileId}
          </a>
        </span>
      )}
    </span>
  );
}

const render = (props: Parameters<typeof AuthorIds>[0]): string =>
  renderToStaticMarkup(<AuthorIds {...props} />);

/** What a screen reader announces: markup stripped, whitespace collapsed. */
const asText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// The operator's real bound profile, from the 2026-09-09 live sync.
const SCHOLAR_ID = 'phNLrFMAAAAJ';

describe('profile — Author IDs', () => {
  it('links a Google Scholar id to its public profile page', () => {
    const html = render({ scopusAuthorId: null, openalexAuthorId: null, scholarProfileId: SCHOLAR_ID });
    expect(html).toContain(`https://scholar.google.com/citations?user=${SCHOLAR_ID}`);
    expect(html).toContain(SCHOLAR_ID);
  });

  it('shows the row when Scholar is the ONLY identifier', () => {
    // The case that matters: a person can bind Scholar themselves without ever
    // appearing in Scopus or OpenAlex. Gating the row on the other two would
    // hide the one id they actually have.
    const html = render({ scopusAuthorId: null, openalexAuthorId: null, scholarProfileId: SCHOLAR_ID });
    expect(html).not.toBe('');
    expect(asText(html)).toContain('Google Scholar');
  });

  it('still hides the row when there is no identifier at all', () => {
    expect(render({ scopusAuthorId: null, openalexAuthorId: null, scholarProfileId: null })).toBe('');
  });

  it('keeps the label separated from the id in the accessible name', () => {
    // Adjacent text and values render run-together in this codebase — a flex
    // gap separates them on screen but leaves "Google Scholarphn..." as the
    // announced string. The trailing space lives inside the label span.
    const text = asText(
      render({ scopusAuthorId: null, openalexAuthorId: null, scholarProfileId: SCHOLAR_ID }),
    );
    expect(text).toContain(`Google Scholar ${SCHOLAR_ID}`);
    expect(text).not.toContain(`Google Scholar${SCHOLAR_ID}`);
  });

  it('lists Scholar alongside the others without disturbing them', () => {
    const text = asText(
      render({ scopusAuthorId: '7005123456', openalexAuthorId: 'A5012345678', scholarProfileId: SCHOLAR_ID }),
    );
    expect(text).toBe(`Scopus 7005123456OpenAlex A5012345678Google Scholar ${SCHOLAR_ID}`);
  });
  it('matches what profile-view.tsx actually renders', async () => {
    // The block above is a reproduction, so on its own it would keep passing
    // while the real component drifted. This pins the three things that would
    // silently break: the link template, the visibility condition, and the
    // trailing space inside the label.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const source = readFileSync(
      path.join(__dirname, '..', 'app', 'profile', 'profile-view.tsx'),
      'utf8',
    );

    expect(source).toContain('https://scholar.google.com/citations?user=${scholarProfileId}');
    expect(source).toContain('(scopusAuthorId || openalexAuthorId || scholarProfileId)');
    // Trailing space INSIDE the span, not a flex gap.
    expect(source).toContain('>Google Scholar </span>');
  });
});

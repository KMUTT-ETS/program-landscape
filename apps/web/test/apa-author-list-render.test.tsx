import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthorName } from '@/lib/profile-types';
import { buildAuthorListJsx } from '../app/profile/apa-author-list';

// The byline on /profile. An "&" before the last name is APA's claim that the
// list is complete; Google Scholar shortens long lists, so a list we know is
// partial must end with an ellipsis instead and never borrow that claim.

const a = (family: string, given: string): AuthorName => ({ family, given, initials: null });
const render = (authors: AuthorName[], complete: boolean, owner: string | null = null) =>
  renderToStaticMarkup(<p>{buildAuthorListJsx(authors, owner, complete)}</p>);

describe('buildAuthorListJsx', () => {
  const three = [a('Smith', 'John'), a('Lee', 'Ann'), a('Wong', 'Kim')];

  it('joins a complete list with a serial comma and ampersand', () => {
    expect(render(three, true)).toBe('<p>Smith, J., Lee, A., &amp; Wong, K. </p>');
  });

  it('closes a name without an initial with exactly one period', () => {
    expect(render([{ family: 'Plato', given: null, initials: null }], true)).toBe('<p>Plato. </p>');
  });

  it('ends an incomplete list with an ellipsis and no ampersand', () => {
    const html = render(three, false);
    expect(html).not.toContain('&amp;');
    expect(html).toBe('<p>Smith, J., Lee, A., Wong, K., … </p>');
  });

  it('marks a single-author incomplete list as partial too', () => {
    expect(render([a('Smith', 'John')], false)).toBe('<p>Smith, J., … </p>');
  });

  it('keeps a single complete author unadorned', () => {
    expect(render([a('Smith', 'John')], true)).toBe('<p>Smith, J. </p>');
  });

  it('still bolds the owner in an incomplete list', () => {
    expect(render(three, false, 'lee')).toContain('<strong class="font-semibold">Lee, A.</strong>');
  });

  it('truncates 21+ complete authors per APA 7 §9.8', () => {
    const many = Array.from({ length: 25 }, (_, i) => a(`Author${i}`, 'X'));
    const html = render(many, true);
    expect(html).toContain('Author18, X., ... Author24, X.');
    expect(html).not.toContain('&amp;');
  });

  it('renders nothing for an empty list', () => {
    expect(render([], false)).toBe('<p></p>');
  });
});

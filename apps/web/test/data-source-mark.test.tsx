import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { DataSourceMark, acknowledgementHref } from '../src/components/data-source-mark';

describe('DataSourceMark', () => {
  it('is a plain image by default — safe inside links and buttons', () => {
    const html = renderToStaticMarkup(<DataSourceMark source="jobthai" />);
    expect(html.startsWith('<img')).toBe(true);
    expect(html).not.toContain('<a');
  });

  it('wraps the image in a link to the acknowledgement when href is given', () => {
    const html = renderToStaticMarkup(
      <DataSourceMark source="jobthai" href={acknowledgementHref('jobthai')} />,
    );
    expect(html).toMatch(/^<a [^>]*href="\/docs\/acknowledgements#jobthai"/);
    expect(html).toContain('<img');
    expect(html).toContain('aria-label="Data from JobThai — see Acknowledgements"');
  });

  it('acknowledgementHref points at the contributor anchor', () => {
    expect(acknowledgementHref('jobthai')).toBe('/docs/acknowledgements#jobthai');
  });
});

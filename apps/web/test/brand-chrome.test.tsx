import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrgLogo } from '../src/components/brand/org-logo';
import { SetupBanner } from '../src/components/brand/setup-banner';
import type { Branding } from '../src/lib/branding';

const B: Branding = {
  nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
  tagline: 'EXU Curriculum Intelligence Platform', version: 3,
  logoLightUrl: '/brand/logo-light?v=3', logoDarkUrl: '/brand/logo-dark?v=3', faviconUrl: '/brand/favicon?v=3',
  hasOwnLogo: true, css: '',
};

describe('OrgLogo', () => {
  it('renders the light and dark logo pair from the brand route', () => {
    const html = renderToStaticMarkup(<OrgLogo branding={B} width={30} height={50} />);
    expect(html).toContain('src="/brand/logo-light?v=3"');
    expect(html).toContain('src="/brand/logo-dark?v=3"');
    expect(html).toContain('alt="EXU"');
  });

  it('renders the product mark when there is no uploaded logo or no profile', () => {
    expect(renderToStaticMarkup(<OrgLogo branding={{ ...B, hasOwnLogo: false }} width={30} height={50} />)).toContain('<svg');
    expect(renderToStaticMarkup(<OrgLogo branding={null} width={30} height={50} />)).toContain('<svg');
  });
});

describe('SetupBanner', () => {
  it('links admins to the setup page', () => {
    const html = renderToStaticMarkup(<SetupBanner canConfigure />);
    expect(html).toMatch(/not configured/i);
    expect(html).toContain('href="/admin/organization"');
  });

  it('tells everyone else to contact an administrator, without a link', () => {
    const html = renderToStaticMarkup(<SetupBanner canConfigure={false} />);
    expect(html).toMatch(/administrator/i);
    expect(html).not.toContain('href=');
  });
});

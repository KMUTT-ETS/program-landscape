import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrganizationClient, type OrganizationProfileDto } from './client';

const PROFILE: OrganizationProfileDto = {
  id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
  shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: null,
  appUrl: 'https://landscape.example.ac.th',
  intakeFloorBachelor: 30, intakeFloorPostgrad: 8, openalexInstitutionId: null,
  version: 3, updatedAt: '2026-10-15T00:00:00Z', updatedBy: null,
  logoLightKey: null, logoDarkKey: null, faviconKey: null, primaryColor: null, secondaryColor: null,
};

// apps/web has no jsdom (see vitest.config.ts): assert on static markup.
describe('OrganizationClient', () => {
  it('shows a first-time setup state when no profile exists', () => {
    const html = renderToStaticMarkup(<OrganizationClient initial={{ profile: null }} loadError={null} />);
    expect(html).toMatch(/not configured yet/i);
    expect(html).toContain('Thai name');
    expect(html).not.toMatch(/version \d/i);
    expect(html).toContain('Create organisation');
    expect(html).toContain('OpenAlex institution ID');
    expect(html).toContain('I60837268');
  });

  it('prefills an existing profile and shows its version', () => {
    const html = renderToStaticMarkup(
      <OrganizationClient
        initial={{
          profile: {
            id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
            shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: null,
            appUrl: 'https://landscape.example.ac.th',
            intakeFloorBachelor: 30, intakeFloorPostgrad: 8, openalexInstitutionId: null,
            version: 3, updatedAt: '2026-10-15T00:00:00Z', updatedBy: null,
            logoLightKey: null, logoDarkKey: null, faviconKey: null, primaryColor: null, secondaryColor: null,
          },
        }}
        loadError={null}
      />,
    );
    expect(html).toContain('value="Example University"');
    expect(html).toMatch(/version\s*(<!-- -->)?\s*3/i);
    expect(html).not.toMatch(/not configured yet/i);
  });

  it('offers the region as a list of the four projection regions', () => {
    const html = renderToStaticMarkup(
      <OrganizationClient initial={{ profile: { ...PROFILE, regionEn: 'Northeast' } }} loadError={null} />,
    );
    expect(html).toMatch(/<select/);
    expect(html).not.toContain('Region (Thai)');
    for (const v of ['Northeast', 'Central', 'North', 'South']) expect(html).toContain(`value="${v}"`);
    expect(html).toContain('Central (incl. Bangkok, East, West)');
    expect(html).toMatch(/value="Northeast" selected/);
    expect(html).not.toMatch(/is not one of the regions/);
  });

  it('warns about a saved free-text region the list cannot show', () => {
    const html = renderToStaticMarkup(
      <OrganizationClient initial={{ profile: { ...PROFILE, regionEn: 'Isan' } }} loadError={null} />,
    );
    expect(html).toMatch(/“Isan” is not one of the regions/);
  });
});

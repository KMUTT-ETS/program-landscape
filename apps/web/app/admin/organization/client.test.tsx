import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrganizationClient } from './client';

// apps/web has no jsdom (see vitest.config.ts): assert on static markup.
describe('OrganizationClient', () => {
  it('shows a first-time setup state when no profile exists', () => {
    const html = renderToStaticMarkup(<OrganizationClient initial={{ profile: null }} loadError={null} />);
    expect(html).toMatch(/not configured yet/i);
    expect(html).toContain('Thai name');
    expect(html).not.toMatch(/version \d/i);
    expect(html).toContain('Create organisation');
  });

  it('prefills an existing profile and shows its version', () => {
    const html = renderToStaticMarkup(
      <OrganizationClient
        initial={{
          profile: {
            id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
            shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: null,
            appUrl: 'https://landscape.example.ac.th',
            intakeFloorBachelor: 30, intakeFloorPostgrad: 8,
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
});

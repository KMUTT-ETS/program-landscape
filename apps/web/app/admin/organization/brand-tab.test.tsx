/* eslint-disable no-restricted-syntax -- hex values here are admin input data, not UI colours */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { BrandTab } from './brand-tab';

const base = {
  id: 'default', nameTh: 'ท', nameEn: 'Example University', shortNameTh: 'มต.', shortNameEn: 'EXU',
  regionTh: null, regionEn: null, contactEmail: null, appUrl: 'https://x.example', version: 3,
  updatedAt: '2026-10-16T00:00:00Z', updatedBy: null,
  logoLightKey: null, logoDarkKey: null, faviconKey: null, primaryColor: null, secondaryColor: null,
};

describe('BrandTab', () => {
  it('shows the contrast report for the stored colours', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, primaryColor: '#f26522' }} onSaved={() => {}} />);
    expect(html).toMatch(/primary text on primary/i);
    expect(html).toMatch(/\d+\.\d\d:1/);
  });

  it('blocks saving while a colour fails the gate', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, primaryColor: '#808585' }} onSaved={() => {}} />);
    expect(html).toMatch(/too close to grey/i);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Save colours/);
  });

  it('offers an upload for each asset and a remove button only for uploaded ones', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, logoLightKey: 'logo-light/a.png' }} onSaved={() => {}} />);
    expect(html).toMatch(/Logo \(light mode\)/);
    expect(html).toMatch(/Logo \(dark mode\)/);
    expect(html).toMatch(/Favicon/);
    expect((html.match(/>Remove</g) ?? []).length).toBe(1);
  });

  it('offers a Clear button for each colour that is set', () => {
    const html = renderToStaticMarkup(
      <BrandTab profile={{ ...base, primaryColor: '#f26522', secondaryColor: '#9e1b32' }} onSaved={() => {}} />,
    );
    expect((html.match(/>Clear</g) ?? []).length).toBe(2);
  });

  it('previews light mode in its own light-theme scope, like the dark one', () => {
    const html = renderToStaticMarkup(<BrandTab profile={{ ...base, primaryColor: '#f26522' }} onSaved={() => {}} />);
    expect(html).toMatch(/data-theme="light"[^>]*bg-surface-0/);
    expect(html).toMatch(/data-theme="dark"[^>]*bg-surface-0/);
  });
});

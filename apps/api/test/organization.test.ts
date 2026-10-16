/* eslint-disable no-restricted-syntax -- hex values here are brand-colour test data, not UI colours */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrganizationProfile: vi.fn(),
  saveOrganizationIdentity: vi.fn(),
  tcasInstitutionMatches: vi.fn(),
  saveOrganizationBrand: vi.fn(),
  setOrganizationAsset: vi.fn(),
}));

// The real brandAssetUrls / organizationTagline: the public URLs are part of the contract under test.
vi.mock('@kku/db', async (orig) => ({
  ...(await orig<typeof import('@kku/db')>()),
  getOrganizationProfile: mocks.getOrganizationProfile,
  saveOrganizationIdentity: mocks.saveOrganizationIdentity,
  tcasInstitutionMatches: mocks.tcasInstitutionMatches,
  saveOrganizationBrand: mocks.saveOrganizationBrand,
  setOrganizationAsset: mocks.setOrganizationAsset,
}));

import { OrganizationService } from '../src/organization/organization.service';

const ROW = {
  id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
  shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: 'landscape@example.ac.th',
  appUrl: 'https://landscape.example.ac.th', version: 4,
  logoLightKey: `logo-light/${'5e'.repeat(32)}.png`, logoDarkKey: null, faviconKey: null, primaryColor: '#f26522', secondaryColor: null, brandTokensJson: null,
  updatedAt: new Date(), updatedBy: 'u1',
};

describe('OrganizationService.publicView', () => {
  beforeEach(() => mocks.getOrganizationProfile.mockReset());

  it('reports configured:false on a fresh install (200, so the sign-in page still renders)', async () => {
    mocks.getOrganizationProfile.mockResolvedValue(null);
    expect(await new OrganizationService({} as never /* storage unused on this path */).publicView()).toEqual({ configured: false });
  });

  it('never exposes the contact email publicly', async () => {
    mocks.getOrganizationProfile.mockResolvedValue(ROW);
    const view = await new OrganizationService({} as never /* storage unused on this path */).publicView();
    expect(view).toEqual({
      configured: true, nameTh: ROW.nameTh, nameEn: ROW.nameEn, shortNameTh: 'มต.', shortNameEn: 'EXU',
      tagline: 'EXU Curriculum Intelligence Platform', version: 4,
      logoLightUrl: '/brand/logo-light?v=4-5e5e5e5e5e5e', logoDarkUrl: null, faviconUrl: null, primaryColor: '#f26522', secondaryColor: null,
    });
    expect(JSON.stringify(view)).not.toContain('example.ac.th');
  });
});

describe('OrganizationService.save', () => {
  it('passes the parsed input and the acting user through', async () => {
    mocks.saveOrganizationIdentity.mockResolvedValue(ROW);
    const input = {
      nameTh: ROW.nameTh, nameEn: ROW.nameEn, shortNameTh: 'มต.', shortNameEn: 'EXU', regionTh: null,
      regionEn: null, contactEmail: null, appUrl: ROW.appUrl, expectedVersion: 3,
    };
    expect(await new OrganizationService({} as never /* storage unused on this path */).save(input, 'u9')).toEqual({ profile: ROW });
    expect(mocks.saveOrganizationIdentity).toHaveBeenCalledWith(input, 'u9');
  });
});

describe('OrganizationService.saveBrand', () => {
  it('refuses colours that fail the contrast gate before touching the database', async () => {
    mocks.saveOrganizationBrand.mockReset();
    await expect(
      new OrganizationService({} as never).saveBrand({ primaryColor: '#808585', secondaryColor: null, expectedVersion: 4 }, 'u1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(mocks.saveOrganizationBrand).not.toHaveBeenCalled();
  });

  it('derives tokens and saves them with the input', async () => {
    mocks.saveOrganizationBrand.mockResolvedValue(ROW);
    await new OrganizationService({} as never).saveBrand({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 4 }, 'u1');
    const [input, tokens, user] = mocks.saveOrganizationBrand.mock.calls[0];
    expect(input).toEqual({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 4 });
    expect(tokens.light['accent-default']).toMatch(/^70\.0% /);
    expect(user).toBe('u1');
  });
});

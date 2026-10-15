import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getOrganizationProfile: vi.fn(),
  saveOrganizationIdentity: vi.fn(),
  tcasInstitutionMatches: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  getOrganizationProfile: mocks.getOrganizationProfile,
  saveOrganizationIdentity: mocks.saveOrganizationIdentity,
  tcasInstitutionMatches: mocks.tcasInstitutionMatches,
  organizationTagline: (s: string) => `${s} Curriculum Intelligence Platform`,
}));

import { OrganizationService } from '../src/organization/organization.service';

const ROW = {
  id: 'default', nameTh: 'มหาวิทยาลัยตัวอย่าง', nameEn: 'Example University', shortNameTh: 'มต.',
  shortNameEn: 'EXU', regionTh: null, regionEn: null, contactEmail: 'landscape@example.ac.th',
  appUrl: 'https://landscape.example.ac.th', version: 4, updatedAt: new Date(), updatedBy: 'u1',
};

describe('OrganizationService.publicView', () => {
  beforeEach(() => mocks.getOrganizationProfile.mockReset());

  it('reports configured:false on a fresh install (200, so the sign-in page still renders)', async () => {
    mocks.getOrganizationProfile.mockResolvedValue(null);
    expect(await new OrganizationService().publicView()).toEqual({ configured: false });
  });

  it('never exposes the contact email publicly', async () => {
    mocks.getOrganizationProfile.mockResolvedValue(ROW);
    const view = await new OrganizationService().publicView();
    expect(view).toEqual({
      configured: true, nameTh: ROW.nameTh, nameEn: ROW.nameEn, shortNameTh: 'มต.', shortNameEn: 'EXU',
      tagline: 'EXU Curriculum Intelligence Platform', version: 4,
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
    expect(await new OrganizationService().save(input, 'u9')).toEqual({ profile: ROW });
    expect(mocks.saveOrganizationIdentity).toHaveBeenCalledWith(input, 'u9');
  });
});

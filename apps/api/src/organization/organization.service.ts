import { Injectable } from '@nestjs/common';
import {
  getOrganizationProfile,
  organizationTagline,
  saveOrganizationIdentity,
  tcasInstitutionMatches,
  type TcasNameMatch,
} from '@kku/db';
import type { OrganizationIdentityInput, OrganizationPublicView } from '@kku/shared';

type OrganizationProfile = NonNullable<Awaited<ReturnType<typeof getOrganizationProfile>>>;

@Injectable()
export class OrganizationService {
  async publicView(): Promise<OrganizationPublicView> {
    const row = await getOrganizationProfile();
    if (!row) return { configured: false };
    return {
      configured: true,
      nameTh: row.nameTh,
      nameEn: row.nameEn,
      shortNameTh: row.shortNameTh,
      shortNameEn: row.shortNameEn,
      tagline: organizationTagline(row.shortNameEn),
      version: row.version,
    };
  }

  async adminView(): Promise<{ profile: OrganizationProfile | null }> {
    return { profile: await getOrganizationProfile() };
  }

  async save(input: OrganizationIdentityInput, userId: string): Promise<{ profile: OrganizationProfile }> {
    return { profile: await saveOrganizationIdentity(input, userId) };
  }

  async tcasMatch(name: string): Promise<TcasNameMatch> {
    return tcasInstitutionMatches(name);
  }
}

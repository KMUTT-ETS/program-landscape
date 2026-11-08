import { Injectable } from '@nestjs/common';
import {
  brandAssetUrls,
  getOrganizationProfile,
  organizationTagline,
  saveOrganizationBrand,
  saveOrganizationIdentity,
  setOrganizationAsset,
} from '@kku/db';
import {
  ApiError,
  deriveBrandTokens,
  type BrandAssetKind,
  type OrganizationBrandInput,
  type OrganizationIdentityInput,
  type OrganizationPublicView,
} from '@kku/shared';
import { createHash } from 'node:crypto';
import { validateBrandAsset } from './asset-validation';
import { BrandingStorageService } from './branding-storage.service';

type OrganizationProfile = NonNullable<Awaited<ReturnType<typeof getOrganizationProfile>>>;

interface AssetResult {
  id: string;
  profile: OrganizationProfile;
}
interface AssetFacts {
  kind: BrandAssetKind;
  storageKey: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

@Injectable()
export class OrganizationService {
  constructor(private readonly storage: BrandingStorageService) {}

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
      ...brandAssetUrls(row),
      primaryColor: row.primaryColor,
      secondaryColor: row.secondaryColor,
    };
  }

  async adminView(): Promise<{ profile: OrganizationProfile | null }> {
    return { profile: await getOrganizationProfile() };
  }

  async save(input: OrganizationIdentityInput, userId: string): Promise<{ profile: OrganizationProfile }> {
    return { profile: await saveOrganizationIdentity(input, userId) };
  }

  async saveBrand(input: OrganizationBrandInput, userId: string): Promise<{ id: string; profile: OrganizationProfile }> {
    const derived = deriveBrandTokens(input.primaryColor, input.secondaryColor);
    if (!derived.ok) {
      throw new ApiError('VALIDATION_FAILED', derived.errors.join(' '), { errors: derived.errors, checks: derived.checks });
    }
    const hasTokens = Object.keys(derived.tokens.light).length > 0;
    const profile = await saveOrganizationBrand(input, hasTokens ? derived.tokens : null, userId);
    return { id: profile.id, profile };
  }

  /** `id` and `asset` exist for the audit log: it reads the entity id from the result. */
  async uploadAsset(kind: BrandAssetKind, bytes: Buffer, userId: string): Promise<AssetResult & { asset: AssetFacts }> {
    const verdict = validateBrandAsset(kind, bytes);
    if (!verdict.ok) throw new ApiError('VALIDATION_FAILED', verdict.reason);
    const key = await this.storage.put(kind, bytes, verdict.ext, verdict.contentType);
    const profile = await setOrganizationAsset(kind, key, userId);
    return {
      id: profile.id,
      profile,
      asset: {
        kind,
        storageKey: key,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        contentType: verdict.contentType,
      },
    };
  }

  async removeAsset(kind: BrandAssetKind, userId: string): Promise<AssetResult & { asset: { kind: BrandAssetKind } }> {
    const profile = await setOrganizationAsset(kind, null, userId);
    return { id: profile.id, profile, asset: { kind } };
  }
}

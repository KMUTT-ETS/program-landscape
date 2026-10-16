import { cache } from 'react';
import { unstable_noStore as noStore } from 'next/cache';
import { assetToken, getOrganizationProfile, organizationTagline } from '@kku/db';
import { brandCss } from '@kku/shared/brand';

type OrganizationProfile = NonNullable<Awaited<ReturnType<typeof getOrganizationProfile>>>;

export interface Branding {
  nameTh: string;
  nameEn: string;
  shortNameTh: string;
  shortNameEn: string;
  tagline: string;
  version: number;
  logoLightUrl: string;
  logoDarkUrl: string;
  faviconUrl: string;
  hasOwnLogo: boolean;
  css: string;
}

export function toBranding(row: OrganizationProfile): Branding {
  const url = (kind: 'logo-light' | 'logo-dark' | 'favicon', key: string | null) =>
    `/brand/${kind}?v=${assetToken(row.version, key)}`;
  const light = row.logoLightKey ? url('logo-light', row.logoLightKey) : null;
  const dark = row.logoDarkKey ? url('logo-dark', row.logoDarkKey) : null;
  return {
    nameTh: row.nameTh,
    nameEn: row.nameEn,
    shortNameTh: row.shortNameTh,
    shortNameEn: row.shortNameEn,
    tagline: organizationTagline(row.shortNameEn),
    version: row.version,
    // One uploaded logo serves both themes: the missing variant would
    // otherwise be the currentColor product mark, which is black inside <img>.
    logoLightUrl: light ?? dark ?? url('logo-light', null),
    logoDarkUrl: dark ?? light ?? url('logo-dark', null),
    faviconUrl: url('favicon', row.faviconKey),
    hasOwnLogo: light !== null || dark !== null,
    css: brandCss(row.brandTokensJson),
  };
}

/**
 * One profile read per request. Null when the install is not configured —
 * AND when the read fails (no database at `next build`, an outage): chrome
 * then renders the product defaults instead of crashing every page.
 */
export const brandingForRequest = cache(async (): Promise<Branding | null> => {
  // Branding is per-request data: never let a build-time prerender freeze the fallback.
  noStore();
  try {
    const row = await getOrganizationProfile();
    return row ? toBranding(row) : null;
  } catch {
    return null;
  }
});

export function brandMetadata(b: Branding | null): {
  title: { default: string; template: string };
  description: string;
  icons: { icon: string };
} {
  if (!b) {
    return {
      title: { default: 'Program Landscape', template: '%s — Program Landscape' },
      description: 'Program Landscape — curriculum intelligence for strategic decisions.',
      icons: { icon: '/brand/favicon' },
    };
  }
  return {
    title: { default: `Program Landscape — ${b.tagline}`, template: `%s — ${b.tagline}` },
    description: `Program Landscape · ${b.tagline} — strategic decision-support for ${b.nameEn}.`,
    icons: { icon: b.faviconUrl },
  };
}

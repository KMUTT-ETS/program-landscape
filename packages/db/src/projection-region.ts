// Which demographic-projection region an institution's catchment maps to.
//
// The population projection carries one row set per region ('TH' national
// plus the regional splits seeded by seed-thailand-demographics). An
// institution declares its own region in the organisation profile
// (`regionEn`). A region the data does not carry, or no profile at all,
// resolves to the national series 'TH' - never to another region's numbers.
import {
  OrganizationNotConfiguredError,
  OrganizationNotLoadedError,
  getInstitution,
} from '@kku/shared';

const NATIONAL_REGION = 'TH';

export function resolveProjectionRegion(
  regionEn: string | null | undefined,
  availableRegions: readonly string[],
): string {
  const wanted = regionEn?.trim();
  if (!wanted) return NATIONAL_REGION;
  const exact = availableRegions.find((r) => r === wanted);
  if (exact) return exact;
  const lower = wanted.toLowerCase();
  return availableRegions.find((r) => r.trim().toLowerCase() === lower) ?? NATIONAL_REGION;
}

export function projectionRegionForInstitution(availableRegions: readonly string[]): string {
  let regionEn: string | null = null;
  try {
    regionEn = getInstitution().regionEn;
  } catch (err) {
    if (!(err instanceof OrganizationNotConfiguredError || err instanceof OrganizationNotLoadedError)) {
      throw err;
    }
  }
  return resolveProjectionRegion(regionEn, availableRegions);
}

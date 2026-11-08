// The regions an institution can declare on its organisation profile.
//
// These are exactly the four statistical regions the built-in NESDC
// population projection carries (apps/ingestion/src/scripts/
// seed-thailand-demographics.ts). The four sum to the national total, so
// "Central" is everything outside North, Northeast and South: the central
// plains plus Bangkok, the East and the West. An institution in the East or
// West picks Central.
//
// The stored value (`regionEn`) is the projection's region key, matched by
// projection-region.ts; `regionTh` is derived from it, never typed. A
// spreadsheet projection upload drives the demographic driver only through
// rows that use one of these four names.

export const ORGANIZATION_REGIONS = ['Northeast', 'Central', 'North', 'South'] as const;
export type OrganizationRegion = (typeof ORGANIZATION_REGIONS)[number];

export const ORGANIZATION_REGION_INFO: Record<
  OrganizationRegion,
  { th: string; label: string }
> = {
  Northeast: { th: 'ภาคตะวันออกเฉียงเหนือ', label: 'Northeast' },
  Central: { th: 'ภาคกลาง', label: 'Central (incl. Bangkok, East, West)' },
  North: { th: 'ภาคเหนือ', label: 'North' },
  South: { th: 'ภาคใต้', label: 'South' },
};

/** Case- and whitespace-tolerant lookup; null for blank or unrecognised text. */
export function toOrganizationRegion(value: string | null | undefined): OrganizationRegion | null {
  const wanted = value?.trim().toLowerCase();
  if (!wanted) return null;
  return ORGANIZATION_REGIONS.find((r) => r.toLowerCase() === wanted) ?? null;
}

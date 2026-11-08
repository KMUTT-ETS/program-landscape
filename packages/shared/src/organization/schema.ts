import { z } from 'zod';

const requiredText = z.string().trim().min(1, 'required').max(200);
const optionalText = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null));

export const OrganizationIdentityInputSchema = z.object({
  nameTh: requiredText,
  nameEn: requiredText,
  shortNameTh: requiredText.pipe(z.string().max(30)),
  shortNameEn: requiredText.pipe(z.string().max(30)),
  regionTh: optionalText,
  regionEn: optionalText,
  contactEmail: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().email().nullable()),
  appUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'must start with http:// or https://')
    .transform((u) => u.replace(/\/+$/, '')),
  /**
   * Council policy: the minimum intake a programme must recruit to count as
   * viable. Must be at least 1 — `intakeComplianceFor` divides by the floor,
   * so a 0 would score every programme NaN rather than mean "no policy".
   * The defaults are the values the product shipped with, so an institution
   * that never touches them scores exactly as it always did.
   */
  intakeFloorBachelor: z.coerce.number().int().min(1).max(10_000).default(30),
  intakeFloorPostgrad: z.coerce.number().int().min(1).max(10_000).default(8),
  /**
   * OpenAlex institution id, e.g. I60837268 — find it at openalex.org by
   * searching the university. Blank means "not set" (the publications
   * connector then skips with a reason).
   */
  openalexInstitutionId: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .pipe(z.string().regex(/^I\d+$/, 'expected an OpenAlex institution id like I60837268').nullable()),
  /** null when creating the first profile; otherwise the version the form was loaded at. */
  expectedVersion: z.number().int().positive().nullable(),
});
export type OrganizationIdentityInput = z.infer<typeof OrganizationIdentityInputSchema>;

export const BRAND_ASSET_KINDS = ['logo-light', 'logo-dark', 'favicon'] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

const hexOrNull = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v.toLowerCase() : null))
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/, 'expected #rrggbb').nullable());

export const OrganizationBrandInputSchema = z.object({
  primaryColor: hexOrNull,
  secondaryColor: hexOrNull,
  expectedVersion: z.number().int().positive(),
});
export type OrganizationBrandInput = z.infer<typeof OrganizationBrandInputSchema>;

/** What GET /api/v1/organization returns to anyone, signed in or not. */
export type OrganizationPublicView =
  | { configured: false }
  | {
      configured: true;
      nameTh: string;
      nameEn: string;
      shortNameTh: string;
      shortNameEn: string;
      tagline: string;
      version: number;
      logoLightUrl: string | null;
      logoDarkUrl: string | null;
      faviconUrl: string | null;
      primaryColor: string | null;
      secondaryColor: string | null;
    };

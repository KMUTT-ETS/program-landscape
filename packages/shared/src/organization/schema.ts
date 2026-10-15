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
  /** null when creating the first profile; otherwise the version the form was loaded at. */
  expectedVersion: z.number().int().positive().nullable(),
});
export type OrganizationIdentityInput = z.infer<typeof OrganizationIdentityInputSchema>;

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
    };

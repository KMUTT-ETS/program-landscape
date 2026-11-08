import { z } from 'zod';

// Input rules for the first-run wizard. Kept out of the 'use server' file
// because a server-action module may only export async functions.

/**
 * Minimum length for the first administrator's password.
 *
 * `hashPassword` accepts 4 characters, which suits a throwaway developer
 * login and not this: the wizard is reachable without credentials and the
 * account it creates is a SUPER_ADMIN on a system that will hold the
 * university's staff and finance records.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const FirstAdminSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter the name this account belongs to.'),
    // Sign-in looks the address up with findUnique, so a stored
    // ' Admin@Example.ac.th ' would be an account nobody can reach.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Enter a valid email address.'),
    // Never trimmed — the form and the sign-in box must agree on exactly
    // what the password is, spaces included.
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    // There is no password-reset flow here and no second admin to ask, so
    // a typo locks the installation behind a string nobody knows.
    path: ['confirmPassword'],
    message: 'The two passwords do not match.',
  });

export type FirstAdminInput = z.infer<typeof FirstAdminSchema>;

'use server';

// First-run wizard. Creates the first administrator of an installation
// that has never been claimed — see packages/db/src/setup.ts for when that
// is possible and, more importantly, when it stops being possible.

import { SetupUnavailableError, completeSetup } from '@kku/db';

import { signIn } from '@/lib/auth';
import { hashPassword } from '@/lib/auth/password-hash';
import { FirstAdminSchema } from './setup-schema';

export interface SetupActionResult {
  ok: boolean;
  /** Keyed by field name, for rendering beside the input that is wrong. */
  fieldErrors?: Record<string, string>;
  /** Everything else, shown above the form. */
  error?: string;
  /** True when the new account was also signed in (session cookie set). */
  signedIn?: boolean;
}

export async function completeSetupAction(raw: unknown): Promise<SetupActionResult> {
  const parsed = FirstAdminSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && fieldErrors[key] === undefined) {
        fieldErrors[key] = issue.message;
      }
    }
    return { ok: false, fieldErrors };
  }

  try {
    await completeSetup({
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash: hashPassword(parsed.data.password),
    });
  } catch (e) {
    // Someone else claimed it between the page loading and this submit.
    // Not an error to retry — the installation now has an owner.
    if (e instanceof SetupUnavailableError) {
      return {
        ok: false,
        error: 'This installation has already been set up. Sign in instead.',
      };
    }
    throw e;
  }

  // Sign in on the server. The browser-side signIn() needs next-auth's CSRF
  // cookie, which this first visit has not necessarily been given, and failed
  // with MissingCSRF. The server entry point sets the session cookie itself.
  try {
    await signIn('dev-credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (e) {
    // The account exists; only the automatic sign-in failed. Log the error
    // class only: the credentials are in scope here and must not be.
    console.warn(`[setup] automatic sign-in failed: ${e instanceof Error ? e.name : 'error'}`);
    return { ok: true, signedIn: false };
  }
  return { ok: true, signedIn: true };
}

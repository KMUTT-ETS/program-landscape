import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  passwordMatches,
  shouldOfferPasswordForm,
} from '@/lib/auth/password-hash';

// Which passwords the Credentials provider will accept, and where.
//
// The provider used to be switched off wholesale in production, which is
// why `assertLocalAuthSafe()` exists. The thing that rule protects against
// is not passwords — it is the dev fallback below, where ANY account with
// no stored hash is opened by one shared string (default 'kku-dev'). On a
// production installation that is a universal back door into every SSO
// account, because SSO-provisioned users never have a hash.
//
// So the fallback stays strictly development-only, and an account with a
// real stored hash — which today means only the first admin, created by
// the setup wizard — can sign in anywhere.

const PASSWORD = 'correct horse battery staple';

describe('password login', () => {
  it('accepts a stored hash in production', async () => {
    const user = { passwordHash: hashPassword(PASSWORD) };

    expect(passwordMatches(user, PASSWORD, { allowDevFallback: false })).toBe(true);
  });

  it('rejects the wrong password against a stored hash', async () => {
    const user = { passwordHash: hashPassword(PASSWORD) };

    expect(passwordMatches(user, 'guess', { allowDevFallback: false })).toBe(false);
  });

  it('refuses an account with no stored hash when the dev fallback is off', async () => {
    // Every SSO-provisioned user looks like this. If the shared dev
    // password reached them, one string would open the whole university.
    const user = { passwordHash: null };

    expect(
      passwordMatches(user, process.env.DEV_AUTH_PASSWORD ?? 'kku-dev', {
        allowDevFallback: false,
      }),
    ).toBe(false);
  });

  it('allows the shared dev password only when the fallback is on', async () => {
    const user = { passwordHash: null };

    expect(passwordMatches(user, 'kku-dev', { allowDevFallback: true })).toBe(true);
    expect(passwordMatches(user, 'wrong', { allowDevFallback: true })).toBe(false);
  });

  it('prefers a stored hash over the dev password even in development', async () => {
    // Otherwise the shared string would also open the bootstrap admin on
    // any machine where the fallback happens to be enabled.
    const user = { passwordHash: hashPassword(PASSWORD) };

    expect(passwordMatches(user, 'kku-dev', { allowDevFallback: true })).toBe(false);
  });
});

describe('offering the password form', () => {
  it('offers it on an installation with no SSO yet', async () => {
    // The adopter's first sign-in. SSO gets wired later, so without this
    // the account the setup wizard just created has nowhere to be typed.
    expect(
      shouldOfferPasswordForm({ localAuthEnabled: false, ssoConfigured: false, forced: false }),
    ).toBe(true);
  });

  it('hides it once SSO is configured', async () => {
    // KKU today. Nobody should be invited to type a password at an
    // installation where every account is an SSO account.
    expect(
      shouldOfferPasswordForm({ localAuthEnabled: false, ssoConfigured: true, forced: false }),
    ).toBe(false);
  });

  it('offers it in development regardless of SSO', async () => {
    expect(
      shouldOfferPasswordForm({ localAuthEnabled: true, ssoConfigured: true, forced: false }),
    ).toBe(true);
  });

  it('offers it on request even when SSO is configured', async () => {
    // The escape hatch. Wiring SSO otherwise hides the only door the
    // bootstrap admin has, and if no SSO account has been promoted to
    // admin by then the installation has locked out its own owner.
    expect(
      shouldOfferPasswordForm({ localAuthEnabled: false, ssoConfigured: true, forced: true }),
    ).toBe(true);
  });
});

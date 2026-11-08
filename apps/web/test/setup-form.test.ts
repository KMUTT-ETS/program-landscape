import { describe, expect, it } from 'vitest';

import { FirstAdminSchema } from '@/lib/actions/setup-schema';

// What the first-run wizard will accept.
//
// This form is reachable without credentials and the account it makes is a
// SUPER_ADMIN, so its rules are the only thing standing between a fresh
// installation and a permanent administrator with a four-character
// password. `hashPassword` enforces a minimum of 4, which is right for a
// throwaway dev login and wrong for this.

function valid(over: Record<string, unknown> = {}) {
  return {
    name: 'Somchai Wong',
    email: 'admin@example.ac.th',
    password: 'a-long-enough-passphrase',
    confirmPassword: 'a-long-enough-passphrase',
    ...over,
  };
}

describe('first admin form', () => {
  it('accepts a well-formed submission', () => {
    expect(FirstAdminSchema.safeParse(valid()).success).toBe(true);
  });

  it('refuses a password short enough to guess', () => {
    const result = FirstAdminSchema.safeParse(
      valid({ password: 'kku-dev', confirmPassword: 'kku-dev' }),
    );

    expect(result.success).toBe(false);
  });

  it('refuses a mistyped confirmation', () => {
    // There is no password-reset flow and no second admin to ask. A typo
    // here locks the installation behind an unknown string.
    const result = FirstAdminSchema.safeParse(
      valid({ confirmPassword: 'a-long-enough-passphrasee' }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('refuses something that is not an email address', () => {
    expect(FirstAdminSchema.safeParse(valid({ email: 'admin' })).success).toBe(false);
  });

  it('refuses a blank name', () => {
    expect(FirstAdminSchema.safeParse(valid({ name: '   ' })).success).toBe(false);
  });

  it('normalises the email so the account can actually be found', () => {
    // Sign-in looks the address up with findUnique. A stored
    // ' Admin@Example.ac.th ' is an account nobody can reach.
    const result = FirstAdminSchema.parse(valid({ email: '  Admin@Example.ac.TH  ' }));

    expect(result.email).toBe('admin@example.ac.th');
  });

  it('keeps the password exactly as typed', () => {
    // Trimming a passphrase would make the form and the sign-in box
    // disagree about what the password is.
    const result = FirstAdminSchema.parse(
      valid({ password: ' spaces matter ', confirmPassword: ' spaces matter ' }),
    );

    expect(result.password).toBe(' spaces matter ');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
const completeSetup = vi.fn();

vi.mock('@/lib/auth', () => ({ signIn: (...a: unknown[]) => signIn(...a) }));
vi.mock('@kku/db', () => ({
  completeSetup: (...a: unknown[]) => completeSetup(...a),
  SetupUnavailableError: class SetupUnavailableError extends Error {},
}));

import { completeSetupAction } from '@/lib/actions/setup';

const input = {
  name: 'Test Admin',
  email: 'Admin@Example.ac.th',
  password: 'a-long-enough-passphrase',
  confirmPassword: 'a-long-enough-passphrase',
};

describe('completeSetupAction sign-in', () => {
  beforeEach(() => {
    signIn.mockReset();
    completeSetup.mockReset().mockResolvedValue(undefined);
  });

  it('signs the new account in on the server (no browser CSRF round-trip)', async () => {
    signIn.mockResolvedValue(undefined);
    const r = await completeSetupAction(input);
    expect(r).toEqual({ ok: true, signedIn: true });
    expect(signIn).toHaveBeenCalledWith('dev-credentials', {
      email: 'admin@example.ac.th',
      password: input.password,
      redirect: false,
    });
  });

  it('reports the account as created but not signed in when sign-in throws', async () => {
    signIn.mockRejectedValue(new Error('CredentialsSignin'));
    expect(await completeSetupAction(input)).toEqual({ ok: true, signedIn: false });
  });
});

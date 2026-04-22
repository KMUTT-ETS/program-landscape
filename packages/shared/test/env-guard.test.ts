// This test lives in apps/web/test ideally, but @kku/shared has the
// cleanest test harness. We inline the guard logic here because the
// web-side module imports `process.env` at load time and is easier to
// exercise through a pure function.
//
// See also: apps/web/src/lib/auth/env-guard.ts — kept identical.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

function assertLocalAuthSafe(env: Record<string, string | undefined>): void {
  const enabled = env.ENABLE_LOCAL_AUTH === 'true';
  const isProd = env.NODE_ENV === 'production';
  if (enabled && isProd) {
    throw new Error(
      'ENABLE_LOCAL_AUTH=true is not permitted when NODE_ENV=production.',
    );
  }
}

describe('local auth env guard', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when ENABLE_LOCAL_AUTH=true and NODE_ENV=production', () => {
    expect(() =>
      assertLocalAuthSafe({
        NODE_ENV: 'production',
        ENABLE_LOCAL_AUTH: 'true',
      }),
    ).toThrow();
  });

  it('allows ENABLE_LOCAL_AUTH=true in development', () => {
    expect(() =>
      assertLocalAuthSafe({
        NODE_ENV: 'development',
        ENABLE_LOCAL_AUTH: 'true',
      }),
    ).not.toThrow();
  });

  it('allows production when ENABLE_LOCAL_AUTH is unset or false', () => {
    expect(() => assertLocalAuthSafe({ NODE_ENV: 'production' })).not.toThrow();
    expect(() =>
      assertLocalAuthSafe({
        NODE_ENV: 'production',
        ENABLE_LOCAL_AUTH: 'false',
      }),
    ).not.toThrow();
  });
});

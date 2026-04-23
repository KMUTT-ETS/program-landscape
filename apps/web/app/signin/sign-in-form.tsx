'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  ssoConfigured: boolean;
  localAuthEnabled: boolean;
}

export function SignInForm({ ssoConfigured, localAuthEnabled }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('from') ?? '/';

  const [email, setEmail] = useState('admin@kku.ac.th');
  const [password, setPassword] = useState('kku-dev');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onKkuSso = () => {
    setError(null);
    void signIn('kku-sso', { callbackUrl });
  };

  const onDevSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await signIn('dev-credentials', {
      email,
      password,
      redirect: false,
      callbackUrl,
    });
    setSubmitting(false);
    if (res?.error) {
      setError('Invalid email or password');
    } else if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={onKkuSso}
        disabled={!ssoConfigured}
        className="w-full rounded-md bg-accent-default px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        Continue with KKU SSO
      </button>
      {!ssoConfigured && (
        <p className="-mt-4 text-xs text-text-tertiary">
          KKU SSO not yet configured. Set <code>KKU_SSO_ISSUER</code> and the
          client credentials, then restart.
        </p>
      )}

      {localAuthEnabled && (
        <>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border-default" aria-hidden />
            <span className="text-xs text-text-tertiary">Or (dev only)</span>
            <span className="h-px flex-1 bg-border-default" aria-hidden />
          </div>

          <form onSubmit={onDevSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-sm border border-default bg-surface-1 px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-default"
                autoComplete="username"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-sm border border-default bg-surface-1 px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-default"
                autoComplete="current-password"
              />
            </label>
            {error && <p className="text-xs text-danger">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md border border-strong bg-surface-1 px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-2 disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in with developer credentials'}
            </button>
            <p className="text-xs text-text-tertiary">
              Seeded users: <code>admin@kku.ac.th</code>,{' '}
              <code>council@kku.ac.th</code>, <code>dean.en@kku.ac.th</code>,{' '}
              <code>dh.cpe@kku.ac.th</code>, <code>analyst@kku.ac.th</code>,{' '}
              <code>exec@kku.ac.th</code>, <code>viewer@kku.ac.th</code>.
              Password: <code>kku-dev</code>.
            </p>
          </form>
        </>
      )}
    </div>
  );
}

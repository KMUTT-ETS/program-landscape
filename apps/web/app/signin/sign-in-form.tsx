'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

interface Props {
  ssoConfigured: boolean;
  localAuthEnabled: boolean;
}

// Sign-in form — minimal: one primary action (KKU SSO), a clear divider,
// then an optional dev-credentials section. Real bordered inputs (the
// bottom-border style read as "search box" rather than "form field").
//
// Hierarchy:
//   1. SSO button — accent-default, owns the page's only saturated colour.
//   2. Divider — single hairline with inline "or" label.
//   3. Email + password — standard bordered fields, generous padding.
//   4. Sign-in button — outline style; never competes with the SSO CTA.
//   5. Disclosure for seeded users — collapsed by default.

export function SignInForm({ ssoConfigured, localAuthEnabled }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('from') ?? '/';

  const [email, setEmail] = useState('admin@kku.ac.th');
  const [password, setPassword] = useState('kku-dev');
  const [submitting, setSubmitting] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onKkuSso = () => {
    setError(null);
    setSsoBusy(true);
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
      setError('That email and password do not match a seeded user.');
    } else if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Primary CTA — the single saturated colour on the page */}
      <button
        type="button"
        onClick={onKkuSso}
        disabled={!ssoConfigured || ssoBusy}
        className="group flex w-full items-center justify-center gap-2 rounded-md bg-accent-default px-5 py-3 text-[14px] font-medium text-accent-fg shadow-sm transition-all hover:bg-accent-hover hover:shadow active:bg-accent-active disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        <span>{ssoBusy ? 'Redirecting…' : 'Continue with KKU SSO'}</span>
        <ArrowRight
          className="h-4 w-4 opacity-80 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
      {!ssoConfigured && (
        <p className="-mt-3 text-[12px] leading-relaxed text-text-tertiary">
          KKU SSO is not configured for this environment. Set{' '}
          <code className="font-mono text-[11px] text-text-secondary">KKU_SSO_ISSUER</code>{' '}
          and the client credentials in <code className="font-mono text-[11px] text-text-secondary">.env</code>, then restart.
        </p>
      )}

      {localAuthEnabled && (
        <>
          {/* Hairline divider with inline label */}
          <div
            role="separator"
            className="relative flex items-center gap-3 my-1"
          >
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
            <span className="text-[11px] uppercase tracking-[0.16em] text-text-tertiary">
              Or
            </span>
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>

          <form onSubmit={onDevSubmit} className="flex flex-col gap-4">
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              autoComplete="username"
              onChange={setEmail}
            />
            <Field
              id="password"
              label="Password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={setPassword}
            />

            {error && (
              <p
                role="alert"
                className="text-[12px] text-danger"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-md border border-border-strong bg-surface-1 px-5 py-2.5 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-text-primary disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in with developer credentials'}
            </button>

            <details className="group mt-1">
              <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-text-secondary select-none">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
                Show seeded developer accounts
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-1 font-mono text-[11px] text-text-secondary leading-relaxed">
                <code>admin@kku.ac.th</code>
                <code>council@kku.ac.th</code>
                <code>exec@kku.ac.th</code>
                <code>dean.en@kku.ac.th</code>
                <code>dh.cpe@kku.ac.th</code>
                <code>analyst@kku.ac.th</code>
                <code>viewer@kku.ac.th</code>
                <p className="pt-2 text-text-tertiary">
                  Password: <code>kku-dev</code>
                </p>
              </div>
            </details>
          </form>
        </>
      )}
    </div>
  );
}

// Standard bordered input. Label sits above. Soft border that strengthens
// on hover and switches to accent-default on focus.
function Field({
  id,
  label,
  type,
  value,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  type: 'email' | 'password';
  value: string;
  autoComplete: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-text-secondary">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full rounded-md border border-border-default bg-surface-0 px-3.5 py-2.5 text-[14px] text-text-primary outline-none transition-all hover:border-border-strong focus:border-accent-default focus:ring-2 focus:ring-accent-default/20"
      />
    </div>
  );
}

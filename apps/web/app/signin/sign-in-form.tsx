'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Lock } from 'lucide-react';

interface Props {
  ssoConfigured: boolean;
  localAuthEnabled: boolean;
}

// Sign-in form — editorial redesign companion to page.tsx. Bottom-border
// inputs (no boxed widgets), one accent CTA, dev-credentials list
// hidden behind a disclosure to keep the form quiet for real users.

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
      {/* Primary action — KKU SSO. Single deliberate button. */}
      <button
        type="button"
        onClick={onKkuSso}
        disabled={!ssoConfigured || ssoBusy}
        className="group relative flex w-full items-center justify-between gap-3 rounded-md bg-accent-default px-5 py-3.5 text-sm font-medium text-accent-fg shadow-sm transition-all hover:bg-accent-hover hover:shadow-md active:bg-accent-active disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        <span className="flex items-center gap-2.5">
          <Lock className="h-4 w-4 opacity-80" aria-hidden />
          {ssoBusy ? 'Redirecting to KKU SSO…' : 'Continue with KKU SSO'}
        </span>
        <ArrowRight
          className="h-4 w-4 opacity-70 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
      {!ssoConfigured && (
        <p className="-mt-3 text-[11px] text-text-tertiary leading-relaxed">
          KKU SSO is not yet configured for this environment. Set{' '}
          <code className="font-mono text-[10px] text-text-secondary">KKU_SSO_ISSUER</code>{' '}
          and the client credentials, then restart the dev server.
        </p>
      )}

      {localAuthEnabled && (
        <>
          {/* Hairline divider with inline label — quieter than the
              two-rule "Or (dev only)" pattern. */}
          <div
            className="relative h-px bg-border-subtle my-2"
            role="separator"
            aria-label="Developer-only sign-in below"
          >
            <span className="absolute left-1/2 -translate-x-1/2 -top-2 bg-surface-1 px-3 text-[10px] uppercase tracking-[0.18em] font-semibold text-text-tertiary">
              Developer access
            </span>
          </div>

          <form onSubmit={onDevSubmit} className="flex flex-col gap-5">
            <Field
              label="Email"
              type="email"
              value={email}
              autoComplete="username"
              onChange={(v) => setEmail(v)}
            />
            <Field
              label="Password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(v) => setPassword(v)}
            />

            {error && (
              <p
                role="alert"
                className="rounded-sm border-l-2 border-danger bg-danger/5 px-3 py-2 text-[12px] text-danger"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="self-start rounded-md border border-border-strong bg-surface-1 px-4 py-2 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-text-primary disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in (dev)'}
            </button>

            <details className="group rounded-sm">
              <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.14em] font-semibold text-text-tertiary transition-colors hover:text-text-secondary">
                <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
                Show seeded dev users
              </summary>
              <div className="mt-3 space-y-1 font-mono text-[11px] text-text-secondary leading-relaxed">
                <code className="block">admin@kku.ac.th</code>
                <code className="block">council@kku.ac.th</code>
                <code className="block">exec@kku.ac.th</code>
                <code className="block">dean.en@kku.ac.th</code>
                <code className="block">dh.cpe@kku.ac.th</code>
                <code className="block">analyst@kku.ac.th</code>
                <code className="block">viewer@kku.ac.th</code>
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

// Editorial bottom-border input. Label sits above as a small caption,
// border lifts from subtle to default on hover and to accent on focus.
function Field({
  label,
  type,
  value,
  autoComplete,
  onChange,
}: {
  label: string;
  type: 'email' | 'password';
  value: string;
  autoComplete: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        className="w-full bg-transparent text-[15px] text-text-primary placeholder:text-text-tertiary border-0 border-b border-border-default px-0 py-2 outline-none transition-colors hover:border-border-strong focus:border-accent-default"
      />
    </label>
  );
}

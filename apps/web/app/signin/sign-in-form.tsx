'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';

interface Props {
  ssoConfigured: boolean;
  /** Whether to render the password form at all — see shouldOfferPasswordForm(). */
  localAuthEnabled: boolean;
  /**
   * Whether this is a development machine with the shared DEV_AUTH_PASSWORD
   * fallback on. Separate from the flag above on purpose: an adopting
   * university sees the password form (it is how their first admin signs
   * in) and must NOT be shown KKU's seeded accounts or offered `kku-dev`,
   * which is not a password on their installation and never was.
   */
  devHints: boolean;
}

// Card-style sign-in form. Lives inside the rounded-2xl container in
// page.tsx — typography here is sized to the card width (440px), not
// the viewport, so weights/sizes feel calm and contained.

export function SignInForm({ ssoConfigured, localAuthEnabled, devHints }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('from') ?? '/';

  const [email, setEmail] = useState(devHints ? 'admin@kku.ac.th' : '');
  const [password, setPassword] = useState(devHints ? 'kku-dev' : '');
  const [submitting, setSubmitting] = useState(false);
  const [ssoBusy, setSsoBusy] = useState(false);
  // Surface SSO errors propagated from /api/auth/callback/kku-sso.
  const ssoError = params.get('error');
  const initialError = ssoError ? mapSsoError(ssoError) : null;
  const [error, setError] = useState<string | null>(initialError);

  // SSONext bypasses NextAuth — the browser navigates to /api/auth/kku-sso/start,
  // which 302s to KKU's login page and stashes the original destination so the
  // callback route can return the user there.
  const onKkuSso = () => {
    setError(null);
    setSsoBusy(true);
    const target = `/api/auth/kku-sso/start?from=${encodeURIComponent(callbackUrl)}`;
    window.location.assign(target);
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
      setError(
        devHints
          ? 'That email and password do not match a seeded user.'
          : 'That email and password do not match an account.',
      );
    } else if (res?.ok) {
      router.push(callbackUrl);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Primary CTA — full-width, accent-coloured */}
      <button
        type="button"
        onClick={onKkuSso}
        disabled={!ssoConfigured || ssoBusy}
        className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-accent-default px-5 py-3 text-[14px] font-medium text-accent-fg shadow-sm transition-all hover:bg-accent-hover hover:shadow active:bg-accent-active disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        <span>{ssoBusy ? 'Redirecting…' : 'Continue with KKU SSO'}</span>
        <ArrowRight
          className="size-icon-md opacity-80 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>
      {!ssoConfigured && (
        <p className="-mt-2 text-[11px] leading-relaxed text-text-tertiary">
          KKU SSO is not configured for this environment. Set{' '}
          <code className="font-mono text-[10px] text-text-secondary">KKU_SSO_WEB_BASE</code>,{' '}
          <code className="font-mono text-[10px] text-text-secondary">KKU_SSO_APP_ID</code>{' '}
          and client credentials in{' '}
          <code className="font-mono text-[10px] text-text-secondary">.env</code>
          , then restart.
        </p>
      )}

      {localAuthEnabled && (
        <>
          <div className="relative flex items-center gap-3 my-1" role="separator">
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
            <span className="text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
              Or
            </span>
            <span aria-hidden className="h-px flex-1 bg-border-subtle" />
          </div>

          <form onSubmit={onDevSubmit} className="flex flex-col gap-3">
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              autoComplete="username"
              onChange={setEmail}
              placeholder="firstname.l@kku.ac.th"
            />
            <Field
              id="password"
              label="Password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={setPassword}
              placeholder="••••••••"
            />

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border-default bg-surface-0 px-5 py-2.5 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-2 hover:border-border-strong disabled:opacity-50"
            >
              {submitting
                ? 'Signing in…'
                : devHints
                  ? 'Sign in with developer credentials'
                  : 'Sign in'}
            </button>

            <details className={devHints ? 'group mt-2' : 'hidden'}>
              <summary className="cursor-pointer list-none text-[10px] uppercase tracking-[0.14em] text-text-tertiary transition-colors hover:text-text-secondary select-none">
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

// Map SSO error codes from /api/auth/callback/kku-sso into human messages.
function mapSsoError(code: string): string {
  switch (code) {
    case 'no_code':
      return 'KKU SSO returned no code. Try signing in again.';
    case 'sso_not_configured':
      return 'KKU SSO is not configured. Contact the administrator.';
    case 'server_misconfigured':
      return 'Server is missing the session secret. Contact the administrator.';
    case 'sso_unauthorized':
      return 'KKU SSO rejected the access token. Try signing in again.';
    case 'sso_failed':
      return 'KKU SSO sign-in failed. Try again or use developer credentials.';
    default:
      if (code.startsWith('sso_auth')) {
        return `KKU SSO rejected the request (${code.toUpperCase()}). Try again.`;
      }
      return `KKU SSO error (${code}).`;
  }
}

// Card-style input — soft border, rounded-lg, generous padding,
// subtle ring on focus.
function Field({
  id,
  label,
  type,
  value,
  autoComplete,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  type: 'email' | 'password';
  value: string;
  autoComplete: string;
  onChange: (v: string) => void;
  placeholder?: string;
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
        placeholder={placeholder}
        className="w-full rounded-lg border border-border-default bg-surface-0 px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none transition-all hover:border-border-strong focus:border-accent-default focus:ring-2 focus:ring-accent-default/20"
      />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { completeSetupAction } from '@/lib/actions/setup';
import { MIN_PASSWORD_LENGTH } from '@/lib/actions/setup-schema';

// The first-admin form. Signs the new account straight in rather than
// sending anyone back to /signin — they have just typed the password, and
// asking for it again is how a typo in a field with no reset flow turns
// into a locked installation.

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    const result = await completeSetupAction({ name, email, password, confirmPassword });
    if (!result.ok) {
      setSubmitting(false);
      setFieldErrors(result.fieldErrors ?? {});
      setError(result.error ?? null);
      return;
    }

    // The server action signs the new account in. A failure there is a
    // sign-in problem, not a setup problem, so say so rather than implying
    // nothing was created.
    setSubmitting(false);
    if (result.signedIn) {
      router.push('/');
      router.refresh();
      return;
    }
    setError('Your account was created, but signing in failed. Try signing in.');
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field
        id="name"
        label="Your name"
        type="text"
        value={name}
        autoComplete="name"
        onChange={setName}
        error={fieldErrors.name}
      />
      <Field
        id="email"
        label="Email"
        type="email"
        value={email}
        autoComplete="username"
        onChange={setEmail}
        error={fieldErrors.email}
      />
      <Field
        id="password"
        label="Password"
        type="password"
        value={password}
        autoComplete="new-password"
        onChange={setPassword}
        error={fieldErrors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      />
      <Field
        id="confirmPassword"
        label="Confirm password"
        type="password"
        value={confirmPassword}
        autoComplete="new-password"
        onChange={setConfirmPassword}
        error={fieldErrors.confirmPassword}
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
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-default px-5 py-3 text-[14px] font-medium text-accent-fg shadow-sm transition-all hover:bg-accent-hover hover:shadow active:bg-accent-active disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
      >
        {submitting ? 'Creating…' : 'Create administrator'}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  type,
  value,
  autoComplete,
  onChange,
  error,
  hint,
}: {
  id: string;
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  autoComplete: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
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
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="w-full rounded-lg border border-default bg-surface-0 px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-text-tertiary outline-none transition-all hover:border-strong focus:border-accent-default focus:ring-2 focus:ring-accent-default/20"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[11px] text-text-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

export default function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-12">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-default text-[16px] font-bold text-accent-fg shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset]"
        >
          K
        </div>
        <div className="leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            KKU Curriculum Intelligence Platform
          </div>
          <div className="mt-0.5 text-[17px] font-semibold tracking-tight text-text-primary">
            Program Landscape
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            Strategic decision-support for the University Council
          </div>
        </div>
      </div>

      <h1 className="text-2xl font-semibold text-text-primary">Sign in</h1>

      <SignInForm
        ssoConfigured={ssoConfigured}
        localAuthEnabled={localAuthEnabled}
      />

      <p className="text-xs text-text-tertiary">
        Trouble signing in? Contact the KKU Digital Transformation Office.
      </p>
    </main>
  );
}

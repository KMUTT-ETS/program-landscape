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
        <div aria-hidden className="h-8 w-8 rounded-md bg-brand" />
        <div>
          <div className="text-sm font-medium text-fg">
            KKU Curriculum Landscape
          </div>
          <div className="text-xs text-fg-muted">
            Strategic decision-support for the University Council
          </div>
        </div>
      </div>

      <h1 className="text-2xl font-semibold text-fg">Sign in</h1>

      <SignInForm
        ssoConfigured={ssoConfigured}
        localAuthEnabled={localAuthEnabled}
      />

      <p className="text-xs text-fg-subtle">
        Trouble signing in? Contact the KKU Digital Transformation Office.
      </p>
    </main>
  );
}

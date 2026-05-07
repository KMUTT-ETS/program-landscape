import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

// Sign-in page — minimal institutional layout (2026-05-07).
//
// Three principles:
//   1. One focal point. The form is the only thing the user needs to
//      act on, and it's clearly the right-hand subject. The left panel
//      sets context but doesn't compete.
//   2. Hierarchy through size, not decoration. No patterns, no
//      ambient textures, no icons-for-icons-sake. Restraint reads as
//      institutional.
//   3. Typography pair: a single calm display size for the wordmark,
//      restrained body for everything else. One accent colour for the
//      primary CTA. Tokens only.
//
// English-only on this surface per direction; the application's bilingual
// posture lives downstream where data is presented.
export default function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* ── Left: brand panel ──────────────────────────────────── */}
      <section className="relative bg-surface-0 border-b lg:border-b-0 lg:border-r border-border-subtle">
        <div className="flex h-full flex-col justify-between px-8 py-12 lg:px-16 lg:py-20 lg:min-h-screen">
          {/* Top: small platform caption */}
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-tertiary">
            KKU Curriculum Intelligence Platform
          </div>

          {/* Middle: wordmark + single-line tagline */}
          <div className="max-w-lg py-12 lg:py-0">
            <h1 className="font-light tracking-tight text-text-primary text-5xl lg:text-7xl leading-[1.05]">
              Program
              <br />
              Landscape<span className="text-accent-default">.</span>
            </h1>
            <p className="mt-8 text-base lg:text-lg leading-relaxed text-text-secondary max-w-md">
              Strategic decision-support for the University Council at Khon Kaen University —
              programs read against future trends, financial sustainability, and labour-market demand.
            </p>
          </div>

          {/* Bottom: institutional cue */}
          <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.18em] text-text-tertiary">
            <span aria-hidden className="h-px w-12 bg-border-strong" />
            Council-restricted
          </div>
        </div>
      </section>

      {/* ── Right: form panel ──────────────────────────────────── */}
      <section className="relative bg-surface-1 flex flex-col lg:min-h-screen">
        <div className="flex-1 flex flex-col justify-center px-8 py-16 lg:px-16">
          <div className="w-full max-w-sm mx-auto">
            <h2 className="text-3xl font-light tracking-tight text-text-primary">
              Sign in
            </h2>
            <p className="mt-2.5 text-sm text-text-secondary leading-relaxed">
              Use your KKU institutional account. Your access is determined by
              the role assigned to you.
            </p>

            <div className="mt-10">
              <SignInForm
                ssoConfigured={ssoConfigured}
                localAuthEnabled={localAuthEnabled}
              />
            </div>
          </div>
        </div>

        <footer className="border-t border-border-subtle px-8 lg:px-16 py-5 text-[12px] text-text-tertiary">
          Need access? Contact the{' '}
          <a
            href="mailto:dto@kku.ac.th"
            className="text-text-secondary underline-offset-4 hover:underline hover:text-accent-default transition-colors"
          >
            KKU Digital Transformation Office
          </a>
          .
        </footer>
      </section>
    </main>
  );
}

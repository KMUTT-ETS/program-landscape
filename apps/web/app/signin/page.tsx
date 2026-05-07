import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

// Sign-in page — atmospheric centred-card layout (Lovable-inspired,
// 2026-05-07).
//
// Single-column, page is the canvas. Soft accent-coloured gradient orbs
// blurred behind a refined card. The card carries the form and the
// wordmark; everything else (page chrome, environment cue, credits)
// sits at low opacity around it.
//
// All colour from design tokens. Light + dark mode track automatically.
export default function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-surface-0">
      {/* Atmospheric gradient orbs — soft, blurred, low-opacity. The
          accent token gives them a warm cream-to-amber glow against
          the page canvas. They're decorative only, no semantic role. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-[520px] w-[520px] rounded-full blur-[120px] opacity-30"
        style={{ background: 'oklch(var(--color-accent-default) / 0.55)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 h-[640px] w-[640px] rounded-full blur-[140px] opacity-25"
        style={{ background: 'oklch(var(--color-accent-hover) / 0.50)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-1/4 h-[360px] w-[360px] rounded-full blur-[100px] opacity-15"
        style={{ background: 'oklch(var(--color-glossy-tint) / 0.80)' }}
      />

      {/* Page content — vertically centred, modest top/bottom safety
          padding so it never crashes into the viewport edges. */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-12">
        {/* Wordmark — sits ABOVE the card, not inside. Establishes
            identity before the user looks at the form. */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-tertiary">
            KKU Curriculum Intelligence Platform
          </div>
          <h1 className="text-3xl font-light tracking-tight text-text-primary">
            Program Landscape<span className="text-accent-default">.</span>
          </h1>
        </div>

        {/* The card — refined container with soft shadow + subtle
            border. Surface-1 sits slightly above the page canvas,
            reading as "the working surface". */}
        <div
          className="relative w-full max-w-[440px] rounded-2xl border border-border-subtle bg-surface-1 p-8 shadow-[0_2px_24px_-8px_rgba(0,0,0,0.08),0_8px_56px_-12px_rgba(0,0,0,0.06)]"
        >
          <div className="flex flex-col gap-1.5 mb-8">
            <h2 className="text-xl font-medium text-text-primary">Welcome back</h2>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              Sign in with your KKU institutional account. Access is scoped to your role.
            </p>
          </div>

          <SignInForm
            ssoConfigured={ssoConfigured}
            localAuthEnabled={localAuthEnabled}
          />
        </div>

        {/* Below the card: tagline + credits. Quiet, low contrast. */}
        <p className="mt-8 max-w-md text-center text-[12px] leading-relaxed text-text-tertiary">
          Strategic decision-support for the University Council at Khon Kaen
          University — programs read against future trends, financial
          sustainability, and labour-market demand.
        </p>

        <div className="mt-10 flex flex-col items-center gap-1 text-[11px] text-text-tertiary">
          <span>
            Need access? Contact the{' '}
            <a
              href="mailto:dto@kku.ac.th"
              className="text-text-secondary underline-offset-4 hover:underline hover:text-accent-default transition-colors"
            >
              KKU Digital Transformation Office
            </a>
            .
          </span>
        </div>

        {/* Credit line — sits at the very bottom of the viewport on
            tall screens, otherwise scrolls with the rest. Refined and
            understated; this is the signature, not a banner. */}
        <div className="mt-12 flex flex-col items-center gap-0.5 text-[10px] uppercase tracking-[0.16em] text-text-tertiary">
          <span aria-hidden className="h-px w-12 bg-border-subtle mb-3" />
          <span className="text-text-secondary">
            Conceived by Dr. Denpong Soodphakdee
          </span>
          <span className="font-normal normal-case text-[10px] tracking-normal text-text-tertiary mt-0.5">
            Vice President for Education and Digital, Khon Kaen University
          </span>
          <span className="mt-1.5 normal-case tracking-normal text-text-tertiary/80">
            Built in collaboration with Claude (Anthropic)
          </span>
        </div>
      </div>
    </main>
  );
}

import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

// Sign-in page — two-pane split (Lovable-inspired, 2026-05-07).
//
// Left pane: calm, near-monochrome surface holding the wordmark, form,
// and contact line. The working surface.
//
// Right pane: a vivid atmospheric gradient — the visual moment of the
// page. It's not decoration; it carries the brand identity that the
// rest of the application (warm cream + amber accent palette) draws
// from. A small floating tile teases what the application looks like
// inside without committing to a literal screenshot.
//
// English-only on this surface per direction. All colour from design
// tokens; gradient stops use oklch(var(token) / alpha) so they invert
// cleanly under dark mode.
export default function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* ── Left pane: form ─────────────────────────────────────── */}
      <section className="relative bg-surface-1 flex flex-col lg:min-h-screen">
        {/* Top: brand mark + wordmark */}
        <header className="px-8 py-8 lg:px-16 lg:py-10">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-[14px] font-medium tracking-tight text-text-primary">
              Program Landscape
            </span>
          </div>
        </header>

        {/* Centre: form. Sized to ~400px so the inputs don't sprawl. */}
        <div className="flex-1 flex flex-col justify-center px-8 lg:px-16">
          <div className="w-full max-w-[400px]">
            <h1 className="text-[28px] font-medium tracking-tight text-text-primary leading-tight">
              Sign in
            </h1>
            <p className="mt-2 text-[14px] text-text-secondary leading-relaxed">
              Use your KKU institutional account. Access is scoped to your role.
            </p>

            <div className="mt-8">
              <SignInForm
                ssoConfigured={ssoConfigured}
                localAuthEnabled={localAuthEnabled}
              />
            </div>
          </div>
        </div>

        {/* Bottom: contact + credit. Quiet, low-contrast. */}
        <footer className="px-8 lg:px-16 pb-8 lg:pb-10">
          <div className="text-[12px] text-text-tertiary leading-relaxed border-t border-border-subtle pt-5">
            Need access? Contact the{' '}
            <a
              href="mailto:denpong@kku.ac.th"
              className="text-text-secondary underline-offset-4 hover:underline hover:text-accent-default transition-colors"
            >
              Office of the Vice President for Education and Digital
            </a>
            .
          </div>
          <div className="mt-5 text-[11px] leading-relaxed text-text-tertiary">
            <div className="text-text-secondary font-medium">
              Conceived by Dr. Denpong Soodphakdee
            </div>
            <div>Vice President for Education and Digital, Khon Kaen University</div>
            <div className="mt-1 opacity-80">
              Built in collaboration with Claude (Anthropic)
            </div>
          </div>
        </footer>
      </section>

      {/* ── Right pane: vivid atmospheric gradient ─────────────── */}
      <section
        aria-hidden
        className="relative hidden lg:block overflow-hidden"
      >
        {/* Base canvas for the gradient. Layered radial blooms in the
            warm accent palette give it volumetric depth — the page's
            visual moment, on-brand, without imagery. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, oklch(var(--color-accent-default) / 0.95) 0%, oklch(var(--color-accent-hover) / 0.85) 35%, oklch(var(--color-glossy-tint) / 0.95) 100%)',
          }}
        />
        <div
          className="absolute -top-32 -right-24 h-[640px] w-[640px] rounded-full blur-[120px] opacity-70"
          style={{ background: 'oklch(98% 0.04 70 / 0.85)' }}
        />
        <div
          className="absolute top-1/3 -left-32 h-[520px] w-[520px] rounded-full blur-[140px] opacity-50"
          style={{ background: 'oklch(78% 0.18 50 / 0.85)' }}
        />
        <div
          className="absolute -bottom-32 right-1/4 h-[480px] w-[480px] rounded-full blur-[120px] opacity-60"
          style={{ background: 'oklch(60% 0.14 35 / 0.65)' }}
        />

        {/* A subtle dot field overlaid on the gradient — same BCG-matrix
            visual the application uses internally, but at low opacity so
            it reads as texture, not chart. Carries the institutional
            "this is a portfolio analytics tool" cue without being literal. */}
        <DotOverlay />

        {/* Floating teaser tile — bottom-right, miniature card. Hints at
            what the product is without showing a literal screenshot. */}
        <div className="absolute bottom-10 right-10 max-w-[320px]">
          <div className="rounded-xl border border-white/30 bg-white/12 backdrop-blur-md px-5 py-4 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.30)]">
            <div className="flex items-baseline gap-3 mb-3">
              <span
                className="text-[34px] font-light tracking-tight leading-none text-white"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                297
              </span>
              <span className="text-[11px] uppercase tracking-[0.16em] text-white/85">
                programs
              </span>
            </div>
            <div className="text-[12px] text-white/90 leading-relaxed">
              Read against future trends, financial sustainability, and labour-market demand.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// Compact brand mark — four-bubble BCG-matrix nod. Identifies the
// product (analytics for a portfolio of 297 programs) without being
// literal or noisy.
function BrandMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden
      className="shrink-0"
    >
      {/* Four bubbles arranged 2×2; top-right (Stars) is the largest +
          most saturated to give the mark a clear focal point. */}
      <circle cx="6" cy="6" r="2.6" className="fill-accent-default" opacity="0.6" />
      <circle cx="16" cy="6" r="3.6" className="fill-accent-default" />
      <circle cx="6" cy="16" r="2.0" className="fill-accent-default" opacity="0.4" />
      <circle cx="16" cy="16" r="2.6" className="fill-accent-default" opacity="0.7" />
    </svg>
  );
}

// Faint dot grid as overlay on the gradient. Uses radial-gradient on a
// small repeating tile so it's static (no SVG child elements).
function DotOverlay() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 opacity-25"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, oklch(99% 0 0 / 0.55) 1.2px, transparent 1.2px)',
        backgroundSize: '28px 28px',
      }}
    />
  );
}

import { SignInForm } from './sign-in-form';
import { prisma } from '@kku/db';
import { SignalsFeed } from './signals-feed';

export const dynamic = 'force-dynamic';

// Sign-in page — two-pane split (Lovable-inspired, 2026-05-07).
//
// Left pane: calm warm-cream surface holding a centred, narrow form
// (~320px) with the wordmark above it and the contact + credit
// stack below. Mirrors Lovable's layout proportion — generous
// breathing room, form is a column of items, not a sprawling box.
//
// Right pane: vivid layered gradient as the visual moment, with a
// LIVE feed of TrendSignal headlines stacked on glassmorphic cards.
// These are the same signals the application surfaces internally for
// Council briefings — showing them on the sign-in page is honest
// branding ("this is what's inside") and gives the page genuine
// content rather than a static teaser.
export default async function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';

  // Pull the 5 most recent signals. Pre-auth so we limit to title +
  // English summary + signalType + detectedDate — no source URLs, no
  // affected-program IDs, no impact scores. Fail open: if the query
  // errors the right pane just falls back to an evergreen tagline.
  const signals = await prisma.trendSignal
    .findMany({
      orderBy: { detectedDate: 'desc' },
      take: 5,
      select: {
        id: true,
        signalType: true,
        title: true,
        summaryEn: true,
        detectedDate: true,
      },
    })
    .catch(() => [] as Array<{
      id: string;
      signalType: string;
      title: string;
      summaryEn: string | null;
      detectedDate: Date;
    }>);

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-2">
      {/* ── Left pane: form ─────────────────────────────────────── */}
      <section className="relative bg-surface-1 flex flex-col lg:min-h-screen">
        {/* Top: brand mark + wordmark, anchored to the same horizontal
            axis as the form below for a clean column. */}
        <header className="px-8 pt-8 lg:pt-10">
          <div className="mx-auto flex w-full max-w-[320px] items-center gap-2.5">
            <BrandMark />
            <span className="text-[14px] font-medium tracking-tight text-text-primary">
              Program Landscape
            </span>
          </div>
        </header>

        {/* Centre: form. max-w-[320px] mirrors Lovable's tight column. */}
        <div className="flex-1 flex flex-col justify-center px-8 py-12">
          <div className="mx-auto w-full max-w-[320px]">
            <h1 className="text-[26px] font-medium tracking-tight text-text-primary leading-tight">
              Sign in
            </h1>
            <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
              Use your KKU institutional account. Access is scoped to your role.
            </p>

            <div className="mt-7">
              <SignInForm
                ssoConfigured={ssoConfigured}
                localAuthEnabled={localAuthEnabled}
              />
            </div>
          </div>
        </div>

        {/* Bottom: contact + credit stack, same column width as the
            form. */}
        <footer className="px-8 pb-8 lg:pb-10">
          <div className="mx-auto w-full max-w-[320px]">
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
          </div>
        </footer>
      </section>

      {/* ── Right pane: vivid gradient + live signals feed ─────── */}
      <section
        className="relative hidden lg:block overflow-hidden"
        aria-label="Live signals feed"
      >
        {/* Layered radial blooms in the warm accent palette. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, oklch(var(--color-accent-default) / 0.95) 0%, oklch(var(--color-accent-hover) / 0.85) 35%, oklch(var(--color-glossy-tint) / 0.95) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute -top-32 -right-24 h-[640px] w-[640px] rounded-full blur-[120px] opacity-70"
          style={{ background: 'oklch(98% 0.04 70 / 0.85)' }}
        />
        <div
          aria-hidden
          className="absolute top-1/3 -left-32 h-[520px] w-[520px] rounded-full blur-[140px] opacity-50"
          style={{ background: 'oklch(78% 0.18 50 / 0.85)' }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 right-1/4 h-[480px] w-[480px] rounded-full blur-[120px] opacity-60"
          style={{ background: 'oklch(60% 0.14 35 / 0.65)' }}
        />

        {/* Faint dot grid — same BCG-matrix texture from inside the app. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, oklch(99% 0 0 / 0.55) 1.2px, transparent 1.2px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* Live signals stack — server-rendered cards, gentle entrance
            animation handled in the SignalsFeed client wrapper. */}
        <div className="relative z-10 flex h-full flex-col justify-center px-12 xl:px-16 py-16">
          <div className="mb-6 flex items-center gap-3 text-white/85">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              Live · today&apos;s signals
            </span>
          </div>
          <p className="text-[13px] text-white/80 max-w-md mb-6 leading-relaxed">
            Curated signals on changes in the world and Thailand — education, technology, policy, demographics — that move the strategic outlook for KKU programs.
          </p>
          <SignalsFeed
            signals={signals.map((s) => ({
              id: s.id,
              type: s.signalType,
              title: s.title,
              summary: s.summaryEn ?? '',
              detectedDateIso: s.detectedDate.toISOString(),
            }))}
          />
        </div>
      </section>
    </main>
  );
}

// Compact brand mark — four bubbles in 2×2 (BCG-matrix nod). Top-right
// largest gives the mark a clear focal point.
function BrandMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden className="shrink-0">
      <circle cx="6" cy="6" r="2.6" className="fill-accent-default" opacity="0.6" />
      <circle cx="16" cy="6" r="3.6" className="fill-accent-default" />
      <circle cx="6" cy="16" r="2.0" className="fill-accent-default" opacity="0.4" />
      <circle cx="16" cy="16" r="2.6" className="fill-accent-default" opacity="0.7" />
    </svg>
  );
}

import { SignInForm } from './sign-in-form';
import { prisma } from '@kku/db';
import { SignalsFeed, type FeedItem } from './signals-feed';
import { fetchTodaysHeadlines, type NewsItem } from '@/lib/news/today';

export const dynamic = 'force-dynamic';

// Sign-in page — two-pane split (Lovable-inspired, 2026-05-07).
//
// Left pane (form): warm cream surface, form left-justified to a
// stable column ~340px wide with consistent left padding from the
// pane edge. Header (brand mark) and footer (contact + credit) line
// up to the same left margin.
//
// Right pane (lg+ only): vivid layered gradient + a LIVE feed of
// today's headlines. Pulls from Google News RSS (Thailand top stories,
// higher-education, technology, policy keywords) — primary; falls
// back to TrendSignal seed data when offline. Picks 5 at random per
// render so repeat visits show different stories. Content vertically
// centred in the pane.
//
// Responsive: at <lg the right pane drops out entirely and the left
// pane fills the viewport; the form column stays the same width
// (~340px) so it doesn't feel narrower on a phone — just better
// breathing room above and below.
export default async function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';

  // News fetch (parallel), with TrendSignal fallback so the right pane
  // is always populated during dev / offline.
  const [news, trendSignals] = await Promise.all([
    fetchTodaysHeadlines().catch(() => [] as NewsItem[]),
    prisma.trendSignal
      .findMany({
        orderBy: { detectedDate: 'desc' },
        take: 10,
        select: {
          id: true,
          signalType: true,
          title: true,
          summaryEn: true,
          detectedDate: true,
        },
      })
      .catch(() => []),
  ]);

  const feedItems: FeedItem[] =
    news.length > 0
      ? shuffle(news).slice(0, 5).map((n) => ({
          id: n.id,
          source: n.source ?? n.category.toUpperCase(),
          title: n.title,
          summary: null,
          publishedAtIso: n.publishedAtIso,
          url: n.url,
        }))
      : trendSignals.map((s) => ({
          id: s.id,
          source: s.signalType,
          title: s.title,
          summary: s.summaryEn,
          publishedAtIso: s.detectedDate.toISOString(),
          url: null,
        }));

  return (
    <main className="min-h-screen w-full grid grid-cols-1 md:grid-cols-2">
      {/* ── Left pane: form ─────────────────────────────────────── */}
      {/* Header + footer are full-width (left-justified flush to the
          pane padding) so single-line text never wraps. The form in
          the middle stays horizontally centred at max-w-[340px]. */}
      <section className="relative bg-surface-1 flex flex-col md:min-h-screen">
        <header className="w-full px-6 pt-8 sm:px-10 sm:pt-10 md:px-16 md:pt-12">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="text-[14px] font-medium tracking-tight text-text-primary">
              Program Landscape
            </span>
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center items-center px-6 sm:px-10 md:px-16 py-12">
          <div className="w-full max-w-[340px]">
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

        <footer className="w-full px-6 pb-8 sm:px-10 sm:pb-10 md:px-16">
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
          <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] leading-relaxed text-text-tertiary">
            <span className="text-text-secondary font-medium whitespace-nowrap">
              Conceived by Dr. Denpong Soodphakdee
            </span>
            <span className="whitespace-nowrap">
              · Vice President for Education and Digital, Khon Kaen University
            </span>
            <span className="opacity-80 whitespace-nowrap">
              · Built in collaboration with Claude (Anthropic)
            </span>
          </div>
        </footer>
      </section>

      {/* ── Right pane: vivid gradient + live news feed ────────── */}
      {/* Hidden on mobile (<lg): the form pane fills the viewport.
          The brand identity travels with the form pane regardless,
          so the page never feels stripped on a phone. */}
      <section
        className="relative hidden md:flex overflow-hidden"
        aria-label="Live news feed"
      >
        {/* Sunset gradient — KKU cardinal red bottom-left to warm orange
            top-right. All stops sit in the 44-62% lightness band so white
            text reads cleanly across the full pane. The previous version
            used --color-glossy-tint (96% L) at the end stop which washed
            the right edge to near-white and made the news invisible. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, oklch(var(--color-accent-active)) 0%, oklch(var(--color-accent-default)) 45%, oklch(var(--color-brand-cardinal)) 100%)',
          }}
        />
        {/* Subtle warm bloom in the upper-right — keeps the gradient from
            looking flat without lightening it enough to break contrast.
            Toned down from 50%/40% → 35%/28% to soften the overall
            brightness per design feedback. */}
        <div
          aria-hidden
          className="absolute -top-32 -right-24 h-[640px] w-[640px] rounded-full blur-[120px] opacity-35"
          style={{ background: 'oklch(var(--color-warning-default))' }}
        />
        <div
          aria-hidden
          className="absolute -bottom-32 right-1/4 h-[480px] w-[480px] rounded-full blur-[120px] opacity-30"
          style={{ background: 'oklch(var(--color-brand-cardinal))' }}
        />

        {/* Soft dimming veil — knocks the whole vivid stack back to
            ~80% perceived intensity. Sits above the gradient + blooms
            but below the dot grid + content so texture + text stay
            crisp. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: 'oklch(20% 0.020 30 / 0.20)' }}
        />

        {/* Faint dot grid — same BCG-matrix texture from inside the app. */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, oklch(99% 0 0 / 0.4) 1.2px, transparent 1.2px)',
            backgroundSize: '28px 28px',
          }}
        />

        {/* News stack — vertically + horizontally centred. */}
        <div className="relative z-10 m-auto w-full max-w-[480px] px-12 py-16">
          <div className="mb-5 flex items-center gap-3 text-white/85">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
              {news.length > 0 ? "Today's headlines" : 'Curated signals'}
            </span>
          </div>
          <p className="text-[13px] text-white/80 mb-6 leading-relaxed">
            {news.length > 0
              ? 'A live pull from world + Thailand news on education, technology, and policy — randomised on each visit.'
              : 'Curated signals on changes shaping the strategic outlook for KKU programs.'}
          </p>
          <SignalsFeed items={feedItems} />
        </div>
      </section>
    </main>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const ai = a[i] as T;
    const aj = a[j] as T;
    a[i] = aj;
    a[j] = ai;
  }
  return a;
}

// Compact brand mark — four bubbles in 2×2 (BCG-matrix nod).
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

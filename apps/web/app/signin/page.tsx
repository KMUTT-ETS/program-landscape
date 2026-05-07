import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

// Sign-in page — editorial / institutional redesign (2026-05-07).
//
// Design intent (vs. the previous SaaS-default centred-card form):
//
//   1. Asymmetric two-column. Left ~55% is a brand panel led by the
//      Thai codename ทักษทัศน์ rendered at editorial scale — readable as
//      "this is a serious instrument owned by KKU", not "a generic SaaS
//      product".
//   2. The numbers strip (297 / 36 / 1) borrows the magazine-spread
//      "by the numbers" treatment. Reinforces what the application
//      actually does at a glance — no marketing copy needed.
//   3. Ambient BCG-matrix dot pattern in the lower-left echoes the
//      strategic matrix users will see post-login. Visual continuity
//      between sign-in and the home hero.
//   4. Right panel is compact and quiet. Form uses bottom-border
//      inputs (editorial / form-of-a-form), single accent button, and
//      a collapsed disclosure for the dev-credentials list (was a
//      noisy inline dump).
//   5. All colour from design tokens. Light / dark mode follow
//      automatically. No hardcoded hex anywhere on this surface.
export default function SignInPage() {
  const ssoConfigured = Boolean(
    process.env.KKU_SSO_ISSUER && process.env.KKU_SSO_CLIENT_ID,
  );
  const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';
  const env = process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'UAT';

  return (
    <main className="min-h-screen w-full grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(440px,560px)]">
      {/* ── Left: brand panel ──────────────────────────────────── */}
      <section className="relative overflow-hidden bg-surface-0 border-b lg:border-b-0 lg:border-r border-border-subtle lg:min-h-screen">
        {/* Ambient dot pattern — quiet BCG-matrix echo. Stays behind
            content, opacity dialled down. */}
        <BcgDotPattern />

        {/* Top-left: subtle wordmark — corner glyph + the platform
            full name in small caps. No K-in-circle. */}
        <div className="absolute left-6 top-6 lg:left-10 lg:top-10 z-10 flex items-center gap-3">
          <span aria-hidden className="text-text-primary text-2xl leading-none font-light">
            ◤
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
            KKU · Curriculum Intelligence Platform
          </span>
        </div>

        {/* Hero — Thai codename at scale, English caption below. The
            Thai script is the visual centrepiece on purpose. */}
        <div className="relative z-10 flex flex-col justify-center px-6 pt-24 pb-12 lg:pl-16 lg:pr-12 lg:py-32 lg:min-h-screen">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-accent-default mb-3">
            Curriculum Compass
          </div>
          <h1
            lang="th"
            className="text-6xl md:text-7xl lg:text-[88px] leading-[0.92] font-medium tracking-tight text-text-primary"
            style={{ fontFamily: 'var(--font-body-thai), var(--font-body)' }}
          >
            ทักษทัศน์
          </h1>
          <div className="mt-3 lg:mt-4 text-xl lg:text-2xl font-light tracking-tight text-text-secondary">
            Program Landscape
          </div>

          <p className="mt-6 lg:mt-8 max-w-md text-sm leading-relaxed text-text-secondary">
            A strategic decision-support instrument for the Khon Kaen University Council and top management. Programs are read against future trends, financial sustainability, and the demand the labour market actually has.
          </p>

          {/* Editorial "by the numbers" strip. Each cell is a quiet
              tabular figure with an even quieter caption. */}
          <div className="mt-10 lg:mt-12 flex items-end gap-6 lg:gap-10">
            <BigStat figure="297" caption="programs" />
            <Hairline />
            <BigStat figure="36" caption="faculties" />
            <Hairline />
            <BigStat figure="1" caption="mandate" />
          </div>

          {/* Editorial mandate line — only at lg. Mobile keeps the
              hero compact so the form is reachable without scrolling. */}
          <blockquote className="mt-12 lg:mt-16 max-w-md text-[13px] italic leading-relaxed text-text-tertiary border-l border-border-default pl-4 hidden lg:block">
            Decisions to close, merge, or launch academic programs are high-stakes
            and irreversible. The Council&apos;s remit is to ensure they are made
            on the strongest possible evidence — and to be seen to do so.
          </blockquote>
        </div>

        {/* Bottom meta strip — environment + the Thai phrase. Hidden
            on mobile (form's footer carries the institutional cue). */}
        <div className="absolute inset-x-0 bottom-0 z-10 hidden lg:flex items-center justify-between px-10 lg:px-16 py-5 text-[10px] font-mono uppercase tracking-[0.14em] text-text-tertiary border-t border-border-subtle">
          <span>{env} · v2026.05</span>
          <span lang="th" className="not-italic">มหาวิทยาลัยขอนแก่น</span>
        </div>
      </section>

      {/* ── Right: form panel ──────────────────────────────────── */}
      <section className="relative bg-surface-1 flex flex-col lg:min-h-screen">
        <div className="flex-1 flex flex-col justify-center px-6 py-12 lg:px-16 lg:py-16">
          <div className="max-w-sm w-full mx-auto">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary mb-1.5">
              Authenticate
            </div>
            <h2 className="text-3xl font-light tracking-tight text-text-primary">
              <span lang="th" className="font-normal">เข้าสู่ระบบ</span>
              <span className="ml-3 text-text-tertiary text-xl">·</span>
              <span className="ml-3">Sign in</span>
            </h2>
            <p className="mt-3 text-sm text-text-secondary">
              Use your KKU institutional account. Access is scoped to your role.
            </p>

            <div className="mt-10">
              <SignInForm
                ssoConfigured={ssoConfigured}
                localAuthEnabled={localAuthEnabled}
              />
            </div>
          </div>
        </div>

        {/* Footer rail — institutional touchpoints. */}
        <footer className="border-t border-border-subtle px-6 lg:px-16 py-5 text-[11px] text-text-tertiary flex flex-wrap items-center justify-between gap-2">
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
          <span className="font-mono uppercase tracking-[0.14em] lg:hidden">
            {env}
          </span>
          <span className="font-mono uppercase tracking-[0.14em] hidden lg:inline">
            Council-restricted
          </span>
        </footer>
      </section>
    </main>
  );
}

// ── Subcomponents ──────────────────────────────────────────────

function BigStat({ figure, caption }: { figure: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="text-[64px] leading-none font-light tracking-tight text-text-primary"
        style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
      >
        {figure}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {caption}
      </span>
    </div>
  );
}

function Hairline() {
  return (
    <span
      aria-hidden
      className="h-12 w-px bg-border-default mb-1.5"
    />
  );
}

// Subtle dotted-grid background. Echoes the BCG matrix that's the home
// hero post-login — "this is what's inside" rather than a stock pattern.
// Larger dots toward upper-right (where the post-login matrix shows
// "stars"), fading toward lower-left (the "dogs" quadrant). No words on
// it; pure ambient texture.
function BcgDotPattern() {
  const cols = 28;
  const rows = 22;
  const dots: Array<{ x: number; y: number; r: number; opacity: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Quadrant intensity: top-right gets bigger / more visible dots,
      // bottom-left gets nearly invisible. Mimics the strategic matrix.
      const xNorm = c / (cols - 1);
      const yNorm = r / (rows - 1);
      const upperRight = xNorm * (1 - yNorm);
      const lowerLeft = (1 - xNorm) * yNorm;
      const weight = upperRight - 0.5 * lowerLeft;
      const radius = 1.2 + Math.max(0, weight) * 3.0;
      const opacity = 0.10 + Math.max(0, weight) * 0.45;
      // Mild jitter on the centres so it doesn't read as graph paper
      const jx = (Math.sin((r * 31 + c * 17) * 0.6) * 0.5);
      const jy = (Math.cos((r * 19 + c * 23) * 0.5) * 0.5);
      dots.push({
        x: c * 32 + jx * 4,
        y: r * 32 + jy * 4,
        r: radius,
        opacity,
      });
    }
  }
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full pointer-events-none"
      preserveAspectRatio="xMidYMid slice"
      viewBox={`0 0 ${cols * 32} ${rows * 32}`}
    >
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          className="fill-accent-default"
          fillOpacity={d.opacity * 0.35}
        />
      ))}
    </svg>
  );
}

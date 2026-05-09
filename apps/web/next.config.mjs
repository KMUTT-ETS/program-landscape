/** @type {import('next').NextConfig} */

import bundleAnalyzer from '@next/bundle-analyzer';

// Bundle-analyzer is gated behind ANALYZE=true so the normal build
// stays fast. Run with: `ANALYZE=true pnpm --filter web build`. Reports
// land at apps/web/.next/analyze/{client,nodejs,edge}.html.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
});

// ──────────────────────────────────────────────────────────────────────
// Security headers.
//
// **CSP** is set per-request by `middleware.ts` (nonce-based, drops
// `'unsafe-inline'` on script-src). The static `headers()` block below
// no longer carries a CSP entry — middleware always wins for HTML
// responses.
//
// The remaining headers are baseline-static: HSTS / Frame-Options /
// Content-Type-Options / Referrer-Policy / Permissions-Policy. nginx
// also stamps them for safety (defence in depth across error pages).
// ──────────────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: `max-age=31536000; includeSubDomains; preload`,
        },
      ]
    : []),
];

// Dev-server LAN access — KKU staff often hit the dev server from
// other machines on the internal network. Next 14.2+ warns / blocks
// cross-origin /_next/* requests unless they're explicitly
// allow-listed.
//
// Only EXACT hostnames and `*.subdomain` patterns work — IP wildcards
// like `10.101.*` are silently rejected by Next's matcher (verified
// against next/dist/server/app-render/csrf-protection.js). So we
// either list IPs by hand or accept a comma-separated env override.
//
// In prod this field is ignored — the upstream KKU proxy handles
// cross-origin posture. To allow a new dev machine without a code
// change, set `NEXT_DEV_ALLOWED_ORIGINS=10.101.x.y,10.101.x.z` in
// `.env`.
const allowedDevOrigins = [
  'localhost',
  '127.0.0.1',
  '*.localhost',
  // Known KKU LAN dev clients. Add more IPs here, or use the env
  // override (NEXT_DEV_ALLOWED_ORIGINS) for ad-hoc additions.
  '10.101.111.233',
  ...(process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? []),
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@kku/ui', '@kku/design', '@kku/shared'],
  // Suppress the "Cross origin request detected" dev warning.
  allowedDevOrigins,
  // Emit a self-contained server bundle at `.next/standalone` so the
  // production Dockerfile can copy it without shipping `node_modules`.
  // Static assets live at `.next/static` and are copied alongside.
  output: 'standalone',
  // The monorepo root is two levels up from apps/web. Next uses this to
  // trace dependencies during the standalone build; without it, the
  // tracer walks to `/` which is wrong in our WSL2 / Docker layout.
  // Top-level placement triggers a "Unrecognized key" warning in Next 14.2
  // but works correctly; moving it into `experimental` actually changes
  // dev-mode module resolution and breaks Prisma tagged-template parsing
  // for some workspace-imported files. Verified by repro 2026-05-09 —
  // do NOT move into `experimental` until Next 15 upgrade.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  experimental: {
    typedRoutes: true,
    // Critical: mark `@prisma/client` as an external server package so Next
    // loads it from disk at RUNTIME (single instance) instead of bundling it
    // separately per Webpack context (rsc / action-browser / etc).
    //
    // Without this, each Webpack context bundles its own copy of
    // @prisma/client. `Prisma.sql\`...\`` evaluated in one context produces a
    // Sql object whose `instanceof Prisma.Sql` check fails inside another
    // context's `$queryRaw` — Prisma then mis-handles the value as a string,
    // Postgres rejects the SQL with `syntax error at or near "$1"`, and the
    // home dashboard 500s on every authenticated request.
    //
    // Verified fix 2026-05-09. Reproducible bug pre-existing on HEAD.
    serverComponentsExternalPackages: ['@prisma/client', '@kku/db'],
  },
  async headers() {
    return [
      {
        // Apply to every route — CSP + HSTS are global.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);

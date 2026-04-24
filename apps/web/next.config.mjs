/** @type {import('next').NextConfig} */

// ──────────────────────────────────────────────────────────────────────
// Security headers (Prompt 13 hardening).
//
// CSP posture:
//   - default-src 'self' — baseline
//   - script-src: Next requires 'unsafe-inline' for its bootstrap payloads
//     and 'unsafe-eval' in dev for HMR. In prod we drop 'unsafe-eval'.
//   - style-src 'self' 'unsafe-inline' — Tailwind emits inline styles
//     through its JIT runtime; tightening requires a nonce pipeline.
//   - img-src 'self' data: blob: — charts/icons and react-pdf thumbnails
//     use data: and blob:.
//   - font-src 'self' data: — fonts ship from /public.
//   - connect-src 'self' + API host — keep the API on the same origin in
//     prod via nginx so this stays tight.
//   - frame-ancestors 'none' — embedding blocked.
//
// HSTS enforced at this layer for the HTML response; also at NestJS and
// nginx for the API.
// ──────────────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production';

const cspDirectives = [
  `default-src 'self'`,
  // Next.js bootstrap needs inline; dev additionally needs eval for HMR.
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${process.env.PUBLIC_API_ORIGIN ?? ''}`.trim(),
  `worker-src 'self' blob:`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: cspDirectives },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: `max-age=${60 * 60 * 24 * 180}; includeSubDomains`,
        },
      ]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@kku/ui', '@kku/design', '@kku/shared'],
  experimental: {
    typedRoutes: true,
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

export default nextConfig;

import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import './globals.css';

// 2026-05-02 redesign: typography pairing — Sarabun primary.
//
// - **Sarabun** is now the primary UI font (was Thai-only fallback before).
//   Loaded with both `thai` + `latin` subsets so a single typeface handles
//   the whole interface; the `--font-body` token in tokens.css lists it
//   first. Screen ↔ print continuity preserved with the Cabinet-mandated
//   TH Sarabun New (PDF generation; same family, official cut).
// - **Inter** retained as a Latin fallback for screens where Sarabun's
//   Latin glyphs feel awkward (tight-tracked nav chrome, etc.).
// - **JetBrains Mono** for tabular numerics — metric cards, data
//   tables, timestamps. Paired with font-variant-numeric: tabular-nums.
//
// All three with display: swap to prevent FOIT.
//
// Self-hosted from public/fonts (2026-10-04): next/font/google downloads the
// files at BUILD time, and the v2.1.1 release build failed when DNS for
// fonts.gstatic.com dropped inside the build container. Local files make the
// build independent of Google. Same faces: Sarabun TTFs carry the full Thai
// block + Latin; Inter and JetBrains Mono are Google's own latin-subset
// variable woff2 files. All three are SIL OFL 1.1.

const bodyLatin = localFont({
  src: '../public/fonts/inter/Inter-latin-variable.woff2',
  weight: '400 700',
  variable: '--font-body-latin',
  display: 'swap',
});

const bodyThai = localFont({
  src: [
    { path: '../public/fonts/sarabun/Sarabun-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../public/fonts/sarabun/Sarabun-Medium.ttf', weight: '500', style: 'normal' },
    { path: '../public/fonts/sarabun/Sarabun-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: '../public/fonts/sarabun/Sarabun-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-body-thai',
  display: 'swap',
});

const mono = localFont({
  src: '../public/fonts/jetbrains-mono/JetBrainsMono-latin-variable.woff2',
  weight: '400 600',
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Program Landscape — KKU Curriculum Intelligence Platform',
    template: '%s — KKU Curriculum Intelligence Platform',
  },
  description:
    'Program Landscape · a KKU Curriculum Intelligence Platform module — strategic decision-support for the University Council.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${bodyLatin.variable} ${bodyThai.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

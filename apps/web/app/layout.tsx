import type { Metadata } from 'next';
import { Inter, Sarabun, JetBrains_Mono } from 'next/font/google';
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

const bodyLatin = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-latin',
  display: 'swap',
});

const bodyThai = Sarabun({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body-thai',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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

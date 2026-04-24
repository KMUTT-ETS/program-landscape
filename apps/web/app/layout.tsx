import type { Metadata } from 'next';
import { Inter, Sarabun, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

// 2026-04-24 redesign: typography pairing.
//
// - **Inter** for Latin UI chrome — the de-facto SaaS sans, excellent
//   OpenType features (tabular figures, contextual alternates).
// - **Sarabun** for Thai — matches the Cabinet-mandated doc font the
//   PDFs already use, so screen ↔ print feel continuous. When the
//   browser is rendering a block tagged `lang="th"` or `.lang-th`, it
//   picks up Sarabun first via the --font-body-th fallback.
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

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'KKU Curriculum Landscape',
  description: 'Strategic decision-support platform for Khon Kaen University Council',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

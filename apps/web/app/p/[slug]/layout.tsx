import * as React from 'react';

// No-chrome layout for public profile pages. The root layout
// (apps/web/app/layout.tsx) already supplies <html> + <body> +
// theme provider + fonts; this file just removes the authenticated
// app shell (sidebar, top bar) and wraps content in a centred
// container so it reads cleanly at any width.
export default function PublicProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-0">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-12">
        {children}
      </main>
      <footer className="border-t border-border-subtle bg-surface-1/40 py-6 text-center text-xs text-text-tertiary">
        <span>
          Powered by{' '}
          <a
            href="/"
            className="font-medium text-text-secondary hover:text-accent-default hover:underline"
          >
            KKU Curriculum Landscape
          </a>
        </span>
      </footer>
    </div>
  );
}

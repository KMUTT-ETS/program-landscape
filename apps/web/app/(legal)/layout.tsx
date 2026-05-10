import * as React from 'react';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { CopyrightFooter } from '@/components/copyright-footer';

// Route-group layout for the legal pages — /copyright, /terms,
// /disclaimer. Authenticated visitors get the normal app shell so they
// can navigate back via the sidebar; signed-out visitors get a
// minimal no-chrome layout. Either way the copyright footer renders
// at the bottom.
export default async function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;

  if (user?.userId) {
    return <AuthedAppShell user={user}>{children}</AuthedAppShell>;
  }

  return (
    <div className="min-h-screen bg-surface-0">
      <header className="border-b border-border-subtle bg-surface-1/40 py-4">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 md:px-8">
          <Link
            href="/"
            className="text-sm font-semibold text-text-primary hover:text-accent-default"
          >
            KKU Curriculum Landscape
          </Link>
          <Link
            href="/signin"
            className="text-xs font-medium text-text-secondary hover:text-accent-default"
          >
            Sign in →
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-10 md:px-8 md:py-14">
        {children}
      </main>
      <footer className="border-t border-border-subtle bg-surface-1/40 py-6">
        <CopyrightFooter />
      </footer>
    </div>
  );
}

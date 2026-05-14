import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { isAdminGrade, type SessionUser } from '@kku/shared';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { StyleguideCatalog } from './catalog';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Styleguide' };

// Admin-only in production, public in dev. This page is the visual
// contract: every primitive, in both themes + all three densities.

export default async function StyleguidePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  if (process.env.NODE_ENV === 'production' && !isAdminGrade(user.effectiveRole ?? user.role)) {
    redirect('/no-access');
  }

  return (
    <AuthedAppShell user={user}>
      <StyleguideCatalog />
    </AuthedAppShell>
  );
}

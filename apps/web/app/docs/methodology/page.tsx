import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { MethodologyClient } from './client';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Methodology — Program Health & Lifecycle',
  description:
    'Public reference paper for the program health score and lifecycle verdict produced by Curriculum Landscape. English / Thai.',
};

type Lang = 'en' | 'th';

export default async function MethodologyPage({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  // ?lang=th switches to Thai; everything else (including missing) is en.
  const lang: Lang = searchParams.lang === 'th' ? 'th' : 'en';

  return (
    <AuthedAppShell user={user}>
      <MethodologyClient initialLang={lang} />
    </AuthedAppShell>
  );
}

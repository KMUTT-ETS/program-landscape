import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { isAdminGrade } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { PageHeader } from '@kku/ui';
import type { Lang } from '@/components/lang-toggle';
import { LangToggle } from './lang-toggle';
import { AcknowledgementsList } from './list';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Acknowledgements — Program Landscape',
  description: 'Organisations whose data and support Program Landscape is built on.',
};

export default async function AcknowledgementsPage({
  searchParams,
}: {
  searchParams: { lang?: string };
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const lang: Lang = searchParams.lang === 'th' ? 'th' : 'en';
  // Why this is gated: see the comment at the point of use in list.tsx.
  const showDetailLinks = isAdminGrade(user.effectiveRole ?? user.role);

  return (
    <AuthedAppShell user={user}>
      <PageHeader
        title="Acknowledgements"
        subtitle="Partner organisations whose contributions the platform is built on."
      />
      <div className="flex flex-col gap-4">
        <LangToggle lang={lang} />
        <AcknowledgementsList lang={lang} showDetailLinks={showDetailLinks} />
      </div>
    </AuthedAppShell>
  );
}

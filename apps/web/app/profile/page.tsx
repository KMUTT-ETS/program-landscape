import { redirect } from 'next/navigation';
import type { SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { getProfileData } from '@/lib/profile-data';
import { ProfileView } from './profile-view';

// Profile page — modern academic-resume layout for the signed-in user.
// Server-renders all the static data (basic info, education, research
// summary, curriculum, publications) and embeds a client component
// for the bilingual TH/EN toggle + AI expertise narrative loader.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My profile' };

export default async function ProfilePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const profile = await getProfileData(user.userId);

  return (
    <AuthedAppShell user={user}>
      <ProfileView profile={profile} userEmail={user.email} />
    </AuthedAppShell>
  );
}

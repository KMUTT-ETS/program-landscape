import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import type { SessionUser, PublicProfileState } from '@kku/shared';
import { auth } from '@/lib/auth';
import { prisma } from '@kku/db';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { getProfileData } from '@/lib/profile-data';
import { ShareCard } from '@/components/profile/share-card';
import { ProfileView } from './profile-view';

// Profile page — modern academic-resume layout for the signed-in user.
// Server-renders all the static data (basic info, education, research
// summary, curriculum, publications) and embeds a client component
// for the bilingual TH/EN toggle + AI expertise narrative loader.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My profile' };

const APP_ORIGIN_ENV = process.env.NEXT_PUBLIC_APP_ORIGIN ?? null;

export default async function ProfilePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const [profile, share] = await Promise.all([
    getProfileData(user.userId),
    prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        publicProfileEnabled: true,
        publicProfileSlug: true,
        publicProfileIndexable: true,
        publicProfileUpdatedAt: true,
      },
    }),
  ]);

  const initial: PublicProfileState = {
    enabled: share?.publicProfileEnabled ?? false,
    slug: share?.publicProfileSlug ?? null,
    indexable: share?.publicProfileIndexable ?? true,
    updatedAt: share?.publicProfileUpdatedAt?.toISOString() ?? null,
  };

  // Origin: prefer the env override (canonical KKU URL); fall back
  // to the Host header so localhost dev still produces working links.
  const hdr = await headers();
  const origin =
    APP_ORIGIN_ENV ??
    (hdr.get('x-forwarded-proto') && hdr.get('host')
      ? `${hdr.get('x-forwarded-proto')}://${hdr.get('host')}`
      : `http://${hdr.get('host') ?? 'localhost:3000'}`);

  let qrSvg: string | null = null;
  let publicUrl: string | null = null;
  if (initial.enabled && initial.slug) {
    publicUrl = `${origin}/p/${initial.slug}`;
    qrSvg = await QRCode.toString(publicUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }

  return (
    <AuthedAppShell user={user}>
      <ShareCard
        initial={initial}
        qrSvg={qrSvg}
        publicUrl={publicUrl}
        origin={origin}
      />
      <ProfileView profile={profile} userEmail={user.email} />
    </AuthedAppShell>
  );
}

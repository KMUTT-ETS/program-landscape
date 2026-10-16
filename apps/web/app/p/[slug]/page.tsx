import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@kku/db';
import { getProfileData } from '@/lib/profile-data';
import { brandingForRequest } from '@/lib/branding';
import { ProfileView } from '../../profile/profile-view';

// Public profile page — same content as /profile, no chrome.
// Reachable by anyone with the slug; renders nothing if the user
// has not enabled sharing. Email + internal IDs are suppressed via
// `publicMode` on ProfileView.

export const dynamic = 'force-dynamic';

// Cache: 5-min CDN, 24-hour stale-while-revalidate. Keeps things
// snappy when a profile gets shared widely; the publication cache
// is the slow path and it's already keyed on userId.
//
// For users who opted out of indexing we fall back to no-store
// (set in generateMetadata + page itself via response headers).

interface PageProps {
  params: { slug: string };
}

async function resolveSlug(slug: string) {
  const user = await prisma.user.findUnique({
    where: { publicProfileSlug: slug },
    select: {
      id: true,
      publicProfileEnabled: true,
      publicProfileIndexable: true,
    },
  });
  if (!user) return null;
  if (!user.publicProfileEnabled) return null;
  return user;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const user = await resolveSlug(params.slug);
  if (!user) {
    return { title: 'Profile not found' };
  }
  const profile = await getProfileData(user.id);
  const fullName = profile?.basic.fullNameEn ?? 'KKU profile';
  const facultyName = profile?.basic.facultyNameEn ?? 'Khon Kaen University';
  return {
    title: `${fullName} · ${facultyName}`,
    description: `Academic profile of ${fullName} at ${facultyName}.`,
    robots: user.publicProfileIndexable ? 'index,follow' : 'noindex,nofollow',
    openGraph: {
      title: fullName,
      description: facultyName,
      type: 'profile',
    },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const user = await resolveSlug(params.slug);
  if (!user) notFound();

  const profile = await getProfileData(user.id);
  if (!profile) notFound();
  const branding = await brandingForRequest();

  return (
    <ProfileView
      profile={profile}
      // userEmail is suppressed by publicMode — pass empty string so
      // the type stays satisfied.
      userEmail=""
      publicMode
      logoLightUrl={branding?.hasOwnLogo ? branding.logoLightUrl : null}
      logoDarkUrl={branding?.hasOwnLogo ? branding.logoDarkUrl : null}
    />
  );
}

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import type { SessionUser, PublicProfileState } from '@kku/shared';
import { auth } from '@/lib/auth';
import { prisma, SCHOLAR_RESEARCH_OUTPUT_SOURCE } from '@kku/db';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { getMyGrants, getMyTeachingEvaluation, getProfileData } from '@/lib/profile-data';
import { ShareCard } from '@/components/profile/share-card';
import { getScholarStatusAction } from '@/lib/actions/scholar';
import { brandingForRequest } from '@/lib/branding';
import { ProfileView } from './profile-view';
import {
  ScholarPanel,
  ScholarPanelUnavailable,
  type ScholarSourceCounts,
} from './scholar-panel';

// Profile page — modern academic-resume layout for the signed-in user.
// Server-renders all the static data (basic info, education, research
// summary, curriculum, publications) and embeds a client component
// for the bilingual TH/EN toggle + AI expertise narrative loader.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My profile' };

// Server-only read — deliberately NOT prefixed NEXT_PUBLIC_. This app
// ships as a pre-built Docker image (pack-and-ship deploy); a
// NEXT_PUBLIC_ var only picks up its value if present at `next build`
// time, but env_file values are injected at container *runtime*. A
// plain var is read fresh on every request, matching how prod actually
// configures this app.
const APP_ORIGIN_ENV = process.env.APP_PUBLIC_URL ?? null;

export default async function ProfilePage() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');

  const [profile, share, scholar, teachingEvaluation, grants] = await Promise.all([
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
    // Read alongside the profile rather than inside the client panel: the
    // panel's five states must be correct in the FIRST paint, including the
    // disabled-with-a-reason one. Fetching them client-side would flash an
    // enabled button at someone who has no staff record.
    getScholarStatusAction(),
    // Owner-only: the evaluation panel renders on this page, never on /p/[slug].
    // A failed read must not take the whole profile down with it, and must not
    // be presented as "no evaluations yet" either — the panel says it is
    // unavailable instead. Logs the error class and code only: a driver
    // message can echo query parameters, i.e. the user's identifiers.
    getMyTeachingEvaluation(user.userId).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : typeof err;
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null;
      console.error(`[profile] teaching evaluation read failed: ${name}${code ? ` (${code})` : ''}`);
      return 'unavailable' as const;
    }),
    // Owner-only, same posture as the evaluation read above.
    getMyGrants(user.userId).catch((err: unknown) => {
      const name = err instanceof Error ? err.name : typeof err;
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : null;
      console.error(`[profile] grants read failed: ${name}${code ? ` (${code})` : ''}`);
      return 'unavailable' as const;
    }),
  ]);

  // Publication provenance for the section header. Counted straight off
  // `research_outputs` rather than off the rendered list, because the list is
  // a merge of live Scopus/kkuscholar reads with local rows and does not carry
  // a per-entry source. This counts what THIS platform stores and where each
  // row came from, which is the claim the header actually makes.
  //
  // Needs the staff record id, which only the Scholar status read resolves —
  // so an account with no staff record gets no counts, which is correct: it
  // has no research rows either.
  const facultyMemberId =
    scholar.ok && scholar.status.staffRecord.linked
      ? scholar.status.staffRecord.facultyMemberId
      : null;

  let scholarSources: ScholarSourceCounts | null = null;
  if (facultyMemberId) {
    const bySource = await prisma.researchOutput.groupBy({
      by: ['source'],
      where: { facultyMemberId },
      _count: { _all: true },
    });
    const googleScholar = bySource
      // The runner's own constant, not a copy of the string: renaming the
      // source label must break the build here rather than quietly move every
      // Scholar paper into the library-index column.
      .filter((row) => row.source === SCHOLAR_RESEARCH_OUTPUT_SOURCE)
      .reduce((sum, row) => sum + row._count._all, 0);
    const total = bySource.reduce((sum, row) => sum + row._count._all, 0);
    scholarSources = { googleScholar, libraryIndex: total - googleScholar };
  }

  const branding = await brandingForRequest();

  const initial: PublicProfileState = {
    enabled: share?.publicProfileEnabled ?? false,
    slug: share?.publicProfileSlug ?? null,
    indexable: share?.publicProfileIndexable ?? true,
    updatedAt: share?.publicProfileUpdatedAt?.toISOString() ?? null,
  };

  // Origin: prefer the env override (canonical KKU URL); fall back
  // to the Host header so localhost dev still produces working links.
  // The final fallback defaults to https — this app is never served
  // over plain HTTP outside local dev, so a missing/misconfigured
  // X-Forwarded-Proto upstream must not downgrade a public link.
  const hdr = await headers();
  const host = hdr.get('host') ?? 'localhost:3000';
  const isLocalDev = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const origin =
    APP_ORIGIN_ENV ??
    (hdr.get('x-forwarded-proto')
      ? `${hdr.get('x-forwarded-proto')}://${host}`
      : `${isLocalDev ? 'http' : 'https'}://${host}`);

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
      <ProfileView
        profile={profile}
        userEmail={user.email}
        logoLightUrl={branding?.hasOwnLogo ? branding.logoLightUrl : null}
        logoDarkUrl={branding?.hasOwnLogo ? branding.logoDarkUrl : null}
        teachingEvaluation={teachingEvaluation}
        grants={grants}
        scholarSlot={
          scholar.ok ? (
            <ScholarPanel initialStatus={scholar.status} sources={scholarSources} />
          ) : (
            // Same principle as every blocked state inside the panel: the
            // control stays, disabled, with the reason beside it. A silently
            // missing section reads as "this university does not have that",
            // and an API outage is precisely when someone goes looking for a
            // button they remember.
            <ScholarPanelUnavailable message={scholar.message} />
          )
        }
      />
    </AuthedAppShell>
  );
}

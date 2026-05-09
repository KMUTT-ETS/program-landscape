import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';
import { EXPERTISE_NARRATIVE_VERSION } from '@kku/shared';
import { getProfileData } from '@/lib/profile-data';
import { generateExpertiseNarrative } from '@/lib/profile-narrative';
import { prisma } from '@kku/db';

// Generates the AI expertise narrative for the signed-in user.
// Pulls the same `getProfileData(userId)` payload the page renders,
// then converts it to the LLM input shape and calls AiService.
//
// Always Node runtime — Prisma + provider SDKs aren't Edge-safe.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
      { status: 401 },
    );
  }

  const profile = await getProfileData(user.userId);
  if (!profile) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Profile not found' } },
      { status: 404 },
    );
  }

  // The expertise extractor reads ONLY education + publication titles.
  // Everything else (counts, citations, venues, programs, basic info)
  // is on the page — passing it would invite the model to restate it.
  //
  // Title order: most-cited first (a soft hint that those papers
  // represent the strongest recurring themes). Capped at 30 — enough
  // signal without blowing the prompt budget.
  const titles = [...profile.publications]
    .sort((a, b) => b.citations - a.citations || b.year - a.year)
    .slice(0, 30)
    .map((p) => p.title);

  // Education: compact "<degree>, <institute>" form. Year omitted —
  // the prompt cares about WHAT was studied, not WHEN.
  const education = profile.education.map((e) => {
    const parts = [e.qualification];
    if (e.institute && !e.qualification.includes(e.institute)) {
      parts.push(e.institute);
    }
    return parts.filter(Boolean).join(', ');
  });

  // Resolve facultyMemberId for the AiInference source-id.
  const facultyMemberId = await resolveFacultyMemberId(user.userId);

  const narrative = await generateExpertiseNarrative(
    { education, publicationTitles: titles },
    { userId: user.userId, facultyMemberId },
  );

  // Persist (upsert by userId + methodVersion) so subsequent profile
  // loads serve from cache. Confidence=0 indicates the placeholder
  // path (no AI key); we still cache it so the page doesn't auto-fire
  // a guaranteed-empty regeneration on every visit.
  try {
    await prisma.userExpertiseNarrative.upsert({
      where: {
        userId_methodVersion: {
          userId: user.userId,
          methodVersion: EXPERTISE_NARRATIVE_VERSION,
        },
      },
      update: {
        narrativeTh: narrative.narrativeTh,
        narrativeEn: narrative.narrativeEn,
        expertiseKeywordsTh: narrative.expertiseKeywordsTh,
        expertiseKeywordsEn: narrative.expertiseKeywordsEn,
        confidence: narrative.confidence,
        generatedAt: new Date(),
      },
      create: {
        userId: user.userId,
        methodVersion: EXPERTISE_NARRATIVE_VERSION,
        narrativeTh: narrative.narrativeTh,
        narrativeEn: narrative.narrativeEn,
        expertiseKeywordsTh: narrative.expertiseKeywordsTh,
        expertiseKeywordsEn: narrative.expertiseKeywordsEn,
        confidence: narrative.confidence,
      },
    });
  } catch (err) {
    // Cache write failed — return the narrative anyway. Subsequent
    // visits will retry the generation; the user still sees a result
    // on this visit.
    console.error('[profile-narrative] failed to persist:', err);
  }

  return NextResponse.json({
    narrative,
    methodVersion: EXPERTISE_NARRATIVE_VERSION,
    generatedAt: new Date().toISOString(),
  });
}

async function resolveFacultyMemberId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employeeId: true },
  });
  if (!user?.employeeId) return null;
  const member = await prisma.facultyMember.findFirst({
    where: { employeeId: user.employeeId, isActive: true },
    select: { id: true },
  });
  return member?.id ?? null;
}

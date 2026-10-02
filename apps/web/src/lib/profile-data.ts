// /profile page data — a thin user-keyed wrapper over buildStaffProfile in
// @kku/db (packages/db/src/staff-profile/profile.ts), which the external
// staff-profile API also calls. What stays here is what belongs to the
// SIGNED-IN USER rather than to the staff record: the account email, the
// uploaded avatar, the cached AI narrative, and the fallback for accounts that
// resolve to no staff record.
import {
  buildStaffProfile,
  emptyResearchSummary,
  getStaffGrants,
  getStaffPublicationsSnapshot,
  getStaffTeachingEvaluation,
  prisma,
  resolveFacultyMemberForUser,
  type StaffPublicationsSnapshot,
} from '@kku/db';
import { EXPERTISE_NARRATIVE_VERSION, type StaffGrantsSummary } from '@kku/shared';
import type { ProfileBasicInfo, ProfileData } from './profile-types';
import type { TeachingEvaluationSummary } from './teaching-evaluation-summary';

export type {
  CurriculumProgram,
  EducationEntry,
  FacultyRankCode,
  ProfileBasicInfo,
  ProfileData,
  PublicationEntry,
  ResearchSummary,
} from './profile-types';
// `formatApa` lives in `./profile-types` so client components can use
// it without dragging Prisma into the browser bundle. Re-exported here
// for callers that already pull `getProfileData` from this module.
export { formatApa } from './profile-types';

/** The page shows the top ten courses; the external API shows all of them. */
const PAGE_COURSE_LIMIT = 10;

/**
 * Build the profile-page payload for a signed-in user. Returns null
 * when the User row can't be located — the page renders an "account
 * not yet provisioned" placeholder in that case.
 */
export async function getProfileData(userId: string): Promise<ProfileData | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      employeeId: true,
      avatarStorageKey: true,
      avatarUpdatedAt: true,
      faculty: { select: { nameTh: true, nameEn: true } },
    },
  });
  if (!user) return null;

  // Build the avatar URL — null when no photo uploaded. The
  // `?v=<timestamp>` cache-buster forces the browser to refetch
  // after a new upload without needing manual reload.
  const avatarUrl = user.avatarStorageKey
    ? `/api/profile/avatar/${user.id}?v=${user.avatarUpdatedAt?.getTime() ?? 0}`
    : null;

  // Cached AI narrative — keyed by (userId, methodVersion). Filtered to
  // the CURRENT method version (fixed 2026-08-17): the model's own doc
  // comment on UserExpertiseNarrative claims a version bump "shadows"
  // the old row on the next profile view, but the query previously read
  // "most recent row for this user, ANY version" — a user with a cached
  // v2 (Thai) row would keep seeing it indefinitely after the v3
  // (English-only) bump, since ExpertiseNarrativeSection only auto-fires
  // regeneration when NO cached row exists at all. Filtering here is
  // what actually makes the "shadows the old" claim true: an old-version
  // row is now treated as absent, so the profile page's existing
  // auto-fire-on-no-cache logic regenerates it under the new method on
  // next view, with no client-side changes needed.
  const cachedNarrativeRow = await prisma.userExpertiseNarrative.findFirst({
    where: { userId: user.id, methodVersion: EXPERTISE_NARRATIVE_VERSION },
    orderBy: { generatedAt: 'desc' },
  });
  const cachedNarrative = cachedNarrativeRow
    ? {
        narrativeEn: cachedNarrativeRow.narrativeEn,
        expertiseKeywordsTh: cachedNarrativeRow.expertiseKeywordsTh,
        expertiseKeywordsEn: cachedNarrativeRow.expertiseKeywordsEn,
        confidence: cachedNarrativeRow.confidence,
        generatedAt: cachedNarrativeRow.generatedAt.toISOString(),
        methodVersion: cachedNarrativeRow.methodVersion,
      }
    : null;

  const memberId = await resolveFacultyMemberForUser(user);
  const staff = memberId
    ? await buildStaffProfile(memberId, { courseLimit: PAGE_COURSE_LIMIT })
    : null;

  if (!staff) {
    // Graceful degradation: render the basic section with whatever's
    // on the User row + empty sections for everything else.
    return {
      hasFacultyMemberRecord: false,
      basic: userOnlyBasicInfo(user, avatarUrl),
      education: [],
      research: emptyResearchSummary(),
      curriculum: [],
      publications: [],
      teaching: null,
      talent: null,
      cachedNarrative,
    };
  }

  return {
    hasFacultyMemberRecord: true,
    basic: { ...staff.basic, email: user.email, avatarUrl },
    education: staff.education,
    research: staff.research,
    curriculum: staff.curriculum,
    publications: staff.publications,
    teaching: staff.teaching,
    talent: staff.talent,
    cachedNarrative,
  };
}

/** An account that resolves to no staff record — render what the User row has. */
function userOnlyBasicInfo(
  user: { email: string; name: string | null; faculty: { nameTh: string; nameEn: string } | null },
  avatarUrl: string | null,
): ProfileBasicInfo {
  // No FacultyMember match — render whatever's on the User row.
  return {
    fullNameTh: user.name ?? user.email,
    fullNameEn: user.name ?? user.email,
    rankLabelTh: '—',
    rankLabelEn: '—',
    facultyNameTh: user.faculty?.nameTh ?? null,
    facultyNameEn: user.faculty?.nameEn ?? null,
    departmentNameTh: null,
    departmentNameEn: null,
    email: user.email,
    orcid: null,
    scopusAuthorId: null,
    openalexAuthorId: null,
    // No FacultyMember row, so no Scholar binding can exist: the binding lives
    // on FacultyMember and the sync refuses outright without one.
    scholarProfileId: null,
    avatarUrl,
  };
}

export type HomePublicationsSnapshot = StaffPublicationsSnapshot;

/**
 * Home-page sparkline — null for accounts that are not matched to a staff
 * record (admins, viewers, students); the caller renders a non-academic
 * placeholder card in that case.
 */
export async function getHomePublicationsSnapshot(
  userId: string,
): Promise<HomePublicationsSnapshot | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { employeeId: true, name: true },
  });
  if (!user) return null;
  const memberId = await resolveFacultyMemberForUser(user);
  return memberId ? getStaffPublicationsSnapshot(memberId) : null;
}

/**
 * The signed-in user's own teaching-evaluation summary for the /profile panel.
 * Server-only; never called for /p/[slug]. Visibility: a user's own data
 * (instructorPersonal does no permission check — this function's only caller
 * passes the session's own user id).
 */
export async function getMyTeachingEvaluation(userId: string): Promise<TeachingEvaluationSummary | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true, name: true } });
  if (!user) return null;
  const memberId = await resolveFacultyMemberForUser(user);
  if (!memberId) return null;
  return getStaffTeachingEvaluation(memberId);
}

/** The signed-in user's own grants for the /profile panel. Server-only; never
 *  called for /p/[slug]. 'unlinked' when the account resolves to no staff record. */
export async function getMyGrants(userId: string): Promise<StaffGrantsSummary | 'unlinked'> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true, name: true } });
  if (!user) return 'unlinked';
  const memberId = await resolveFacultyMemberForUser(user);
  if (!memberId) return 'unlinked';
  return getStaffGrants(memberId);
}

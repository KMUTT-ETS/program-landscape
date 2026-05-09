// Resolves the avatar + rank-prefixed display name for a User. Used
// by the top-right user dropdown and the bottom-left nav footer.
//
// Bridges User.employeeId → FacultyMember → StaffEducationHistory
// (for doctorate detection). Avatar URL comes directly off the User
// row — every user can upload a photo, even non-faculty admins.
//
// Lightweight: only the fields the chrome needs. `getProfileData`
// handles the same bridge but also fetches papers + runs a
// kkuscholar query — too heavy to call on every page.

import { prisma } from '@kku/db';

export interface UserChrome {
  /** Rank-prefixed Thai/English name. Null when the user isn't on
   *  the HR roster (admin-only accounts) — caller falls back to the
   *  bare `user.name` from SSO claims. */
  name: { th: string; en: string } | null;
  /** URL to the user's uploaded profile photo. Null when never
   *  uploaded — caller renders initials. */
  avatarUrl: string | null;
}

const RANK_PREFIX_TH: Record<'PROF' | 'ASSOC_PROF' | 'ASST_PROF' | 'LECTURER', string> = {
  PROF: 'ศ.',
  ASSOC_PROF: 'รศ.',
  ASST_PROF: 'ผศ.',
  LECTURER: 'อ.',
};

const RANK_PREFIX_EN: Record<'PROF' | 'ASSOC_PROF' | 'ASST_PROF' | 'LECTURER', string> = {
  PROF: 'Prof.',
  ASSOC_PROF: 'Assoc. Prof.',
  ASST_PROF: 'Asst. Prof.',
  LECTURER: 'Lect.',
};

const DOCTORATE_RX = /ph\.?\s*d|doctor|doctoral|ปริญญาเอก|ดุษฎีบัณฑิต|ดร\./i;

/**
 * Returns the avatar URL + rank-prefixed display name for a User.
 * Both fields are nullable — every user can have an avatar; only
 * faculty/staff have a rank-prefixed name.
 */
export async function resolveUserChrome(userId: string): Promise<UserChrome> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      employeeId: true,
      avatarStorageKey: true,
      avatarUpdatedAt: true,
    },
  });
  if (!user) return { name: null, avatarUrl: null };

  const avatarUrl = user.avatarStorageKey
    ? `/api/profile/avatar/${userId}?v=${user.avatarUpdatedAt?.getTime() ?? 0}`
    : null;

  if (!user.employeeId) return { name: null, avatarUrl };

  const member = await prisma.facultyMember.findFirst({
    where: { employeeId: user.employeeId, isActive: true },
    select: {
      rank: true,
      nameTh: true,
      nameEn: true,
      academicQualification: true,
      citizenIdHash: true,
    },
  });
  if (!member) return { name: null, avatarUrl };

  // Doctorate detection: prefer DS2003 records (authoritative); fall
  // back to the freeform academicQualification string.
  let hasDoctorate = DOCTORATE_RX.test(member.academicQualification ?? '');
  if (!hasDoctorate && member.citizenIdHash) {
    const eduRows = await prisma.staffEducationHistory.findMany({
      where: { citizenIdHash: member.citizenIdHash },
      select: { gradLevelName: true, gradCurriculum: true },
    });
    hasDoctorate = eduRows.some((r) =>
      DOCTORATE_RX.test(`${r.gradCurriculum ?? ''} ${r.gradLevelName ?? ''}`),
    );
  }

  const drTh = hasDoctorate ? ' ดร.' : '';
  const drEn = hasDoctorate ? ' Dr.' : '';
  const th = `${RANK_PREFIX_TH[member.rank]}${drTh} ${member.nameTh}`.replace(/\s+/g, ' ').trim();
  const en = `${RANK_PREFIX_EN[member.rank]}${drEn} ${member.nameEn}`.replace(/\s+/g, ' ').trim();
  return { name: { th, en }, avatarUrl };
}

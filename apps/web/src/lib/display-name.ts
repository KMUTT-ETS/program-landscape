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

// Honorifics emitted by SSONext's firstName/lastName claims. Stripped
// before a name-based FacultyMember lookup so e.g. "นาย เด่นพงษ์
// สุดภักดี" (User.name from SSO) matches FacultyMember.nameTh =
// "เด่นพงษ์ สุดภักดี". Mirrors the table in apps/web/src/lib/profile-data.ts.
const TITLE_PREFIXES = new Set([
  'นาย', 'นาง', 'นางสาว', 'น.ส.', 'ดร.', 'ดร', 'อ.', 'อาจารย์',
  'ผศ.', 'รศ.', 'ศ.', 'ผศ', 'รศ', 'ศ',
  'Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Dr',
  'Prof.', 'Asst.', 'Assoc.',
]);

function stripTitlePrefixes(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && TITLE_PREFIXES.has(tokens[0]!)) {
    tokens.shift();
  }
  return tokens.join(' ');
}

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

  // Try employeeId first (the canonical bridge — set by the SSO callback
  // from the SSONext /auth.token claim). When it doesn't match (e.g.,
  // FM.employee_id is a SHA256 hash from kku-hr while User.employee_id
  // is the cleartext from SSO; or admin-created users with no
  // employeeId), fall back to a Thai-name match — mirrors the same
  // chain used by /profile (apps/web/src/lib/profile-data.ts).
  let member = user.employeeId
    ? await prisma.facultyMember.findFirst({
        where: { employeeId: user.employeeId, isActive: true },
        select: {
          rank: true,
          nameTh: true,
          nameEn: true,
          academicQualification: true,
          citizenIdHash: true,
        },
      })
    : null;
  if (!member) {
    // Look up the User's `name` (set on first SSO login from the
    // firstName + lastName claims) and try a Thai-name match after
    // stripping common honorifics ("นาย", "นาง", "ดร.", etc.).
    const nameRow = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    const stripped = nameRow?.name ? stripTitlePrefixes(nameRow.name) : '';
    if (stripped) {
      member = await prisma.facultyMember.findFirst({
        where: { nameTh: stripped, isActive: true },
        select: {
          rank: true,
          nameTh: true,
          nameEn: true,
          academicQualification: true,
          citizenIdHash: true,
        },
      });
    }
  }
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

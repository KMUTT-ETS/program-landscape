import { prisma } from '@kku/db';
import type { User } from '@kku/db';
import type { SsonextProfile } from './kku-sso-client';

// Auto-provision a User row from KKU SSONext claims on first login.
//
// SSONext doesn't carry org codes — the closest fields are facultyName /
// positionTypeName (Thai strings). We resolve facultyId by exact match on
// Faculty.nameTh; if that fails, the user lands with facultyId: null and an
// admin can fix it via /admin/users.
//
// The function is safe to call on every login — does nothing if the User
// already exists, but always returns the current row.

export interface SsonextClaims {
  // From /auth.token (always present)
  immutableId: string;
  email: string;
  firstName: string;
  lastName: string;
  employeeId: string;
  // Extended from /user.profile (optional — fetched but not strictly required)
  facultyName?: string;
  titleTh?: string;
  titleEn?: string;
  firstnameEn?: string;
  lastnameEn?: string;
  positionTypeName?: string;
  personStatus?: string;
}

export function ssonextClaimsFromProfile(
  tokenPayload: {
    immutableId: string;
    email: string;
    firstName: string;
    lastName: string;
    employeeId: string;
  },
  profile: SsonextProfile | null,
): SsonextClaims {
  return {
    // KKU's /auth.token doesn't always populate immutableId; /user.profile's
    // userId is the same identity. Either is acceptable as ssoSubject.
    immutableId: tokenPayload.immutableId || profile?.userId || '',
    // /auth.token's email may be empty; /user.profile is the better source.
    email: profile?.email || tokenPayload.email,
    firstName: tokenPayload.firstName || profile?.firstname || '',
    lastName: tokenPayload.lastName || profile?.lastname || '',
    employeeId: tokenPayload.employeeId,
    facultyName: profile?.facultyName,
    titleTh: profile?.title,
    titleEn: profile?.titleEng,
    firstnameEn: profile?.firstnameEng,
    lastnameEn: profile?.lastnameEng,
    positionTypeName: profile?.positionTypeName,
    personStatus: profile?.personStatus,
  };
}

function pickDisplayName(claims: SsonextClaims): string {
  const en = [claims.firstnameEn, claims.lastnameEn].filter(Boolean).join(' ').trim();
  if (en) return en;
  const th = [claims.firstName, claims.lastName].filter(Boolean).join(' ').trim();
  if (th) return th;
  return claims.email || claims.immutableId;
}

export async function provisionFromSsonext(claims: SsonextClaims): Promise<User> {
  if (!claims.email) {
    throw new Error('KKU SSO did not return an email; cannot provision user.');
  }

  // Build the OR clause defensively — empty ssoSubject would match any
  // legacy User row whose ssoSubject is also empty (data integrity risk).
  const lookupClauses = [{ email: claims.email }] as const;
  const ssoSubjectClause = claims.immutableId
    ? [{ ssoSubject: claims.immutableId }]
    : [];

  const existing = await prisma.user.findFirst({
    where: { OR: [...ssoSubjectClause, ...lookupClauses] },
  });

  // Resolve faculty by Thai name (the only org signal SSONext carries).
  // Exact match only — fuzzy resolution would silently bind to the wrong
  // faculty for medical/health-cluster name overlaps. Misses land with null.
  const facultyId = claims.facultyName
    ? (
        await prisma.faculty.findFirst({
          where: { nameTh: claims.facultyName },
          select: { id: true },
        })
      )?.id ?? null
    : null;

  if (existing) {
    // Bind ssoSubject if the user was pre-provisioned (admin) and hadn't
    // logged in via SSO yet. Don't touch role / facultyId on existing users
    // — those are admin-managed.
    if (!existing.ssoSubject && claims.immutableId) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { ssoSubject: claims.immutableId },
      });
    }
    return existing;
  }

  return prisma.user.create({
    data: {
      email: claims.email,
      ssoSubject: claims.immutableId || null,
      name: pickDisplayName(claims),
      role: 'UNIVERSITY_USER',
      facultyId,
      departmentId: null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Academic-staff scope sync.
//
// When an SSO user is also listed in our FacultyMember table (matched by
// HR `employeeId`), they get a PROGRAM_USER UserScope row for every
// program they appear on in ProgramFaculty. The mapping is many-to-many
// — a single staffer routinely teaches in multiple programs across
// faculties, so this function handles N FacultyMember rows × M Program
// rows fan-out.
//
// The sync is destructive on the auto-managed slice ONLY: rows where
// `source = ACADEMIC_STAFF` are reconciled against the current
// FacultyMember×ProgramFaculty truth set. Rows with `source = MANUAL`
// (admin-assigned) are never touched here.
//
// Called from the SSO callback after `provisionFromSsonext()` so every
// login refreshes the picture. Failures are logged but never block the
// login flow — academic-staff scope is a "nice to have" alongside the
// User's primary role.
// ─────────────────────────────────────────────────────────────────────────

export interface AcademicStaffScopeSyncResult {
  added: number;
  removed: number;
  unchanged: number;
}

export async function syncAcademicStaffScopes(
  userId: string,
  employeeId: string | null | undefined,
): Promise<AcademicStaffScopeSyncResult> {
  // Without an HR employee number we can't bridge to FacultyMember.
  if (!employeeId || !employeeId.trim()) {
    return reconcileAutoScopes(userId, []);
  }

  // One staffer can have multiple FacultyMember rows — e.g., when they
  // hold dual appointments across faculties (HR sometimes splits these
  // into separate rows). Take the union of programs across all matches.
  const members = await prisma.facultyMember.findMany({
    where: { employeeId, isActive: true },
    select: {
      id: true,
      facultyId: true,
      programFaculties: {
        select: {
          programId: true,
          program: { select: { facultyId: true } },
        },
      },
    },
  });

  // Build the desired-scope set: one PROGRAM_USER row per (programId).
  // facultyId is derived from Program.facultyId (cross-table consistency
  // matches the manual addUserScopeAction logic).
  type DesiredKey = string;
  const desired = new Map<DesiredKey, { programId: string; facultyId: string }>();
  for (const m of members) {
    for (const pf of m.programFaculties) {
      const key = pf.programId;
      desired.set(key, {
        programId: pf.programId,
        facultyId: pf.program.facultyId,
      });
    }
  }

  return reconcileAutoScopes(userId, [...desired.values()]);
}

async function reconcileAutoScopes(
  userId: string,
  desired: Array<{ programId: string; facultyId: string }>,
): Promise<AcademicStaffScopeSyncResult> {
  // Read all rows for this user — we need to know about MANUAL ones so
  // we don't double-insert on top of an admin-assigned tuple. The auto-
  // managed slice is what we delete/add; manual rows are read-only here.
  const allExisting = await prisma.userScope.findMany({
    where: { userId, role: 'PROGRAM_USER' },
    select: { id: true, programId: true, source: true },
  });

  const auto = allExisting.filter((e) => e.source === 'ACADEMIC_STAFF');
  const manual = allExisting.filter((e) => e.source === 'MANUAL');

  const desiredKeys = new Set(desired.map((d) => d.programId));
  const autoByProgram = new Map(auto.map((e) => [e.programId, e]));
  const manualPrograms = new Set(manual.map((e) => e.programId));

  // ADD: a desired scope that isn't already covered by an auto OR
  // manual row. Manual rows take precedence — we never shadow them.
  const toAdd = desired.filter(
    (d) => !autoByProgram.has(d.programId) && !manualPrograms.has(d.programId),
  );
  // REMOVE: an auto row whose program is no longer in the desired set
  // (the staffer was removed from the program upstream).
  const toRemoveIds = auto
    .filter((e) => !e.programId || !desiredKeys.has(e.programId))
    .map((e) => e.id);

  if (toAdd.length === 0 && toRemoveIds.length === 0) {
    return { added: 0, removed: 0, unchanged: auto.length };
  }

  await prisma.$transaction([
    ...(toRemoveIds.length > 0
      ? [prisma.userScope.deleteMany({ where: { id: { in: toRemoveIds } } })]
      : []),
    ...toAdd.map((d) =>
      prisma.userScope.create({
        data: {
          userId,
          role: 'PROGRAM_USER',
          facultyId: d.facultyId,
          programId: d.programId,
          source: 'ACADEMIC_STAFF',
        },
      }),
    ),
  ]);

  return {
    added: toAdd.length,
    removed: toRemoveIds.length,
    unchanged: auto.length - toRemoveIds.length,
  };
}

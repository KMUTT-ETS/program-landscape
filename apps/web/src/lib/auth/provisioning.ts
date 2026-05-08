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
      role: 'VIEWER',
      facultyId,
      departmentId: null,
    },
  });
}

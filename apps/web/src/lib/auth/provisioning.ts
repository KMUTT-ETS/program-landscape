import { prisma } from '@kku/db';
import type { User } from '@kku/db';

// Auto-provision a User row from KKU SSO claims on first login. Maps the
// faculty/department codes via the KkuOrgCodeMapping table seeded in
// prompt 01 (real values come from KKU IT during prompt 14).
//
// Safe to call on every login — does nothing if the User already exists,
// but always returns the current row.

export interface OidcProfileClaims {
  sub: string;
  email?: string;
  name?: string;
  employee_id?: string;
  faculty_code?: string;
  department_code?: string;
}

export async function provisionFromOidcClaims(
  claims: OidcProfileClaims,
): Promise<User> {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { ssoSubject: claims.sub },
        ...(claims.email ? [{ email: claims.email }] : []),
      ],
    },
  });
  if (existing) {
    // Keep ssoSubject in sync in case the row was pre-created (dev user,
    // admin-provisioned) and hadn't been linked yet.
    if (!existing.ssoSubject) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { ssoSubject: claims.sub },
      });
    }
    return existing;
  }

  if (!claims.email) {
    throw new Error('KKU SSO did not return an email claim; cannot provision.');
  }

  const facultyId = claims.faculty_code
    ? (
        await prisma.kkuOrgCodeMapping.findUnique({
          where: { kkuCode_kind: { kkuCode: claims.faculty_code, kind: 'FACULTY' } },
        })
      )?.facultyId ?? null
    : null;

  const departmentId = claims.department_code
    ? (
        await prisma.kkuOrgCodeMapping.findUnique({
          where: {
            kkuCode_kind: {
              kkuCode: claims.department_code,
              kind: 'DEPARTMENT',
            },
          },
        })
      )?.departmentId ?? null
    : null;

  return prisma.user.create({
    data: {
      email: claims.email,
      ssoSubject: claims.sub,
      name: claims.name ?? claims.email,
      role: 'VIEWER',
      facultyId,
      departmentId,
    },
  });
}

// Resolve an external caller's identifier to a staff record.
//   citizen id → SHA-256 join key (hashCitizenId) → FacultyMember.citizenIdHash
//   email      → FacultyMember.kkuEmail, then User.email → employeeId (the
//                bridge the /profile page itself uses)
import { hashCitizenId } from '@kku/shared';
import { prisma } from '../index';

export type StaffLookup = { citizenId: string } | { email: string };

export async function resolveStaffForLookup(
  lookup: StaffLookup,
  opts: { includeInactive: boolean },
): Promise<string | null> {
  const active = opts.includeInactive ? {} : { isActive: true };

  if ('citizenId' in lookup) {
    const citizenIdHash = hashCitizenId(lookup.citizenId);
    if (!citizenIdHash) return null;
    const m = await prisma.facultyMember.findFirst({
      where: { citizenIdHash, ...active },
      select: { id: true },
    });
    return m?.id ?? null;
  }

  const email = lookup.email.trim().toLowerCase();
  const direct = await prisma.facultyMember.findFirst({
    where: { kkuEmail: email, ...active },
    select: { id: true },
  });
  if (direct) return direct.id;

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { employeeId: true },
  });
  if (!user?.employeeId) return null;
  const viaUser = await prisma.facultyMember.findFirst({
    where: { employeeId: user.employeeId, ...active },
    select: { id: true },
  });
  return viaUser?.id ?? null;
}

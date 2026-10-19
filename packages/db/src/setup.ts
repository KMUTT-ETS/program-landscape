import type { Prisma } from '@prisma/client';

import { prisma } from './index';

// First-run bootstrap: how an installation that has never been seeded gets
// its first administrator.
//
// A fresh install is genuinely stuck without this. `pnpm db:seed` is a KKU
// convenience and adopters do not run it; SSO provisioning deliberately
// creates every user as PROGRAM_USER (v1.0.7 — defaulting to
// UNIVERSITY_USER was a mass scope bypass); and promoting anyone to admin
// is itself behind /admin. So nothing in the product can produce the first
// admin, and the first thing an adopter must do — import their org chart —
// is behind that same door.
//
// The route this opens is reachable WITHOUT CREDENTIALS, so the question
// that matters is not how it opens but when it is shut. Two conditions,
// either of which closes it:
//
//   1. An admin already exists. Covers every existing installation, which
//      has never heard of the latch below, and covers the window before
//      the latch is written.
//   2. The latch has been written. Covers the case where the admin is
//      later deleted or demoted — without it, removing the last admin
//      would silently reopen an anonymous path to SUPER_ADMIN on a system
//      by then full of real data.
//
// Deliberately NOT "any user exists": an adopter may wire SSO before
// claiming the install, and those logins create PROGRAM_USER rows. Closing
// on the first of those would lock the university out of its own system
// with no route back short of hand-written SQL.

/** `SystemSetting` key marking an installation as claimed. Value is the claim timestamp. */
export const SETUP_LATCH_KEY = 'setup.completed';

/** Roles that can reach /admin, and therefore promote anyone else. */
const ADMIN_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN'] as const;

export class SetupUnavailableError extends Error {
  constructor() {
    super('This installation has already been set up.');
    this.name = 'SetupUnavailableError';
  }
}

/** The slice of the client these helpers touch, so a transaction can stand in. */
export type SetupClient = Pick<Prisma.TransactionClient, 'user' | 'systemSetting' | 'auditLog'>;

/** True when this installation has never been claimed. */
export async function isSetupAvailable(client: SetupClient = prisma): Promise<boolean> {
  const latch = await client.systemSetting.findUnique({ where: { key: SETUP_LATCH_KEY } });
  if (latch) return false;

  const admins = await client.user.count({ where: { role: { in: [...ADMIN_ROLES] } } });
  return admins === 0;
}

export interface FirstAdminInput {
  email: string;
  name: string;
  /** Already hashed — hashing lives with the auth code in apps/web. */
  passwordHash: string;
}

/**
 * Claims the installation, creating its first administrator.
 *
 * Throws `SetupUnavailableError` when it has already been claimed. The
 * check and both writes share one transaction, and the latch is a primary
 * key, so two simultaneous claims cannot both succeed — the loser rolls
 * back whole rather than leaving a half-made admin behind.
 */
export async function completeSetup(input: FirstAdminInput): Promise<{ userId: string }> {
  return prisma.$transaction(async (tx) => {
    if (!(await isSetupAvailable(tx))) throw new SetupUnavailableError();

    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: input.passwordHash,
        role: 'SUPER_ADMIN',
      },
      select: { id: true },
    });

    await tx.systemSetting.create({
      data: {
        key: SETUP_LATCH_KEY,
        value: new Date().toISOString(),
        updatedBy: user.id,
      },
    });

    // This is the one account on the system nobody authorised. The audit
    // row is the only evidence of where it came from.
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: 'setup.complete',
        entityType: 'User',
        entityId: user.id,
      },
    });

    return { userId: user.id };
  });
}

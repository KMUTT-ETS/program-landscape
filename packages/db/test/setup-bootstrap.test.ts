import { afterEach, describe, expect, it } from 'vitest';

import { prisma } from '../src';
import {
  SETUP_LATCH_KEY,
  SetupUnavailableError,
  completeSetup,
  isSetupAvailable,
} from '../src/setup';

// First-run bootstrap. A fresh installation has no admin and no way to make
// one: seeding is a KKU-only convenience, SSO provisioning deliberately
// lands everyone on PROGRAM_USER, and role promotion lives behind /admin.
// These tests pin the one escape hatch — and, more importantly, pin when it
// is shut, because it is reachable without credentials.

const EMAIL = 'first-admin@setup.test';
const HASH = 'scrypt:1111:2222';

async function cleanup(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { action: 'setup.complete' } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@setup.test' } } });
  await prisma.systemSetting.deleteMany({ where: { key: SETUP_LATCH_KEY } });
}

afterEach(cleanup);

describe('first-run setup availability', () => {
  it('is available on an installation that has never been claimed', async () => {
    expect(await isSetupAvailable()).toBe(true);
  });

  it('is closed once an admin exists, even with no latch written', async () => {
    // The upgrade path. An existing installation already has admins and has
    // never heard of the latch; the wizard must not open there.
    await prisma.user.create({
      data: { email: EMAIL, name: 'Existing Admin', role: 'SYSTEM_ADMIN' },
    });

    expect(await isSetupAvailable()).toBe(false);
  });

  it('stays open while the only users are ordinary ones', async () => {
    // The SSO-first case. An adopter may wire SSO before claiming the
    // install; those logins provision PROGRAM_USER rows. Closing on "any
    // user exists" would lock the university out of its own system with no
    // route back short of hand-written SQL.
    await prisma.user.create({
      data: { email: EMAIL, name: 'Ordinary Staffer', role: 'PROGRAM_USER' },
    });

    expect(await isSetupAvailable()).toBe(true);
  });
});

describe('claiming an installation', () => {
  it('creates the first account as a SUPER_ADMIN', async () => {
    await completeSetup({ email: EMAIL, name: 'First Admin', passwordHash: HASH });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.role).toBe('SUPER_ADMIN');
    expect(user.passwordHash).toBe(HASH);
  });

  it('closes setup for good', async () => {
    await completeSetup({ email: EMAIL, name: 'First Admin', passwordHash: HASH });

    expect(await isSetupAvailable()).toBe(false);
  });

  it('refuses a second claim', async () => {
    await completeSetup({ email: EMAIL, name: 'First Admin', passwordHash: HASH });

    await expect(
      completeSetup({ email: 'second@setup.test', name: 'Second', passwordHash: HASH }),
    ).rejects.toBeInstanceOf(SetupUnavailableError);
    expect(await prisma.user.count({ where: { email: 'second@setup.test' } })).toBe(0);
  });

  it('records who claimed it', async () => {
    // The only account on the system that nobody authorised. The audit row
    // is the sole evidence of where it came from.
    await completeSetup({ email: EMAIL, name: 'First Admin', passwordHash: HASH });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'setup.complete' },
    });
    expect(entry.entityId).toBe(user.id);
    expect(entry.userId).toBe(user.id);
  });

  it('latches even if the admin is later removed', async () => {
    // Otherwise deleting the last admin silently reopens an anonymous route
    // to SUPER_ADMIN on an installation that is by then full of real data.
    await completeSetup({ email: EMAIL, name: 'First Admin', passwordHash: HASH });
    await prisma.user.deleteMany({ where: { email: EMAIL } });

    expect(await isSetupAvailable()).toBe(false);
  });
});

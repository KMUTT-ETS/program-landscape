import { PrismaClient } from '@prisma/client';

// Singleton across hot reloads in dev.
declare global {
  // eslint-disable-next-line no-var
  var __kku_prisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__kku_prisma__ ?? new PrismaClient({ log: ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__kku_prisma__ = prisma;
}

export * from '@prisma/client';

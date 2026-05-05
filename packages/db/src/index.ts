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
export * from './scope';
export * from './provenance';
export * from './ai-inference-recorder';
export * from './health-score';
export * from './program-deep-dive';
export * from './gap-analysis';
export * from './benchmarking';
export * from './decisions';
export * from './program-digest-materialize';
export * from './skill-normaliser';
export * from './dashboard-overview';
export * from './benchmarking-overview';
export * from './canonical-programs';

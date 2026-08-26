import { PrismaClient } from '@prisma/client';

// Singleton across hot reloads in dev.
declare global {
  // eslint-disable-next-line no-var
  var __kku_prisma__: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__kku_prisma__ ?? new PrismaClient({ log: process.env.PRISMA_LOG_QUERY === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'] });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__kku_prisma__ = prisma;
}

export * from '@prisma/client';
export * from './scope';
export * from './provenance';
export * from './ai-inference-recorder';
export * from './ai-model-override-store';
export * from './ai-model-catalog';
export * from './external-ai-runner';
export * from './health-score';
export * from './program-deep-dive';
export * from './program-strategic-narrative-run';
export * from './program-research-expertise';
export * from './program-research-expertise-run';
export * from './gap-analysis';
export * from './gap-lenses';
export * from './dq-skill-lens';
export * from './benchmarking';
export * from './decisions';
export * from './program-digest-materialize';
export * from './skill-normaliser';
export * from './dashboard-overview';
export * from './benchmarking-overview';
export * from './canonical-programs';
export * from './currently-enrolled';
export * from './student-status';
export * from './imd-rankings';
export * from './imd-materialize';
export * from './program-recruitment';
export * from './program-funnel';
export * from './risk-scoring';
export * from './risk-measure-rules';
export * from './retention';
export * from './sign-in-lockout';
export * from './data-quality';
export * from './methodology-bundle';
export * from './evaluations';
export * from './academic-year';
export * from './financial-year';
export * from './teaching-talent';
export * from './student-dq';
export * from './aunqa-evidence';

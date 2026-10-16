import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadOrganization, startOrganizationRefresh } from '@kku/db';
import { assertLogLevelSafe, markDraining } from '@kku/shared';
import { AppModule } from './app.module';

// Refuse to boot prod with LOG_LEVEL=debug/trace. See
// packages/shared/src/observability/log-level-guard.ts.
assertLogLevelSafe();

async function bootstrap() {
  // Organisation identity (white-label). A missing profile must not stop the
  // process booting — the admin needs the app up to fill it in; identity-dependent
  // calls fail with ORG_NOT_CONFIGURED until then.
  const org = await loadOrganization();
  if (!org) console.warn('[organization] no organisation profile — /admin/organization to set one up');
  startOrganizationRefresh();
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Hold the process open until SIGTERM/SIGINT. IngestionService's
  // onModuleInit has already wired the BullMQ worker + registered
  // schedules. On shutdown:
  //   1. markDraining() — signals to any in-process consumers (none
  //      today on the ingestion side; future-proofing for an admin HTTP
  //      surface).
  //   2. app.close() — invokes IngestionService.onModuleDestroy which
  //      closes BullMQ workers FIRST (waits for active jobs to finish
  //      naturally) before closing queues + events.
  const shutdown = async (signal: string) => {
    markDraining();
    logger.log(`${signal} received — draining (BullMQ workers will finish active jobs)`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('ingestion worker started');
}

void bootstrap();

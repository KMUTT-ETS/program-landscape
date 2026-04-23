import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('ingestion');

  // Hold the process open until SIGTERM/SIGINT. IngestionService's
  // onModuleInit has already wired the BullMQ worker + registered
  // schedules; there's nothing else the entrypoint needs to do.
  const shutdown = async (signal: string) => {
    logger.log(`${signal} received — shutting down`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('ingestion worker started');
}

void bootstrap();

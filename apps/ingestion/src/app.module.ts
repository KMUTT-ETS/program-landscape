import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import path from 'node:path';
import { REDACT_PATHS, scrubLogObject } from '@kku/shared';

import { IngestionService } from './ingestion.service';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // Repo root .env (dev), falling back to apps/ingestion/.env.
        path.join(process.cwd(), '..', '..', '.env'),
        path.join(process.cwd(), '.env'),
      ],
    }),
    // Structured logging — JSON in prod, pretty in dev. Ingestion has no
    // HTTP surface, so no request-id plumbing — each log line picks up
    // the current context (BullMQ job id / monitor name) from pino's
    // child loggers.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
        transport: isProd
          ? undefined
          : {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss.l',
                singleLine: true,
                ignore: 'pid,hostname',
              },
            },
        // ISO 8601 timestamps. Default `Date.now()` 13-digit epoch trips
        // the PDPA acceptance grep `[0-9]{13}` for raw Thai IDs.
        timestamp: stdTimeFunctions.isoTime,
        // PDPA log-redaction — same shape as apps/api. Catches passwords,
        // secrets, tokens, citizen IDs, phones, DOBs across arbitrary
        // depth, plus raw 13-digit Thai IDs in bare string values. See
        // packages/shared/src/observability/log-redaction.ts.
        redact: { paths: [...REDACT_PATHS], remove: true },
        formatters: {
          log(object) {
            return scrubLogObject(object);
          },
        },
      },
    }),
  ],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class AppModule {}

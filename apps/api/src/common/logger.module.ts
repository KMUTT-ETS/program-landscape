import { LoggerModule } from 'nestjs-pino';
import type { DynamicModule } from '@nestjs/common';

// ─────────────────────────────────────────────────────────────────────────
// Pino-based structured logging for the NestJS api.
//
// - Dev: pretty-printed, single-line per log record.
// - Prod: JSON, one record per line (ingestible by Loki / CloudWatch / etc).
//
// Every request gets a `requestId` (or reads X-Request-Id if the KKU
// reverse proxy injects one). Audit-sensitive fields are redacted.
// ─────────────────────────────────────────────────────────────────────────

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'req.body.password',
  'req.body.secret',
  'req.body.apiKey',
  'req.body.exportReason', // Not a secret, but noisy in logs — redact by default.
];

export function buildLoggerModule(): DynamicModule {
  const isProd = process.env.NODE_ENV === 'production';
  return LoggerModule.forRoot({
    pinoHttp: {
      level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,req,res,responseTime',
              singleLine: true,
            },
          },
      redact: { paths: REDACT_PATHS, remove: true },
      genReqId: (req, res) => {
        const incoming =
          (req.headers['x-request-id'] as string | undefined) ??
          (req.headers['x-correlation-id'] as string | undefined);
        const id =
          incoming ??
          `req_${Date.now().toString(36)}${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Keep logs tight — body content is redacted + audit log captures
      // the full mutation via AuditLog interceptor.
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
            remoteAddress: req.remoteAddress,
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    },
  });
}

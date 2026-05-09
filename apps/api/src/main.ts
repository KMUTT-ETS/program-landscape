import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { assertLogLevelSafe, markDraining } from '@kku/shared';
import { AppModule } from './app.module';

// Refuse to boot prod with LOG_LEVEL=debug/trace. See
// packages/shared/src/observability/log-level-guard.ts.
assertLogLevelSafe();

// Prisma returns BigInt for @db.BigInt columns (e.g. ScenarioRun.seed).
// Express's res.json() uses JSON.stringify which can't serialize BigInt.
// Convert to string at the boundary — safe because these fields are
// seeds/ids that round-trip fine as strings.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Swap Nest's default logger for the pino logger from the module.
  app.useLogger(app.get(Logger));

  // Respect X-Forwarded-For behind KKU's reverse proxy (for audit IPs).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());

  // ────────────────────────────────────────────────────────────────────
  // Security headers (prompt 13 hardening).
  //
  // KKU's university reverse proxy terminates TLS and re-encrypts to our
  // server on :8443 with a self-signed cert. Our own nginx handles the
  // internal routing. In prod, HSTS is emitted by both the KKU proxy and
  // by this layer so the browser sees it on first request.
  //
  // CSP in this layer is the backstop for API responses. The main CSP
  // enforcement for the app HTML lives in apps/web/next.config.mjs — the
  // browser reads that when loading the SPA shell.
  // ────────────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP is served by Next.js for the HTML.
      crossOriginEmbedderPolicy: false, // MinIO / Gotenberg assets need relaxed COEP.
      hsts: {
        // 6 months, include subdomains; preload left off until we're on
        // the HSTS preload list.
        maxAge: 60 * 60 * 24 * 180,
        includeSubDomains: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      noSniff: true,
      xssFilter: true,
    }),
  );

  // SIGTERM/SIGINT — flip the drain flag FIRST, then trigger Nest's
  // shutdown hooks (which await in-flight requests). The drain flip
  // makes /api/v1/ready return 503 immediately so the KKU upstream
  // proxy stops sending NEW requests within its 30s polling window.
  // Nest's enableShutdownHooks() registers its own listeners that
  // call app.close() — they run AFTER ours because ours are appended
  // to the same `process` event list later (Node fires listeners in
  // registration order).
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sig, () => {
      markDraining();
      // eslint-disable-next-line no-console
      console.log(`[shutdown] ${sig} received — draining; /ready returns 503 to new traffic.`);
    });
  }
  app.enableShutdownHooks();

  // Dev CORS — in prod, nginx routes /api/* on the same host so CORS is
  // unused. ALLOWED_ORIGINS is a comma-separated list; default in dev is
  // http://localhost:3000.
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
      credentials: true,
    });
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`api listening on ${port}`);
}

void bootstrap();

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

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

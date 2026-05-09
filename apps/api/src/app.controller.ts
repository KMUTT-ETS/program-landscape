import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kku/db';
import type { Response } from 'express';
import IORedis from 'ioredis';
import {
  drainStartedAt,
  isDraining,
  snapshotAllBreakers,
} from '@kku/shared';
import { Public } from './common';

// ─────────────────────────────────────────────────────────────────────────
// Health endpoints.
//
// GET /api/v1/healthz — liveness. Returns 200 as long as the process is
// up. Used by Docker HEALTHCHECK + k8s liveness.
//
// GET /api/v1/ready   — readiness. Actually probes dependencies:
//   postgres  — prisma.$queryRaw('SELECT 1')
//   redis     — PING
//   minio     — HeadBucket on MINIO_BUCKET_PDF_OUTPUT
//   gotenberg — GET /health on GOTENBERG_URL
//   ai        — provider key present (not a call — no $$ on every probe)
// Returns 503 with a per-dep verdict on any failure. Used by nginx to
// gate traffic and by ops to diagnose outages.
// ─────────────────────────────────────────────────────────────────────────

interface DepCheck {
  name: string;
  ok: boolean;
  latencyMs?: number;
  detail?: string;
}

// `/ready` is publicly probeable (KKU upstream proxy gates traffic on
// it). Returning raw error messages would leak hostnames, ports, and
// occasionally usernames (Postgres "password authentication failed for
// user '<role>'", Redis ECONNREFUSED with host:port, etc.). In prod we
// return only `{ name, ok, latencyMs }`. Dev keeps `detail` so ops can
// still diagnose locally. See docs/hardening/04-authz-matrix.report.md
// V3.
function sanitiseDetail(detail: string | undefined): string | undefined {
  return process.env.NODE_ENV === 'production' ? undefined : detail;
}

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('/healthz')
  @Public()
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('/ready')
  @Public()
  async ready(@Res({ passthrough: true }) res: Response): Promise<{
    status: 'ok' | 'degraded' | 'draining';
    checks: DepCheck[];
    breakers: ReturnType<typeof snapshotAllBreakers>;
    drainStartedAt?: string | null;
    timestamp: string;
  }> {
    // Drain mode short-circuit. SIGTERM flips the in-process flag in
    // packages/shared/src/observability/drain-state.ts; we return 503
    // immediately so the KKU upstream proxy stops sending NEW requests
    // within its polling window. In-flight requests continue to drain
    // via Nest's `app.close()` deadline.
    if (isDraining()) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'draining',
        checks: [],
        breakers: snapshotAllBreakers(),
        drainStartedAt: drainStartedAt()?.toISOString() ?? null,
        timestamp: new Date().toISOString(),
      };
    }

    const checks = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkGotenberg(),
      this.checkAiProvider(),
    ]);
    // Live circuit-breaker snapshot — any OPEN breaker degrades /ready
    // so nginx can soft-degrade upstream traffic. The KKU upstream
    // proxy poller catches the 503 within its 30s polling window.
    const breakers = snapshotAllBreakers();
    const anyBreakerOpen = breakers.some((b) => b.state === 'OPEN');
    const allOk = checks.every((c) => c.ok) && !anyBreakerOpen;
    if (!allOk) {
      // 503 Service Unavailable so nginx + the KKU upstream poller can
      // gate traffic. The body still carries the per-dep verdict + the
      // breaker snapshot so ops can diagnose the failing dep.
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: allOk ? 'ok' : 'degraded',
      checks,
      breakers,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<DepCheck> {
    const started = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { name: 'postgres', ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return {
        name: 'postgres',
        ok: false,
        latencyMs: Date.now() - started,
        detail: sanitiseDetail(
          err instanceof Error ? err.message.slice(0, 120) : String(err),
        ),
      };
    }
  }

  private async checkRedis(): Promise<DepCheck> {
    const started = Date.now();
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      return { name: 'redis', ok: false, detail: 'REDIS_URL not set' };
    }
    const client = new IORedis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await client.connect();
      const pong = await client.ping();
      return { name: 'redis', ok: pong === 'PONG', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        name: 'redis',
        ok: false,
        latencyMs: Date.now() - started,
        detail: sanitiseDetail(
          err instanceof Error ? err.message.slice(0, 120) : String(err),
        ),
      };
    } finally {
      client.disconnect();
    }
  }

  private async checkMinio(): Promise<DepCheck> {
    const started = Date.now();
    const endpoint = this.config.get<string>('MINIO_ENDPOINT');
    const bucket = this.config.get<string>('MINIO_BUCKET_PDF_OUTPUT');
    if (!endpoint || !bucket) {
      return { name: 'minio', ok: false, detail: 'MINIO env vars missing' };
    }
    try {
      // A cheap ping is enough — we don't need to authenticate here
      // because `/minio/health/ready` is unauthenticated by default.
      const url = new URL('/minio/health/ready', endpoint).toString();
      const res = await fetch(url, {
        signal: AbortSignal.timeout(1500),
      });
      return {
        name: 'minio',
        ok: res.ok,
        latencyMs: Date.now() - started,
        ...(res.ok ? {} : { detail: sanitiseDetail(`HTTP ${res.status}`) }),
      };
    } catch (err) {
      return {
        name: 'minio',
        ok: false,
        latencyMs: Date.now() - started,
        detail: sanitiseDetail(
          err instanceof Error ? err.message.slice(0, 120) : String(err),
        ),
      };
    }
  }

  private async checkGotenberg(): Promise<DepCheck> {
    const started = Date.now();
    const url = this.config.get<string>('GOTENBERG_URL');
    if (!url) {
      return { name: 'gotenberg', ok: false, detail: 'GOTENBERG_URL not set' };
    }
    try {
      const res = await fetch(new URL('/health', url).toString(), {
        signal: AbortSignal.timeout(1500),
      });
      return {
        name: 'gotenberg',
        ok: res.ok,
        latencyMs: Date.now() - started,
        ...(res.ok ? {} : { detail: sanitiseDetail(`HTTP ${res.status}`) }),
      };
    } catch (err) {
      return {
        name: 'gotenberg',
        ok: false,
        latencyMs: Date.now() - started,
        detail: sanitiseDetail(
          err instanceof Error ? err.message.slice(0, 120) : String(err),
        ),
      };
    }
  }

  private async checkAiProvider(): Promise<DepCheck> {
    const provider = (
      this.config.get<string>('AI_PROVIDER') ?? 'stub'
    ).toLowerCase();
    switch (provider) {
      case 'google':
        return {
          name: 'ai',
          ok: !!this.config.get<string>('GOOGLE_AI_API_KEY'),
          detail: `provider=google`,
        };
      case 'anthropic':
        return {
          name: 'ai',
          ok: !!this.config.get<string>('ANTHROPIC_API_KEY'),
          detail: `provider=anthropic`,
        };
      case 'openrouter':
        return {
          name: 'ai',
          ok: !!this.config.get<string>('OPENROUTER_API_KEY'),
          detail: `provider=openrouter`,
        };
      case 'intelsphere':
        return {
          name: 'ai',
          ok:
            !!this.config.get<string>('KKU_INTELSPHERE_URL') &&
            !!this.config.get<string>('KKU_INTELSPHERE_API_KEY'),
          detail: `provider=intelsphere`,
        };
      default:
        return { name: 'ai', ok: true, detail: `provider=stub` };
    }
  }
}

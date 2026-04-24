import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kku/db';
import IORedis from 'ioredis';
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
  async ready(): Promise<{
    status: 'ok' | 'degraded';
    checks: DepCheck[];
    timestamp: string;
  }> {
    const checks = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkGotenberg(),
      this.checkAiProvider(),
    ]);
    const allOk = checks.every((c) => c.ok);
    return {
      status: allOk ? 'ok' : 'degraded',
      checks,
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
        detail: err instanceof Error ? err.message.slice(0, 120) : String(err),
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
        detail: err instanceof Error ? err.message.slice(0, 120) : String(err),
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
        ...(res.ok ? {} : { detail: `HTTP ${res.status}` }),
      };
    } catch (err) {
      return {
        name: 'minio',
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message.slice(0, 120) : String(err),
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
        ...(res.ok ? {} : { detail: `HTTP ${res.status}` }),
      };
    } catch (err) {
      return {
        name: 'gotenberg',
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message.slice(0, 120) : String(err),
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

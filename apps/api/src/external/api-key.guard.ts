// Authenticates machine clients of the external API by per-client API key.
//
// Like every guard in this app it is a global APP_GUARD that no-ops unless
// its route metadata is present: @ApiKeyAuth() sets that metadata AND marks
// the route @Public(), because JwtAuthGuard reads any `Authorization: Bearer`
// as a JWT and would reject an API key before this guard ran.
import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { recordApiRequest, resolveApiKey, touchApiKeyUsage, type ResolvedApiKey } from '@kku/db';
import { ApiError, ipAllowed } from '@kku/shared';
import { Public } from '../common/decorators';
import { CacheService } from '../common/cache.service';

export const API_KEY_AUTH_META = Symbol('api-key-auth');

export const ApiKeyAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(Public(), SetMetadata(API_KEY_AUTH_META, true));

export interface ApiClientRequest extends Request {
  apiClient?: ResolvedApiKey;
}

/** One message for every authentication failure: a caller must not be able
 *  to tell an unknown key from a revoked, expired or disabled one. */
const UNAUTHENTICATED_MESSAGE = 'Invalid or missing API key';

/** Only a conservative token shape is stored: the header is caller-controlled
 *  and lands in the request log verbatim. */
const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

export function requestIdOf(req: Request): string | null {
  const id = (req as { id?: unknown }).id ?? req.headers['x-request-id'];
  return typeof id === 'string' && REQUEST_ID_RE.test(id) ? id : null;
}

/** Drop every `${clientId}:${minute}` entry from an earlier minute, so the
 *  per-process maps stay bounded by (active clients x 1). */
function pruneBefore(minute: number, keys: Map<string, unknown> | Set<string>): void {
  for (const k of keys.keys()) {
    if (Number(k.slice(k.lastIndexOf(':') + 1)) < minute) keys.delete(k);
  }
}

function readBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m?.[1] ?? null;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private lastRedisWarnMinute = -1;
  private lastRecordWarnMinute = -1;
  private lastTouchWarnMinute = -1;
  /** Fallback rate-limit counters, used only while Redis is unavailable.
   *  With one api container (today's deployment) this is effectively exact;
   *  with several it would be per-process, i.e. limit x replicas. */
  private readonly memoryWindows = new Map<string, number>();
  /** Clients whose 403 ip_not_allowed has already been logged this minute. */
  private readonly ipRejectLogged = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const enabled = this.reflector.getAllAndOverride<boolean>(API_KEY_AUTH_META, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!enabled) return true;

    const started = Date.now();
    const req = ctx.switchToHttp().getRequest<ApiClientRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const presented = readBearer(req);
    const resolved = presented ? await resolveApiKey(presented) : null;
    if (!resolved) throw new ApiError('UNAUTHORIZED', UNAUTHENTICATED_MESSAGE);
    const { client, keyId } = resolved;

    const minute = Math.floor(Date.now() / 60_000);
    const windowKey = `${client.id}:${minute}`;

    if (!ipAllowed(req.ip, client.ipAllowlist)) {
      // A caller hammering from a disallowed address must not become an
      // unbounded stream of DB writes: log the first rejection per minute.
      pruneBefore(minute, this.ipRejectLogged);
      if (!this.ipRejectLogged.has(windowKey)) {
        this.ipRejectLogged.add(windowKey);
        this.log(req, resolved, 403, started);
      }
      throw new ApiError('FORBIDDEN', 'Caller address is not permitted for this client', {
        reason: 'ip_not_allowed',
      });
    }

    let count = await this.cache.incrWindow(`api-rl:${windowKey}`, 120);
    if (count === undefined) {
      // Redis is down: this endpoint returns personal data, so it must not
      // fail open. Count in a per-process fixed window instead.
      if (this.lastRedisWarnMinute !== minute) {
        this.lastRedisWarnMinute = minute;
        this.logger.warn('API rate limit counting in process memory (Redis unavailable)');
      }
      pruneBefore(minute, this.memoryWindows);
      count = (this.memoryWindows.get(windowKey) ?? 0) + 1;
      this.memoryWindows.set(windowKey, count);
    }
    if (count > client.rateLimitPerMinute) {
      res.setHeader('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
      // Log only the first rejection in a window; later ones are implied.
      if (count === client.rateLimitPerMinute + 1) this.log(req, resolved, 429, started);
      throw new ApiError('RATE_LIMITED', 'Rate limit exceeded for this client');
    }

    req.apiClient = resolved;
    touchApiKeyUsage(keyId, client.id).catch((err: unknown) => {
      const m = Math.floor(Date.now() / 60_000);
      if (this.lastTouchWarnMinute === m) return;
      this.lastTouchWarnMinute = m;
      this.logger.warn(`could not record key usage: ${(err as Error).message}`);
    });
    return true;
  }

  private log(req: ApiClientRequest, r: ResolvedApiKey, status: number, started: number): void {
    recordApiRequest({
      clientId: r.client.id,
      keyId: r.keyId,
      lookupType: null,
      facultyMemberId: null,
      status,
      sectionsReturned: [],
      latencyMs: Date.now() - started,
      ip: req.ip ?? null,
      requestId: requestIdOf(req),
    }).catch((err: unknown) => {
      const m = Math.floor(Date.now() / 60_000);
      if (this.lastRecordWarnMinute === m) return;
      this.lastRecordWarnMinute = m;
      this.logger.warn(`could not log API request: ${(err as Error).message}`);
    });
  }
}

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

export function requestIdOf(req: Request): string | null {
  const id = (req as { id?: unknown }).id ?? req.headers['x-request-id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
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

    if (!ipAllowed(req.ip, client.ipAllowlist)) {
      this.log(req, resolved, 403, started);
      throw new ApiError('FORBIDDEN', 'Caller address is not permitted for this client', {
        reason: 'ip_not_allowed',
      });
    }

    const minute = Math.floor(Date.now() / 60_000);
    const count = await this.cache.incrWindow(`api-rl:${client.id}:${minute}`, 120);
    if (count === undefined) {
      // Fail open, like CacheService everywhere else; nginx's zone is the backstop.
      if (this.lastRedisWarnMinute !== minute) {
        this.lastRedisWarnMinute = minute;
        this.logger.warn('API rate limit unavailable (Redis down) — allowing calls this minute');
      }
    } else if (count > client.rateLimitPerMinute) {
      res.setHeader('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
      this.log(req, resolved, 429, started);
      throw new ApiError('RATE_LIMITED', 'Rate limit exceeded for this client');
    }

    req.apiClient = resolved;
    touchApiKeyUsage(keyId, client.id).catch((err: unknown) =>
      this.logger.warn(`could not record key usage: ${(err as Error).message}`),
    );
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
    }).catch((err: unknown) => this.logger.warn(`could not log API request: ${(err as Error).message}`));
  }
}

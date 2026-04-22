import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as jose from 'jose';
import { ApiError, SessionUserSchema } from '@kku/shared';
import type { Request } from 'express';
import { PUBLIC_META } from './decorators';

// Verifies the HS256-signed JWT issued by next-auth (see apps/web/src/lib/
// auth.ts for the custom encode/decode). Accepts the token from either:
//   - Authorization: Bearer <token>
//   - Cookie: authjs.session-token (dev) / __Secure-authjs.session-token (prod)
//
// On success, sets req.user to a SessionUser. Routes read via
// @AuthSession().
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly secret: Uint8Array;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    const secret = config.getOrThrow<string>('NEXTAUTH_SECRET');
    this.secret = new TextEncoder().encode(secret);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_META, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = readToken(req);
    if (!token) {
      throw new ApiError('UNAUTHORIZED', 'Missing authentication token');
    }

    try {
      const { payload } = await jose.jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      const user = SessionUserSchema.parse(payload);
      (req as unknown as { user: unknown }).user = user;
      return true;
    } catch (e) {
      this.logger.debug(`JWT verify failed: ${(e as Error).message}`);
      throw new ApiError('UNAUTHORIZED', 'Invalid authentication token');
    }
  }
}

function readToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader) {
    const [scheme, value] = authHeader.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && value) return value;
  }
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (cookies) {
    return (
      cookies['authjs.session-token'] ??
      cookies['__Secure-authjs.session-token'] ??
      null
    );
  }
  return null;
}

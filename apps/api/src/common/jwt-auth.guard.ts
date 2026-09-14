import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as jose from 'jose';
import {
  ApiError,
  IMPERSONATION_COOKIE,
  SessionUserSchema,
  canImpersonate,
  tryDecodeImpersonation,
  type SessionUser,
} from '@kku/shared';
import type { Request } from 'express';
import { PUBLIC_META } from './decorators';

// Verifies the HS256-signed JWT issued by next-auth (see apps/web/src/lib/
// auth.ts for the custom encode/decode). Accepts the token from either:
//   - Authorization: Bearer <token>
//   - Cookie: authjs.session-token (dev) / __Secure-authjs.session-token (prod)
//
// On success, sets req.user to a SessionUser. Routes read via
// @AuthSession().
//
// Impersonation override: when the JWT-derived role is super-grade and
// the request carries a `kku-impersonate` cookie with a valid payload,
// the guard substitutes the cookie's role + scope before exposing
// req.user. This mirrors the override the web's session() callback
// applies for SSR — without it the API would silently grant the
// SUPER_ADMIN's actual access surface even while the UI shows the
// impersonated role's view, defeating the whole point of role
// switching. The (unsigned) cookie is only honoured when the JWT's
// real role passes `canImpersonate`, so a regular user forging the
// cookie sees no effect.
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
      let user: SessionUser = SessionUserSchema.parse(payload);

      // Apply the impersonation override last — only when the
      // underlying JWT role permits it.
      if (canImpersonate(user.role)) {
        const imp = readImpersonation(req);
        if (imp) {
          user = {
            ...user,
            role: imp.role,
            facultyId: imp.facultyId ?? null,
            departmentId: imp.departmentId ?? null,
            programId: imp.programId ?? null,
          };
          // Published for telemetry: a handler cannot re-derive this,
          // because req.user no longer carries the real role.
          (req as unknown as { impersonated?: boolean }).impersonated = true;
        }
      }

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

// The web's apiFetch() carries the impersonation payload to the API as
// an `x-kku-impersonate` header — the request only contains an
// Authorization: Bearer JWT, NOT the original cookie jar. We accept
// either source so the override works for both same-origin browser
// traffic (cookie) and BFF-style server fetches (header).
function readImpersonation(req: Request) {
  const headerRaw = req.header('x-kku-impersonate');
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  const cookieRaw = cookies?.[IMPERSONATION_COOKIE];
  return tryDecodeImpersonation(headerRaw ?? cookieRaw);
}

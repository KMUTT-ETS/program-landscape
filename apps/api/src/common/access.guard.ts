import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ApiError,
  can,
  ScopeLevelSchema,
  type Permission,
  type ScopeContext,
  type SessionUser,
} from '@kku/shared';
import type { Request } from 'express';
import {
  PERMISSION_META,
  SCOPE_META,
  type RequireScopeOpts,
} from './decorators';

// Runs after JwtAuthGuard. Reads @RequirePermission + @RequireScope
// metadata and calls can() from @kku/shared. This is the one place in the
// system that makes authorisation decisions — modules must not roll their
// own checks.
@Injectable()
export class AccessControlGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission>(
      PERMISSION_META,
      [ctx.getHandler(), ctx.getClass()],
    );
    // No permission decorator → endpoint is authenticated but unrestricted
    // beyond that (e.g. /me).
    if (!permission) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    const user = req.user;
    if (!user) {
      throw new ApiError('UNAUTHORIZED', 'Authenticated user missing');
    }

    const scopeOpts = this.reflector.getAllAndOverride<RequireScopeOpts>(
      SCOPE_META,
      [ctx.getHandler(), ctx.getClass()],
    );
    const scopeContext = scopeOpts ? readScope(req, scopeOpts) : undefined;

    if (!can(user, permission, scopeContext)) {
      throw new ApiError(
        scopeContext ? 'SCOPE_DENIED' : 'FORBIDDEN',
        `Missing permission: ${permission}`,
        scopeContext ? { scope: scopeContext } : undefined,
      );
    }
    return true;
  }
}

function readScope(
  req: Request,
  opts: RequireScopeOpts,
): ScopeContext | undefined {
  const q = req.query as Record<string, string | undefined>;
  const raw = q.scope;
  if (!raw) return { level: 'university' };

  const parsed = ScopeLevelSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid `scope` parameter');
  }
  if (opts.levels && !opts.levels.includes(parsed.data)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `scope "${parsed.data}" not supported on this endpoint`,
    );
  }
  return { level: parsed.data, id: q.scopeId };
}

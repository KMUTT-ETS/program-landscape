import { SetMetadata, applyDecorators, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Permission, ScopeLevel, ApiMeta, SessionUser } from '@kku/shared';

// ──────────────────────────────────────────────────────────────────────────
// Metadata keys — the guards/interceptors look these up via Reflector.
// ──────────────────────────────────────────────────────────────────────────

export const PUBLIC_META = Symbol('public-route');
export const PERMISSION_META = Symbol('require-permission');
export const SCOPE_META = Symbol('require-scope');
export const PROVENANCE_META = Symbol('provenance');
export const AUDIT_LOG_META = Symbol('audit-log');
export const AI_CALL_META = Symbol('ai-call');

// ──────────────────────────────────────────────────────────────────────────
// Public — marks an endpoint as not requiring authentication.
// ──────────────────────────────────────────────────────────────────────────

export const Public = () => SetMetadata(PUBLIC_META, true);

// ──────────────────────────────────────────────────────────────────────────
// @RequirePermission('programs:read:all') — gated by RBAC in the guard.
// ──────────────────────────────────────────────────────────────────────────

export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_META, permission);

// ──────────────────────────────────────────────────────────────────────────
// @RequireScope() — marks an endpoint as scope-aware. The guard reads
// { scope, scopeId } from the request query and builds the ScopeContext
// that feeds into can(). Optional `level` restricts to a specific scope.
// ──────────────────────────────────────────────────────────────────────────

export interface RequireScopeOpts {
  levels?: ScopeLevel[];
}
export const RequireScope = (opts: RequireScopeOpts = {}) =>
  SetMetadata(SCOPE_META, opts);

// ──────────────────────────────────────────────────────────────────────────
// @Provenance({ sources, methodologyVersion, ... }) — ResponseInterceptor
// reads this to decorate the envelope's meta field.
// ──────────────────────────────────────────────────────────────────────────

export const Provenance = (meta: Partial<ApiMeta>) =>
  SetMetadata(PROVENANCE_META, meta);

// ──────────────────────────────────────────────────────────────────────────
// @AuditLog({ action, entityType, extractEntityId? })
// The interceptor writes a row to AuditLog after the handler succeeds.
// ──────────────────────────────────────────────────────────────────────────

export interface AuditLogConfig {
  action: string;
  entityType: string;
}
export const AuditLog = (config: AuditLogConfig) =>
  SetMetadata(AUDIT_LOG_META, config);

// ──────────────────────────────────────────────────────────────────────────
// @AiCall({ module }) — infra stub. The AI layer (prompt 04) fills in the
// interceptor that writes AiInference rows.
// ──────────────────────────────────────────────────────────────────────────

export interface AiCallConfig {
  module: string;
}
export const AiCall = (config: AiCallConfig) =>
  SetMetadata(AI_CALL_META, config);

// ──────────────────────────────────────────────────────────────────────────
// Combined convenience decorator — @Authorized(permission) applies
// @RequirePermission and implicitly @RequireScope when the permission ends
// in :own_faculty / :own_department.
// ──────────────────────────────────────────────────────────────────────────

export function Authorized(permission: Permission): MethodDecorator {
  const decorators: MethodDecorator[] = [RequirePermission(permission)];
  if (
    permission.endsWith(':own_faculty') ||
    permission.endsWith(':own_department')
  ) {
    decorators.push(RequireScope());
  }
  return applyDecorators(...decorators);
}

// ──────────────────────────────────────────────────────────────────────────
// @AuthSession() — parameter decorator for handlers.
//   async handler(@AuthSession() user: SessionUser) { ... }
// ──────────────────────────────────────────────────────────────────────────

export const AuthSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: SessionUser }>();
    if (!req.user) {
      throw new Error(
        'AuthSession() used on a route without authentication. Did you forget the JwtAuthGuard or mark the route @Public()?',
      );
    }
    return req.user;
  },
);

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Prisma, prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import type { Request } from 'express';
import { AUDIT_LOG_META, type AuditLogConfig } from './decorators';

// Writes an AuditLog row after a mutating handler succeeds. The decorator
// supplies `action` + `entityType`; the entity id is best-effort:
//   - If the handler returned `{ id: ... }` or `{ data: { id: ... } }` we use that.
//   - Otherwise we fall back to request.params.id.
// Payload is a redacted copy of the request body (passwords stripped).
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const config = this.reflector.getAllAndOverride<AuditLogConfig>(
      AUDIT_LOG_META,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!config) return next.handle();

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser; ip?: string }>();
    const user = req.user;
    const ip =
      (req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
        req.socket.remoteAddress) ??
      null;

    return next.handle().pipe(
      tap((result) => {
        const paramId = req.params?.id;
        const entityId =
          extractEntityId(result) ??
          (typeof paramId === 'string' ? paramId : null);
        const payload = redact(req.body);
        prisma.auditLog
          .create({
            data: {
              userId: user?.userId ?? null,
              action: config.action,
              entityType: config.entityType,
              entityId,
              payloadJson:
                payload === undefined
                  ? Prisma.JsonNull
                  : (payload as Prisma.InputJsonValue),
              ipAddress: ip,
            },
          })
          .catch((err) =>
            this.logger.error(`Failed to write audit log: ${err?.message}`),
          );
      }),
    );
  }
}

function extractEntityId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  if (typeof r.id === 'string') return r.id;
  if (r.data && typeof r.data === 'object' && r.data !== null) {
    const d = r.data as Record<string, unknown>;
    if (typeof d.id === 'string') return d.id;
  }
  return null;
}

function redact(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const copy: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of Object.keys(copy)) {
    if (/^(password|secret|token|key)/i.test(k)) copy[k] = '[REDACTED]';
  }
  return copy;
}

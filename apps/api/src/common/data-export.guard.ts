import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────
// DataExportGuard — enforces a Council-readiness rule: any endpoint that
// emits a document containing personal data (faculty names, individual
// demographics, salary line items, student PII) must require the caller
// to supply a textual `reason` that gets written to the audit log.
//
// Usage:
//   @RequireExportReason() on the route handler.
//   Client sends the reason either as:
//     - POST body field  `exportReason: string (min 10)`
//     - GET query param  `exportReason=...`
//
// The guard fails loudly at 400 VALIDATION_FAILED when the reason is
// missing or too terse. The AuditLogInterceptor picks the reason up
// from request metadata and writes it to the audit row alongside the
// action + entityId.
// ─────────────────────────────────────────────────────────────────────────

export const REQUIRE_EXPORT_REASON_META = Symbol('require-export-reason');

export interface RequireExportReasonConfig {
  minLength?: number;
}

export const RequireExportReason = (config: RequireExportReasonConfig = {}) =>
  SetMetadata(REQUIRE_EXPORT_REASON_META, config);

export interface RequestWithExportReason {
  body?: { exportReason?: string } & Record<string, unknown>;
  query?: { exportReason?: string } & Record<string, unknown>;
  // Attached by this guard for the AuditLogInterceptor to pick up.
  exportReason?: string;
}

@Injectable()
export class DataExportGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const config = this.reflector.get<RequireExportReasonConfig | undefined>(
      REQUIRE_EXPORT_REASON_META,
      context.getHandler(),
    );
    if (!config) return true;

    const minLength = config.minLength ?? 10;
    const req = context
      .switchToHttp()
      .getRequest<RequestWithExportReason>();
    const reason =
      (typeof req.body?.exportReason === 'string' && req.body.exportReason) ||
      (typeof req.query?.exportReason === 'string' && req.query.exportReason) ||
      '';
    const trimmed = reason.trim();
    if (trimmed.length < minLength) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `exportReason is required (min ${minLength} chars) for endpoints that emit documents containing personal data.`,
        { field: 'exportReason', minLength },
      );
    }
    req.exportReason = trimmed;
    return true;
  }
}

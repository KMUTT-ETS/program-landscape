import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError } from '@kku/shared';
import type { ApiFailure, SessionUser } from '@kku/shared';

// Maps any thrown exception to the ApiFailure envelope. ApiError gives us
// a code taxonomy; built-in HttpException maps to a compatible shape;
// anything else becomes INTERNAL (logged, no stack exposed to the client).
//
// Logging contract (prompt 13):
//   Every caught error logs at level=error with:
//     { requestId, userId, route, method, code, status, stack? }
//   The stack is included in the LOG ONLY (never the response body, in
//   any environment).
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request & { user?: SessionUser; id?: string }>();
    const res = host.switchToHttp().getResponse<Response>();

    const { status, body } = this.toEnvelope(exception);

    // Structured error log — operator can recover the full request
    // path from the requestId.
    this.logError(exception, status, body.error.code, req);

    res.status(status).json(body);
  }

  private toEnvelope(e: unknown): { status: number; body: ApiFailure } {
    if (e instanceof ApiError) {
      const status = statusForCode(e.code);
      return {
        status,
        body: {
          data: null,
          meta: null,
          error: { code: e.code, message: e.message, details: e.details },
        },
      };
    }

    if (e instanceof HttpException) {
      const status = e.getStatus();
      const resp = e.getResponse();
      const message =
        typeof resp === 'string'
          ? resp
          : (resp as { message?: string | string[] }).message
              ? String((resp as { message: string | string[] }).message)
              : e.message;
      return {
        status,
        body: {
          data: null,
          meta: null,
          error: {
            code: codeForStatus(status),
            message,
          },
        },
      };
    }

    return {
      status: 500,
      body: {
        data: null,
        meta: null,
        error: { code: 'INTERNAL', message: 'Internal server error' },
      },
    };
  }

  private logError(
    e: unknown,
    status: number,
    code: string,
    req: Request & { user?: SessionUser; id?: string },
  ): void {
    const ctx = {
      requestId: req.id ?? (req.headers['x-request-id'] as string | undefined) ?? null,
      userId: req.user?.userId ?? null,
      method: req.method,
      route: req.originalUrl ?? req.url,
      status,
      code,
      // stack is for ops only — never the response body. The pino
      // redaction layer doesn't strip stacks (they're not PII), but
      // the body never gets one in any environment.
      stack: e instanceof Error ? e.stack : undefined,
      message: e instanceof Error ? e.message : String(e),
    };

    // 5xx (incl. unhandled) → error level. 4xx → warn (caller-fault is
    // not a system error). ApiError + HttpException both flow through
    // here so the level distinction stays consistent.
    if (status >= 500) {
      this.logger.error(`[${code}] ${req.method} ${req.originalUrl ?? req.url}`, JSON.stringify(ctx));
    } else {
      this.logger.warn(`[${code}] ${req.method} ${req.originalUrl ?? req.url}`, JSON.stringify(ctx));
    }
  }
}

function statusForCode(code: string): number {
  switch (code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
    case 'SCOPE_DENIED':
      return 403;
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION_FAILED':
      return 400;
    case 'RATE_LIMITED':
      return 429;
    case 'UPSTREAM_UNAVAILABLE':
    case 'AI_PROVIDER_ERROR':
      return 502;
    default:
      return 500;
  }
}

function codeForStatus(status: number): string {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 400) return 'VALIDATION_FAILED';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL';
}

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '@kku/shared';
import type { ApiFailure } from '@kku/shared';

// Maps any thrown exception to the ApiFailure envelope. ApiError gives us
// a code taxonomy; built-in HttpException maps to a compatible shape;
// anything else becomes INTERNAL (logged, no stack exposed to the client).
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    const { status, body } = this.toEnvelope(exception);
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

    this.logger.error(
      'Unhandled exception',
      e instanceof Error ? e.stack : String(e),
    );
    return {
      status: 500,
      body: {
        data: null,
        meta: null,
        error: { code: 'INTERNAL', message: 'Internal server error' },
      },
    };
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

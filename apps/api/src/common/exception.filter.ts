import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, scrubString } from '@kku/shared';
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
/** What a caller and the log see when the request body was not valid JSON. */
export const MALFORMED_JSON_MESSAGE = 'Malformed JSON body';

/** Wording of V8's JSON.parse errors, which body-parser rethrows verbatim. */
const JSON_PARSE_MESSAGE_RE =
  /is not valid JSON|Unexpected token|JSON at position|Unexpected end of JSON input|Unexpected non-whitespace character/;

/**
 * True when the exception is a request-body JSON parse failure.
 *
 * body-parser throws a SyntaxError whose message QUOTES the body it could not
 * parse — for the external staff-profile endpoint that is a citizen id or an
 * email. Nest's RoutesResolver.mapExternalException turns it into
 * `new BadRequestException(err.message)` with no `cause`, so the message is
 * the reliable signal; `cause instanceof SyntaxError` is checked as well in
 * case a future Nest version starts attaching it.
 */
export function isBodyParseFailure(e: unknown): boolean {
  // A RAW SyntaxError is a body-parse failure only when it carries
  // body-parser's marker. Nest wraps real body-parser errors in a
  // BadRequestException, so any other raw SyntaxError (a bad JSON.parse, an
  // upstream HTML page fed to res.json()) is a server-side fault and must stay a 500.
  if (e instanceof SyntaxError) {
    return (e as { type?: unknown }).type === 'entity.parse.failed';
  }
  if (!(e instanceof HttpException) || e.getStatus() !== 400) return false;
  if (e.cause instanceof SyntaxError) return true;
  return JSON_PARSE_MESSAGE_RE.test(e.message);
}

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

    if (isBodyParseFailure(e)) {
      return {
        status: 400,
        body: {
          data: null,
          meta: null,
          error: { code: 'VALIDATION_FAILED', message: MALFORMED_JSON_MESSAGE },
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
    // A parse failure's message and stack both carry the raw body.
    const parseFailure = isBodyParseFailure(e);
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
      stack: !parseFailure && e instanceof Error ? e.stack : undefined,
      message: parseFailure ? MALFORMED_JSON_MESSAGE : e instanceof Error ? e.message : String(e),
    };

    // 5xx (incl. unhandled) → error level. 4xx → warn (caller-fault is
    // not a system error). ApiError + HttpException both flow through
    // here so the level distinction stays consistent.
    //
    // IMPORTANT: embed ctx in the MESSAGE string. Passing it as a second
    // arg (`logger.error(msg, JSON.stringify(ctx))`) silently DROPS it
    // under nestjs-pino (extra string params are treated as context
    // labels, not payload) — prod 500s logged with no message/stack for
    // weeks because of exactly that (found 2026-07-09 debugging the
    // /pdfs/upload failure).
    //
    // The whole line is id-scrubbed: pino's formatters.log never sees the
    // message string, so nothing downstream would catch an id in it.
    const line = scrubString(
      `[${code}] ${req.method} ${req.originalUrl ?? req.url} ${JSON.stringify(ctx)}`,
    );
    if (status >= 500) {
      this.logger.error(line);
    } else {
      this.logger.warn(line);
    }
  }
}

export function statusForCode(code: string): number {
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

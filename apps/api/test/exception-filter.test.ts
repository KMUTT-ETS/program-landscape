import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { ApiError } from '@kku/shared';
import {
  GlobalExceptionFilter,
  MALFORMED_JSON_MESSAGE,
  isBodyParseFailure,
} from '../src/common/exception.filter';

const RAW_ID = '1101700203883';
const EMAIL = 'secret.person@kku.ac.th';

/** What body-parser throws, and what Nest's RoutesResolver.mapExternalException
 *  turns it into: `new BadRequestException(err.message)`. */
function nestParseFailure(parserMessage: string): BadRequestException {
  const parserErr = new SyntaxError(parserMessage);
  return new BadRequestException(parserErr.message);
}

function run(exception: unknown) {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  const req = { method: 'POST', originalUrl: '/api/v1/external/staff-profile', headers: {} };
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  new GlobalExceptionFilter().catch(exception, host);
  const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
  return { status: res.status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0], logged };
}

afterEach(() => vi.restoreAllMocks());

describe('GlobalExceptionFilter — malformed JSON bodies', () => {
  it.each([
    `Unexpected token '"', ""${RAW_ID}"" is not valid JSON`,
    `Unexpected token 's', "${EMAIL}" is not valid JSON`,
    `Expected ',' or '}' after property value in JSON at position 27 (line 1 column 28) {"citizenId": ${RAW_ID} "email": "${EMAIL}"`,
  ])('neither returns nor logs the body it could not parse: %s', (parserMessage) => {
    const { status, body, logged } = run(nestParseFailure(parserMessage));
    expect(status).toBe(400);
    expect(body.error.message).toBe(MALFORMED_JSON_MESSAGE);
    const sent = JSON.stringify(body);
    for (const secret of [RAW_ID, EMAIL, 'secret.per']) {
      expect(sent).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain(MALFORMED_JSON_MESSAGE);
  });

  it('recognises a body-parser SyntaxError (by its marker) and a SyntaxError cause', () => {
    expect(isBodyParseFailure(new SyntaxError('x'))).toBe(false);
    const marked = Object.assign(new SyntaxError('x'), { type: 'entity.parse.failed' });
    expect(isBodyParseFailure(marked)).toBe(true);
    expect(
      isBodyParseFailure(new BadRequestException('bad', { cause: new SyntaxError('x') })),
    ).toBe(true);
    expect(isBodyParseFailure(new BadRequestException('page must be a number'))).toBe(false);
    expect(isBodyParseFailure(new NotFoundException('Unexpected token'))).toBe(false);
  });

  it('keeps an ordinary HttpException message', () => {
    const { body } = run(new BadRequestException('page must be a number'));
    expect(body.error.message).toBe('page must be a number');
  });
});

describe('GlobalExceptionFilter — server-side SyntaxError', () => {
  it('reports an unmarked SyntaxError as a 500 INTERNAL and still scrubs its log line', () => {
    const err = new SyntaxError(
      `Unexpected token '<', "<!DOCTYPE "... is not valid JSON ${RAW_ID}`,
    );
    const { status, body, logged } = run(err);
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toBe(MALFORMED_JSON_MESSAGE);
    expect(logged).not.toContain(RAW_ID);
    expect(logged).toContain('[REDACTED:THAI_ID]');
    expect(logged).toContain('is not valid JSON');
  });
});

describe('GlobalExceptionFilter — log scrubbing', () => {
  it('scrubs a citizen id out of a long log line', () => {
    const { logged } = run(new ApiError('INTERNAL', `lookup failed for ${RAW_ID} ${'x'.repeat(300)}`));
    expect(logged).not.toContain(RAW_ID);
    expect(logged).toContain('[REDACTED:THAI_ID]');
  });
});

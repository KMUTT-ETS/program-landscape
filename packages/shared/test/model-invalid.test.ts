// packages/shared/test/model-invalid.test.ts
import { describe, it, expect } from 'vitest';
import { isModelInvalidError } from '../src/ai/model-invalid';

describe('isModelInvalidError', () => {
  it('classifies the real production 400', () => {
    // Verbatim from prod, KKU-SEQ-0002, 2026-09-07.
    const err = new Error(
      '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
    );
    expect(isModelInvalidError(err)).toBe(true);
  });

  it('classifies a 404 model-not-found', () => {
    const err = new Error(
      '{"error":{"code":404,"message":"models/gemini-9.9-flash is not found for API version v1beta","status":"NOT_FOUND"}}',
    );
    expect(isModelInvalidError(err)).toBe(true);
  });

  it('does NOT classify a 429 — that is the transient wrapper\'s job', () => {
    const err = new Error('{"error":{"code":429,"message":"Resource exhausted","status":"RESOURCE_EXHAUSTED"}}');
    expect(isModelInvalidError(err)).toBe(false);
  });

  it('does NOT classify a 500', () => {
    const err = new Error('{"error":{"code":500,"message":"Internal error","status":"INTERNAL"}}');
    expect(isModelInvalidError(err)).toBe(false);
  });

  it('does NOT classify a schema-validation failure — the response arrived', () => {
    const err = new Error('AiService extractStructured: response failed schema validation (issues=[])');
    expect(isModelInvalidError(err)).toBe(false);
  });

  it('is safe on non-Error input', () => {
    expect(isModelInvalidError(undefined)).toBe(false);
    expect(isModelInvalidError('boom')).toBe(false);
  });
});

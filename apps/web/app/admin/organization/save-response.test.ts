import { describe, expect, it } from 'vitest';
import { readSaveResponse } from './save-response';

describe('readSaveResponse', () => {
  it('reads a JSON envelope', async () => {
    const res = new Response(JSON.stringify({ error: { code: 'ORG_VERSION_CONFLICT', message: 'x' } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
    const out = await readSaveResponse(res);
    expect(out.errorCode).toBe('ORG_VERSION_CONFLICT');
    expect(out.errorMessage).toBe('x');
  });

  it('turns a non-JSON error body (nginx 502 HTML) into "Save failed (<status>)"', async () => {
    const res = new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 });
    const out = await readSaveResponse(res);
    expect(out.errorCode).toBeNull();
    expect(out.errorMessage).toBe('Save failed (502)');
    expect(out.body).toBeNull();
  });

  it('falls back to the status when a JSON error carries no message', async () => {
    const res = new Response(JSON.stringify({}), { status: 500 });
    expect((await readSaveResponse(res)).errorMessage).toBe('Save failed (500)');
  });
});

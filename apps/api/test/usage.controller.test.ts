import { HttpCode } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Throttle } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@kku/shared';

import { PERMISSION_META } from '../src/common/decorators';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import {
  DetailWindowQuery,
  PageViewBody,
  UsageController,
  WindowQuery,
} from '../src/usage/usage.controller';
import type { UsageService } from '../src/usage/usage.service';

// Identity comes from the session, never the body; the body only ever
// carries what the browser saw. These are unit tests around the controller
// with a stubbed service — permission gating is asserted separately via
// can() in packages/shared, and the decorators are asserted by reflection.

const user = {
  userId: 'u1',
  role: 'FACULTY_USER',
  facultyId: 'f1',
  departmentId: null,
  programId: null,
  email: 'x@kku.ac.th',
  name: null,
} as never;

type RecordArg = Record<string, unknown>;

function firstArg(record: { mock: { calls: unknown[][] } }): RecordArg {
  return record.mock.calls[0]![0] as RecordArg;
}

const noHeaders = { header: () => undefined, cookies: {} } as never;

const windowQuery = (query: Record<string, unknown>) =>
  new ZodValidationPipe(WindowQuery).transform(query, {} as never);

describe('UsageController.recordPageView', () => {
  it('ignores identity fields in the body and passes the session identity', async () => {
    const record = vi.fn(async () => undefined);
    const c = new UsageController({ record } as unknown as UsageService);

    await c.recordPageView(
      {
        path: '/programs/cmtzdam3m0001fd72f65igks4',
        userId: 'attacker',
        role: 'SUPER_ADMIN',
      } as never,
      user,
      noHeaders,
    );

    expect(record).toHaveBeenCalledTimes(1);
    const arg = firstArg(record);
    expect(arg.userId).toBe('u1');
    expect(arg.role).toBe('FACULTY_USER');
    expect(arg.viewerFacultyId).toBe('f1');
    expect(arg.impersonated).toBe(false);
    expect(arg.rawPath).toBe('/programs/cmtzdam3m0001fd72f65igks4');
  });

  it('passes scope and programId through, defaulting scopeId to null', async () => {
    const record = vi.fn(async () => undefined);
    const c = new UsageController({ record } as unknown as UsageService);

    await c.recordPageView(
      { path: '/programs/p1', scope: 'program', programId: 'p1' } as never,
      user,
      noHeaders,
    );

    const arg = firstArg(record);
    expect(arg.scope).toBe('program');
    expect(arg.programId).toBe('p1');
    expect(arg.scopeId).toBeNull();
  });

  it('returns an enveloped body rather than a bodiless 204', async () => {
    // apiFetch() on the web side always calls res.json(); a 204 arrives
    // there as a parse failure that only a special case rescues. Give it
    // something to parse.
    const c = new UsageController({
      record: vi.fn(async () => undefined),
    } as unknown as UsageService);

    await expect(c.recordPageView({ path: '/cockpit' } as never, user, noHeaders)).resolves.toEqual(
      { recorded: true },
    );
  });

  it('marks the view impersonated when JwtAuthGuard stamped the request', async () => {
    // JwtAuthGuard is the only place that still knows the real role; it
    // publishes its decision as req.impersonated after substituting the
    // role (see jwt-auth.guard.ts). The controller reads that stamp —
    // never header/cookie presence, which anyone can forge.
    const record = vi.fn(async () => undefined);
    const c = new UsageController({ record } as unknown as UsageService);

    await c.recordPageView({ path: '/cockpit' } as never, user, {
      header: () => undefined,
      cookies: {},
      impersonated: true,
    } as never);

    expect(firstArg(record).impersonated).toBe(true);
  });

  it('records impersonated=false for a junk cookie/header the guard never stamped', async () => {
    // Anyone can set an arbitrary kku-impersonate cookie or x-kku-impersonate
    // header. Only JwtAuthGuard's stamp — set after canImpersonate() passes
    // AND the payload decodes — means anything; presence alone must not
    // flip this, or any account could opt its own views out of tracking
    // (every reader filters impersonated = false).
    const record = vi.fn(async () => undefined);
    const c = new UsageController({ record } as unknown as UsageService);

    await c.recordPageView({ path: '/cockpit' } as never, user, {
      header: (n: string) => (n === 'x-kku-impersonate' ? 'payload' : undefined),
      cookies: { 'kku-impersonate': 'x' },
    } as never);

    expect(firstArg(record).impersonated).toBe(false);
  });

  it('reports a write failure as a 2xx body, never a throw', async () => {
    // A page view is telemetry: a failed write must never fail the request
    // or page ops. One warn line, no stack, and the client learns nothing
    // it would act on — the beacon discards the response either way.
    const c = new UsageController({
      record: vi.fn(async () => {
        throw new Error('db down');
      }),
    } as unknown as UsageService);
    const warn = vi.spyOn(c['logger'], 'warn').mockImplementation(() => undefined);

    await expect(c.recordPageView({ path: '/cockpit' } as never, user, noHeaders)).resolves.toEqual(
      { recorded: false },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('db down');
  });
});

describe('UsageController query forwarding', () => {
  it('forwards days/excludeAdmins/facultyId to service.programs', () => {
    const programs = vi.fn(async () => []);
    const c = new UsageController({ programs } as unknown as UsageService);

    c.programs(windowQuery({ days: '7', excludeAdmins: 'false', facultyId: 'fac-9' }));

    expect(programs).toHaveBeenCalledWith(7, false, 'fac-9');
  });

  it('forwards days/excludeAdmins to service.summary', () => {
    const summary = vi.fn(async () => ({}));
    const c = new UsageController({ summary } as unknown as UsageService);

    c.summary(windowQuery({ days: '7', excludeAdmins: 'false' }));

    expect(summary).toHaveBeenCalledWith(7, false);
  });

  it('defaults to days=30, excludeAdmins=true, facultyId=null on service.programs', () => {
    const programs = vi.fn(async () => []);
    const c = new UsageController({ programs } as unknown as UsageService);

    c.programs(windowQuery({}));

    expect(programs).toHaveBeenCalledWith(30, true, null);
  });
});

describe('UsageController permissions (by reflection)', () => {
  const perm = (method: string): unknown =>
    Reflect.getMetadata(
      PERMISSION_META,
      UsageController.prototype[method as keyof UsageController] as object,
    );

  it('aggregate endpoints require usage:read:aggregate', () => {
    for (const m of ['summary', 'modules', 'programs', 'roles', 'faculties', 'actions']) {
      expect(perm(m), m).toBe('usage:read:aggregate');
    }
  });

  it('detail endpoints require usage:read:detail', () => {
    for (const m of ['users', 'userTimeline', 'programViewers']) {
      expect(perm(m), m).toBe('usage:read:detail');
    }
  });

  it('the beacon endpoint is not permission-gated beyond authentication', () => {
    // Any signed-in user records their own views; usage:read:* gates
    // reading other people's, not writing your own.
    expect(perm('recordPageView')).toBeUndefined();
  });

  it('the beacon endpoint is throttled identically to a reference @Throttle decorator', () => {
    // @nestjs/throttler v6 stores metadata under bucket-suffixed keys whose
    // exact names are an implementation detail; compare against a reference
    // decorator application rather than hardcoding key strings.
    class Reference {
      @Throttle({ default: { limit: 60, ttl: 60_000 } })
      method() {}
    }
    const handler = UsageController.prototype.recordPageView as object;
    const ref = Reference.prototype.method as object;
    const keys = Reflect.getMetadataKeys(ref);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(Reflect.getMetadata(key, handler), key).toEqual(Reflect.getMetadata(key, ref));
    }
  });

  it('the beacon endpoint always answers 200, matching a reference @HttpCode(200) decorator', () => {
    class Reference {
      @HttpCode(200)
      method() {}
    }
    const handler = UsageController.prototype.recordPageView as object;
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toEqual(
      Reflect.getMetadata(HTTP_CODE_METADATA, Reference.prototype.method as object),
    );
  });
});

describe('PageViewBody', () => {
  const parse = (b: Record<string, unknown>) =>
    new ZodValidationPipe(PageViewBody).transform(b, {} as never);

  it('strips identity keys from the body before the handler sees it', () => {
    expect(parse({ path: '/cockpit', userId: 'attacker', role: 'SUPER_ADMIN' })).toEqual({
      path: '/cockpit',
    });
  });

  it('rejects an empty path and one over 512 characters', () => {
    expect(() => parse({ path: '' })).toThrow(ApiError);
    expect(() => parse({ path: `/${'x'.repeat(512)}` })).toThrow(ApiError);
  });
});

describe('WindowQuery', () => {
  const pipe = new ZodValidationPipe(WindowQuery);
  const parse = (query: Record<string, unknown>) => pipe.transform(query, {} as never);

  it('rejects a days value outside the allowed windows (7/30/90/365)', () => {
    expect(() => parse({ days: '5' })).toThrow(ApiError);
    try {
      parse({ days: '5' });
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('accepts a valid days value', () => {
    expect(parse({ days: '90' }).days).toBe(90);
  });

  it('accepts days=365 for aggregate reads (no retention ceiling)', () => {
    expect(parse({ days: '365' }).days).toBe(365);
  });

  it('defaults days to 30 when absent', () => {
    expect(parse({}).days).toBe(30);
  });

  it('defaults excludeAdmins to true when absent', () => {
    expect(parse({}).excludeAdmins).toBe(true);
  });

  it('parses excludeAdmins=false to false', () => {
    expect(parse({ excludeAdmins: 'false' }).excludeAdmins).toBe(false);
  });

  it('rejects a q longer than 80 characters', () => {
    expect(() => parse({ q: 'x'.repeat(81) })).toThrow(ApiError);
    expect(parse({ q: 'x'.repeat(80) }).q).toHaveLength(80);
  });
});

describe('DetailWindowQuery', () => {
  // The timeline and viewer endpoints read raw page_views, which is swept
  // at RAW_RETENTION_DAYS (120). A days value the aggregate endpoints
  // accept can still be too wide for these two.
  const pipe = new ZodValidationPipe(DetailWindowQuery);
  const parse = (query: Record<string, unknown>) => pipe.transform(query, {} as never);

  it('rejects days=365 — wider than the raw retention window', () => {
    expect(() => parse({ days: '365' })).toThrow(ApiError);
  });

  it('accepts days=90 — within the raw retention window', () => {
    expect(parse({ days: '90' }).days).toBe(90);
  });
});

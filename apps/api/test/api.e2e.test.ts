/**
 * End-to-end API test — boots the real Nest app against the dev Postgres,
 * seeded users, and exercises a few role × endpoint combinations. This
 * proves the full auth + RBAC + envelope chain end to end.
 *
 * Requires: docker postgres running (`pnpm db:up`) and the dev seed loaded
 * (`pnpm db:seed`). It does NOT mutate persisted rows — only reads via GET,
 * plus one PATCH /me/theme that is idempotent under re-run (and the dev
 * admin has theme=SYSTEM → LIGHT → SYSTEM round-trip is easy to repeat).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import * as jose from 'jose';
import request from 'supertest';
import path from 'node:path';
import { prisma, type UserRole } from '@kku/db';

import {
  AccessControlGuard,
  AuditLogInterceptor,
  GlobalExceptionFilter,
  JwtAuthGuard,
  ResponseEnvelopeInterceptor,
} from '../src/common';
import { AppController } from '../src/app.controller';
import { FacultiesController } from '../src/faculties/faculties.controller';
import { DepartmentsController } from '../src/departments/departments.controller';
import { ProgramsController } from '../src/programs/programs.controller';
import { UsersController } from '../src/users/users.controller';
import { DataSourcesModule } from '../src/data-sources/data-sources.module';

let app: INestApplication;
const secretKey = () => new TextEncoder().encode(process.env.NEXTAUTH_SECRET!);

async function signFor(role: UserRole, facultyId: string | null = null, departmentId: string | null = null) {
  // Look up a real seeded user for this role; fall back to a synthetic
  // payload when no row exists (dev seeds historically only carried the
  // 3 SUPER_ADMINs). Synthetic users cannot exercise routes that hit
  // prisma.user — but the auth-only routes (e.g. /me, /faculties) work.
  const realUser = await prisma.user.findFirst({
    where: { role },
    select: { id: true, email: true, name: true, role: true, facultyId: true, departmentId: true, themePreference: true },
  });
  const user = realUser ?? {
    id: `synthetic-${role}`,
    email: `${role.toLowerCase()}@kku.ac.th`,
    name: `Synthetic ${role}`,
    role,
    facultyId: null as string | null,
    departmentId: null as string | null,
    themePreference: 'SYSTEM' as const,
  };
  const payload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    facultyId: facultyId ?? user.facultyId,
    departmentId: departmentId ?? user.departmentId,
    themePreference: user.themePreference,
  };
  const jwt = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey());
  return { jwt, user };
}

// Skip when Postgres isn't reachable — this test is a real end-to-end
// probe that needs `pnpm db:up && pnpm db:seed`. The existence check is
// cheap (~ms) and avoids noisy failures during CI runs that haven't
// provisioned the DB yet.
const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();
const describeIfDb = postgresUp ? describe : describe.skip;

beforeAll(async () => {
  // Make sure env is loaded even when run outside pnpm dev.
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(process.cwd(), '..', '..', '.env') });
  if (!process.env.NEXTAUTH_SECRET) {
    throw new Error('NEXTAUTH_SECRET must be set for e2e tests');
  }

  const modRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 1000 }] }),
      DataSourcesModule,
    ],
    controllers: [
      AppController,
      FacultiesController,
      DepartmentsController,
      ProgramsController,
      UsersController,
    ],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: AccessControlGuard },
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
      { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
  }).compile();

  app = modRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describeIfDb('Public endpoints', () => {
  it('GET /healthz does not require auth', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok' });
  });
});

describeIfDb('Authenticated endpoints — missing token', () => {
  it('401 when no Authorization header', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('UNAUTHORIZED');
  });

  it('401 for a forged token with the wrong secret', async () => {
    const wrongKey = new TextEncoder().encode('x'.repeat(64));
    const bad = await new jose.SignJWT({ userId: 'u1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongKey);
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });
});

// Role names migrated from legacy 7-role taxonomy to v2 (2026-05-09):
//   ADMIN  → SYSTEM_ADMIN
//   COUNCIL → UNIVERSITY_USER  (council tier — read-everywhere)
//   VIEWER → PROGRAM_USER      (narrowest — own-program only)

describeIfDb('/me', () => {
  it('returns identity + permissions for SYSTEM_ADMIN', async () => {
    const { jwt } = await signFor('SYSTEM_ADMIN');
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('SYSTEM_ADMIN');
    expect(res.body.data.permissions.length).toBeGreaterThan(20);
    expect(res.body.meta).toBeDefined();
  });
});

describeIfDb('/data-sources — admin only', () => {
  it('SYSTEM_ADMIN can list', async () => {
    const { jwt } = await signFor('SYSTEM_ADMIN');
    const res = await request(app.getHttpServer())
      .get('/api/v1/data-sources')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('UNIVERSITY_USER is forbidden', async () => {
    const { jwt } = await signFor('UNIVERSITY_USER');
    const res = await request(app.getHttpServer())
      .get('/api/v1/data-sources')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('PROGRAM_USER is forbidden', async () => {
    const { jwt } = await signFor('PROGRAM_USER');
    const res = await request(app.getHttpServer())
      .get('/api/v1/data-sources')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
  });
});

describeIfDb('/programs', () => {
  it('returns programs at university scope for UNIVERSITY_USER', async () => {
    const { jwt } = await signFor('UNIVERSITY_USER');
    const res = await request(app.getHttpServer())
      .get('/api/v1/programs?scope=university')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.scope).toEqual({ level: 'university', id: null });
  });

  it('validates scope parameter (VALIDATION_FAILED for invalid)', async () => {
    const { jwt } = await signFor('UNIVERSITY_USER');
    const res = await request(app.getHttpServer())
      .get('/api/v1/programs?scope=galaxy')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});

describeIfDb('/faculties', () => {
  it('UNIVERSITY_USER can list', async () => {
    const { jwt } = await signFor('UNIVERSITY_USER');
    const res = await request(app.getHttpServer())
      .get('/api/v1/faculties')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.sources).toEqual([
      { id: 'kku-reg', name: 'KKU Registration' },
    ]);
  });
});

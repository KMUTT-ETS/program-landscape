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
  const user = await prisma.user.findFirstOrThrow({
    where: { role },
    select: { id: true, email: true, name: true, role: true, facultyId: true, departmentId: true, themePreference: true },
  });
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

describe('Public endpoints', () => {
  it('GET /healthz does not require auth', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/healthz');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ok' });
  });
});

describe('Authenticated endpoints — missing token', () => {
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

describe('/me', () => {
  it('returns identity + permissions for ADMIN', async () => {
    const { jwt } = await signFor('ADMIN');
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.data.permissions.length).toBeGreaterThan(20);
    expect(res.body.meta).toBeDefined();
  });
});

describe('/data-sources — admin only', () => {
  it('ADMIN can list', async () => {
    const { jwt } = await signFor('ADMIN');
    const res = await request(app.getHttpServer())
      .get('/api/v1/data-sources')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('COUNCIL is forbidden', async () => {
    const { jwt } = await signFor('COUNCIL');
    const res = await request(app.getHttpServer())
      .get('/api/v1/data-sources')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('VIEWER is forbidden', async () => {
    const { jwt } = await signFor('VIEWER');
    const res = await request(app.getHttpServer())
      .get('/api/v1/data-sources')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(403);
  });
});

describe('/programs', () => {
  it('returns programs at university scope for COUNCIL', async () => {
    const { jwt } = await signFor('COUNCIL');
    const res = await request(app.getHttpServer())
      .get('/api/v1/programs?scope=university')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.scope).toEqual({ level: 'university', id: null });
  });

  it('validates scope parameter (VALIDATION_FAILED for invalid)', async () => {
    const { jwt } = await signFor('COUNCIL');
    const res = await request(app.getHttpServer())
      .get('/api/v1/programs?scope=galaxy')
      .set('authorization', `Bearer ${jwt}`);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('/faculties', () => {
  it('COUNCIL can list', async () => {
    const { jwt } = await signFor('COUNCIL');
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

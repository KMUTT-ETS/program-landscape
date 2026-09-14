import { Module, ValidationPipe, type ExecutionContext } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import path from 'node:path';

/**
 * Build a `skipIf` predicate for a named throttler bucket. The bucket
 * fires only when a route's `@Throttle({ <name>: {...} })` decorator
 * (at the method or controller level) explicitly references it.
 *
 * Without this, every configured throttler applies to every route — so
 * a strict bucket like `heavy: 10/min` would rate-limit unrelated
 * endpoints to 10/min. The metadata key `THROTTLER:LIMIT` carries the
 * decorator's record; presence of <name> means opt-in.
 */
function skipUnlessRouteOptsInTo(name: string): (ctx: ExecutionContext) => boolean {
  return (ctx) => {
    const handler = ctx.getHandler();
    const cls = ctx.getClass();
    const meta =
      (Reflect.getMetadata('THROTTLER:LIMIT', handler) as Record<string, unknown> | undefined) ??
      (Reflect.getMetadata('THROTTLER:LIMIT', cls) as Record<string, unknown> | undefined);
    return !meta || !(name in meta);
  };
}

import { buildLoggerModule } from './common/logger.module';
import { CacheService } from './common/cache.service';

import { AppController } from './app.controller';
import { FacultiesController } from './faculties/faculties.controller';
import { DepartmentsController } from './departments/departments.controller';
import { ProgramsModule } from './programs/programs.module';
import { UsersController } from './users/users.controller';
import { DataSourcesModule } from './data-sources/data-sources.module';
import { PdfModule } from './pdf/pdf.module';
import { PdfIntakeModule } from './pdf-intake/pdf-intake.module';
import { SkillsModule } from './skills/skills.module';
import { AiAdminModule } from './ai-admin/ai-admin.module';
import { CockpitModule } from './cockpit/cockpit.module';
import { TrendsModule } from './trends/trends.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GapModule } from './gap/gap.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { BenchmarkingModule } from './benchmarking/benchmarking.module';
import { AnalystModule } from './analyst/analyst.module';
import { DecisionsModule } from './decisions/decisions.module';
import { AdminModule } from './admin/admin.module';
import { AdminDataSetupModule } from './admin-data-setup/admin-data-setup.module';
import { EducationModule } from './education/education.module';
import { StaffDashboardModule } from './staff-dashboard/staff.module';
import { RisksModule } from './risks/risks.module';
import { JobThaiModule } from './jobthai/jobthai.module';
import { UsageModule } from './usage/usage.module';
import { TrendDocumentsModule } from './trend-documents/trend-documents.module';
import { AunqaModule } from './aunqa/aunqa.module';
import { ScholarModule } from './scholar/scholar.module';

import {
  AccessControlGuard,
  AiQuotaGuard,
  AuditLogInterceptor,
  DataExportGuard,
  GlobalExceptionFilter,
  JwtAuthGuard,
  ResponseEnvelopeInterceptor,
  UserAwareThrottlerGuard,
} from './common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        // Primary dev env lives at the repo root; we resolve relative
        // to the running process' CWD and fall back to apps/api/.env.
        path.join(process.cwd(), '..', '..', '.env'),
        path.join(process.cwd(), '.env'),
      ],
    }),
    buildLoggerModule(),
    ThrottlerModule.forRoot({
      throttlers: [
        // Named throttlers — bucket key is the userId for authenticated
        // requests (see UserAwareThrottlerGuard) so each user gets their
        // own counter.
        //
        // CRITICAL: @nestjs/throttler v6 applies EVERY configured throttler
        // to every route by default. Without `skipIf`, the strict buckets
        // (ai_short=20, heavy=10) would silently rate-limit every endpoint
        // including healthz + program list to 10 req/min. We make
        // non-default buckets OPT-IN: they only fire when a route's
        // @Throttle({ <name>: {...} }) decorator references them.
        //
        //   default:   baseline for every API endpoint (always-on)
        //   ai_short:  AI endpoints — burst protection (opt-in)
        //   ai_hourly: AI endpoints — sustained limit (opt-in)
        //   heavy:     PDF generation + exports (opt-in)
        { name: 'default',   ttl: 60_000,           limit: 240 },
        { name: 'ai_short',  ttl: 60_000,           limit: 20,  skipIf: skipUnlessRouteOptsInTo('ai_short') },
        { name: 'ai_hourly', ttl: 60 * 60 * 1000,   limit: 200, skipIf: skipUnlessRouteOptsInTo('ai_hourly') },
        { name: 'heavy',     ttl: 60_000,           limit: 10,  skipIf: skipUnlessRouteOptsInTo('heavy') },
      ],
    }),
    PdfModule,
    DataSourcesModule,
    PdfIntakeModule,
    SkillsModule,
    AiAdminModule,
    CockpitModule,
    ProgramsModule,
    TrendsModule,
    NotificationsModule,
    GapModule,
    ScenariosModule,
    BenchmarkingModule,
    AnalystModule,
    DecisionsModule,
    AdminModule,
    AdminDataSetupModule,
    EducationModule,
    StaffDashboardModule,
    RisksModule,
    JobThaiModule,
    UsageModule,
    TrendDocumentsModule,
    AunqaModule,
    ScholarModule,
  ],
  exports: [CacheService],
  controllers: [
    AppController,
    FacultiesController,
    DepartmentsController,
    UsersController,
  ],
  providers: [
    // Shared cache handle — inject in services that want to wrap
    // expensive queries with a Redis-backed cache.
    CacheService,

    // Global auth chain — every endpoint is authenticated unless marked
    // @Public(). AccessControlGuard runs after JwtAuthGuard and evaluates
    // @RequirePermission / @RequireScope metadata.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessControlGuard },
    // UserAwareThrottlerGuard keys by user ID (not source IP) so each
    // user gets their own bucket. JwtAuthGuard runs first and sets
    // req.user, which the throttler reads.
    { provide: APP_GUARD, useClass: UserAwareThrottlerGuard },
    // Per-user daily AI-cost cap. No-op for routes without @AiQuota().
    { provide: APP_GUARD, useClass: AiQuotaGuard },
    // @RequireExportReason() enforces a textual reason on endpoints that
    // emit documents containing personal data. No-op for unmarked routes.
    { provide: APP_GUARD, useClass: DataExportGuard },

    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },

    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Built-in validation pipe — handles class-validator-decorated DTOs
    // (currently zero in our codebase; ZodValidationPipe handles every
    // route). Kept mounted as defence-in-depth for future class-validator
    // DTOs, but configured to never echo offending values back to the
    // client (PDPA defence — error messages must not become a PII
    // exfiltration channel via crafted-input replay).
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        // Strip the original target object (which carries the user's input)
        // from validation errors. Without this, a failed `IsEmail` on a
        // field named `email` echoes the attempted email value back.
        validationError: { target: false, value: false },
      }),
    },
  ],
})
export class AppModule {}

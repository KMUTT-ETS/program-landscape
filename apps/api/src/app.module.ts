import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import path from 'node:path';

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

import {
  AccessControlGuard,
  AiQuotaGuard,
  AuditLogInterceptor,
  DataExportGuard,
  GlobalExceptionFilter,
  JwtAuthGuard,
  ResponseEnvelopeInterceptor,
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
        // Named throttlers — routes can @Throttle({ name: '...' }) to pick
        // a specific bucket.
        //   default:   baseline for every API endpoint
        //   ai_short:  AI endpoints — burst protection
        //   ai_hourly: AI endpoints — sustained limit (complements daily quota)
        //   heavy:     PDF generation + exports
        { name: 'default',   ttl: 60_000,           limit: 120 },
        { name: 'ai_short',  ttl: 60_000,           limit: 20  },
        { name: 'ai_hourly', ttl: 60 * 60 * 1000,   limit: 200 },
        { name: 'heavy',     ttl: 60_000,           limit: 10  },
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Per-user daily AI-cost cap. No-op for routes without @AiQuota().
    { provide: APP_GUARD, useClass: AiQuotaGuard },
    // @RequireExportReason() enforces a textual reason on endpoints that
    // emit documents containing personal data. No-op for unmarked routes.
    { provide: APP_GUARD, useClass: DataExportGuard },

    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },

    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Built-in validation pipe — handles class-validator-decorated DTOs.
    // ZodValidationPipe is used per-route for the Zod schemas in
    // @kku/shared.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}

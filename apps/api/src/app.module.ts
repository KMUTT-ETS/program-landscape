import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import path from 'node:path';

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

import {
  AccessControlGuard,
  AuditLogInterceptor,
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
    ThrottlerModule.forRoot({
      throttlers: [
        // Conservative default. Module-level overrides for AI endpoints
        // (tighter) and /healthz (disabled) land in prompt 04 / 13.
        { ttl: 60_000, limit: 120 },
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
  ],
  controllers: [
    AppController,
    FacultiesController,
    DepartmentsController,
    UsersController,
  ],
  providers: [
    // Global auth chain — every endpoint is authenticated unless marked
    // @Public(). AccessControlGuard runs after JwtAuthGuard and evaluates
    // @RequirePermission / @RequireScope metadata.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessControlGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },

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

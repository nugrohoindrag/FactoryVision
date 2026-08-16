import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { OtpService } from './auth/otp.service.js';
import { OTP_SENDER, OtpSenderService } from './auth/otp-sender.js';
import { TokensService } from './auth/tokens.service.js';
import { UsersController } from './auth/users.controller.js';
import { AlertService } from './alerts/alert.service.js';
import { AlertsController } from './alerts/alerts.controller.js';
import { PushService } from './alerts/push.service.js';
import { SchedulerService } from './alerts/scheduler.service.js';
import { RateLimitService } from './common/rate-limit.service.js';
import { ENV, env, type Env } from './config/env.js';
import { EventStoreService } from './events/event-store.service.js';
import { HealthController } from './health/health.controller.js';
import { DocumentsController } from './master/documents.controller.js';
import { HistoryImportService } from './master/history-import.service.js';
import { MasterController } from './master/master.controller.js';
import { MasterService } from './master/master.service.js';
import { ProjectionController } from './projection/projection.controller.js';
import { ProjectorService } from './projection/projector.service.js';
import { IngestService } from './sync/ingest.service.js';
import { SyncController } from './sync/sync.controller.js';
import { SyncDownService } from './sync/sync-down.service.js';
import { OpsController } from './ops/ops.controller.js';
import { OpsService } from './ops/ops.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { ExportService } from './reports/export.service.js';
import { ReportsController } from './reports/reports.controller.js';
import { ReportsService } from './reports/reports.service.js';
import { PhotosController } from './storage/photos.controller.js';
import { StorageService } from './storage/storage.service.js';
import { ConfigController } from './tenant/config.controller.js';
import { TenantService } from './tenant/tenant.service.js';

/**
 * Everything is registered by explicit token.
 *
 * `@Inject(PrismaService)` rather than bare constructor typing is not verbosity
 * for its own sake — it is what lets this server run under esbuild (tsx in dev,
 * Vitest in tests) instead of requiring the TypeScript compiler's
 * `emitDecoratorMetadata`. The reasoning is in tsconfig.json; the cost is one
 * decorator per dependency, and the benefit is that the same code boots under
 * every runner in the monorepo.
 */
@Module({})
export class AppModule {
  static register(overrides: Partial<Env> = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        UsersController,
        SyncController,
        ProjectionController,
        MasterController,
        DocumentsController,
        ConfigController,
        AlertsController,
        PhotosController,
        ReportsController,
        OpsController,
      ],
      providers: [
        { provide: ENV, useValue: { ...env(), ...overrides } },
        PrismaService,
        TenantService,
        TokensService,
        OtpService,
        AuthService,
        RateLimitService,
        EventStoreService,
        ProjectorService,
        IngestService,
        SyncDownService,
        MasterService,
        HistoryImportService,
        PushService,
        AlertService,
        SchedulerService,
        StorageService,
        ReportsService,
        ExportService,
        OpsService,
        { provide: OTP_SENDER, useClass: OtpSenderService },
        // Authentication is ON for every route; four routes opt out with
        // `@Public()` and each one says why.
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [PrismaService, TenantService, ProjectorService, EventStoreService],
    };
  }
}

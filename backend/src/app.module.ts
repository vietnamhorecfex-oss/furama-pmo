/**
 * S-08 — Root module. Wires config (validated env), structured logging, Prisma, and health.
 * Feature modules (auth, rbac, projects, …) are registered here as they land per TASK-BREAKDOWN.
 */
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuditModule } from './audit/audit.module';
import { RbacModule } from './rbac/rbac.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { MembersModule } from './members/members.module';
import { ConfigDimModule } from './config-dim/config.module';
import { TasksModule } from './tasks/tasks.module';
import { ImportExportModule } from './import-export/import-export.module';
import { CommentsModule } from './comments/comments.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Monorepo: .env lives at the repo root, one level above backend/.
      envFilePath: ['../.env', '.env'],
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) =>
          (req.headers['x-request-id'] as string) ??
          `req_${Math.random().toString(36).slice(2, 12)}`,
        autoLogging: true,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    PrismaModule,
    AuditModule,
    RbacModule,
    AuthModule,
    ProjectsModule,
    MembersModule,
    ConfigDimModule,
    TasksModule,
    ImportExportModule,
    CommentsModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

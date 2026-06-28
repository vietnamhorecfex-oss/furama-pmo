/**
 * S-08 — Root module. Wires config (validated env), structured logging, Prisma, and health.
 * Feature modules (auth, rbac, projects, …) are registered here as they land per TASK-BREAKDOWN.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';

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
    PrismaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

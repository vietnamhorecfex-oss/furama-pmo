/**
 * S-07/S-08 — API bootstrap. Security middleware, CORS allowlist, structured logging,
 * global error envelope, graceful shutdown.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/error.filter';
import { validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = validateEnv(process.env);

  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [config.WEB_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.listen(config.API_PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`API listening on :${config.API_PORT} (prefix /api/v1)`);
}

void bootstrap();

/**
 * HTTP-level test harness. Bootstraps the full NestJS application (with guards, filters, and
 * middleware) so Supertest requests exercise the real HTTP stack, not just service logic.
 *
 * Usage:
 *   const { app, prisma, agent } = await createHttpTestApp();
 *   const { token } = await registerAndLogin(agent, 'owner');
 *   afterAll(() => teardownHttpTestApp(app, prisma, orgId));
 */
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/error.filter';
import { PrismaService } from '../prisma/prisma.service';

export const SKIP_HTTP = process.env.SKIP_DB_TESTS === '1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HttpAgent = any;

export async function createHttpTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  agent: HttpAgent;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  const agent = request.agent(app.getHttpServer());

  return { app, prisma, agent };
}

export async function teardownHttpTestApp(
  app: INestApplication,
  prisma: PrismaService,
  orgId: string | undefined,
): Promise<void> {
  if (orgId) {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  }
  await app.close();
}

export async function registerAndLogin(
  agent: HttpAgent,
  hint: string,
  orgSlug?: string,
): Promise<{ token: string; userId: string; orgId: string; email: string; password: string }> {
  const slug = (orgSlug ?? `sec-${hint}-${Date.now()}`).toLowerCase();
  const email = `${slug}@example.test`;
  const password = 'TestPass123!';

  const regRes = await agent.post('/api/v1/auth/register').send({ orgSlug: slug, name: hint, email, password });
  if (regRes.status !== 201) {
    throw new Error(`register failed [${regRes.status}]: ${JSON.stringify(regRes.body)}`);
  }
  const loginRes = await agent.post('/api/v1/auth/login').send({ email, password });
  if (!(loginRes.body as { user?: unknown }).user) {
    throw new Error(`login failed [${loginRes.status}]: ${JSON.stringify(loginRes.body)}`);
  }

  return {
    token: (loginRes.body as { accessToken: string }).accessToken,
    userId: (loginRes.body as { user: { id: string } }).user.id,
    orgId: (loginRes.body as { user: { orgId: string } }).user.orgId,
    email,
    password,
  };
}

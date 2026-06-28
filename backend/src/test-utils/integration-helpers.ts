/**
 * Test-only helpers for integration specs. Spins up a slim DI context (config + prisma +
 * audit + rbac) and offers per-test seeding so each suite is isolated via cascade-delete
 * of its org row.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { validateEnv } from '../config/env';

export const SKIP_DB = process.env.SKIP_DB_TESTS === '1';

export interface TestDeps {
  prisma: PrismaService;
  audit: AuditService;
  rbac: RbacService;
  config: ConfigService;
}

export async function bootIntegrationDeps(): Promise<TestDeps> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: ['../.env'],
        validate: validateEnv,
      }),
      PrismaModule,
    ],
    providers: [AuditService, RbacService, ConfigService],
  }).compile();

  const prisma = moduleRef.get(PrismaService);
  const dbUp = await prisma.isHealthy();
  if (!dbUp) {
    throw new Error('Postgres unreachable — start `pnpm infra:up` or set SKIP_DB_TESTS=1');
  }
  return {
    prisma,
    audit: moduleRef.get(AuditService),
    rbac: moduleRef.get(RbacService),
    config: moduleRef.get(ConfigService),
  };
}

export async function makeOrgWithUser(prisma: PrismaService, hint: string) {
  const slug = `${hint}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await prisma.organization.create({ data: { slug, name: slug } });
  const user = await prisma.user.create({
    data: { orgId: org.id, name: hint, email: `${slug}@example.test`, passwordHash: 'noop' },
  });
  return { org, user, ctx: { userId: user.id, orgId: org.id } };
}

export async function cleanupOrg(prisma: PrismaService, orgId: string | undefined) {
  if (!orgId) return;
  await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
}

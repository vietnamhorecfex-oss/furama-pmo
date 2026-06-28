/**
 * A-11 — TokensService integration test.
 *
 * Uses the dev Postgres (5433) because reuse-detection is a transactional behaviour worth
 * exercising end-to-end. Each test seeds its own user and cleans up via cascade-delete of
 * the org row, so runs are independent and the order doesn't matter.
 *
 * Run with:  pnpm -F @furama/backend test
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { validateEnv } from '../config/env';
import { TokensService } from './tokens.service';

const SKIP_INTEGRATION = process.env.SKIP_DB_TESTS === '1';
const itDb = SKIP_INTEGRATION ? it.skip : it;

describe('TokensService (rotation + family revoke)', () => {
  let prisma: PrismaService;
  let tokens: TokensService;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: ['../.env'],
          validate: validateEnv,
        }),
        PrismaModule,
      ],
      providers: [TokensService, ConfigService],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    tokens = moduleRef.get(TokensService);

    if (SKIP_INTEGRATION) return;
    const dbReachable = await prisma.isHealthy();
    if (!dbReachable) {
      throw new Error('Postgres unreachable — start with `pnpm infra:up` or set SKIP_DB_TESTS=1');
    }
  });

  beforeEach(async () => {
    if (SKIP_INTEGRATION) return;
    const slug = `test-tokens-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({ data: { slug, name: slug } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        orgId,
        name: 'Token Test',
        email: `${slug}@example.test`,
        passwordHash: 'unused-for-token-tests',
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    if (SKIP_INTEGRATION) return;
    // Cascade deletes RefreshToken and User via FK rules.
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  itDb('issues access + refresh pair and stores only the hashed secret', async () => {
    const pair = await tokens.issueOnLogin({ id: userId, orgId }, '127.0.0.1');
    expect(pair.accessToken.split('.').length).toBe(3); // JWT
    expect(pair.refreshToken).toContain('.');
    const claims = tokens.verifyAccess(pair.accessToken);
    expect(claims.sub).toBe(userId);

    const stored = await prisma.refreshToken.findMany({ where: { userId } });
    expect(stored).toHaveLength(1);
    // The raw secret must NEVER appear in the DB.
    const secret = pair.refreshToken.split('.', 2)[1]!;
    expect(stored[0]!.tokenHash).not.toContain(secret);
  });

  itDb('rotate replaces the old row and keeps the family alive', async () => {
    const first = await tokens.issueOnLogin({ id: userId, orgId }, '1.1.1.1');
    const second = await tokens.rotate(first.refreshToken, '1.1.1.1');

    expect(second.refreshToken).not.toBe(first.refreshToken);
    const rows = await prisma.refreshToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.revokedAt).not.toBeNull();
    expect(rows[1]!.revokedAt).toBeNull();
    expect(rows[0]!.familyId).toBe(rows[1]!.familyId);
  });

  itDb('reuse of an already-rotated refresh token revokes the entire family', async () => {
    const first = await tokens.issueOnLogin({ id: userId, orgId }, '1.1.1.1');
    const second = await tokens.rotate(first.refreshToken, '1.1.1.1');

    // Attacker replays the original (already revoked) token.
    await expect(tokens.rotate(first.refreshToken, '9.9.9.9')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    // The legitimate next token (second) must also be dead now (whole family revoked).
    await expect(tokens.rotate(second.refreshToken, '1.1.1.1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const rows = await prisma.refreshToken.findMany({ where: { userId } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });

  itDb('rejects malformed and unknown refresh tokens with 401', async () => {
    await expect(tokens.rotate('not-a-token', null)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(tokens.rotate('aaa.bbb', null)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

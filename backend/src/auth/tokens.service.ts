/**
 * A-04 — TokensService. JWT access token + refresh-token rotation with family revocation.
 *
 * Refresh-token model (ADR-4):
 *  - Each successful login mints a NEW family (UUID), one row in RefreshToken.
 *  - Rotation issues a new token in the SAME family and marks the prior row revoked.
 *  - Replaying a revoked/already-rotated refresh token = theft → revoke ENTIRE family
 *    so the attacker AND legitimate session are both locked out (forces re-login).
 *  - Token value sent to the client is `${tokenId}.${secret}`. DB stores only SHA-256(secret),
 *    so a DB leak does not expose usable refresh tokens.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import type { AppConfig } from '../config/env';

export interface AccessTokenClaims {
  sub: string; // userId
  orgId: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string; // raw value to send to client (id.secret)
  refreshExpiresAt: Date;
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly accessSecret: string;
  private readonly accessTtlSec: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.accessSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
    this.accessTtlSec = config.get('JWT_ACCESS_TTL', { infer: true });
    this.refreshTtlDays = config.get('REFRESH_TTL_DAYS', { infer: true });
  }

  signAccess(claims: AccessTokenClaims): string {
    return jwt.sign(claims, this.accessSecret, {
      expiresIn: this.accessTtlSec,
      algorithm: 'HS256',
    });
  }

  verifyAccess(token: string): AccessTokenClaims {
    try {
      const decoded = jwt.verify(token, this.accessSecret, { algorithms: ['HS256'] });
      if (typeof decoded !== 'object' || decoded === null || !('sub' in decoded)) {
        throw new UnauthorizedException('Invalid token payload');
      }
      const { sub, orgId } = decoded as Record<string, unknown>;
      if (typeof sub !== 'string' || typeof orgId !== 'string') {
        throw new UnauthorizedException('Invalid token payload');
      }
      return { sub, orgId };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /** Mint a brand-new token family for a fresh login. */
  async issueOnLogin(
    user: { id: string; orgId: string },
    ip: string | null,
  ): Promise<IssuedTokens> {
    const familyId = randomUUID();
    return this.mintRefresh(user, familyId, ip);
  }

  /**
   * Rotate a refresh token. Returns the new pair on success. Detects reuse (a refresh row
   * was revoked but is being presented again) and revokes the entire family, returning 401.
   */
  async rotate(
    rawRefreshToken: string,
    ip: string | null,
  ): Promise<IssuedTokens> {
    const parsed = parseRefreshTokenValue(rawRefreshToken);
    if (!parsed) throw new UnauthorizedException('Invalid refresh token');

    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: parsed.hash },
    });
    if (!row) throw new UnauthorizedException('Invalid refresh token');

    // Reuse detection: row exists but is already revoked / already replaced.
    if (row.revokedAt || row.replacedById) {
      this.logger.warn(
        `Refresh-token reuse detected (family=${row.familyId}, user=${row.userId}); revoking family`,
      );
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    const minted = await this.mintRefresh(
      { id: user.id, orgId: user.orgId },
      row.familyId,
      ip,
    );
    // Atomically mark the old row replaced and revoked. Use updateMany guarded by revokedAt=null
    // so a parallel rotation cannot succeed twice for the same row.
    const updated = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: parsed.id /* we put the new id below */ },
    });
    if (updated.count === 0) {
      // Parallel rotation happened; treat as reuse and revoke family.
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    return minted;
  }

  /** Revoke a refresh token + its entire family. Used on logout. */
  async revokeByRawToken(rawRefreshToken: string): Promise<void> {
    const parsed = parseRefreshTokenValue(rawRefreshToken);
    if (!parsed) return;
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: parsed.hash },
    });
    if (!row) return;
    await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ----- private -----

  private async mintRefresh(
    user: { id: string; orgId: string },
    familyId: string,
    ip: string | null,
  ): Promise<IssuedTokens> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const raw = `${id}.${secret}`;
    const hash = sha256(secret);
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        id,
        userId: user.id,
        familyId,
        tokenHash: hash,
        expiresAt,
        createdByIp: ip ?? null,
      },
    });

    return {
      accessToken: this.signAccess({ sub: user.id, orgId: user.orgId }),
      refreshToken: raw,
      refreshExpiresAt: expiresAt,
    };
  }
}

function parseRefreshTokenValue(raw: string): { id: string; hash: string } | null {
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const id = raw.slice(0, dot);
  const secret = raw.slice(dot + 1);
  return { id, hash: sha256(secret) };
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

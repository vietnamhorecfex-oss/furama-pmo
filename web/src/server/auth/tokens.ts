import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma';
import { getConfig } from '../config';
import { Unauthorized } from '../http/errors';

export interface AccessTokenClaims { sub: string; orgId: string }
export interface IssuedTokens { accessToken: string; refreshToken: string; refreshExpiresAt: Date }

export function signAccess(claims: AccessTokenClaims): string {
  const c = getConfig();
  return jwt.sign(claims, c.JWT_ACCESS_SECRET, { expiresIn: c.JWT_ACCESS_TTL, algorithm: 'HS256' });
}

export function verifyAccess(token: string): AccessTokenClaims {
  const c = getConfig();
  try {
    const decoded = jwt.verify(token, c.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) throw new Unauthorized('Invalid token payload');
    const { sub, orgId } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof orgId !== 'string') throw new Unauthorized('Invalid token payload');
    return { sub, orgId };
  } catch (err) {
    if (err instanceof Unauthorized) throw err;
    throw new Unauthorized('Invalid or expired token');
  }
}

function sha256(input: string): string { return createHash('sha256').update(input).digest('hex'); }
function parseRefresh(raw: string): { id: string; hash: string } | null {
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { id: raw.slice(0, dot), hash: sha256(raw.slice(dot + 1)) };
}

async function mintRefresh(user: { id: string; orgId: string }, familyId: string, ip: string | null) {
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const hash = sha256(secret);
  const expiresAt = new Date(Date.now() + getConfig().REFRESH_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({
    data: { id, userId: user.id, familyId, tokenHash: hash, expiresAt, createdByIp: ip ?? null },
  });
  return {
    newId: id,
    tokens: { accessToken: signAccess({ sub: user.id, orgId: user.orgId }), refreshToken: `${id}.${secret}`, refreshExpiresAt: expiresAt } as IssuedTokens,
  };
}

export async function issueOnLogin(user: { id: string; orgId: string }, ip: string | null): Promise<IssuedTokens> {
  return (await mintRefresh(user, randomUUID(), ip)).tokens;
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function rotate(rawRefreshToken: string, ip: string | null): Promise<IssuedTokens> {
  const parsed = parseRefresh(rawRefreshToken);
  if (!parsed) throw new Unauthorized('Invalid refresh token');
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: parsed.hash } });
  if (!row) throw new Unauthorized('Invalid refresh token');
  if (row.id !== parsed.id) throw new Unauthorized('Invalid refresh token');
  if (row.revokedAt || row.replacedById) {
    // Reuse detected: revoke the entire family to invalidate all tokens in this lineage
    await revokeFamily(row.familyId);
    throw new Unauthorized('Refresh token reuse detected');
  }
  if (row.expiresAt.getTime() <= Date.now()) throw new Unauthorized('Refresh token expired');
  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.isActive) throw new Unauthorized('User is inactive');

  // Mint the new token FIRST so we have its id to record in replacedById
  // FIX: The original NestJS rotate() set replacedById = parsed.id (old token's id),
  // which is wrong — it should be the NEW token's id. We thread newId back from mintRefresh
  // and store it correctly as the forward pointer from old → new.
  const minted = await mintRefresh({ id: user.id, orgId: user.orgId }, row.familyId, ip);
  const updated = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date(), replacedById: minted.newId },
  });
  if (updated.count === 0) {
    // Race condition: another request already rotated this token
    await revokeFamily(row.familyId);
    throw new Unauthorized('Refresh token reuse detected');
  }
  return minted.tokens;
}

export async function revokeByRawToken(rawRefreshToken: string): Promise<void> {
  const parsed = parseRefresh(rawRefreshToken);
  if (!parsed) return;
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: parsed.hash } });
  if (!row) return;
  if (row.id !== parsed.id) return;
  await revokeFamily(row.familyId);
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { issueOnLogin, rotate, verifyAccess } from './tokens';

let userId: string;
let orgId: string;

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { slug: `t-${Date.now()}`, name: 'T' } });
  orgId = org.id;
  const u = await prisma.user.create({
    data: { orgId, name: 'T', email: `t-${Date.now()}@x.test`, passwordHash: 'x', isActive: true },
  });
  userId = u.id;
});
afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('tokens', () => {
  it('issues an access token carrying sub+orgId', async () => {
    const t = await issueOnLogin({ id: userId, orgId }, null);
    expect(verifyAccess(t.accessToken)).toEqual({ sub: userId, orgId });
  });
  it('rotates a refresh token and detects reuse → family revoked', async () => {
    const first = await issueOnLogin({ id: userId, orgId }, null);
    const second = await rotate(first.refreshToken, null);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // replaying the now-rotated first token is reuse → throws
    await expect(rotate(first.refreshToken, null)).rejects.toThrow(/reuse/i);
    // the legitimate second token is now also revoked (family killed)
    await expect(rotate(second.refreshToken, null)).rejects.toThrow();
  });
});

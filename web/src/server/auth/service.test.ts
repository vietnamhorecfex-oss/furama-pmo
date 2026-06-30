import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { registerUser, loginUser } from './service';

const email = `svc-${Date.now()}@acme.test`;
afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { email } } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

describe('auth service', () => {
  it('registers then logs in, returning an access token + public user', async () => {
    await registerUser({ name: 'Svc', email, password: 'Sup3rSecret!' } as any, null);
    const { tokens, response } = await loginUser({ email, password: 'Sup3rSecret!' } as any, null);
    expect(tokens.accessToken).toMatch(/\./);
    expect(response.user.email).toBe(email.toLowerCase());
    expect((response.user as any).passwordHash).toBeUndefined();
  });
  it('rejects a wrong password with a generic 401', async () => {
    await expect(loginUser({ email, password: 'wrong' } as any, null)).rejects.toThrow(/invalid email or password/i);
  });
});

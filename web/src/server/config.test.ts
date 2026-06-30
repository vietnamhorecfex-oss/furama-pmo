import { describe, it, expect } from 'vitest';
import { validateEnv } from './config';

describe('validateEnv', () => {
  it('rejects when JWT secret is too short', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x@localhost/y', JWT_ACCESS_SECRET: 'short' }))
      .toThrow(/JWT_ACCESS_SECRET/);
  });
  it('applies defaults and coerces numbers', () => {
    const c = validateEnv({
      DATABASE_URL: 'postgresql://x@localhost/y',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
    });
    expect(c.API_PORT).toBe(3000);
    expect(c.COOKIE_SECURE).toBe(false);
  });
});

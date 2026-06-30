/**
 * S-04 — Environment configuration, validated with zod at boot (fail fast).
 * Never read process.env directly elsewhere; inject AppConfig instead.
 */
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

    DATABASE_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),

    ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
    RATE_LIMIT_WRITE_PER_MIN: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_READ_PER_MIN: z.coerce.number().int().positive().default(600),

    // AI — optional; AI endpoints degrade gracefully when absent
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL_REASONING: z.string().default('claude-haiku-4-5-20251001'),
  })
  .strip();

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Parse + validate. Throws a readable aggregated error on invalid/missing config.
 * Used as the @nestjs/config `validate` hook so the app refuses to boot when misconfigured.
 */
export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

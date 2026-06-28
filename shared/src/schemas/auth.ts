/**
 * A-01 — Auth DTOs (zod). Used by both backend controllers and web forms.
 * All schemas .strict() — controllers must reject unknown fields (docs/03 §5).
 */
import { z } from 'zod';
import { emailSchema, passwordSchema } from './common';

export const registerSchema = z
  .object({
    orgSlug: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/, 'orgSlug: lowercase letters, digits, dashes only')
      .optional(),
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();
export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();
export type LoginDto = z.infer<typeof loginSchema>;

/** Public shape of a user (NEVER includes passwordHash). */
export const publicUserSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  email: z.string(),
  avatarColor: z.string().nullable(),
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

/** /auth/me — includes per-project memberships so the web can boot the role-aware UI. */
export const meResponseSchema = z.object({
  user: publicUserSchema,
  memberships: z.array(
    z.object({
      projectId: z.string(),
      role: z.enum(['OWNER', 'PM', 'LEAD', 'MEMBER', 'VIEWER']),
      memberLabel: z.string().nullable(),
    }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: publicUserSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

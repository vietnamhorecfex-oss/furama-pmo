/**
 * P-01 — Member DTOs (zod). docs/03 §M-MEMBER, docs/04 §2.
 */
import { z } from 'zod';
import { idSchema, emailSchema } from './common';

export const memberRoleSchema = z.enum(['OWNER', 'PM', 'LEAD', 'MEMBER', 'VIEWER']);

export const addMemberSchema = z
  .object({
    userId: idSchema,
    role: memberRoleSchema.default('VIEWER'),
    memberLabel: z.string().trim().min(1).max(80).optional(),
    /** Required (and only meaningful) when role=LEAD — list of workstream ids to scope to. */
    workstreamIds: z.array(idSchema).max(50).optional(),
  })
  .strict();
export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z
  .object({
    role: memberRoleSchema.optional(),
    memberLabel: z.string().trim().min(1).max(80).nullish(),
    workstreamIds: z.array(idSchema).max(50).optional(),
  })
  .strict();
export type UpdateMemberDto = z.infer<typeof updateMemberSchema>;

export const memberDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  role: memberRoleSchema,
  memberLabel: z.string().nullable(),
  workstreamIds: z.array(z.string()),
});
export type MemberDto = z.infer<typeof memberDtoSchema>;

/** Lightweight user record for pickers (e.g. the add-member dropdown). */
export const userLiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarColor: z.string(),
});
export type UserLite = z.infer<typeof userLiteSchema>;

/**
 * Create a brand-new user (id auto-generated server-side) AND add them to the project
 * as a member in one step. The server generates a random initial password.
 */
export const createMemberUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: emailSchema,
    role: memberRoleSchema.default('VIEWER'),
    memberLabel: z.string().trim().min(1).max(80).optional(),
    workstreamIds: z.array(idSchema).max(50).optional(),
  })
  .strict();
export type CreateMemberUserDto = z.infer<typeof createMemberUserSchema>;

/** Response of the create-user-and-add-member flow — includes the one-time password. */
export const createMemberUserResultSchema = z.object({
  member: memberDtoSchema,
  user: userLiteSchema,
  /** Plain initial password — shown to the admin exactly once, never stored. */
  tempPassword: z.string(),
});
export type CreateMemberUserResult = z.infer<typeof createMemberUserResultSchema>;

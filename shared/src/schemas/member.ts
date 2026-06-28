/**
 * P-01 — Member DTOs (zod). docs/03 §M-MEMBER, docs/04 §2.
 */
import { z } from 'zod';
import { idSchema } from './common';

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

/**
 * Milestone & gate DTOs (docs/03 §M-GATE).
 *
 * `criteria.taskIds` is the source of a gate's readiness: a Go/No-Go gate is "ready" when
 * every linked task is COMPLETED. The shape is JSONB so non-task criteria can be added later
 * (e.g. external sign-off counts) without a migration.
 */
import { z } from 'zod';
import { idSchema, isoDateSchema, notesSchema, titleSchema } from './common';

export const milestoneTypeSchema = z.enum(['MILESTONE', 'GATE']);
export const gateStatusSchema = z.enum(['PENDING', 'PASSED', 'FAILED', 'NA']);

export const milestoneCriteriaSchema = z
  .object({
    /** Task ids whose COMPLETED status counts toward readiness. */
    taskIds: z.array(idSchema).max(200).optional(),
    /** Free-form descriptions for non-system criteria. */
    notes: z.array(z.string().max(200)).max(20).optional(),
  })
  .strict();
export type MilestoneCriteria = z.infer<typeof milestoneCriteriaSchema>;

export const createMilestoneSchema = z
  .object({
    name: titleSchema,
    date: isoDateSchema.nullish(),
    type: milestoneTypeSchema.default('MILESTONE'),
    status: gateStatusSchema.default('PENDING'),
    criteria: milestoneCriteriaSchema.optional(),
    notes: notesSchema,
  })
  .strict();
export type CreateMilestoneDto = z.infer<typeof createMilestoneSchema>;

export const updateMilestoneSchema = createMilestoneSchema.partial();
export type UpdateMilestoneDto = z.infer<typeof updateMilestoneSchema>;

export const setMilestoneStatusSchema = z
  .object({ status: gateStatusSchema, notes: notesSchema })
  .strict();
export type SetMilestoneStatusDto = z.infer<typeof setMilestoneStatusSchema>;

export const milestoneDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  date: z.string().datetime().nullable(),
  type: milestoneTypeSchema,
  status: gateStatusSchema,
  criteria: milestoneCriteriaSchema.nullable(),
  notes: z.string().nullable(),
  /** Readiness: percentage of linked tasks completed (0–100); null when no taskIds set. */
  readinessPct: z.number().min(0).max(100).nullable(),
  /** Convenience: how many of the linked tasks are completed. null when no criteria. */
  completedCount: z.number().int().nonnegative().nullable(),
  totalCount: z.number().int().nonnegative().nullable(),
});
export type MilestoneDto = z.infer<typeof milestoneDtoSchema>;

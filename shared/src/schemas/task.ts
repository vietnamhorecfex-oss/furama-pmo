/**
 * T-01 — Task DTOs (zod). docs/03 §M-TASK, docs/04 §3.
 *
 * Wire format keeps money as JSON number (BigInt in DB); dates as ISO strings (timestamptz in DB).
 * All schemas .strict() so unknown fields are rejected.
 */
import { z } from 'zod';
import {
  descriptionSchema,
  idSchema,
  isoDateSchema,
  moneyVndSchema,
  notesSchema,
  paginationQuerySchema,
  percentSchema,
  titleSchema,
} from './common';

export const taskStatusSchema = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'IN_REVIEW',
  'BLOCKED',
  'COMPLETED',
]);
export const prioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export const assignmentRoleSchema = z.enum(['IN_CHARGE', 'SUPPORT', 'APPROVER']);

export const taskAssignmentInputSchema = z
  .object({
    userId: idSchema.nullish(),
    label: z.string().trim().min(1).max(120),
    role: assignmentRoleSchema.default('IN_CHARGE'),
  })
  .strict();
export type TaskAssignmentInput = z.infer<typeof taskAssignmentInputSchema>;

const baseTaskFields = {
  code: z.string().trim().min(1).max(40).optional(),
  title: titleSchema,
  description: descriptionSchema,
  phaseId: idSchema.nullish(),
  workstreamId: idSchema.nullish(),
  category: z.string().max(80).nullish(),
  budgetCategoryId: idSchema.nullish(),
  startDate: isoDateSchema.nullish(),
  deadline: isoDateSchema.nullish(),
  durationDays: z.number().int().min(0).max(3650).nullish(),
  priority: prioritySchema.default('MEDIUM'),
  status: taskStatusSchema.default('NOT_STARTED'),
  percent: percentSchema.default(0),
  budgetVnd: moneyVndSchema.default(0),
  actualVnd: moneyVndSchema.default(0),
  kpi: z.string().max(500).nullish(),
  deliverable: z.string().max(500).nullish(),
  dependencyText: z.string().max(500).nullish(),
  riskText: z.string().max(500).nullish(),
  audience: z.string().max(200).nullish(),
  notes: notesSchema,
  inChargeLabel: z.string().max(120).nullish(),
  assignments: z.array(taskAssignmentInputSchema).max(50).optional(),
};

export const createTaskSchema = z
  .object(baseTaskFields)
  .strict()
  .refine(
    (v) => !v.startDate || !v.deadline || new Date(v.startDate) <= new Date(v.deadline),
    { message: 'deadline must be on or after startDate', path: ['deadline'] },
  );
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object(
    Object.fromEntries(
      Object.entries(baseTaskFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as { [K in keyof typeof baseTaskFields]: z.ZodOptional<(typeof baseTaskFields)[K]> },
  )
  .strict();
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

export const progressUpdateSchema = z
  .object({
    status: taskStatusSchema.optional(),
    percent: percentSchema.optional(),
    notes: notesSchema,
    /**
     * True when the change comes from a Kanban drag or the status dropdown (status is the
     * user's intent and percent is derived to fit). Lets a card move to NOT_STARTED or reopen
     * from COMPLETED without the status/percent invariants bouncing it back.
     */
    kanbanMove: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.percent !== undefined || v.notes !== undefined, {
    message: 'At least one of status/percent/notes is required',
  });
export type ProgressUpdateDto = z.infer<typeof progressUpdateSchema>;

export const setAssignmentsSchema = z
  .object({ assignments: z.array(taskAssignmentInputSchema).max(50) })
  .strict();
export type SetAssignmentsDto = z.infer<typeof setAssignmentsSchema>;

export const setDependenciesSchema = z
  .object({ dependsOnTaskIds: z.array(idSchema).max(100) })
  .strict();
export type SetDependenciesDto = z.infer<typeof setDependenciesSchema>;

/** Filters per docs/04 §3 + pagination. */
export const listTasksQuerySchema = paginationQuerySchema.extend({
  phaseId: idSchema.optional(),
  workstreamId: idSchema.optional(),
  status: taskStatusSchema.optional(),
  priority: prioritySchema.optional(),
  assignee: z.string().trim().max(120).optional(),
  q: z.string().trim().max(120).optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const taskDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  phaseId: z.string().nullable(),
  workstreamId: z.string().nullable(),
  category: z.string().nullable(),
  budgetCategoryId: z.string().nullable(),
  startDate: z.string().datetime().nullable(),
  deadline: z.string().datetime().nullable(),
  durationDays: z.number().int().nullable(),
  priority: prioritySchema,
  status: taskStatusSchema,
  percent: percentSchema,
  budgetVnd: z.number().int().nonnegative(),
  actualVnd: z.number().int().nonnegative(),
  kpi: z.string().nullable(),
  deliverable: z.string().nullable(),
  dependencyText: z.string().nullable(),
  riskText: z.string().nullable(),
  audience: z.string().nullable(),
  notes: z.string().nullable(),
  inChargeLabel: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  assignments: z
    .array(
      z.object({
        id: z.string(),
        userId: z.string().nullable(),
        label: z.string(),
        role: assignmentRoleSchema,
      }),
    )
    .optional(),
  dependsOnTaskIds: z.array(z.string()).optional(),
});
export type TaskDto = z.infer<typeof taskDtoSchema>;

/** Packed seed format (docs/02 §6). */
export const packedSeedSchema = z
  .object({
    cols: z.array(z.string().min(1)).min(1),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  })
  .strict();
export type PackedSeed = z.infer<typeof packedSeedSchema>;

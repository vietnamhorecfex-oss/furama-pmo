/**
 * P-01 — Configurable dimensions DTOs (zod). docs/03 §M-CONFIG, docs/04 §2.
 *
 * Five dimensions share the same CRUD + reorder shape; only field sets differ:
 *  - Phase           {name, order, startDate?, endDate?}
 *  - Workstream      {name, order, track}
 *  - StatusDef       {key, order, color, isTerminal}
 *  - PriorityDef     {key, order, color}
 *  - BudgetCategory  {name, order, ownerLabel?, plannedVnd}
 */
import { z } from 'zod';
import { idSchema, isoDateSchema, moneyVndSchema, titleSchema } from './common';

const orderSchema = z.number().int().min(0).max(9999);
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Expected #rgb or #rrggbb');
const workstreamTrack = z.enum(['PMO', 'MARKETING', 'OPERATIONS']);

// ----- Phase -----
export const createPhaseSchema = z
  .object({
    name: titleSchema,
    order: orderSchema.default(0),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
  })
  .strict();
export const updatePhaseSchema = createPhaseSchema.partial();
export type CreatePhaseDto = z.infer<typeof createPhaseSchema>;
export type UpdatePhaseDto = z.infer<typeof updatePhaseSchema>;

// ----- Workstream -----
export const createWorkstreamSchema = z
  .object({
    name: titleSchema,
    track: workstreamTrack.default('PMO'),
    order: orderSchema.default(0),
  })
  .strict();
export const updateWorkstreamSchema = createWorkstreamSchema.partial();
export type CreateWorkstreamDto = z.infer<typeof createWorkstreamSchema>;
export type UpdateWorkstreamDto = z.infer<typeof updateWorkstreamSchema>;

// ----- StatusDef -----
export const createStatusDefSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    color: hexColor.default('#94A3B8'),
    order: orderSchema.default(0),
    isTerminal: z.boolean().default(false),
  })
  .strict();
export const updateStatusDefSchema = createStatusDefSchema.partial().extend({
  /** When renaming the key, services cascade Task.status references inside a single transaction. */
  renameToKey: z.string().trim().min(1).max(40).optional(),
});
export type CreateStatusDefDto = z.infer<typeof createStatusDefSchema>;
export type UpdateStatusDefDto = z.infer<typeof updateStatusDefSchema>;

// ----- PriorityDef -----
export const createPriorityDefSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    color: hexColor.default('#7A8B99'),
    order: orderSchema.default(0),
  })
  .strict();
export const updatePriorityDefSchema = createPriorityDefSchema.partial().extend({
  renameToKey: z.string().trim().min(1).max(40).optional(),
});
export type CreatePriorityDefDto = z.infer<typeof createPriorityDefSchema>;
export type UpdatePriorityDefDto = z.infer<typeof updatePriorityDefSchema>;

// ----- BudgetCategory -----
export const createBudgetCategorySchema = z
  .object({
    name: titleSchema,
    ownerLabel: z.string().max(80).optional(),
    plannedVnd: moneyVndSchema.default(0),
    order: orderSchema.default(0),
  })
  .strict();
export const updateBudgetCategorySchema = createBudgetCategorySchema.partial();
export type CreateBudgetCategoryDto = z.infer<typeof createBudgetCategorySchema>;
export type UpdateBudgetCategoryDto = z.infer<typeof updateBudgetCategorySchema>;

// ----- Reorder (shared across dimensions) -----
export const reorderSchema = z
  .object({
    items: z
      .array(z.object({ id: idSchema, order: orderSchema }).strict())
      .min(1)
      .max(200),
  })
  .strict();
export type ReorderDto = z.infer<typeof reorderSchema>;

// ----- Delete with optional replacement (StatusDef/PriorityDef only) -----
export const deleteWithReplacementSchema = z
  .object({ replaceWithKey: z.string().trim().min(1).max(40).optional() })
  .strict();
export type DeleteWithReplacementDto = z.infer<typeof deleteWithReplacementSchema>;

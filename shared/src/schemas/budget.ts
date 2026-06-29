/**
 * Budget summary DTO (docs/03 §M-BUDGET).
 *
 * Rollups:
 *  - planned   = Σ BudgetCategory.plannedVnd
 *  - committed = Σ Task.budgetVnd  (what's allocated against tasks)
 *  - actual    = Σ Task.actualVnd  (what's been spent)
 *  - cap       = Project.budgetCapVnd
 *  - overCap   = committed > cap
 *  - overruns[]= categories where Σ tasks' budget exceeds the category's planned by >10%
 */
import { z } from 'zod';
import { moneyVndSchema } from './common';

/** Set the project budget cap (envelope). */
export const setBudgetCapSchema = z.object({ capVnd: moneyVndSchema }).strict();
export type SetBudgetCapDto = z.infer<typeof setBudgetCapSchema>;

/** Update a category's planned and/or actual amounts (at least one required). */
export const updateCategoryAmountsSchema = z
  .object({ plannedVnd: moneyVndSchema.optional(), actualVnd: moneyVndSchema.optional() })
  .strict()
  .refine((v) => v.plannedVnd !== undefined || v.actualVnd !== undefined, {
    message: 'At least one of plannedVnd/actualVnd is required',
  });
export type UpdateCategoryAmountsDto = z.infer<typeof updateCategoryAmountsSchema>;

/** Bulk budget import: set the cap and/or update planned (+optional actual) per category by name. */
export const budgetImportSchema = z
  .object({
    capVnd: moneyVndSchema.optional(),
    rows: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            plannedVnd: moneyVndSchema,
            actualVnd: moneyVndSchema.optional(),
          })
          .strict(),
      )
      .max(2000),
  })
  .strict();
export type BudgetImportDto = z.infer<typeof budgetImportSchema>;

export const budgetImportResultSchema = z.object({
  updated: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  capUpdated: z.boolean(),
});
export type BudgetImportResult = z.infer<typeof budgetImportResultSchema>;

export const budgetCategorySummarySchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  plannedVnd: z.number().int().nonnegative(),
  committedVnd: z.number().int().nonnegative(),
  actualVnd: z.number().int().nonnegative(),
  /** committedVnd / plannedVnd (0 when planned=0). */
  utilization: z.number().min(0),
});
export type BudgetCategorySummary = z.infer<typeof budgetCategorySummarySchema>;

export const budgetWorkstreamSummarySchema = z.object({
  workstreamId: z.string().nullable(),
  name: z.string(),
  committedVnd: z.number().int().nonnegative(),
  actualVnd: z.number().int().nonnegative(),
});
export type BudgetWorkstreamSummary = z.infer<typeof budgetWorkstreamSummarySchema>;

export const budgetOverrunSchema = z.object({
  categoryId: z.string(),
  name: z.string(),
  plannedVnd: z.number().int().nonnegative(),
  committedVnd: z.number().int().nonnegative(),
  /** committed - planned, always > 0 by definition of an overrun entry. */
  overByVnd: z.number().int().positive(),
});
export type BudgetOverrun = z.infer<typeof budgetOverrunSchema>;

export const budgetSummarySchema = z.object({
  projectId: z.string(),
  capVnd: z.number().int().nonnegative(),
  plannedVnd: z.number().int().nonnegative(),
  committedVnd: z.number().int().nonnegative(),
  actualVnd: z.number().int().nonnegative(),
  overCap: z.boolean(),
  byCategory: z.array(budgetCategorySummarySchema),
  byWorkstream: z.array(budgetWorkstreamSummarySchema),
  overruns: z.array(budgetOverrunSchema),
});
export type BudgetSummary = z.infer<typeof budgetSummarySchema>;

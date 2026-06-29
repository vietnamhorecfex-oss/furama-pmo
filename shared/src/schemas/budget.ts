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

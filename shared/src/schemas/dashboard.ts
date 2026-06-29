/**
 * Dashboard overview DTO (docs/03 §M-DASH).
 */
import { z } from 'zod';
import { percentSchema } from './common';
import { taskStatusSchema, prioritySchema } from './task';
import { budgetSummarySchema } from './budget';

export const taskHealthSchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.record(taskStatusSchema, z.number().int().nonnegative()),
  byPriority: z.record(prioritySchema, z.number().int().nonnegative()),
  overdue: z.number().int().nonnegative(),
  atRisk: z.number().int().nonnegative(),
  overallPercent: percentSchema,
});
export type TaskHealth = z.infer<typeof taskHealthSchema>;

export const progressGroupSchema = z.object({
  id: z.string().nullable(),
  name: z.string(),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  percent: percentSchema,
});
export type ProgressGroup = z.infer<typeof progressGroupSchema>;

export const upcomingDeadlineSchema = z.object({
  taskId: z.string(),
  code: z.string(),
  title: z.string(),
  deadline: z.string().datetime(),
  daysLeft: z.number().int(),
  status: taskStatusSchema,
});
export type UpcomingDeadline = z.infer<typeof upcomingDeadlineSchema>;

export const dashboardOverviewSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  openingDate: z.string().datetime().nullable(),
  /** Days from "now" to openingDate; negative if opened already. null if no opening date. */
  daysToOpening: z.number().int().nullable(),
  health: taskHealthSchema,
  byPhase: z.array(progressGroupSchema),
  byWorkstream: z.array(progressGroupSchema),
  upcomingDeadlines: z.array(upcomingDeadlineSchema),
  budget: budgetSummarySchema,
});
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>;

/**
 * R-03 — WebSocket event payloads (docs/04 §5). Shared between backend gateway and
 * web client so both ends agree on the shape.
 *
 * Event names mirror docs verbatim. Each payload includes `projectId` so the web cache
 * patcher can route invalidations precisely (even though the room itself is project-scoped).
 */
import { z } from 'zod';
import { commentBodySchema, idSchema, percentSchema } from './common';

export const taskCreatedEvent = z.object({
  projectId: idSchema,
  taskId: idSchema,
  code: z.string(),
  by: idSchema.optional(),
});
export type TaskCreatedEvent = z.infer<typeof taskCreatedEvent>;

export const taskUpdatedEvent = z.object({
  projectId: idSchema,
  taskId: idSchema,
  by: idSchema.optional(),
});
export type TaskUpdatedEvent = z.infer<typeof taskUpdatedEvent>;

export const taskDeletedEvent = z.object({
  projectId: idSchema,
  taskId: idSchema,
  by: idSchema.optional(),
});
export type TaskDeletedEvent = z.infer<typeof taskDeletedEvent>;

export const taskProgressEvent = z.object({
  projectId: idSchema,
  taskId: idSchema,
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED']),
  percent: percentSchema,
  by: idSchema.optional(),
});
export type TaskProgressEvent = z.infer<typeof taskProgressEvent>;

export const commentCreatedEvent = z.object({
  projectId: idSchema,
  taskId: idSchema,
  comment: z.object({
    id: idSchema,
    authorId: idSchema,
    body: commentBodySchema,
    createdAt: z.string().datetime(),
  }),
});
export type CommentCreatedEvent = z.infer<typeof commentCreatedEvent>;

export const budgetChangedEvent = z.object({ projectId: idSchema });
export type BudgetChangedEvent = z.infer<typeof budgetChangedEvent>;

export const milestoneUpdatedEvent = z.object({
  projectId: idSchema,
  milestoneId: idSchema,
});
export type MilestoneUpdatedEvent = z.infer<typeof milestoneUpdatedEvent>;

/** Map event name → payload type. Useful for typed `socket.on(name, payload)`. */
export interface WsEventMap {
  'task.created': TaskCreatedEvent;
  'task.updated': TaskUpdatedEvent;
  'task.deleted': TaskDeletedEvent;
  'task.progress': TaskProgressEvent;
  'comment.created': CommentCreatedEvent;
  'budget.changed': BudgetChangedEvent;
  'milestone.updated': MilestoneUpdatedEvent;
}

export type WsEventName = keyof WsEventMap;

/**
 * Audit feed & entity-history DTOs (docs/03 §M-AUDIT, docs/04 §3 /activity).
 */
import { z } from 'zod';
import { paginationQuerySchema } from './common';

export const activityQuerySchema = paginationQuerySchema.extend({
  /** Optional filter by entityType (e.g. 'Task'). */
  entityType: z.string().trim().max(40).optional(),
  /** Optional filter by entityId (full row history). */
  entityId: z.string().trim().max(40).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const auditLogDtoSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditLogDto = z.infer<typeof auditLogDtoSchema>;

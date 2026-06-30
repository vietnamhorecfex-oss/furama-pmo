/**
 * web/server port of backend AuditService.record — minimal helper for writing audit log rows.
 * Failures are caught and only logged as a warning — an audit write must NOT break a mutation.
 * Matches AuditLog schema columns: projectId?, actorId?, action, entityType, entityId?,
 * before (Json?), after (Json?), ip?, userAgent?, createdAt.
 */
import { prisma } from '../prisma';

export interface AuditActor {
  actorId: string;
  ip: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

export async function auditRecord(actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor.actorId,
        ip: actor.ip ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before === undefined ? undefined : (entry.before as object),
        after: entry.after === undefined ? undefined : (entry.after as object),
      },
    });
  } catch (err) {
    console.warn(
      `[audit] write failed for ${entry.entityType}#${entry.entityId} action=${entry.action}: ${(err as Error).message}`,
    );
  }
}

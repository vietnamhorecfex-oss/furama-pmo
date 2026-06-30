import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

export interface AuditActor {
  actorId: string | null;
  projectId?: string | null;
  ip: string | null;
}
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Write an audit row. A failed audit write must NOT break the calling mutation,
 * so the create is wrapped and only logged (matches backend AuditService.record).
 */
export async function auditRecord(actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor.actorId ?? null,
        projectId: actor.projectId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before ?? Prisma.DbNull,
        after: entry.after ?? Prisma.DbNull,
        ip: actor.ip ?? null,
      },
    });
  } catch (err) {
    console.error(
      `Audit write failed for ${entry.entityType}#${entry.entityId ?? '-'} action=${entry.action}: ${(err as Error).message}`,
    );
  }
}

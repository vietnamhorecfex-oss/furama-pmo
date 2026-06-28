/**
 * A-02 — AuditService. Append-only log of every mutation (docs/03 §M-AUDIT, docs/06).
 * No update/delete: only `record()`. Failures are logged but never propagate — losing one
 * audit row must not break a user-facing mutation; alarms come from log monitoring.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditContext {
  actorId?: string | null;
  projectId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: AuditContext, entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: ctx.actorId ?? null,
          projectId: ctx.projectId ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          before: entry.before ?? Prisma.DbNull,
          after: entry.after ?? Prisma.DbNull,
          ip: ctx.ip ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Audit write failed for ${entry.entityType}#${entry.entityId ?? '-'} action=${entry.action}: ${(err as Error).message}`,
      );
    }
  }
}

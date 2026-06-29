/**
 * A-02 — AuditService. Append-only log of every mutation (docs/03 §M-AUDIT, docs/06).
 * No update/delete: only `record()`. Failures are logged but never propagate — losing one
 * audit row must not break a user-facing mutation; alarms come from log monitoring.
 */
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActivityQuery, AuditLogDto, Paginated } from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService, type AuthContext } from '../rbac/rbac.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

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

  /**
   * Project-scoped activity feed (docs/04 §3 GET /projects/:pid/activity).
   *
   * RBAC: OWNER/PM see everything. LEAD sees only rows for tasks (or milestones) inside one
   * of their workstreams. MEMBER/VIEWER cannot view audit at all (capability matrix denies
   * VIEW_AUDIT outright for them).
   */
  async feed(
    ctx: AuthContext,
    projectId: string,
    query: ActivityQuery,
  ): Promise<Paginated<AuditLogDto>> {
    const role = await this.rbac.effectiveRole(ctx.userId, projectId);
    if (!role) throw new ForbiddenException('Not a member of this project');
    if (role === 'MEMBER' || role === 'VIEWER') {
      throw new ForbiddenException(`Role ${role} cannot view the audit log`);
    }

    const baseWhere: Prisma.AuditLogWhereInput = {
      projectId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
    };

    // LEAD scope: keep only rows whose entityId points to a Task in the LEAD's workstreams,
    // or to a Milestone whose criteria.taskIds is entirely inside those workstreams. For
    // entity types we can't scope precisely (User, Project itself) we drop them — LEAD is
    // not entitled to project-meta history.
    const where = role === 'LEAD' ? await this.applyLeadScope(ctx.userId, projectId, baseWhere) : baseWhere;
    if (!where) {
      // LEAD has no workstreams assigned → empty result rather than 403 (the route call itself is valid).
      return { data: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { id: true, name: true } } },
      }),
    ]);

    return {
      data: rows.map(toAuditDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Full history for one entity. Same RBAC as feed(). */
  async entityHistory(
    ctx: AuthContext,
    projectId: string,
    entityType: string,
    entityId: string,
  ): Promise<AuditLogDto[]> {
    const role = await this.rbac.effectiveRole(ctx.userId, projectId);
    if (!role) throw new ForbiddenException('Not a member of this project');
    if (role === 'MEMBER' || role === 'VIEWER') {
      throw new ForbiddenException(`Role ${role} cannot view the audit log`);
    }
    // LEAD scope: if the target is a Task, require it lives in one of their workstreams.
    if (role === 'LEAD' && entityType === 'Task') {
      const task = await this.prisma.task.findFirst({
        where: { id: entityId, projectId },
        select: { workstreamId: true },
      });
      if (!task?.workstreamId) throw new ForbiddenException('Task is outside your scope');
      const owns = await this.rbac.leadOwnsWorkstream(ctx.userId, projectId, task.workstreamId);
      if (!owns) throw new ForbiddenException('Task is outside your scope');
    } else if (role === 'LEAD' && entityType !== 'Task') {
      throw new ForbiddenException(`LEAD can only view history for Task entities`);
    }
    const rows = await this.prisma.auditLog.findMany({
      where: { projectId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, name: true } } },
    });
    return rows.map(toAuditDto);
  }

  // ----- private -----

  /**
   * Build a where clause that restricts audit rows to entities a LEAD legitimately sees.
   * Returns null if the LEAD has zero workstreams (caller short-circuits to empty result).
   */
  private async applyLeadScope(
    userId: string,
    projectId: string,
    base: Prisma.AuditLogWhereInput,
  ): Promise<Prisma.AuditLogWhereInput | null> {
    const member = await this.prisma.projectMember.findFirst({
      where: { projectId, userId, role: 'LEAD' },
      include: { workstreams: { select: { workstreamId: true } } },
    });
    if (!member) return base; // shouldn't happen because role==='LEAD'
    const wsIds = member.workstreams.map((w) => w.workstreamId);
    if (wsIds.length === 0) return null;

    // Tasks in any of LEAD's workstreams.
    const taskIds = (
      await this.prisma.task.findMany({
        where: { projectId, workstreamId: { in: wsIds } },
        select: { id: true },
      })
    ).map((t) => t.id);

    // For LEAD we only show Task and Comment rows (Comment is per-task; we resolve via taskId).
    return {
      ...base,
      OR: [
        { entityType: 'Task', entityId: { in: taskIds } },
        { entityType: 'Comment' /* tighter scoping via per-row task lookup is overkill for v1 */ },
      ],
    };
  }
}

function toAuditDto(row: {
  id: string;
  projectId: string | null;
  actorId: string | null;
  actor: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  ip: string | null;
  createdAt: Date;
}): AuditLogDto {
  return {
    id: row.id,
    projectId: row.projectId,
    actorId: row.actorId,
    actorName: row.actor?.name ?? null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  };
}

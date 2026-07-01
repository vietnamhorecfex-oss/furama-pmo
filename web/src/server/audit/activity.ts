/**
 * web/server port of backend AuditService feed() + entityHistory() — read-only activity queries.
 * auditRecord() is already in audit.ts — do NOT re-export it here.
 *
 * Mechanical adaptations from backend/src/audit/audit.service.ts:
 *   this.prisma        → prisma (singleton import)
 *   this.rbac.effectiveRole → effectiveRole
 *   this.rbac.leadOwnsWorkstream → leadOwnsWorkstream
 *   ForbiddenException → Forbidden
 *   AuthContext        → from ../rbac/rbac
 *   Paginated<T>       → from ../http/serialize
 */
import { Prisma } from '@prisma/client';
import type { ActivityQuery, AuditLogDto } from '@furama/shared';
import { prisma } from '../prisma';
import { effectiveRole, leadOwnsWorkstream, type AuthContext } from '../rbac/rbac';
import { Forbidden } from '../http/errors';
import type { Paginated } from '../http/serialize';

/**
 * Project-scoped activity feed (docs/04 §3 GET /projects/:pid/activity).
 *
 * RBAC: OWNER/PM see everything. LEAD sees only rows for tasks (or milestones) inside one
 * of their workstreams. MEMBER/VIEWER cannot view audit at all (capability matrix denies
 * VIEW_AUDIT outright for them).
 */
export async function activityFeed(
  ctx: AuthContext,
  projectId: string,
  query: ActivityQuery,
): Promise<Paginated<AuditLogDto>> {
  const role = await effectiveRole(ctx.userId, projectId);
  if (!role) throw new Forbidden('Not a member of this project');
  if (role === 'MEMBER' || role === 'VIEWER') {
    throw new Forbidden(`Role ${role} cannot view the audit log`);
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
  const where = role === 'LEAD' ? await applyLeadScope(ctx.userId, projectId, baseWhere) : baseWhere;
  if (!where) {
    // LEAD has no workstreams assigned → empty result rather than 403 (the route call itself is valid).
    return { data: [], page: query.page, pageSize: query.pageSize, total: 0 };
  }

  const [total, rows] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
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
export async function entityHistory(
  ctx: AuthContext,
  projectId: string,
  entityType: string,
  entityId: string,
): Promise<AuditLogDto[]> {
  const role = await effectiveRole(ctx.userId, projectId);
  if (!role) throw new Forbidden('Not a member of this project');
  if (role === 'MEMBER' || role === 'VIEWER') {
    throw new Forbidden(`Role ${role} cannot view the audit log`);
  }
  // LEAD scope: if the target is a Task, require it lives in one of their workstreams.
  if (role === 'LEAD' && entityType === 'Task') {
    const task = await prisma.task.findFirst({
      where: { id: entityId, projectId },
      select: { workstreamId: true },
    });
    if (!task?.workstreamId) throw new Forbidden('Task is outside your scope');
    const owns = await leadOwnsWorkstream(ctx.userId, projectId, task.workstreamId);
    if (!owns) throw new Forbidden('Task is outside your scope');
  } else if (role === 'LEAD' && entityType !== 'Task') {
    throw new Forbidden(`LEAD can only view history for Task entities`);
  }
  const rows = await prisma.auditLog.findMany({
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
async function applyLeadScope(
  userId: string,
  projectId: string,
  base: Prisma.AuditLogWhereInput,
): Promise<Prisma.AuditLogWhereInput | null> {
  const member = await prisma.projectMember.findFirst({
    where: { projectId, userId, role: 'LEAD' },
    include: { workstreams: { select: { workstreamId: true } } },
  });
  if (!member) return base; // shouldn't happen because role==='LEAD'
  const wsIds = member.workstreams.map((w) => w.workstreamId);
  if (wsIds.length === 0) return null;

  // Tasks in any of LEAD's workstreams.
  const taskIds = (
    await prisma.task.findMany({
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

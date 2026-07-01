/**
 * web/server port of ConfigService PriorityDef methods
 * (backend/src/config-dim/config.service.ts lines ~295-381).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - ForbiddenException/NotFoundException/ConflictException/BadRequestException → errors from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 */
import type { PriorityDef } from '@prisma/client';
import type { CreatePriorityDefDto, UpdatePriorityDefDto, ReorderDto, DeleteWithReplacementDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { NotFound, Conflict, BadRequest } from '../http/errors';
import { uniqueClash } from './config-util';

// ─── public API ───────────────────────────────────────────────────────────────

export async function listPriorityDefs(ctx: AuthContext, projectId: string): Promise<PriorityDef[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  return prisma.priorityDef.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { key: 'asc' }],
  });
}

export async function createPriorityDef(
  ctx: AuthContext,
  projectId: string,
  dto: CreatePriorityDefDto,
  ip: string | null,
): Promise<PriorityDef> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  try {
    const row = await prisma.priorityDef.create({
      data: { projectId, key: dto.key, color: dto.color, order: dto.order },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      { action: 'priority.created', entityType: 'PriorityDef', entityId: row.id, after: { key: dto.key } },
    );
    return row;
  } catch (err) {
    throw uniqueClash(err, `PriorityDef "${dto.key}" already exists in this project`);
  }
}

export async function updatePriorityDef(
  ctx: AuthContext,
  projectId: string,
  id: string,
  dto: UpdatePriorityDefDto,
  ip: string | null,
): Promise<PriorityDef | null> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const before = await prisma.priorityDef.findFirst({ where: { id, projectId } });
  if (!before) throw new NotFound('PriorityDef not found');

  await prisma.$transaction(async (tx) => {
    if (dto.renameToKey && dto.renameToKey !== before.key) {
      const clash = await tx.priorityDef.findFirst({
        where: { projectId, key: dto.renameToKey, NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new Conflict(`Cannot rename to "${dto.renameToKey}" — already in use`);
      await tx.priorityDef.update({ where: { id }, data: { key: dto.renameToKey } });
      // See StatusDef note above on Task.priority enum migration.
    }
    const data: Parameters<typeof tx.priorityDef.update>[0]['data'] = {};
    if (dto.key !== undefined && !dto.renameToKey) data.key = dto.key;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.order !== undefined) data.order = dto.order;
    if (Object.keys(data).length > 0) {
      await tx.priorityDef.update({ where: { id }, data });
    }
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'priority.updated', entityType: 'PriorityDef', entityId: id },
  );
  return prisma.priorityDef.findUnique({ where: { id } });
}

export async function deletePriorityDef(
  ctx: AuthContext,
  projectId: string,
  id: string,
  opts: DeleteWithReplacementDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const prio = await prisma.priorityDef.findFirst({ where: { id, projectId } });
  if (!prio) throw new NotFound('PriorityDef not found');

  const referenced = await prisma.task
    // as never: Task.status/priority is a Prisma enum in v1; def keys are free text — the guarded count treats a non-enum key as 0 refs (see file header).
    .count({ where: { projectId, priority: prio.key as never } })
    .catch(() => 0);

  if (referenced > 0 && !opts.replaceWithKey) {
    throw new Conflict(`PriorityDef "${prio.key}" is used by ${referenced} task(s); provide replaceWithKey`);
  }
  if (referenced > 0 && opts.replaceWithKey) {
    const replacement = await prisma.priorityDef.findFirst({
      where: { projectId, key: opts.replaceWithKey },
    });
    if (!replacement) throw new BadRequest(`replaceWithKey "${opts.replaceWithKey}" not found`);
    await prisma.$transaction([
      prisma.task.updateMany({
        // as never: Task.status/priority is a Prisma enum in v1; def keys are free text — the guarded count treats a non-enum key as 0 refs (see file header).
        where: { projectId, priority: prio.key as never },
        data: { priority: opts.replaceWithKey as never },
      }),
      prisma.priorityDef.delete({ where: { id } }),
    ]);
  } else {
    await prisma.priorityDef.delete({ where: { id } });
  }
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'priority.deleted', entityType: 'PriorityDef', entityId: id, before: { key: prio.key } },
  );
}

export async function reorderPriorityDefs(
  ctx: AuthContext,
  projectId: string,
  dto: ReorderDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  await prisma.$transaction(async (tx) => {
    for (const item of dto.items) {
      await tx.priorityDef.updateMany({ where: { id: item.id, projectId }, data: { order: item.order } });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'priority.reordered', entityType: 'PriorityDef' },
  );
}

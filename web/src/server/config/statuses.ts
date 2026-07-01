/**
 * web/server port of ConfigService StatusDef methods
 * (backend/src/config-dim/config.service.ts lines ~189-293).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - ForbiddenException/NotFoundException/ConflictException/BadRequestException → errors from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 */
import type { StatusDef } from '@prisma/client';
import type { CreateStatusDefDto, UpdateStatusDefDto, ReorderDto, DeleteWithReplacementDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { NotFound, Conflict, BadRequest } from '../http/errors';
import { uniqueClash } from './config-util';

// ─── public API ───────────────────────────────────────────────────────────────

export async function listStatusDefs(ctx: AuthContext, projectId: string): Promise<StatusDef[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  return prisma.statusDef.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { key: 'asc' }],
  });
}

export async function createStatusDef(
  ctx: AuthContext,
  projectId: string,
  dto: CreateStatusDefDto,
  ip: string | null,
): Promise<StatusDef> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  try {
    const row = await prisma.statusDef.create({
      data: { projectId, key: dto.key, color: dto.color, order: dto.order, isTerminal: dto.isTerminal },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      { action: 'status.created', entityType: 'StatusDef', entityId: row.id, after: { key: dto.key } },
    );
    return row;
  } catch (err) {
    throw uniqueClash(err, `StatusDef "${dto.key}" already exists in this project`);
  }
}

export async function updateStatusDef(
  ctx: AuthContext,
  projectId: string,
  id: string,
  dto: UpdateStatusDefDto,
  ip: string | null,
): Promise<StatusDef | null> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const before = await prisma.statusDef.findFirst({ where: { id, projectId } });
  if (!before) throw new NotFound('StatusDef not found');

  // Cascade rename (transactional). When renameToKey is given, the key on this row changes
  // and any Task currently bearing the old key string is migrated — together — or the whole
  // operation rolls back. Validation: the new key must not already exist on this project.
  await prisma.$transaction(async (tx) => {
    if (dto.renameToKey && dto.renameToKey !== before.key) {
      const clash = await tx.statusDef.findFirst({
        where: { projectId, key: dto.renameToKey, NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new Conflict(`Cannot rename to "${dto.renameToKey}" — already in use`);
      await tx.statusDef.update({ where: { id }, data: { key: dto.renameToKey } });
      // NOTE: Task.status is a Prisma enum in v1 — see file header. If/when Task.status
      // becomes a free-text string referencing StatusDef.key, uncomment the line below:
      // await tx.task.updateMany({ where: { projectId, status: before.key as TaskStatus }, data: { status: dto.renameToKey as TaskStatus } });
    }
    const data: Parameters<typeof tx.statusDef.update>[0]['data'] = {};
    if (dto.key !== undefined && !dto.renameToKey) data.key = dto.key;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.isTerminal !== undefined) data.isTerminal = dto.isTerminal;
    if (Object.keys(data).length > 0) {
      await tx.statusDef.update({ where: { id }, data });
    }
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'status.updated',
      entityType: 'StatusDef',
      entityId: id,
      before: { key: before.key },
      after: { key: dto.renameToKey ?? dto.key ?? before.key },
    },
  );
  return prisma.statusDef.findUnique({ where: { id } });
}

export async function deleteStatusDef(
  ctx: AuthContext,
  projectId: string,
  id: string,
  opts: DeleteWithReplacementDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const status = await prisma.statusDef.findFirst({ where: { id, projectId } });
  if (!status) throw new NotFound('StatusDef not found');

  // Task.status is a Prisma enum (v1), so "tasks still referencing this key" can only be true
  // when the def's key matches one of the canonical enum values used by Task. We treat any
  // tasks bearing the matching enum value as referenced.
  const referenced = await prisma.task
    .count({ where: { projectId, status: status.key as never } })
    .catch(() => 0);

  if (referenced > 0 && !opts.replaceWithKey) {
    throw new Conflict(
      `StatusDef "${status.key}" is used by ${referenced} task(s); provide replaceWithKey`,
    );
  }
  if (referenced > 0 && opts.replaceWithKey) {
    const replacement = await prisma.statusDef.findFirst({
      where: { projectId, key: opts.replaceWithKey },
    });
    if (!replacement) throw new BadRequest(`replaceWithKey "${opts.replaceWithKey}" not found`);
    await prisma.$transaction([
      prisma.task.updateMany({
        where: { projectId, status: status.key as never },
        data: { status: opts.replaceWithKey as never },
      }),
      prisma.statusDef.delete({ where: { id } }),
    ]);
  } else {
    await prisma.statusDef.delete({ where: { id } });
  }
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'status.deleted', entityType: 'StatusDef', entityId: id, before: { key: status.key } },
  );
}

export async function reorderStatusDefs(
  ctx: AuthContext,
  projectId: string,
  dto: ReorderDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  await prisma.$transaction(async (tx) => {
    for (const item of dto.items) {
      await tx.statusDef.updateMany({ where: { id: item.id, projectId }, data: { order: item.order } });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'status.reordered', entityType: 'StatusDef' },
  );
}

/**
 * web/server port of ConfigService Workstream methods
 * (backend/src/config-dim/config.service.ts lines ~124-187).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - ForbiddenException/NotFoundException/ConflictException → Forbidden/NotFound/Conflict from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *
 * deleteWorkstream guards BOTH task.count AND memberWorkstream.count — don't omit either.
 */
import type { Workstream } from '@prisma/client';
import type { CreateWorkstreamDto, UpdateWorkstreamDto, ReorderDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { NotFound, Conflict } from '../http/errors';

// ─── public API ───────────────────────────────────────────────────────────────

export async function listWorkstreams(ctx: AuthContext, projectId: string): Promise<Workstream[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  return prisma.workstream.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
}

export async function createWorkstream(
  ctx: AuthContext,
  projectId: string,
  dto: CreateWorkstreamDto,
  ip: string | null,
): Promise<Workstream> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  try {
    const row = await prisma.workstream.create({
      data: {
        projectId,
        name: dto.name,
        track: dto.track,
        order: dto.order,
      },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      { action: 'workstream.created', entityType: 'Workstream', entityId: row.id, after: { name: dto.name } },
    );
    return row;
  } catch (err) {
    throw uniqueClash(err, `Workstream "${dto.name}" already exists in this project`);
  }
}

export async function updateWorkstream(
  ctx: AuthContext,
  projectId: string,
  id: string,
  dto: UpdateWorkstreamDto,
  ip: string | null,
): Promise<Workstream> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const before = await prisma.workstream.findFirst({ where: { id, projectId } });
  if (!before) throw new NotFound('Workstream not found');
  try {
    const row = await prisma.workstream.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.track !== undefined ? { track: dto.track } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      {
        action: 'workstream.updated',
        entityType: 'Workstream',
        entityId: id,
        before: { name: before.name },
        after: { name: row.name },
      },
    );
    return row;
  } catch (err) {
    throw uniqueClash(err, 'Workstream name conflict in this project');
  }
}

export async function deleteWorkstream(
  ctx: AuthContext,
  projectId: string,
  id: string,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const ws = await prisma.workstream.findFirst({ where: { id, projectId } });
  if (!ws) throw new NotFound('Workstream not found');

  // Both checks are required — do not omit MemberWorkstream
  const [taskRefs, memberScopeRefs] = await Promise.all([
    prisma.task.count({ where: { workstreamId: id } }),
    prisma.memberWorkstream.count({ where: { workstreamId: id } }),
  ]);

  if (taskRefs > 0 || memberScopeRefs > 0) {
    throw new Conflict(
      `Workstream has ${taskRefs} task(s) and ${memberScopeRefs} LEAD scope(s); detach first`,
    );
  }

  await prisma.workstream.delete({ where: { id } });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'workstream.deleted', entityType: 'Workstream', entityId: id },
  );
}

export async function reorderWorkstreams(
  ctx: AuthContext,
  projectId: string,
  dto: ReorderDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  await prisma.$transaction(async (tx) => {
    for (const item of dto.items) {
      await tx.workstream.updateMany({ where: { id: item.id, projectId }, data: { order: item.order } });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'workstream.reordered', entityType: 'Workstream' },
  );
}

// ─── private helpers ──────────────────────────────────────────────────────────

/** Translate Prisma's unique-violation P2002 into a friendly Conflict. */
function uniqueClash(err: unknown, friendly: string): Error {
  const code = (err as { code?: string }).code;
  if (code === 'P2002') return new Conflict(friendly);
  return err as Error;
}

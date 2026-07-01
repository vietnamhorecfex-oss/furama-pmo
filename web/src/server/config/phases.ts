/**
 * web/server port of ConfigService Phase methods
 * (backend/src/config-dim/config.service.ts lines ~60-122).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - ForbiddenException/NotFoundException/ConflictException → Forbidden/NotFound/Conflict from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 */
import type { Phase } from '@prisma/client';
import type { CreatePhaseDto, UpdatePhaseDto, ReorderDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { NotFound, Conflict } from '../http/errors';

// ─── public API ───────────────────────────────────────────────────────────────

export async function listPhases(ctx: AuthContext, projectId: string): Promise<Phase[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  return prisma.phase.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
}

export async function createPhase(
  ctx: AuthContext,
  projectId: string,
  dto: CreatePhaseDto,
  ip: string | null,
): Promise<Phase> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  try {
    const row = await prisma.phase.create({
      data: {
        projectId,
        name: dto.name,
        order: dto.order,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      { action: 'phase.created', entityType: 'Phase', entityId: row.id, after: { name: dto.name } },
    );
    return row;
  } catch (err) {
    throw uniqueClash(err, `Phase "${dto.name}" already exists in this project`);
  }
}

export async function updatePhase(
  ctx: AuthContext,
  projectId: string,
  phaseId: string,
  dto: UpdatePhaseDto,
  ip: string | null,
): Promise<Phase> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const before = await prisma.phase.findFirst({ where: { id: phaseId, projectId } });
  if (!before) throw new NotFound('Phase not found');
  try {
    const row = await prisma.phase.update({
      where: { id: phaseId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
      },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      {
        action: 'phase.updated',
        entityType: 'Phase',
        entityId: phaseId,
        before: { name: before.name },
        after: { name: row.name },
      },
    );
    return row;
  } catch (err) {
    throw uniqueClash(err, 'Phase name conflict in this project');
  }
}

export async function deletePhase(
  ctx: AuthContext,
  projectId: string,
  phaseId: string,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const phase = await prisma.phase.findFirst({ where: { id: phaseId, projectId } });
  if (!phase) throw new NotFound('Phase not found');
  const refs = await prisma.task.count({ where: { phaseId } });
  if (refs > 0) throw new Conflict(`Phase has ${refs} task(s); reassign them first`);
  await prisma.phase.delete({ where: { id: phaseId } });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'phase.deleted', entityType: 'Phase', entityId: phaseId },
  );
}

export async function reorderPhases(
  ctx: AuthContext,
  projectId: string,
  dto: ReorderDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  await prisma.$transaction(async (tx) => {
    for (const item of dto.items) {
      await tx.phase.updateMany({ where: { id: item.id, projectId }, data: { order: item.order } });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'phase.reordered', entityType: 'Phase' },
  );
}

// ─── private helpers ──────────────────────────────────────────────────────────

/** Translate Prisma's unique-violation P2002 into a friendly Conflict. */
function uniqueClash(err: unknown, friendly: string): Error {
  const code = (err as { code?: string }).code;
  if (code === 'P2002') return new Conflict(friendly);
  return err as Error;
}

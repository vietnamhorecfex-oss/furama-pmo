/**
 * web/server port of ConfigService BudgetCategory methods
 * (backend/src/config-dim/config.service.ts lines ~383-448).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - ForbiddenException/NotFoundException/ConflictException → errors from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - BigInt fields mapped to number via moneyToNumber() in DTO mapper
 */
import type { BudgetCategory } from '@prisma/client';
import type { CreateBudgetCategoryDto, UpdateBudgetCategoryDto, ReorderDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { NotFound, Conflict } from '../http/errors';
import { moneyToNumber } from '../http/serialize';
import { uniqueClash } from './config-util';

// ─── DTO type (with money as number) ─────────────────────────────────────────

export type BudgetCategoryDto = Omit<BudgetCategory, 'plannedVnd' | 'actualVnd'> & {
  plannedVnd: number;
  actualVnd: number;
};

function toDto(row: BudgetCategory): BudgetCategoryDto {
  return {
    ...row,
    plannedVnd: moneyToNumber(row.plannedVnd),
    actualVnd: moneyToNumber(row.actualVnd),
  };
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function listBudgetCategories(ctx: AuthContext, projectId: string): Promise<BudgetCategoryDto[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  const rows = await prisma.budgetCategory.findMany({
    where: { projectId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toDto);
}

export async function createBudgetCategory(
  ctx: AuthContext,
  projectId: string,
  dto: CreateBudgetCategoryDto,
  ip: string | null,
): Promise<BudgetCategoryDto> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);
  try {
    const row = await prisma.budgetCategory.create({
      data: {
        projectId,
        name: dto.name,
        ownerLabel: dto.ownerLabel ?? null,
        plannedVnd: BigInt(dto.plannedVnd),
        order: dto.order,
      },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      { action: 'budgetCategory.created', entityType: 'BudgetCategory', entityId: row.id, after: { name: dto.name } },
    );
    return toDto(row);
  } catch (err) {
    throw uniqueClash(err, `BudgetCategory "${dto.name}" already exists in this project`);
  }
}

export async function updateBudgetCategory(
  ctx: AuthContext,
  projectId: string,
  id: string,
  dto: UpdateBudgetCategoryDto,
  ip: string | null,
): Promise<BudgetCategoryDto> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);
  const before = await prisma.budgetCategory.findFirst({ where: { id, projectId } });
  if (!before) throw new NotFound('BudgetCategory not found');
  try {
    const row = await prisma.budgetCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.ownerLabel !== undefined ? { ownerLabel: dto.ownerLabel } : {}),
        ...(dto.plannedVnd !== undefined ? { plannedVnd: BigInt(dto.plannedVnd) } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    await auditRecord(
      { actorId: ctx.userId, projectId, ip },
      { action: 'budgetCategory.updated', entityType: 'BudgetCategory', entityId: id },
    );
    return toDto(row);
  } catch (err) {
    throw uniqueClash(err, 'BudgetCategory name conflict in this project');
  }
}

export async function deleteBudgetCategory(
  ctx: AuthContext,
  projectId: string,
  id: string,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);
  const cat = await prisma.budgetCategory.findFirst({ where: { id, projectId } });
  if (!cat) throw new NotFound('BudgetCategory not found');
  const refs = await prisma.task.count({ where: { budgetCategoryId: id } });
  if (refs > 0) {
    throw new Conflict(`BudgetCategory has ${refs} task(s); detach first`);
  }
  await prisma.budgetCategory.delete({ where: { id } });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'budgetCategory.deleted', entityType: 'BudgetCategory', entityId: id },
  );
}

export async function reorderBudgetCategories(
  ctx: AuthContext,
  projectId: string,
  dto: ReorderDto,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);
  await prisma.$transaction(async (tx) => {
    for (const item of dto.items) {
      await tx.budgetCategory.updateMany({ where: { id: item.id, projectId }, data: { order: item.order } });
    }
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'budgetCategory.reordered', entityType: 'BudgetCategory' },
  );
}

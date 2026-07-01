/**
 * web/server port of backend BudgetService (backend/src/budget/budget.service.ts).
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - NotFoundException → NotFound from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - All BigInt money fields → moneyToNumber at the response boundary
 *
 * Key computation semantics (do NOT change):
 *  - committedVnd per category = Σ Task.budgetVnd (task.groupBy budgetCategoryId)
 *  - actualVnd per category = BudgetCategory.actualVnd (manually entered — NOT rolled from tasks)
 *  - utilization = committed/planned (0 when planned=0)
 *  - __uncategorized__ bucket for null-category tasks with any committed/actual spend
 *  - overruns: committedVnd > plannedVnd * 1.1; special case planned=0 with committed>0
 *  - overCap = capVnd > 0 && Σcommitted > capVnd
 */
import type { BudgetImportDto, BudgetImportResult, BudgetSummary } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { moneyToNumber } from '../http/serialize';
import { NotFound } from '../http/errors';

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Compute the full budget summary for a project.
 * Requires VIEW_PROJECT.
 */
export async function budgetSummary(ctx: AuthContext, projectId: string): Promise<BudgetSummary> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);

  const [project, categories, byCategoryRows, byWorkstreamRows, workstreams] =
    await prisma.$transaction([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.budgetCategory.findMany({
        where: { projectId },
        orderBy: { order: 'asc' },
      }),
      prisma.task.groupBy({
        by: ['budgetCategoryId'],
        where: { projectId },
        _sum: { budgetVnd: true, actualVnd: true },
        orderBy: { budgetCategoryId: 'asc' },
      }),
      prisma.task.groupBy({
        by: ['workstreamId'],
        where: { projectId },
        _sum: { budgetVnd: true, actualVnd: true },
        orderBy: { workstreamId: 'asc' },
      }),
      prisma.workstream.findMany({
        where: { projectId },
        select: { id: true, name: true },
      }),
    ]);

  if (!project) throw new NotFound('Project not found');

  // Build per-category aggregation map from task groupBy results.
  const taskAggByCat = new Map<string | null, { committed: bigint; actual: bigint }>();
  for (const r of byCategoryRows) {
    taskAggByCat.set(r.budgetCategoryId, {
      committed: r._sum?.budgetVnd ?? 0n,
      actual: r._sum?.actualVnd ?? 0n,
    });
  }

  const byCategory = categories.map((c) => {
    const agg = taskAggByCat.get(c.id) ?? { committed: 0n, actual: 0n };
    const plannedVnd = moneyToNumber(c.plannedVnd);
    const committedVnd = moneyToNumber(agg.committed);
    // Actual spend is managed directly on the category (manual entry on the Budget screen),
    // NOT rolled up from tasks.
    const actualVnd = moneyToNumber(c.actualVnd);
    const utilization = plannedVnd === 0 ? 0 : committedVnd / plannedVnd;
    return { categoryId: c.id, name: c.name, plannedVnd, committedVnd, actualVnd, utilization };
  });

  // Tasks with no category — surfaced as an "Uncategorized" bucket if any spend exists.
  const uncategorized = taskAggByCat.get(null);
  if (uncategorized && (uncategorized.committed > 0n || uncategorized.actual > 0n)) {
    byCategory.push({
      categoryId: '__uncategorized__',
      name: 'Uncategorized',
      plannedVnd: 0,
      committedVnd: moneyToNumber(uncategorized.committed),
      actualVnd: moneyToNumber(uncategorized.actual),
      utilization: 0,
    });
  }

  const wsNameById = new Map(workstreams.map((w) => [w.id, w.name]));
  const byWorkstream = byWorkstreamRows.map((r) => ({
    workstreamId: r.workstreamId,
    name: r.workstreamId ? (wsNameById.get(r.workstreamId) ?? 'Unknown') : 'Unassigned',
    committedVnd: moneyToNumber(r._sum?.budgetVnd ?? 0n),
    actualVnd: moneyToNumber(r._sum?.actualVnd ?? 0n),
  }));

  // Overruns: committed > planned * 1.10. For planned=0 with any commitment, treat as overrun.
  const overruns = byCategory
    .filter((c) => c.categoryId !== '__uncategorized__')
    .filter((c) => {
      if (c.plannedVnd === 0) return c.committedVnd > 0;
      return c.committedVnd > c.plannedVnd * 1.1;
    })
    .map((c) => ({
      categoryId: c.categoryId,
      name: c.name,
      plannedVnd: c.plannedVnd,
      committedVnd: c.committedVnd,
      overByVnd: Math.max(1, c.committedVnd - c.plannedVnd),
    }));

  const plannedVnd = byCategory.reduce((s, c) => s + c.plannedVnd, 0);
  const committedVnd = byCategory.reduce((s, c) => s + c.committedVnd, 0);
  const actualVnd = byCategory.reduce((s, c) => s + c.actualVnd, 0);
  const capVnd = moneyToNumber(project.budgetCapVnd);

  return {
    projectId,
    capVnd,
    plannedVnd,
    committedVnd,
    actualVnd,
    overCap: capVnd > 0 && committedVnd > capVnd,
    byCategory,
    byWorkstream,
    overruns,
  };
}

/**
 * Set the project budget cap (envelope).
 * Requires MANAGE_BUDGET.
 */
export async function setBudgetCap(
  ctx: AuthContext,
  projectId: string,
  capVnd: number,
  ip: string | null,
): Promise<BudgetSummary> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);
  const before = await prisma.project.findUnique({
    where: { id: projectId },
    select: { budgetCapVnd: true },
  });
  if (!before) throw new NotFound('Project not found');

  await prisma.project.update({
    where: { id: projectId },
    data: { budgetCapVnd: BigInt(capVnd) },
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'budget.capSet',
      entityType: 'Project',
      entityId: projectId,
      before: { capVnd: moneyToNumber(before.budgetCapVnd) },
      after: { capVnd },
    },
  );

  return budgetSummary(ctx, projectId);
}

/**
 * Update a category's planned and/or actual amounts.
 * Requires MANAGE_BUDGET.
 */
export async function setCategoryAmounts(
  ctx: AuthContext,
  projectId: string,
  categoryId: string,
  amounts: { plannedVnd?: number; actualVnd?: number },
  ip: string | null,
): Promise<BudgetSummary> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);

  const cat = await prisma.budgetCategory.findFirst({
    where: { id: categoryId, projectId },
    select: { id: true, name: true, plannedVnd: true, actualVnd: true },
  });
  if (!cat) throw new NotFound('Budget category not found');

  await prisma.budgetCategory.update({
    where: { id: categoryId },
    data: {
      ...(amounts.plannedVnd !== undefined ? { plannedVnd: BigInt(amounts.plannedVnd) } : {}),
      ...(amounts.actualVnd !== undefined ? { actualVnd: BigInt(amounts.actualVnd) } : {}),
    },
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'budget.categorySet',
      entityType: 'BudgetCategory',
      entityId: categoryId,
      before: { plannedVnd: moneyToNumber(cat.plannedVnd), actualVnd: moneyToNumber(cat.actualVnd) },
      after: { name: cat.name, ...amounts },
    },
  );

  return budgetSummary(ctx, projectId);
}

/**
 * Bulk import: set cap and/or update planned (+optional actual) per category by name.
 * Creates missing categories. Requires MANAGE_BUDGET.
 */
export async function importBudget(
  ctx: AuthContext,
  projectId: string,
  dto: BudgetImportDto,
  ip: string | null,
): Promise<BudgetImportResult> {
  await assertCan(ctx, 'MANAGE_BUDGET', projectId);

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new NotFound('Project not found');

  const existing = await prisma.budgetCategory.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });
  const idByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  let order = existing.length;
  const result: BudgetImportResult = { updated: 0, created: 0, capUpdated: false };

  for (const row of dto.rows) {
    const id = idByName.get(row.name.toLowerCase());
    const actualData = row.actualVnd !== undefined ? { actualVnd: BigInt(row.actualVnd) } : {};
    if (id) {
      await prisma.budgetCategory.update({
        where: { id },
        data: { plannedVnd: BigInt(row.plannedVnd), ...actualData },
      });
      result.updated++;
    } else {
      const created = await prisma.budgetCategory.create({
        data: { projectId, name: row.name, plannedVnd: BigInt(row.plannedVnd), ...actualData, order: order++ },
      });
      idByName.set(row.name.toLowerCase(), created.id);
      result.created++;
    }
  }

  if (dto.capVnd !== undefined) {
    await prisma.project.update({
      where: { id: projectId },
      data: { budgetCapVnd: BigInt(dto.capVnd) },
    });
    result.capUpdated = true;
  }

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'budget.imported',
      entityType: 'Project',
      entityId: projectId,
      after: { ...result },
    },
  );

  return result;
}

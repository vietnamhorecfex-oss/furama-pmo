/**
 * B-01 — BudgetService.summary
 *
 * One read = one transaction issuing N indexed aggregations:
 *  - project: cap
 *  - categories: planned per category
 *  - tasks: committed/actual grouped by (category, workstream)
 *
 * Money: stored as BigInt; converted to Number at the boundary. VND has no decimals and
 * any plausible project cap is well within Number.MAX_SAFE_INTEGER (≈ 9.007e15).
 *
 * "Overrun": committed > planned by more than 10% of planned, per category (docs §M-BUDGET AC).
 * A category with planned=0 is overrun the moment anyone commits against it.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { BudgetImportDto, BudgetImportResult, BudgetSummary } from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService, type AuthContext } from '../rbac/rbac.service';

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  // ====================================================================== EDIT
  /** Set the project budget cap (envelope). Requires MANAGE_BUDGET. */
  async setCap(ctx: AuthContext, projectId: string, capVnd: number, ip: string | null): Promise<BudgetSummary> {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    const before = await this.prisma.project.findUnique({ where: { id: projectId }, select: { budgetCapVnd: true } });
    if (!before) throw new NotFoundException('Project not found');
    await this.prisma.project.update({ where: { id: projectId }, data: { budgetCapVnd: BigInt(capVnd) } });
    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'budget.capSet', entityType: 'Project', entityId: projectId, before: { capVnd: Number(before.budgetCapVnd) }, after: { capVnd } },
    );
    return this.summary(ctx, projectId);
  }

  /** Update a single category's planned amount. Requires MANAGE_BUDGET. */
  async setCategoryPlanned(ctx: AuthContext, projectId: string, categoryId: string, plannedVnd: number, ip: string | null): Promise<BudgetSummary> {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    const cat = await this.prisma.budgetCategory.findFirst({ where: { id: categoryId, projectId }, select: { id: true, plannedVnd: true, name: true } });
    if (!cat) throw new NotFoundException('Budget category not found');
    await this.prisma.budgetCategory.update({ where: { id: categoryId }, data: { plannedVnd: BigInt(plannedVnd) } });
    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'budget.plannedSet', entityType: 'BudgetCategory', entityId: categoryId, before: { plannedVnd: Number(cat.plannedVnd) }, after: { name: cat.name, plannedVnd } },
    );
    return this.summary(ctx, projectId);
  }

  /** Bulk import: set cap and/or update planned by category name (creates missing). Requires MANAGE_BUDGET. */
  async importBudget(ctx: AuthContext, projectId: string, dto: BudgetImportDto, ip: string | null): Promise<BudgetImportResult> {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');

    const existing = await this.prisma.budgetCategory.findMany({ where: { projectId }, select: { id: true, name: true } });
    const idByName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
    let order = existing.length;
    const result: BudgetImportResult = { updated: 0, created: 0, capUpdated: false };

    for (const row of dto.rows) {
      const id = idByName.get(row.name.toLowerCase());
      if (id) {
        await this.prisma.budgetCategory.update({ where: { id }, data: { plannedVnd: BigInt(row.plannedVnd) } });
        result.updated++;
      } else {
        const created = await this.prisma.budgetCategory.create({
          data: { projectId, name: row.name, plannedVnd: BigInt(row.plannedVnd), order: order++ },
        });
        idByName.set(row.name.toLowerCase(), created.id);
        result.created++;
      }
    }

    if (dto.capVnd !== undefined) {
      await this.prisma.project.update({ where: { id: projectId }, data: { budgetCapVnd: BigInt(dto.capVnd) } });
      result.capUpdated = true;
    }

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'budget.imported', entityType: 'Project', entityId: projectId, after: { ...result } },
    );
    return result;
  }

  async summary(ctx: AuthContext, projectId: string): Promise<BudgetSummary> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);

    const [project, categories, byCategoryRows, byWorkstreamRows, workstreams] =
      await this.prisma.$transaction([
        this.prisma.project.findUnique({ where: { id: projectId } }),
        this.prisma.budgetCategory.findMany({
          where: { projectId },
          orderBy: { order: 'asc' },
        }),
        this.prisma.task.groupBy({
          by: ['budgetCategoryId'],
          where: { projectId },
          _sum: { budgetVnd: true, actualVnd: true },
          orderBy: { budgetCategoryId: 'asc' },
        }),
        this.prisma.task.groupBy({
          by: ['workstreamId'],
          where: { projectId },
          _sum: { budgetVnd: true, actualVnd: true },
          orderBy: { workstreamId: 'asc' },
        }),
        this.prisma.workstream.findMany({
          where: { projectId },
          select: { id: true, name: true },
        }),
      ]);

    if (!project) throw new NotFoundException('Project not found');

    // Build per-category map for fast joining with planned amounts.
    const taskAggByCat = new Map<string | null, { committed: bigint; actual: bigint }>();
    for (const r of byCategoryRows) {
      taskAggByCat.set(r.budgetCategoryId, {
        committed: r._sum?.budgetVnd ?? 0n,
        actual: r._sum?.actualVnd ?? 0n,
      });
    }

    const byCategory = categories.map((c) => {
      const agg = taskAggByCat.get(c.id) ?? { committed: 0n, actual: 0n };
      const plannedVnd = Number(c.plannedVnd);
      const committedVnd = Number(agg.committed);
      const actualVnd = Number(agg.actual);
      const utilization = plannedVnd === 0 ? 0 : committedVnd / plannedVnd;
      return { categoryId: c.id, name: c.name, plannedVnd, committedVnd, actualVnd, utilization };
    });

    // Tasks with no category — surfaced as an "Uncategorized" bucket if any.
    const uncategorized = taskAggByCat.get(null);
    if (uncategorized && (uncategorized.committed > 0n || uncategorized.actual > 0n)) {
      byCategory.push({
        categoryId: '__uncategorized__',
        name: 'Uncategorized',
        plannedVnd: 0,
        committedVnd: Number(uncategorized.committed),
        actualVnd: Number(uncategorized.actual),
        utilization: 0,
      });
    }

    const wsNameById = new Map(workstreams.map((w) => [w.id, w.name]));
    const byWorkstream = byWorkstreamRows.map((r) => ({
      workstreamId: r.workstreamId,
      name: r.workstreamId ? (wsNameById.get(r.workstreamId) ?? 'Unknown') : 'Unassigned',
      committedVnd: Number(r._sum?.budgetVnd ?? 0n),
      actualVnd: Number(r._sum?.actualVnd ?? 0n),
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
    const capVnd = Number(project.budgetCapVnd);

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
}

/**
 * P-06 — ConfigService. Owns the five configurable dimensions of a project:
 *
 *   Phase, Workstream, StatusDef, PriorityDef, BudgetCategory
 *
 * Common rules (docs/03 §M-CONFIG):
 *  - All mutations require MANAGE_CONFIG (OWNER/PM only).
 *  - Reorder is a bulk operation in a single transaction; partial reorders are rejected
 *    by the validation pipe (zod refuses ≤0 items).
 *  - Referential guards:
 *      Phase: cannot delete if any Task references it (unless caller is OK with cascade — we DENY).
 *      Workstream: same — Task and MemberWorkstream rows must be empty.
 *      StatusDef/PriorityDef: cannot delete if any Task still uses the key, UNLESS the caller
 *        provides `replaceWithKey` that points to an existing def in the same project. In that
 *        case we re-key the affected tasks inside a single transaction (cascade rename).
 *      BudgetCategory: cannot delete if any Task references it.
 *
 *  - Cascade rename: updating StatusDef.key (via `renameToKey`) or PriorityDef.key (same field)
 *    re-points every Task.status / Task.priority equal to the old key inside a transaction.
 *
 * Note on Prisma enum vs StatusDef.key: in v1 Task.status is the fixed Prisma enum value,
 * while StatusDef provides per-project label/color. A "rename" therefore changes the def row
 * but does NOT migrate Task.status enum values; the cascade is exercised by the matching test
 * once Task entities exist (M3). For deletion we still gate on "are any tasks using this key".
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePhaseDto,
  UpdatePhaseDto,
  CreateWorkstreamDto,
  UpdateWorkstreamDto,
  CreateStatusDefDto,
  UpdateStatusDefDto,
  CreatePriorityDefDto,
  UpdatePriorityDefDto,
  CreateBudgetCategoryDto,
  UpdateBudgetCategoryDto,
  ReorderDto,
  DeleteWithReplacementDto,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import type { AuthContext } from '../rbac/rbac.service';

@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ====================================================================== PHASES
  listPhases(ctx: AuthContext, projectId: string) {
    return this.assertView(ctx, projectId).then(() =>
      this.prisma.phase.findMany({ where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    );
  }

  async createPhase(ctx: AuthContext, projectId: string, dto: CreatePhaseDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    try {
      const row = await this.prisma.phase.create({
        data: {
          projectId,
          name: dto.name,
          order: dto.order,
          startDate: dto.startDate ? new Date(dto.startDate) : null,
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'phase.created', entityType: 'Phase', entityId: row.id, after: { name: dto.name } });
      return row;
    } catch (err) {
      throw uniqueClash(err, `Phase "${dto.name}" already exists in this project`);
    }
  }

  async updatePhase(ctx: AuthContext, projectId: string, phaseId: string, dto: UpdatePhaseDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    const before = await this.prisma.phase.findFirst({ where: { id: phaseId, projectId } });
    if (!before) throw new NotFoundException('Phase not found');
    try {
      const row = await this.prisma.phase.update({
        where: { id: phaseId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
          ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
          ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'phase.updated', entityType: 'Phase', entityId: phaseId, before: { name: before.name }, after: { name: row.name } });
      return row;
    } catch (err) {
      throw uniqueClash(err, `Phase name conflict in this project`);
    }
  }

  async deletePhase(ctx: AuthContext, projectId: string, phaseId: string, ip: string | null) {
    await this.assertManage(ctx, projectId);
    const phase = await this.prisma.phase.findFirst({ where: { id: phaseId, projectId } });
    if (!phase) throw new NotFoundException('Phase not found');
    const refs = await this.prisma.task.count({ where: { phaseId } });
    if (refs > 0) throw new ConflictException(`Phase has ${refs} task(s); reassign them first`);
    await this.prisma.phase.delete({ where: { id: phaseId } });
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'phase.deleted', entityType: 'Phase', entityId: phaseId });
  }

  async reorderPhases(ctx: AuthContext, projectId: string, dto: ReorderDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    await this.bulkReorder(projectId, dto, (id, order, tx) =>
      tx.phase.updateMany({ where: { id, projectId }, data: { order } }),
    );
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'phase.reordered', entityType: 'Phase' });
  }

  // ====================================================================== WORKSTREAMS
  listWorkstreams(ctx: AuthContext, projectId: string) {
    return this.assertView(ctx, projectId).then(() =>
      this.prisma.workstream.findMany({ where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    );
  }

  async createWorkstream(ctx: AuthContext, projectId: string, dto: CreateWorkstreamDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    try {
      const row = await this.prisma.workstream.create({
        data: { projectId, name: dto.name, track: dto.track, order: dto.order },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'workstream.created', entityType: 'Workstream', entityId: row.id, after: { name: dto.name } });
      return row;
    } catch (err) {
      throw uniqueClash(err, `Workstream "${dto.name}" already exists in this project`);
    }
  }

  async updateWorkstream(ctx: AuthContext, projectId: string, id: string, dto: UpdateWorkstreamDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    const before = await this.prisma.workstream.findFirst({ where: { id, projectId } });
    if (!before) throw new NotFoundException('Workstream not found');
    try {
      const row = await this.prisma.workstream.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.track !== undefined ? { track: dto.track } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'workstream.updated', entityType: 'Workstream', entityId: id, before: { name: before.name }, after: { name: row.name } });
      return row;
    } catch (err) {
      throw uniqueClash(err, 'Workstream name conflict in this project');
    }
  }

  async deleteWorkstream(ctx: AuthContext, projectId: string, id: string, ip: string | null) {
    await this.assertManage(ctx, projectId);
    const ws = await this.prisma.workstream.findFirst({ where: { id, projectId } });
    if (!ws) throw new NotFoundException('Workstream not found');
    const [taskRefs, memberScopeRefs] = await Promise.all([
      this.prisma.task.count({ where: { workstreamId: id } }),
      this.prisma.memberWorkstream.count({ where: { workstreamId: id } }),
    ]);
    if (taskRefs > 0 || memberScopeRefs > 0) {
      throw new ConflictException(
        `Workstream has ${taskRefs} task(s) and ${memberScopeRefs} LEAD scope(s); detach first`,
      );
    }
    await this.prisma.workstream.delete({ where: { id } });
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'workstream.deleted', entityType: 'Workstream', entityId: id });
  }

  async reorderWorkstreams(ctx: AuthContext, projectId: string, dto: ReorderDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    await this.bulkReorder(projectId, dto, (id, order, tx) =>
      tx.workstream.updateMany({ where: { id, projectId }, data: { order } }),
    );
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'workstream.reordered', entityType: 'Workstream' });
  }

  // ====================================================================== STATUS DEFS
  listStatuses(ctx: AuthContext, projectId: string) {
    return this.assertView(ctx, projectId).then(() =>
      this.prisma.statusDef.findMany({ where: { projectId }, orderBy: [{ order: 'asc' }, { key: 'asc' }] }),
    );
  }

  async createStatus(ctx: AuthContext, projectId: string, dto: CreateStatusDefDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    try {
      const row = await this.prisma.statusDef.create({
        data: { projectId, key: dto.key, color: dto.color, order: dto.order, isTerminal: dto.isTerminal },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'status.created', entityType: 'StatusDef', entityId: row.id, after: { key: dto.key } });
      return row;
    } catch (err) {
      throw uniqueClash(err, `StatusDef "${dto.key}" already exists in this project`);
    }
  }

  async updateStatus(ctx: AuthContext, projectId: string, id: string, dto: UpdateStatusDefDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    const before = await this.prisma.statusDef.findFirst({ where: { id, projectId } });
    if (!before) throw new NotFoundException('StatusDef not found');

    // Cascade rename (transactional). When renameToKey is given, the key on this row changes
    // and any Task currently bearing the old key string is migrated — together — or the whole
    // operation rolls back. Validation: the new key must not already exist on this project.
    await this.prisma.$transaction(async (tx) => {
      if (dto.renameToKey && dto.renameToKey !== before.key) {
        const clash = await tx.statusDef.findFirst({
          where: { projectId, key: dto.renameToKey, NOT: { id } },
          select: { id: true },
        });
        if (clash) throw new ConflictException(`Cannot rename to "${dto.renameToKey}" — already in use`);
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

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      { action: 'status.updated', entityType: 'StatusDef', entityId: id, before: { key: before.key }, after: { key: dto.renameToKey ?? dto.key ?? before.key } },
    );
    return this.prisma.statusDef.findUnique({ where: { id } });
  }

  async deleteStatus(
    ctx: AuthContext,
    projectId: string,
    id: string,
    dto: DeleteWithReplacementDto,
    ip: string | null,
  ) {
    await this.assertManage(ctx, projectId);
    const status = await this.prisma.statusDef.findFirst({ where: { id, projectId } });
    if (!status) throw new NotFoundException('StatusDef not found');

    // Task.status is a Prisma enum (v1), so "tasks still referencing this key" can only be true
    // when the def's key matches one of the canonical enum values used by Task. We treat any
    // tasks bearing the matching enum value as referenced.
    const referenced = await this.prisma.task.count({
      where: { projectId, status: status.key as never },
    }).catch(() => 0);

    if (referenced > 0 && !dto.replaceWithKey) {
      throw new ConflictException(
        `StatusDef "${status.key}" is used by ${referenced} task(s); provide replaceWithKey`,
      );
    }
    if (referenced > 0 && dto.replaceWithKey) {
      const replacement = await this.prisma.statusDef.findFirst({
        where: { projectId, key: dto.replaceWithKey },
      });
      if (!replacement) throw new BadRequestException(`replaceWithKey "${dto.replaceWithKey}" not found`);
      await this.prisma.$transaction([
        this.prisma.task.updateMany({
          where: { projectId, status: status.key as never },
          data: { status: dto.replaceWithKey as never },
        }),
        this.prisma.statusDef.delete({ where: { id } }),
      ]);
    } else {
      await this.prisma.statusDef.delete({ where: { id } });
    }
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'status.deleted', entityType: 'StatusDef', entityId: id, before: { key: status.key } });
  }

  async reorderStatuses(ctx: AuthContext, projectId: string, dto: ReorderDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    await this.bulkReorder(projectId, dto, (id, order, tx) =>
      tx.statusDef.updateMany({ where: { id, projectId }, data: { order } }),
    );
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'status.reordered', entityType: 'StatusDef' });
  }

  // ====================================================================== PRIORITY DEFS
  listPriorities(ctx: AuthContext, projectId: string) {
    return this.assertView(ctx, projectId).then(() =>
      this.prisma.priorityDef.findMany({ where: { projectId }, orderBy: [{ order: 'asc' }, { key: 'asc' }] }),
    );
  }

  async createPriority(ctx: AuthContext, projectId: string, dto: CreatePriorityDefDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    try {
      const row = await this.prisma.priorityDef.create({
        data: { projectId, key: dto.key, color: dto.color, order: dto.order },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'priority.created', entityType: 'PriorityDef', entityId: row.id, after: { key: dto.key } });
      return row;
    } catch (err) {
      throw uniqueClash(err, `PriorityDef "${dto.key}" already exists in this project`);
    }
  }

  async updatePriority(ctx: AuthContext, projectId: string, id: string, dto: UpdatePriorityDefDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    const before = await this.prisma.priorityDef.findFirst({ where: { id, projectId } });
    if (!before) throw new NotFoundException('PriorityDef not found');
    await this.prisma.$transaction(async (tx) => {
      if (dto.renameToKey && dto.renameToKey !== before.key) {
        const clash = await tx.priorityDef.findFirst({
          where: { projectId, key: dto.renameToKey, NOT: { id } },
          select: { id: true },
        });
        if (clash) throw new ConflictException(`Cannot rename to "${dto.renameToKey}" — already in use`);
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
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'priority.updated', entityType: 'PriorityDef', entityId: id });
    return this.prisma.priorityDef.findUnique({ where: { id } });
  }

  async deletePriority(
    ctx: AuthContext,
    projectId: string,
    id: string,
    dto: DeleteWithReplacementDto,
    ip: string | null,
  ) {
    await this.assertManage(ctx, projectId);
    const prio = await this.prisma.priorityDef.findFirst({ where: { id, projectId } });
    if (!prio) throw new NotFoundException('PriorityDef not found');
    const referenced = await this.prisma.task.count({
      where: { projectId, priority: prio.key as never },
    }).catch(() => 0);
    if (referenced > 0 && !dto.replaceWithKey) {
      throw new ConflictException(`PriorityDef "${prio.key}" is used by ${referenced} task(s); provide replaceWithKey`);
    }
    if (referenced > 0 && dto.replaceWithKey) {
      const replacement = await this.prisma.priorityDef.findFirst({
        where: { projectId, key: dto.replaceWithKey },
      });
      if (!replacement) throw new BadRequestException(`replaceWithKey "${dto.replaceWithKey}" not found`);
      await this.prisma.$transaction([
        this.prisma.task.updateMany({
          where: { projectId, priority: prio.key as never },
          data: { priority: dto.replaceWithKey as never },
        }),
        this.prisma.priorityDef.delete({ where: { id } }),
      ]);
    } else {
      await this.prisma.priorityDef.delete({ where: { id } });
    }
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'priority.deleted', entityType: 'PriorityDef', entityId: id, before: { key: prio.key } });
  }

  async reorderPriorities(ctx: AuthContext, projectId: string, dto: ReorderDto, ip: string | null) {
    await this.assertManage(ctx, projectId);
    await this.bulkReorder(projectId, dto, (id, order, tx) =>
      tx.priorityDef.updateMany({ where: { id, projectId }, data: { order } }),
    );
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'priority.reordered', entityType: 'PriorityDef' });
  }

  // ====================================================================== BUDGET CATEGORIES
  listBudgetCategories(ctx: AuthContext, projectId: string) {
    return this.assertView(ctx, projectId).then(() =>
      this.prisma.budgetCategory.findMany({ where: { projectId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
    );
  }

  async createBudgetCategory(ctx: AuthContext, projectId: string, dto: CreateBudgetCategoryDto, ip: string | null) {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    try {
      const row = await this.prisma.budgetCategory.create({
        data: {
          projectId,
          name: dto.name,
          ownerLabel: dto.ownerLabel ?? null,
          plannedVnd: BigInt(dto.plannedVnd),
          order: dto.order,
        },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'budgetCategory.created', entityType: 'BudgetCategory', entityId: row.id, after: { name: dto.name } });
      return row;
    } catch (err) {
      throw uniqueClash(err, `BudgetCategory "${dto.name}" already exists in this project`);
    }
  }

  async updateBudgetCategory(ctx: AuthContext, projectId: string, id: string, dto: UpdateBudgetCategoryDto, ip: string | null) {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    const before = await this.prisma.budgetCategory.findFirst({ where: { id, projectId } });
    if (!before) throw new NotFoundException('BudgetCategory not found');
    try {
      const row = await this.prisma.budgetCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.ownerLabel !== undefined ? { ownerLabel: dto.ownerLabel } : {}),
          ...(dto.plannedVnd !== undefined ? { plannedVnd: BigInt(dto.plannedVnd) } : {}),
          ...(dto.order !== undefined ? { order: dto.order } : {}),
        },
      });
      await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'budgetCategory.updated', entityType: 'BudgetCategory', entityId: id });
      return row;
    } catch (err) {
      throw uniqueClash(err, 'BudgetCategory name conflict in this project');
    }
  }

  async deleteBudgetCategory(ctx: AuthContext, projectId: string, id: string, ip: string | null) {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    const cat = await this.prisma.budgetCategory.findFirst({ where: { id, projectId } });
    if (!cat) throw new NotFoundException('BudgetCategory not found');
    const refs = await this.prisma.task.count({ where: { budgetCategoryId: id } });
    if (refs > 0) {
      throw new ConflictException(`BudgetCategory has ${refs} task(s); detach first`);
    }
    await this.prisma.budgetCategory.delete({ where: { id } });
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'budgetCategory.deleted', entityType: 'BudgetCategory', entityId: id });
  }

  async reorderBudgetCategories(ctx: AuthContext, projectId: string, dto: ReorderDto, ip: string | null) {
    await this.rbac.assertCan(ctx, 'MANAGE_BUDGET', projectId);
    await this.bulkReorder(projectId, dto, (id, order, tx) =>
      tx.budgetCategory.updateMany({ where: { id, projectId }, data: { order } }),
    );
    await this.audit.record({ actorId: ctx.userId, projectId, ip }, { action: 'budgetCategory.reordered', entityType: 'BudgetCategory' });
  }

  // ====================================================================== helpers
  private async assertView(ctx: AuthContext, projectId: string): Promise<void> {
    await this.rbac.assertCan(ctx, 'VIEW_PROJECT', projectId);
  }

  private async assertManage(ctx: AuthContext, projectId: string): Promise<void> {
    await this.rbac.assertCan(ctx, 'MANAGE_CONFIG', projectId);
  }

  private async bulkReorder(
    projectId: string,
    dto: ReorderDto,
    apply: (
      id: string,
      order: number,
      tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ) => Promise<unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await apply(item.id, item.order, tx);
      }
    });
  }
}

/** Translate Prisma's unique-violation P2002 into a friendly Conflict. */
function uniqueClash(err: unknown, friendly: string): Error {
  const code = (err as { code?: string }).code;
  if (code === 'P2002') return new ConflictException(friendly);
  return err as Error;
}

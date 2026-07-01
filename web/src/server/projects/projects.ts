/**
 * web/server port of backend ProjectsService (backend/src/projects/projects.service.ts).
 * NestJS class → module functions; injected services → singleton imports.
 */
import type { Prisma, Project } from '@prisma/client';
import type { CreateProjectDto, ProjectDto, UpdateProjectMetaDto } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { moneyToNumber } from '../http/serialize';
import { BadRequest, NotFound, Conflict } from '../http/errors';

// ─── public API ───────────────────────────────────────────────────────────────

export async function createProject(
  ctx: AuthContext,
  dto: CreateProjectDto,
  ip: string | null,
): Promise<ProjectDto> {
  assertDateOrder(dto.startDate, dto.endDate);

  const project = await prisma.$transaction(async (tx) => {
    const row = await tx.project.create({
      data: {
        orgId: ctx.orgId,
        name: dto.name,
        location: dto.location ?? null,
        status: dto.status,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        openingDate: dto.openingDate ? new Date(dto.openingDate) : null,
        budgetCapVnd: BigInt(dto.budgetCapVnd),
        createdById: ctx.userId,
      },
    });
    await tx.projectMember.create({
      data: { projectId: row.id, userId: ctx.userId, role: 'OWNER' },
    });
    return row;
  });

  await auditRecord(
    { actorId: ctx.userId, projectId: project.id, ip },
    { action: 'project.created', entityType: 'Project', entityId: project.id, after: toAuditJson(project) },
  );

  return toProjectDto(project);
}

export async function listProjects(ctx: AuthContext): Promise<ProjectDto[]> {
  const rows = await prisma.project.findMany({
    where: {
      archivedAt: null,
      members: { some: { userId: ctx.userId } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toProjectDto);
}

export async function getProject(ctx: AuthContext, projectId: string): Promise<ProjectDto> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  const row = await prisma.project.findUnique({ where: { id: projectId } });
  if (!row) throw new NotFound('Project not found');
  return toProjectDto(row);
}

export async function updateProjectMeta(
  ctx: AuthContext,
  projectId: string,
  dto: UpdateProjectMetaDto,
  ip: string | null,
): Promise<ProjectDto> {
  await assertCan(ctx, 'MANAGE_CONFIG', projectId);
  const before = await prisma.project.findUnique({ where: { id: projectId } });
  if (!before) throw new NotFound('Project not found');

  // Resolve the post-update date pair to validate ordering once.
  const start =
    dto.startDate === undefined ? before.startDate : dto.startDate === null ? null : new Date(dto.startDate);
  const end =
    dto.endDate === undefined ? before.endDate : dto.endDate === null ? null : new Date(dto.endDate);
  if (start && end && start > end) {
    throw new BadRequest('startDate must be on or before endDate');
  }

  const data: Prisma.ProjectUpdateInput = {};
  if (dto.name !== undefined) data.name = dto.name;
  if (dto.location !== undefined) data.location = dto.location;
  if (dto.status !== undefined) data.status = dto.status;
  if (dto.startDate !== undefined) data.startDate = dto.startDate === null ? null : new Date(dto.startDate);
  if (dto.endDate !== undefined) data.endDate = dto.endDate === null ? null : new Date(dto.endDate);
  if (dto.openingDate !== undefined) data.openingDate = dto.openingDate === null ? null : new Date(dto.openingDate);
  if (dto.budgetCapVnd !== undefined) data.budgetCapVnd = BigInt(dto.budgetCapVnd);

  const after = await prisma.project.update({ where: { id: projectId }, data });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'project.updated',
      entityType: 'Project',
      entityId: projectId,
      before: toAuditJson(before),
      after: toAuditJson(after),
    },
  );
  return toProjectDto(after);
}

export async function archiveProject(
  ctx: AuthContext,
  projectId: string,
  ip: string | null,
): Promise<ProjectDto> {
  await assertCan(ctx, 'ARCHIVE_PROJECT', projectId);
  const before = await prisma.project.findUnique({ where: { id: projectId } });
  if (!before) throw new NotFound('Project not found');
  if (before.archivedAt) {
    throw new Conflict('Project already archived');
  }
  const after = await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date(), status: 'ARCHIVED' },
  });
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    { action: 'project.archived', entityType: 'Project', entityId: projectId },
  );
  return toProjectDto(after);
}

// ─── DTO mapper ───────────────────────────────────────────────────────────────

export function toProjectDto(p: Project): ProjectDto {
  return {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    location: p.location ?? null,
    status: p.status,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    endDate: p.endDate ? p.endDate.toISOString() : null,
    openingDate: p.openingDate ? p.openingDate.toISOString() : null,
    budgetCapVnd: moneyToNumber(p.budgetCapVnd),
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

// ─── private helpers ──────────────────────────────────────────────────────────

function assertDateOrder(start?: string, end?: string): void {
  if (start && end && new Date(start) > new Date(end)) {
    throw new BadRequest('startDate must be on or before endDate');
  }
}

function toAuditJson(p: Project): Prisma.InputJsonValue {
  return { ...toProjectDto(p) } as Prisma.InputJsonValue;
}

/**
 * web/server port of backend MembersService
 * (backend/src/members/members.service.ts).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - ConflictException/BadRequestException/NotFoundException → Conflict/BadRequest/NotFound from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *
 * Last-OWNER guard: always runs INSIDE the same $transaction as the mutation (TOCTOU safety).
 * Workstream scope: only meaningful when role=LEAD; other roles have scope cleared automatically.
 */
import type { Prisma, MemberRole } from '@prisma/client';
import type {
  AddMemberDto,
  MemberDto,
  UpdateMemberDto,
  CreateMemberUserDto,
  CreateMemberUserResult,
} from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { hashPassword } from '../auth/passwords';
import { generatePassword } from '../auth/generate-password';
import { BadRequest, NotFound, Conflict } from '../http/errors';

// ─── public API ───────────────────────────────────────────────────────────────

export async function listMembers(ctx: AuthContext, projectId: string): Promise<MemberDto[]> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);
  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    include: { workstreams: { select: { workstreamId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toMemberDto);
}

export async function addMember(
  ctx: AuthContext,
  projectId: string,
  dto: AddMemberDto,
  ip: string | null,
): Promise<MemberDto> {
  await assertCan(ctx, 'MANAGE_MEMBERS', projectId);

  // The userId must reference a real user in the caller's org — otherwise Prisma throws
  // an opaque P2003 foreign-key error (ProjectMember_userId_fkey). Fail fast with a clean 404.
  const user = await prisma.user.findFirst({
    where: { id: dto.userId, orgId: ctx.orgId },
    select: { id: true },
  });
  if (!user) throw new NotFound('User not found');

  // Reject duplicates upfront with a clean error (Prisma would throw P2002 otherwise).
  const existing = await prisma.projectMember.findFirst({
    where: { projectId, userId: dto.userId },
    select: { id: true },
  });
  if (existing) throw new Conflict('User is already a member of this project');

  // memberLabel must be unique per project when set.
  if (dto.memberLabel) {
    await assertLabelFree(projectId, dto.memberLabel);
  }

  const created = await prisma.$transaction(async (tx) => {
    const member = await tx.projectMember.create({
      data: {
        projectId,
        userId: dto.userId,
        role: dto.role,
        memberLabel: dto.memberLabel ?? null,
      },
    });
    await applyScope(tx, member.id, projectId, dto.role, dto.workstreamIds);
    return member;
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'member.added',
      entityType: 'ProjectMember',
      entityId: created.id,
      after: { userId: created.userId, role: created.role },
    },
  );

  return getOne(created.id);
}

export async function createUserAndAddMember(
  ctx: AuthContext,
  projectId: string,
  dto: CreateMemberUserDto,
  ip: string | null,
): Promise<CreateMemberUserResult> {
  await assertCan(ctx, 'MANAGE_MEMBERS', projectId);

  const email = dto.email.toLowerCase();
  // Email is unique per org — reject upfront with a clean error.
  const clash = await prisma.user.findFirst({
    where: { orgId: ctx.orgId, email },
    select: { id: true },
  });
  if (clash) throw new Conflict('A user with this email already exists');

  if (dto.memberLabel) {
    await assertLabelFree(projectId, dto.memberLabel);
  }

  // System-generated initial password — returned once, never stored in plain text.
  const tempPassword = generatePassword();
  const passwordHash = await hashPassword(tempPassword);

  const { user, member } = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: { orgId: ctx.orgId, name: dto.name, email, passwordHash, isActive: true },
    });
    const createdMember = await tx.projectMember.create({
      data: {
        projectId,
        userId: createdUser.id,
        role: dto.role,
        memberLabel: dto.memberLabel ?? null,
      },
    });
    await applyScope(tx, createdMember.id, projectId, dto.role, dto.workstreamIds);
    return { user: createdUser, member: createdMember };
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'user.created',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, name: user.name },
    },
  );
  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'member.added',
      entityType: 'ProjectMember',
      entityId: member.id,
      after: { userId: member.userId, role: member.role },
    },
  );

  return {
    member: await getOne(member.id),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor,
    },
    tempPassword,
  };
}

export async function updateMember(
  ctx: AuthContext,
  projectId: string,
  memberId: string,
  dto: UpdateMemberDto,
  ip: string | null,
): Promise<MemberDto> {
  await assertCan(ctx, 'MANAGE_MEMBERS', projectId);
  const before = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
  });
  if (!before) throw new NotFound('Member not found');

  if (dto.memberLabel && dto.memberLabel !== before.memberLabel) {
    await assertLabelFree(projectId, dto.memberLabel, memberId);
  }

  const newRole: MemberRole = dto.role ?? before.role;
  const data: Prisma.ProjectMemberUpdateInput = {};
  if (dto.role !== undefined) data.role = dto.role;
  if (dto.memberLabel !== undefined) data.memberLabel = dto.memberLabel;

  await prisma.$transaction(async (tx) => {
    if (before.role === 'OWNER' && newRole !== 'OWNER') {
      await assertNotLastOwner(tx, projectId, memberId);
    }
    await tx.projectMember.update({ where: { id: memberId }, data });
    // Scope changes apply only when role is/becomes LEAD; for others, the model auto-clears.
    if (dto.workstreamIds !== undefined || dto.role !== undefined) {
      await applyScope(tx, memberId, projectId, newRole, dto.workstreamIds);
    }
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'member.updated',
      entityType: 'ProjectMember',
      entityId: memberId,
      before: { role: before.role, memberLabel: before.memberLabel },
      after: { role: newRole, memberLabel: dto.memberLabel ?? before.memberLabel },
    },
  );

  return getOne(memberId);
}

export async function removeMember(
  ctx: AuthContext,
  projectId: string,
  memberId: string,
  ip: string | null,
): Promise<void> {
  await assertCan(ctx, 'MANAGE_MEMBERS', projectId);
  const before = await prisma.projectMember.findFirst({
    where: { id: memberId, projectId },
  });
  if (!before) throw new NotFound('Member not found');

  await prisma.$transaction(async (tx) => {
    if (before.role === 'OWNER') {
      await assertNotLastOwner(tx, projectId, memberId);
    }
    await tx.projectMember.delete({ where: { id: memberId } });
  });

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'member.removed',
      entityType: 'ProjectMember',
      entityId: memberId,
      before: { role: before.role },
    },
  );
}

// ─── private helpers ──────────────────────────────────────────────────────────

async function getOne(memberId: string): Promise<MemberDto> {
  const row = await prisma.projectMember.findUnique({
    where: { id: memberId },
    include: { workstreams: { select: { workstreamId: true } } },
  });
  if (!row) throw new NotFound('Member not found');
  return toMemberDto(row);
}

async function assertLabelFree(
  projectId: string,
  label: string,
  exceptMemberId?: string,
): Promise<void> {
  const clash = await prisma.projectMember.findFirst({
    where: {
      projectId,
      memberLabel: label,
      ...(exceptMemberId ? { NOT: { id: exceptMemberId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new Conflict(`memberLabel "${label}" already used in this project`);
}

async function assertNotLastOwner(
  tx: Prisma.TransactionClient,
  projectId: string,
  memberIdLeaving: string,
): Promise<void> {
  const owners = await tx.projectMember.count({
    where: { projectId, role: 'OWNER', NOT: { id: memberIdLeaving } },
  });
  if (owners < 1) {
    throw new BadRequest('Cannot remove or demote the last OWNER of a project');
  }
}

async function applyScope(
  tx: Prisma.TransactionClient,
  memberId: string,
  projectId: string,
  role: MemberRole,
  workstreamIds?: string[],
): Promise<void> {
  // Non-LEAD roles never carry workstream scope — wipe any leftovers.
  if (role !== 'LEAD') {
    await tx.memberWorkstream.deleteMany({ where: { projectMemberId: memberId } });
    return;
  }
  if (workstreamIds === undefined) return; // nothing requested → leave as-is

  // Validate that all referenced workstreams belong to this project.
  if (workstreamIds.length > 0) {
    const valid = await tx.workstream.count({
      where: { projectId, id: { in: workstreamIds } },
    });
    if (valid !== workstreamIds.length) {
      throw new BadRequest('One or more workstreamIds do not belong to this project');
    }
  }
  await tx.memberWorkstream.deleteMany({ where: { projectMemberId: memberId } });
  if (workstreamIds.length > 0) {
    await tx.memberWorkstream.createMany({
      data: workstreamIds.map((wid) => ({ projectMemberId: memberId, workstreamId: wid })),
    });
  }
}

// ─── DTO mapper ───────────────────────────────────────────────────────────────

function toMemberDto(row: {
  id: string;
  projectId: string;
  userId: string;
  role: MemberRole;
  memberLabel: string | null;
  workstreams?: { workstreamId: string }[];
}): MemberDto {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    memberLabel: row.memberLabel,
    workstreamIds: (row.workstreams ?? []).map((w) => w.workstreamId),
  };
}

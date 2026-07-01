/**
 * web/server port of backend RbacService — class → module functions.
 * Injected prisma → singleton import; ForbiddenException→Forbidden, NotFoundException→NotFound.
 * Logic is unchanged from backend/src/rbac/rbac.service.ts.
 */
import type { MemberRole, Capability } from '@furama/shared';
import { prisma } from '../prisma';
import { roleHasCapability } from './capability';
import { Forbidden, NotFound } from '../http/errors';

export interface AuthContext {
  userId: string;
  orgId: string;
}

export interface ScopeHints {
  workstreamId?: string | null;
  taskId?: string | null;
}

export async function effectiveRole(userId: string, projectId: string): Promise<MemberRole | null> {
  const m = await prisma.projectMember.findFirst({
    where: { userId, projectId },
    select: { role: true },
  });
  return m?.role ?? null;
}

/**
 * Throws Forbidden unless the caller is allowed to perform `capability` on the given project,
 * taking into account LEAD workstream scope and MEMBER assignee scope.
 */
export async function assertCan(
  ctx: AuthContext,
  capability: Capability,
  projectId: string,
  scope: ScopeHints = {},
): Promise<MemberRole> {
  const role = await effectiveRole(ctx.userId, projectId);
  if (!role) throw new Forbidden('Not a member of this project');
  const grant = roleHasCapability(role, capability);
  if (grant === true) return role;
  if (grant === false) throw new Forbidden(`Role ${role} cannot ${capability}`);
  // 'scope' branch
  if (!(await isInScope(ctx.userId, projectId, role, capability, scope))) {
    throw new Forbidden(`Role ${role} can ${capability} only within own scope`);
  }
  return role;
}

/** Pure predicate version of assertCan — never throws. */
export async function can(
  ctx: AuthContext,
  capability: Capability,
  projectId: string,
  scope: ScopeHints = {},
): Promise<boolean> {
  try {
    await assertCan(ctx, capability, projectId, scope);
    return true;
  } catch {
    return false;
  }
}

/** True if the LEAD owns the given workstream in this project. */
export async function leadOwnsWorkstream(userId: string, projectId: string, workstreamId: string): Promise<boolean> {
  const row = await prisma.memberWorkstream.findFirst({
    where: {
      workstreamId,
      projectMember: { userId, projectId, role: 'LEAD' },
    },
    select: { id: true },
  });
  return row !== null;
}

/** True if the caller is named (by userId OR by memberLabel) on a task assignment. */
async function isAssignee(userId: string, projectId: string, taskId: string): Promise<boolean> {
  const member = await prisma.projectMember.findFirst({
    where: { userId, projectId },
    select: { memberLabel: true },
  });
  if (!member) return false;
  const count = await prisma.taskAssignment.count({
    where: {
      taskId,
      OR: [{ userId }, ...(member.memberLabel ? [{ label: member.memberLabel }] : [])],
    },
  });
  return count > 0;
}

async function isInScope(
  userId: string,
  projectId: string,
  role: MemberRole,
  capability: Capability,
  scope: ScopeHints,
): Promise<boolean> {
  if (role === 'LEAD') {
    let workstreamId = scope.workstreamId ?? null;
    if (!workstreamId && scope.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: scope.taskId },
        select: { workstreamId: true, projectId: true },
      });
      if (!task) throw new NotFound('Task not found');
      if (task.projectId !== projectId) return false;
      workstreamId = task.workstreamId;
    }
    if (!workstreamId) return false;
    return leadOwnsWorkstream(userId, projectId, workstreamId);
  }
  if (role === 'MEMBER') {
    if (!scope.taskId) return false;
    if (capability !== 'UPDATE_TASK_PROGRESS') return false;
    return isAssignee(userId, projectId, scope.taskId);
  }
  // OWNER/PM/VIEWER never hit 'scope' branch in the matrix.
  return false;
}

/**
 * A-12 — RBAC deny-path coverage. Pure unit test with a minimal in-memory Prisma stub
 * so we never need a DB. Asserts every cell of CAPABILITY_MATRIX from docs/03 §2:
 *  - true   → assertCan succeeds
 *  - false  → assertCan throws ForbiddenException
 *  - 'scope'→ allowed only when scope hint matches; denied otherwise
 *
 * Per CLAUDE.md DoD: every '—' or 'scope' cell needs a deny-path test. This file owns those.
 */
import { ForbiddenException } from '@nestjs/common';
import type { MemberRole, Capability } from '@furama/shared';
import { CAPABILITY_MATRIX } from './capability.enum';
import { RbacService } from './rbac.service';

const PROJECT = 'project-1';
const USER = 'user-1';
const ORG = 'org-1';
const TASK_IN = 'task-in-scope';
const TASK_OUT = 'task-out-scope';
const WS_IN = 'ws-marketing';
const WS_OUT = 'ws-operations';

interface PrismaStub {
  projectMember: { findFirst: jest.Mock };
  memberWorkstream: { findFirst: jest.Mock };
  task: { findUnique: jest.Mock };
  taskAssignment: { count: jest.Mock };
}

function makeRbac(role: MemberRole | null, opts: { isAssignee?: boolean } = {}): {
  rbac: RbacService;
  prisma: PrismaStub;
} {
  const prisma: PrismaStub = {
    projectMember: {
      findFirst: jest.fn(async ({ where }: { where: { projectId?: string } }) => {
        if (!role) return null;
        if (where.projectId && where.projectId !== PROJECT) return null;
        return { role, memberLabel: 'Marketing Lead' };
      }),
    },
    memberWorkstream: {
      // LEAD owns WS_IN, not WS_OUT.
      findFirst: jest.fn(async ({ where }: { where: { workstreamId: string } }) => {
        return where.workstreamId === WS_IN ? { id: 'mw-1' } : null;
      }),
    },
    task: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id === TASK_IN) return { workstreamId: WS_IN, projectId: PROJECT };
        if (where.id === TASK_OUT) return { workstreamId: WS_OUT, projectId: PROJECT };
        return null;
      }),
    },
    taskAssignment: {
      count: jest.fn(async () => (opts.isAssignee ? 1 : 0)),
    },
  };
  return { rbac: new RbacService(prisma as never), prisma };
}

const ctx = { userId: USER, orgId: ORG };
const ROLES: MemberRole[] = ['OWNER', 'PM', 'LEAD', 'MEMBER', 'VIEWER'];
const ALL_CAPS = Object.keys(CAPABILITY_MATRIX.OWNER) as Capability[];

describe('RbacService.assertCan — full matrix', () => {
  it('denies non-members regardless of capability', async () => {
    const { rbac } = makeRbac(null);
    await expect(rbac.assertCan(ctx, 'VIEW_PROJECT', PROJECT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe.each(ROLES)('role=%s', (role) => {
    it.each(ALL_CAPS)('capability=%s respects the matrix cell', async (capability) => {
      const cell = CAPABILITY_MATRIX[role][capability];
      const { rbac } = makeRbac(role, { isAssignee: true });

      if (cell === true) {
        await expect(rbac.assertCan(ctx, capability, PROJECT)).resolves.toBe(role);
      } else if (cell === false) {
        await expect(rbac.assertCan(ctx, capability, PROJECT)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      } else {
        // 'scope': denied with no scope hint
        await expect(rbac.assertCan(ctx, capability, PROJECT)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      }
    });
  });
});

describe('RbacService — scope semantics', () => {
  it('LEAD can edit a task in their workstream', async () => {
    const { rbac } = makeRbac('LEAD');
    await expect(
      rbac.assertCan(ctx, 'EDIT_TASK', PROJECT, { taskId: TASK_IN }),
    ).resolves.toBe('LEAD');
  });

  it('LEAD is denied editing a task outside their workstream', async () => {
    const { rbac } = makeRbac('LEAD');
    await expect(
      rbac.assertCan(ctx, 'EDIT_TASK', PROJECT, { taskId: TASK_OUT }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MEMBER can update progress on an assigned task', async () => {
    const { rbac } = makeRbac('MEMBER', { isAssignee: true });
    await expect(
      rbac.assertCan(ctx, 'UPDATE_TASK_PROGRESS', PROJECT, { taskId: TASK_IN }),
    ).resolves.toBe('MEMBER');
  });

  it('MEMBER is denied updating progress on an unassigned task', async () => {
    const { rbac } = makeRbac('MEMBER', { isAssignee: false });
    await expect(
      rbac.assertCan(ctx, 'UPDATE_TASK_PROGRESS', PROJECT, { taskId: TASK_IN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MEMBER cannot use scope to slip into EDIT_TASK', async () => {
    const { rbac } = makeRbac('MEMBER', { isAssignee: true });
    await expect(
      rbac.assertCan(ctx, 'EDIT_TASK', PROJECT, { taskId: TASK_IN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('VIEWER cannot comment even with a task hint', async () => {
    const { rbac } = makeRbac('VIEWER');
    await expect(
      rbac.assertCan(ctx, 'COMMENT_TASK', PROJECT, { taskId: TASK_IN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('OWNER bypasses scope for ARCHIVE_PROJECT but PM does not', async () => {
    const { rbac: owner } = makeRbac('OWNER');
    const { rbac: pm } = makeRbac('PM');
    await expect(owner.assertCan(ctx, 'ARCHIVE_PROJECT', PROJECT)).resolves.toBe('OWNER');
    await expect(pm.assertCan(ctx, 'ARCHIVE_PROJECT', PROJECT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

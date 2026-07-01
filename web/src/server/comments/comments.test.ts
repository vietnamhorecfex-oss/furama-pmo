/**
 * Integration tests for comments service functions.
 * TDD: written before implementation — expect RED first, then GREEN after comments.ts is created.
 *
 * Covers:
 *  - addComment → returned authorId equals the caller
 *  - VIEWER member → Forbidden (COMMENT_TASK=false for VIEWER)
 *  - body with <script>alert(1)</script>Hello is sanitized (no <script, keeps Hello)
 *  - listComments on a missing task → NotFound
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { listComments, addComment } from './comments';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let viewerUserId: string;
let pid: string;
let taskId: string;
let ownerCtx: AuthContext;
let viewerCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `comments-${ts}`, name: 'CommentsOrg' } });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `comments-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  viewerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Viewer', email: `comments-viewer-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: { orgId, name: `CommentsProject-${ts}`, budgetCapVnd: BigInt(0), createdById: ownerUserId },
  });
  pid = project.id;

  // Seed project members
  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerUserId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: viewerUserId, role: 'VIEWER' } });

  // Seed a task to comment on
  const task = await prisma.task.create({
    data: {
      projectId: pid,
      code: `CMT-0001`,
      title: 'Task for Comments',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      budgetVnd: BigInt(0),
      actualVnd: BigInt(0),
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });
  taskId = task.id;

  ownerCtx = { userId: ownerUserId, orgId };
  viewerCtx = { userId: viewerUserId, orgId };
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { taskId } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('addComment', () => {
  it('add a comment → returned authorId equals the caller', async () => {
    const c = await addComment(ownerCtx, taskId, 'Hello world', null);
    expect(c.authorId).toBe(ownerUserId);
    expect(c.taskId).toBe(taskId);
    expect(c.body).toBe('Hello world');
    expect(typeof c.createdAt).toBe('string');
  });

  it('sanitizes script tags out of the comment body', async () => {
    const c = await addComment(ownerCtx, taskId, '<script>alert(1)</script>Hello', null);
    expect(c.body).not.toMatch(/<script/i);
    expect(c.body).toContain('Hello');
  });

  it('a VIEWER cannot comment (Forbidden)', async () => {
    await expect(addComment(viewerCtx, taskId, 'hi', null)).rejects.toThrow(/forbidden|cannot/i);
  });

  it('adding a comment to a missing task → NotFound', async () => {
    await expect(addComment(ownerCtx, 'nonexistent-task-id', 'hi', null)).rejects.toThrow(/not found/i);
  });
});

describe('listComments', () => {
  it('returns comments for the task in ascending createdAt order', async () => {
    const comments = await listComments(ownerCtx, taskId);
    expect(Array.isArray(comments)).toBe(true);
    // all comments belong to this task
    for (const c of comments) {
      expect(c.taskId).toBe(taskId);
    }
    // verify ascending order
    for (let i = 1; i < comments.length; i++) {
      expect(new Date(comments[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(comments[i - 1].createdAt).getTime(),
      );
    }
  });

  it('listing comments on a missing task → NotFound', async () => {
    await expect(listComments(ownerCtx, 'nonexistent-task-id')).rejects.toThrow(/not found/i);
  });
});

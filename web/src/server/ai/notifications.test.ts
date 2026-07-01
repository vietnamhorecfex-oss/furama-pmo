/**
 * Integration tests for notifications (Task 4.3).
 * Covers: list scoping to caller, unreadOnly filter, VIEW_PROJECT deny,
 *         markRead ownership (Forbidden for another user), NotFound.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../prisma';
import { listNotifications, markRead } from './notifications';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let memberCtx: AuthContext;
let strangerCtx: AuthContext;
let pid: string;
let unreadId: string;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `notif-${ts}`, name: 'NotifOrg' } });
  orgId = org.id;
  const member = await prisma.user.create({
    data: { orgId, name: 'M', email: `notif-m-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  const stranger = await prisma.user.create({
    data: { orgId, name: 'S', email: `notif-s-${ts}@x.test`, passwordHash: 'x', isActive: true },
  });
  memberCtx = { userId: member.id, orgId };
  strangerCtx = { userId: stranger.id, orgId };
  const project = await prisma.project.create({
    data: { orgId, name: `NotifProject-${ts}`, budgetCapVnd: BigInt(0), createdById: member.id },
  });
  pid = project.id;
  await prisma.projectMember.create({ data: { projectId: pid, userId: member.id, role: 'OWNER' } });

  const unread = await prisma.notification.create({
    data: { projectId: pid, userId: member.id, type: 'AI_NUDGE', severity: 'INFO', title: 'Ping', body: 'do the thing' },
  });
  unreadId = unread.id;
  await prisma.notification.create({
    data: { projectId: pid, userId: member.id, type: 'AI_NUDGE', severity: 'INFO', title: 'Old', body: 'read one', readAt: new Date() },
  });
});

describe('listNotifications', () => {
  it('returns the caller\'s notifications, newest first', async () => {
    const all = await listNotifications(memberCtx, pid);
    expect(all.length).toBe(2);
  });
  it('unreadOnly filters out read notifications', async () => {
    const unread = await listNotifications(memberCtx, pid, true);
    expect(unread.length).toBe(1);
    expect(unread[0]!.id).toBe(unreadId);
  });
  it('denies a non-member with Forbidden', async () => {
    await expect(listNotifications(strangerCtx, pid)).rejects.toMatchObject({ status: 403 });
  });
});

describe('markRead', () => {
  it('marks the caller\'s own notification read', async () => {
    await markRead(memberCtx, unreadId);
    const n = await prisma.notification.findUnique({ where: { id: unreadId } });
    expect(n!.readAt).not.toBeNull();
  });
  it('forbids marking another user\'s notification', async () => {
    const other = await prisma.notification.create({
      data: { projectId: pid, userId: memberCtx.userId, type: 'AI_NUDGE', severity: 'INFO', title: 'x', body: 'y' },
    });
    await expect(markRead(strangerCtx, other.id)).rejects.toMatchObject({ status: 403 });
  });
  it('throws NotFound for a missing notification', async () => {
    await expect(markRead(memberCtx, 'cxxxxnope0000000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

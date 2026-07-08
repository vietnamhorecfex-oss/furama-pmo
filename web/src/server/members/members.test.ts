/**
 * Integration tests for members service functions.
 * TDD: written before implementation — expect RED first, then GREEN after members.ts is created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { listMembers, addMember, updateMember, removeMember, createUserAndAddMember } from './members';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let u1: string; // owner
let u2: string; // second user (to be added as member)
let pid: string;
let pid2: string; // another project (for foreign workstream test)
let wsId: string; // workstream in pid
let foreignWsId: string; // workstream in pid2
let ownerMemberId: string;
let ownerCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `mem-${ts}`, name: 'MemOrg' } });
  orgId = org.id;

  u1 = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `mem-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  u2 = (
    await prisma.user.create({
      data: { orgId, name: 'User2', email: `mem-u2-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: { orgId, name: `MemberProject-${ts}`, budgetCapVnd: BigInt(0), createdById: u1 },
  });
  pid = project.id;

  const project2 = await prisma.project.create({
    data: { orgId, name: `OtherProject-${ts}`, budgetCapVnd: BigInt(0), createdById: u1 },
  });
  pid2 = project2.id;

  // Owner member in pid
  const ownerMember = await prisma.projectMember.create({
    data: { projectId: pid, userId: u1, role: 'OWNER' },
  });
  ownerMemberId = ownerMember.id;

  // A workstream in pid
  const ws = await prisma.workstream.create({
    data: { projectId: pid, name: 'Marketing', track: 'MARKETING', order: 1 },
  });
  wsId = ws.id;

  // A workstream in pid2 (foreign)
  const wsOther = await prisma.workstream.create({
    data: { projectId: pid2, name: 'Operations', track: 'OPERATIONS', order: 1 },
  });
  foreignWsId = wsOther.id;

  ownerCtx = { userId: u1, orgId };
});

afterAll(async () => {
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: { in: [pid, pid2] } } } });
  await prisma.projectMember.deleteMany({ where: { projectId: { in: [pid, pid2] } } });
  await prisma.auditLog.deleteMany({ where: { projectId: { in: [pid, pid2] } } });
  await prisma.workstream.deleteMany({ where: { projectId: { in: [pid, pid2] } } });
  await prisma.project.deleteMany({ where: { id: { in: [pid, pid2] } } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('members', () => {
  it('listMembers returns the seeded OWNER member', async () => {
    const members = await listMembers(ownerCtx, pid);
    expect(members.length).toBeGreaterThanOrEqual(1);
    const owner = members.find((m) => m.id === ownerMemberId);
    expect(owner).toBeTruthy();
    expect(owner?.role).toBe('OWNER');
    expect(Array.isArray(owner?.workstreamIds)).toBe(true);
  });

  it('adds a LEAD member with workstreamIds → member has those workstreamIds', async () => {
    const member = await addMember(
      ownerCtx,
      pid,
      { userId: u2, role: 'LEAD', memberLabel: 'LeadLabel', workstreamIds: [wsId] } as any,
      null,
    );
    expect(member.role).toBe('LEAD');
    expect(member.workstreamIds).toContain(wsId);
    expect(member.memberLabel).toBe('LeadLabel');
    // Clean up for subsequent tests
    await prisma.memberWorkstream.deleteMany({ where: { projectMemberId: member.id } });
    await prisma.projectMember.delete({ where: { id: member.id } });
  });

  it('rejects a workstreamId from another project (BadRequest)', async () => {
    await expect(
      addMember(
        ownerCtx,
        pid,
        { userId: u2, role: 'LEAD', memberLabel: 'L', workstreamIds: [foreignWsId] } as any,
        null,
      ),
    ).rejects.toThrow(/bad request|workstream/i);
  });

  it('rejects a duplicate userId with Conflict', async () => {
    // u1 is already a member
    await expect(
      addMember(ownerCtx, pid, { userId: u1, role: 'VIEWER' } as any, null),
    ).rejects.toThrow(/already a member|conflict/i);
  });

  it('rejects a userId that does not exist with NotFound', async () => {
    await expect(
      addMember(ownerCtx, pid, { userId: 'does-not-exist-cuid', role: 'VIEWER' } as any, null),
    ).rejects.toThrow(/user not found/i);
  });

  it('createUserAndAddMember creates a user (auto id + password) and adds them as a member', async () => {
    const ts = Date.now();
    const res = await createUserAndAddMember(
      ownerCtx,
      pid,
      { name: 'Fresh User', email: `fresh-${ts}@x.test`, role: 'MEMBER' } as any,
      null,
    );
    expect(res.user.id).toBeTruthy(); // auto-generated cuid
    expect(res.tempPassword).toHaveLength(14);
    expect(res.member.userId).toBe(res.user.id);
    expect(res.member.role).toBe('MEMBER');

    // The user really exists and is in the caller's org.
    const dbUser = await prisma.user.findUnique({ where: { id: res.user.id } });
    expect(dbUser?.orgId).toBe(orgId);
    expect(dbUser?.email).toBe(`fresh-${ts}@x.test`);

    await prisma.projectMember.delete({ where: { id: res.member.id } });
    await prisma.user.delete({ where: { id: res.user.id } });
  });

  it('createUserAndAddMember rejects a duplicate email with Conflict', async () => {
    // u2 already exists in this org — reuse its email.
    const u2Row = await prisma.user.findUnique({ where: { id: u2 } });
    await expect(
      createUserAndAddMember(
        ownerCtx,
        pid,
        { name: 'Dup', email: u2Row!.email, role: 'VIEWER' } as any,
        null,
      ),
    ).rejects.toThrow(/already exists|conflict/i);
  });

  it('rejects a duplicate memberLabel with Conflict', async () => {
    // Add a member first with a label
    const m = await addMember(ownerCtx, pid, { userId: u2, role: 'VIEWER', memberLabel: 'UniqueLabel' } as any, null);
    // Trying to add the same label for another — but u2 is already there, so we update
    // Test via updateMember: give u2 a label, then try to give owner same label
    await expect(
      updateMember(ownerCtx, pid, ownerMemberId, { memberLabel: 'UniqueLabel' } as any, null),
    ).rejects.toThrow(/conflict|already used/i);
    // Clean up
    await prisma.projectMember.delete({ where: { id: m.id } });
  });

  it('refuses to demote the last OWNER (BadRequest)', async () => {
    // ownerMember is the only OWNER in this project
    await expect(
      updateMember(ownerCtx, pid, ownerMemberId, { role: 'PM' } as any, null),
    ).rejects.toThrow(/last owner/i);
  });

  it('refuses to remove the last OWNER (BadRequest)', async () => {
    await expect(removeMember(ownerCtx, pid, ownerMemberId, null)).rejects.toThrow(/last owner/i);
  });

  it('updateMember leaves scope alone when workstreamIds===undefined', async () => {
    // Add a LEAD member with workstreams
    const m = await addMember(
      ownerCtx,
      pid,
      { userId: u2, role: 'LEAD', workstreamIds: [wsId] } as any,
      null,
    );
    expect(m.workstreamIds).toContain(wsId);
    // Update only memberLabel, not workstreamIds
    const updated = await updateMember(ownerCtx, pid, m.id, { memberLabel: 'Updated' } as any, null);
    // scope should be unchanged
    expect(updated.workstreamIds).toContain(wsId);
    // Clean up
    await prisma.memberWorkstream.deleteMany({ where: { projectMemberId: m.id } });
    await prisma.projectMember.delete({ where: { id: m.id } });
  });

  it('addMember and removeMember in happy path', async () => {
    const m = await addMember(ownerCtx, pid, { userId: u2, role: 'VIEWER' } as any, null);
    expect(m.userId).toBe(u2);
    await removeMember(ownerCtx, pid, m.id, null);
    const members = await listMembers(ownerCtx, pid);
    expect(members.find((x) => x.id === m.id)).toBeUndefined();
  });
});

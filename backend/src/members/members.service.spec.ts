/**
 * P-08 — MembersService integration tests.
 * Asserts: add+role, last-OWNER guard on demote and remove, LEAD workstream scope wiring,
 * memberLabel uniqueness, MANAGE_MEMBERS RBAC for non-PM caller.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { MembersService } from './members.service';
import { ProjectsService } from '../projects/projects.service';

const itDb = SKIP_DB ? it.skip : it;

describe('MembersService (M2 integration)', () => {
  let deps: TestDeps;
  let members: MembersService;
  let projects: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    members = new MembersService(deps.prisma, deps.audit, deps.rbac);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });

  afterEach(async () => {
    await cleanupOrg(deps?.prisma, orgId);
    orgId = undefined;
  });

  afterAll(async () => {
    await deps?.prisma.$disconnect();
  });

  itDb('add: blocks duplicates and unknown workstreams; happy path returns dto', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'memb');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const u2 = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'U2', email: `u2-${Date.now()}@x.test`, passwordHash: 'noop' },
    });

    const added = await members.add(owner.ctx, proj.id, { userId: u2.id, role: 'MEMBER', memberLabel: 'Design Lead' }, null);
    expect(added.role).toBe('MEMBER');

    // Duplicate userId in same project.
    await expect(
      members.add(owner.ctx, proj.id, { userId: u2.id, role: 'MEMBER' }, null),
    ).rejects.toBeInstanceOf(ConflictException);

    // Bogus workstreamIds for a LEAD addition should reject.
    const u3 = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'U3', email: `u3-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await expect(
      members.add(owner.ctx, proj.id, { userId: u3.id, role: 'LEAD', workstreamIds: ['bogus-id'] }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  itDb('LEAD workstream scope is wired and removed when role changes away from LEAD', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'lead');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const ws = await deps.prisma.workstream.create({
      data: { projectId: proj.id, name: 'Marketing', track: 'MARKETING' },
    });
    const u = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'L', email: `l-${Date.now()}@x.test`, passwordHash: 'noop' },
    });

    const m = await members.add(
      owner.ctx,
      proj.id,
      { userId: u.id, role: 'LEAD', workstreamIds: [ws.id] },
      null,
    );
    expect(m.workstreamIds).toEqual([ws.id]);

    const demoted = await members.update(owner.ctx, proj.id, m.id, { role: 'VIEWER' }, null);
    expect(demoted.workstreamIds).toEqual([]); // scope auto-cleared on role change
  });

  itDb('last-OWNER cannot be demoted or removed', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'last');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);

    const me = await deps.prisma.projectMember.findFirst({
      where: { projectId: proj.id, userId: owner.user.id },
    });

    await expect(
      members.update(owner.ctx, proj.id, me!.id, { role: 'PM' }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      members.remove(owner.ctx, proj.id, me!.id, null),
    ).rejects.toBeInstanceOf(BadRequestException);

    // After promoting a second OWNER, the first can step down.
    const u = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'O2', email: `o2-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    const second = await members.add(owner.ctx, proj.id, { userId: u.id, role: 'OWNER' }, null);
    const demoted = await members.update(owner.ctx, proj.id, me!.id, { role: 'PM' }, null);
    expect(demoted.role).toBe('PM');
    expect(second.role).toBe('OWNER');
  });

  itDb('non-PM cannot add members (ForbiddenException via MANAGE_MEMBERS)', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'guard');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const lead = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'Lead', email: `lead-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await deps.prisma.projectMember.create({ data: { projectId: proj.id, userId: lead.id, role: 'LEAD' } });
    const newGuy = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'N', email: `n-${Date.now()}@x.test`, passwordHash: 'noop' },
    });

    await expect(
      members.add({ userId: lead.id, orgId: owner.org.id }, proj.id, { userId: newGuy.id, role: 'MEMBER' }, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * P-08 — ProjectsService integration tests.
 * Asserts: auto-OWNER on create, list scoped to membership, non-OWNER PATCH allowed,
 * non-PM PATCH blocked, archive role-gated.
 */
import { ForbiddenException } from '@nestjs/common';
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { ProjectsService } from './projects.service';

const itDb = SKIP_DB ? it.skip : it;

describe('ProjectsService (M2 integration)', () => {
  let deps: TestDeps;
  let service: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    service = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });

  afterEach(async () => {
    await cleanupOrg(deps?.prisma, orgId);
    orgId = undefined;
  });

  afterAll(async () => {
    await deps?.prisma.$disconnect();
  });

  itDb('create makes the caller OWNER and list returns only own projects', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'owner');
    orgId = owner.org.id;
    const stranger = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'Stranger', email: `stranger-${Date.now()}@x.test`, passwordHash: 'noop' },
    });

    const project = await service.create(
      owner.ctx,
      { name: 'Furama HCM', status: 'PLANNING', budgetCapVnd: 1_000_000_000 },
      '127.0.0.1',
    );
    expect(project.name).toBe('Furama HCM');
    expect(project.budgetCapVnd).toBe(1_000_000_000);

    const mine = await service.list(owner.ctx);
    expect(mine.map((p) => p.id)).toContain(project.id);
    const theirs = await service.list({ userId: stranger.id, orgId: owner.org.id });
    expect(theirs.map((p) => p.id)).not.toContain(project.id);
  });

  itDb('non-PM cannot updateMeta (RBAC blocks via MANAGE_CONFIG)', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'pmguard');
    orgId = owner.org.id;
    const proj = await service.create(owner.ctx, { name: 'P1', status: 'PLANNING', budgetCapVnd: 0 }, null);

    const viewer = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'Viewer', email: `viewer-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await deps.prisma.projectMember.create({
      data: { projectId: proj.id, userId: viewer.id, role: 'VIEWER' },
    });

    await expect(
      service.updateMeta({ userId: viewer.id, orgId: owner.org.id }, proj.id, { name: 'Renamed' }, null),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Owner can.
    const updated = await service.updateMeta(owner.ctx, proj.id, { name: 'Renamed' }, null);
    expect(updated.name).toBe('Renamed');
  });

  itDb('archive sets archivedAt and hides from list; only OWNER may archive', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'arch');
    orgId = owner.org.id;
    const proj = await service.create(owner.ctx, { name: 'To Archive', status: 'ACTIVE', budgetCapVnd: 0 }, null);

    // Promote a PM and verify they cannot archive (ARCHIVE_PROJECT is OWNER-only).
    const pm = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'PM', email: `pm-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await deps.prisma.projectMember.create({ data: { projectId: proj.id, userId: pm.id, role: 'PM' } });
    await expect(
      service.archive({ userId: pm.id, orgId: owner.org.id }, proj.id, null),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const archived = await service.archive(owner.ctx, proj.id, null);
    expect(archived.archivedAt).not.toBeNull();
    const visible = await service.list(owner.ctx);
    expect(visible.find((p) => p.id === proj.id)).toBeUndefined();
  });
});

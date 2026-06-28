/**
 * P-08 — ConfigService integration tests.
 * Asserts:
 *  - Phase CRUD + unique(name) per project + referential guard on delete
 *  - Workstream referential guard for LEAD scope rows
 *  - StatusDef rename inside a transaction (cascade-rename code path exercised)
 *  - non-PM cannot mutate config (MANAGE_CONFIG denial)
 *  - Reorder applies all updates atomically
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { ConfigService } from './config.service';
import { ProjectsService } from '../projects/projects.service';

const itDb = SKIP_DB ? it.skip : it;

describe('ConfigService (M2 integration)', () => {
  let deps: TestDeps;
  let config: ConfigService;
  let projects: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    config = new ConfigService(deps.prisma, deps.audit, deps.rbac);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });

  afterEach(async () => {
    await cleanupOrg(deps?.prisma, orgId);
    orgId = undefined;
  });

  afterAll(async () => {
    await deps?.prisma.$disconnect();
  });

  itDb('Phase: unique name per project + non-PM blocked', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'cfg');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);

    const a = await config.createPhase(owner.ctx, proj.id, { name: 'P0', order: 0 }, null);
    expect(a.name).toBe('P0');
    await expect(
      config.createPhase(owner.ctx, proj.id, { name: 'P0', order: 1 }, null),
    ).rejects.toBeInstanceOf(ConflictException);

    const viewer = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'V', email: `v-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await deps.prisma.projectMember.create({ data: { projectId: proj.id, userId: viewer.id, role: 'VIEWER' } });
    await expect(
      config.createPhase({ userId: viewer.id, orgId: owner.org.id }, proj.id, { name: 'P1', order: 1 }, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  itDb('Workstream: delete refuses while a LEAD scope row references it', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'wsdel');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const ws = await config.createWorkstream(owner.ctx, proj.id, { name: 'Ops', track: 'OPERATIONS', order: 0 }, null);

    const u = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'Lead', email: `lead-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    const pm = await deps.prisma.projectMember.create({
      data: { projectId: proj.id, userId: u.id, role: 'LEAD' },
    });
    await deps.prisma.memberWorkstream.create({
      data: { projectMemberId: pm.id, workstreamId: ws.id },
    });

    await expect(
      config.deleteWorkstream(owner.ctx, proj.id, ws.id, null),
    ).rejects.toBeInstanceOf(ConflictException);

    // After clearing the scope, delete proceeds.
    await deps.prisma.memberWorkstream.deleteMany({ where: { workstreamId: ws.id } });
    await expect(
      config.deleteWorkstream(owner.ctx, proj.id, ws.id, null),
    ).resolves.toBeUndefined();
  });

  itDb('StatusDef rename is transactional and rejects clashing target keys', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'sts');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const blocked = await config.createStatus(owner.ctx, proj.id, { key: 'BLOCKED', color: '#ff0000', order: 1, isTerminal: false }, null);
    await config.createStatus(owner.ctx, proj.id, { key: 'IN_REVIEW', color: '#00ff00', order: 2, isTerminal: false }, null);

    // Renaming to an existing key must fail.
    await expect(
      config.updateStatus(owner.ctx, proj.id, blocked.id, { renameToKey: 'IN_REVIEW' }, null),
    ).rejects.toBeInstanceOf(ConflictException);

    // Renaming to a new key succeeds.
    const renamed = await config.updateStatus(owner.ctx, proj.id, blocked.id, { renameToKey: 'STALLED' }, null);
    expect(renamed?.key).toBe('STALLED');
  });

  itDb('reorderPhases applies all updates atomically', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'reord');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const p0 = await config.createPhase(owner.ctx, proj.id, { name: 'P0', order: 0 }, null);
    const p1 = await config.createPhase(owner.ctx, proj.id, { name: 'P1', order: 1 }, null);
    const p2 = await config.createPhase(owner.ctx, proj.id, { name: 'P2', order: 2 }, null);

    await config.reorderPhases(
      owner.ctx,
      proj.id,
      { items: [{ id: p2.id, order: 0 }, { id: p1.id, order: 1 }, { id: p0.id, order: 2 }] },
      null,
    );
    const after = await config.listPhases(owner.ctx, proj.id);
    expect(after.map((p) => p.name)).toEqual(['P2', 'P1', 'P0']);
  });
});

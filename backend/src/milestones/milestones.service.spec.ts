/**
 * B-04 — MilestonesService integration tests.
 * Asserts: gate readiness from criteria.taskIds; OWNER/PM full CRUD; LEAD setStatus only
 * within their workstream; readiness reflects task completion.
 */
import { ForbiddenException } from '@nestjs/common';
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { MilestonesService } from './milestones.service';
import { ProjectsService } from '../projects/projects.service';

const itDb = SKIP_DB ? it.skip : it;

describe('MilestonesService (M5 integration)', () => {
  let deps: TestDeps;
  let svc: MilestonesService;
  let projects: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    svc = new MilestonesService(deps.prisma, deps.audit, deps.rbac);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });
  afterEach(async () => { await cleanupOrg(deps?.prisma, orgId); orgId = undefined; });
  afterAll(async () => { await deps?.prisma.$disconnect(); });

  itDb('readinessPct reflects COMPLETED count over linked taskIds', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'gate');
    orgId = owner.org.id;
    const p = await projects.create(owner.ctx, { name: 'G', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const t1 = await deps.prisma.task.create({ data: { projectId: p.id, code: 'A', title: 'a', status: 'COMPLETED', percent: 100 } });
    const t2 = await deps.prisma.task.create({ data: { projectId: p.id, code: 'B', title: 'b', status: 'IN_PROGRESS', percent: 50 } });
    const t3 = await deps.prisma.task.create({ data: { projectId: p.id, code: 'C', title: 'c', status: 'NOT_STARTED', percent: 0 } });

    const m = await svc.create(
      owner.ctx, p.id,
      { name: 'Soft Opening Gate', type: 'GATE', status: 'PENDING', criteria: { taskIds: [t1.id, t2.id, t3.id] } } as never,
      null,
    );
    expect(m.totalCount).toBe(3);
    expect(m.completedCount).toBe(1);
    expect(m.readinessPct).toBe(33);
  });

  itDb('LEAD can setStatus only when criteria tasks are within their workstreams', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'glead');
    orgId = owner.org.id;
    const p = await projects.create(owner.ctx, { name: 'G', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const wsMine = await deps.prisma.workstream.create({ data: { projectId: p.id, name: 'Mkt', track: 'MARKETING' } });
    const wsOther = await deps.prisma.workstream.create({ data: { projectId: p.id, name: 'Ops', track: 'OPERATIONS' } });
    const tIn = await deps.prisma.task.create({ data: { projectId: p.id, code: 'TI', title: 'in', workstreamId: wsMine.id, status: 'COMPLETED', percent: 100 } });
    const tOut = await deps.prisma.task.create({ data: { projectId: p.id, code: 'TO', title: 'out', workstreamId: wsOther.id } });

    const u = await deps.prisma.user.create({ data: { orgId: owner.org.id, name: 'L', email: `gl-${Date.now()}@x.test`, passwordHash: 'noop' } });
    const m = await deps.prisma.projectMember.create({ data: { projectId: p.id, userId: u.id, role: 'LEAD' } });
    await deps.prisma.memberWorkstream.create({ data: { projectMemberId: m.id, workstreamId: wsMine.id } });

    const inScopeGate = await svc.create(owner.ctx, p.id, { name: 'A', type: 'GATE', status: 'PENDING', criteria: { taskIds: [tIn.id] } } as never, null);
    const outScopeGate = await svc.create(owner.ctx, p.id, { name: 'B', type: 'GATE', status: 'PENDING', criteria: { taskIds: [tOut.id] } } as never, null);

    const leadCtx = { userId: u.id, orgId: owner.org.id };
    const passed = await svc.setStatus(leadCtx, inScopeGate.id, { status: 'PASSED' }, null);
    expect(passed.status).toBe('PASSED');

    await expect(
      svc.setStatus(leadCtx, outScopeGate.id, { status: 'PASSED' }, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

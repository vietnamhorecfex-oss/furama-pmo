/**
 * T-08 — TasksService integration tests.
 * Asserts: LEAD-scope create/edit enforced; status/percent invariants in update; dependency
 * cycle detection; pagination + filter.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { TasksService } from './tasks.service';
import { ProjectsService } from '../projects/projects.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';

const fakeRealtime = { emit: jest.fn() } as unknown as RealtimeGateway;

const itDb = SKIP_DB ? it.skip : it;

describe('TasksService (M3 integration)', () => {
  let deps: TestDeps;
  let tasks: TasksService;
  let projects: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    tasks = new TasksService(deps.prisma, deps.audit, deps.rbac, fakeRealtime);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });

  afterEach(async () => {
    await cleanupOrg(deps?.prisma, orgId);
    orgId = undefined;
  });

  afterAll(async () => {
    await deps?.prisma.$disconnect();
  });

  itDb('LEAD can create a task in their workstream but is blocked outside it', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'leadt');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);

    const wsMine = await deps.prisma.workstream.create({
      data: { projectId: proj.id, name: 'Marketing', track: 'MARKETING' },
    });
    const wsOther = await deps.prisma.workstream.create({
      data: { projectId: proj.id, name: 'Ops', track: 'OPERATIONS' },
    });

    const u = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'L', email: `l-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    const member = await deps.prisma.projectMember.create({
      data: { projectId: proj.id, userId: u.id, role: 'LEAD' },
    });
    await deps.prisma.memberWorkstream.create({
      data: { projectMemberId: member.id, workstreamId: wsMine.id },
    });

    const leadCtx = { userId: u.id, orgId: owner.org.id };
    const ok = await tasks.create(
      leadCtx,
      proj.id,
      { title: 'My Banner', workstreamId: wsMine.id, priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never,
      null,
    );
    expect(ok.code).toMatch(/^MKT-\d{4}$/);

    await expect(
      tasks.create(
        leadCtx,
        proj.id,
        { title: 'Trespass', workstreamId: wsOther.id, priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never,
        null,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  itDb('updateProgress applies invariants and rejects inconsistent input', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'inv');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const t = await tasks.create(
      owner.ctx,
      proj.id,
      { title: 'Build menu', priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never,
      null,
    );

    // 50% on NOT_STARTED auto-promotes to IN_PROGRESS.
    const mid = await tasks.updateProgress(owner.ctx, t.id, { percent: 50 }, null);
    expect(mid.status).toBe('IN_PROGRESS');
    expect(mid.percent).toBe(50);

    // COMPLETED forces 100.
    const done = await tasks.updateProgress(owner.ctx, t.id, { status: 'COMPLETED' }, null);
    expect(done.percent).toBe(100);

    // Conflicting input is rejected with 400.
    await expect(
      tasks.updateProgress(owner.ctx, t.id, { status: 'BLOCKED', percent: 100 }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  itDb('setDependencies rejects cycles and cross-project ids', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'deps');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const a = await tasks.create(owner.ctx, proj.id, { title: 'A', priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never, null);
    const b = await tasks.create(owner.ctx, proj.id, { title: 'B', priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never, null);
    const c = await tasks.create(owner.ctx, proj.id, { title: 'C', priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never, null);

    // A depends on B, B depends on C — chain is fine.
    await tasks.setDependencies(owner.ctx, a.id, { dependsOnTaskIds: [b.id] }, null);
    await tasks.setDependencies(owner.ctx, b.id, { dependsOnTaskIds: [c.id] }, null);

    // C → A would close a cycle (A→B→C→A).
    await expect(
      tasks.setDependencies(owner.ctx, c.id, { dependsOnTaskIds: [a.id] }, null),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Cross-project dep is rejected.
    const other = await projects.create(owner.ctx, { name: 'Other', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const z = await tasks.create(owner.ctx, other.id, { title: 'Z', priority: 'MEDIUM', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never, null);
    await expect(
      tasks.setDependencies(owner.ctx, a.id, { dependsOnTaskIds: [z.id] }, null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  itDb('list applies filters + pagination', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'lst');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'P', status: 'PLANNING', budgetCapVnd: 0 }, null);
    for (let i = 0; i < 5; i++) {
      await tasks.create(
        owner.ctx,
        proj.id,
        { title: `Task ${i}`, priority: i % 2 === 0 ? 'HIGH' : 'LOW', status: 'NOT_STARTED', percent: 0, budgetVnd: 0, actualVnd: 0 } as never,
        null,
      );
    }
    const page1 = await tasks.list(owner.ctx, proj.id, {
      page: 1, pageSize: 2, order: 'asc', priority: 'HIGH',
    } as never);
    expect(page1.total).toBe(3);
    expect(page1.data).toHaveLength(2);
  });
});

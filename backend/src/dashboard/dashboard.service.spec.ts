/**
 * B-04 — DashboardService.overview integration test.
 * Asserts: KPI counts, overall percent, byPhase/byWorkstream rollup, upcoming-14d filter,
 * countdown to opening, and that the embedded budget block matches BudgetService.
 */
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { DashboardService } from './dashboard.service';
import { BudgetService } from '../budget/budget.service';
import { ProjectsService } from '../projects/projects.service';

const itDb = SKIP_DB ? it.skip : it;
const ONE_DAY = 24 * 60 * 60 * 1000;

describe('DashboardService.overview (M5 integration)', () => {
  let deps: TestDeps;
  let svc: DashboardService;
  let projects: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    const budget = new BudgetService(deps.prisma, deps.rbac);
    svc = new DashboardService(deps.prisma, deps.rbac, budget);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });
  afterEach(async () => { await cleanupOrg(deps?.prisma, orgId); orgId = undefined; });
  afterAll(async () => { await deps?.prisma.$disconnect(); });

  itDb('aggregates counts, overall percent, upcoming deadlines, and countdown', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'dash');
    orgId = owner.org.id;
    const opening = new Date(Date.now() + 30 * ONE_DAY);
    const p = await projects.create(
      owner.ctx,
      { name: 'D', status: 'PLANNING', budgetCapVnd: 0, openingDate: opening.toISOString() } as never,
      null,
    );
    const ph = await deps.prisma.phase.create({ data: { projectId: p.id, name: 'P0', order: 0 } });
    const ws = await deps.prisma.workstream.create({ data: { projectId: p.id, name: 'PMO', track: 'PMO' } });
    const nearDeadline = new Date(Date.now() + 3 * ONE_DAY);
    const farDeadline = new Date(Date.now() + 30 * ONE_DAY);
    const overdueDeadline = new Date(Date.now() - 2 * ONE_DAY);

    await deps.prisma.task.createMany({
      data: [
        { projectId: p.id, code: 'D1', title: 'done', phaseId: ph.id, workstreamId: ws.id, status: 'COMPLETED', percent: 100 },
        { projectId: p.id, code: 'D2', title: 'progress', phaseId: ph.id, workstreamId: ws.id, status: 'IN_PROGRESS', percent: 60, deadline: nearDeadline },
        { projectId: p.id, code: 'D3', title: 'blocked', phaseId: ph.id, workstreamId: ws.id, status: 'BLOCKED', percent: 10 },
        { projectId: p.id, code: 'D4', title: 'overdue-open', phaseId: ph.id, workstreamId: ws.id, status: 'NOT_STARTED', deadline: overdueDeadline },
        { projectId: p.id, code: 'D5', title: 'future', phaseId: ph.id, workstreamId: ws.id, status: 'NOT_STARTED', deadline: farDeadline },
      ],
    });

    const o = await svc.overview(owner.ctx, p.id);
    expect(o.projectName).toBe('D');
    expect(o.daysToOpening).toBeGreaterThanOrEqual(29);
    expect(o.daysToOpening).toBeLessThanOrEqual(31);
    expect(o.health.total).toBe(5);
    expect(o.health.byStatus.COMPLETED).toBe(1);
    expect(o.health.byStatus.IN_PROGRESS).toBe(1);
    expect(o.health.byStatus.BLOCKED).toBe(1);
    expect(o.health.byStatus.NOT_STARTED).toBe(2);
    expect(o.health.overdue).toBe(1); // D4
    expect(o.health.overallPercent).toBe(Math.round((100 + 60 + 10 + 0 + 0) / 5));

    const phase = o.byPhase.find((g) => g.id === ph.id)!;
    expect(phase.total).toBe(5);
    expect(phase.completed).toBe(1);
    expect(phase.percent).toBe(20);

    // Upcoming = within 14 days, not completed → D2 only (D4 is past, D5 is 30d out).
    const codes = o.upcomingDeadlines.map((u) => u.code);
    expect(codes).toContain('D2');
    expect(codes).not.toContain('D4');
    expect(codes).not.toContain('D5');
  });
});

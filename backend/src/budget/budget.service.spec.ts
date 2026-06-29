/**
 * B-04 — BudgetService integration tests.
 * Asserts: planned/committed/actual rollup matches deterministic test data; overCap flag,
 * 10% overrun rule, uncategorized bucket, byWorkstream rollup.
 */
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { BudgetService } from './budget.service';
import { ProjectsService } from '../projects/projects.service';

const itDb = SKIP_DB ? it.skip : it;

describe('BudgetService.summary (M5 integration)', () => {
  let deps: TestDeps;
  let budget: BudgetService;
  let projects: ProjectsService;
  let orgId: string | undefined;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    budget = new BudgetService(deps.prisma, deps.rbac, deps.audit);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
  });
  afterEach(async () => { await cleanupOrg(deps?.prisma, orgId); orgId = undefined; });
  afterAll(async () => { await deps?.prisma.$disconnect(); });

  itDb('rolls up planned/committed/actual, flags overCap and overruns', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'bud');
    orgId = owner.org.id;
    const p = await projects.create(owner.ctx, { name: 'B', status: 'PLANNING', budgetCapVnd: 100 }, null);

    const ws = await deps.prisma.workstream.create({
      data: { projectId: p.id, name: 'Marketing', track: 'MARKETING' },
    });
    // actual is managed on the category (manual entry), not rolled up from tasks.
    const branding = await deps.prisma.budgetCategory.create({
      data: { projectId: p.id, name: 'Branding', plannedVnd: 80n, actualVnd: 50n, order: 0 },
    });
    const ads = await deps.prisma.budgetCategory.create({
      data: { projectId: p.id, name: 'Ads', plannedVnd: 0n, order: 1 },
    });

    // committed: Branding 100 (overrun >10% of 80), Ads 30 (overrun because planned=0),
    // Uncategorized 20 → total committed = 150 > cap 100.
    await deps.prisma.task.createMany({
      data: [
        { projectId: p.id, code: 'T1', title: 'a', workstreamId: ws.id, budgetCategoryId: branding.id, budgetVnd: 100n },
        { projectId: p.id, code: 'T2', title: 'b', workstreamId: ws.id, budgetCategoryId: ads.id, budgetVnd: 30n },
        { projectId: p.id, code: 'T3', title: 'c', workstreamId: ws.id, budgetVnd: 20n },
      ],
    });

    const s = await budget.summary(owner.ctx, p.id);
    expect(s.capVnd).toBe(100);
    expect(s.plannedVnd).toBe(80);
    expect(s.committedVnd).toBe(150);
    expect(s.actualVnd).toBe(50);
    expect(s.overCap).toBe(true);

    const brand = s.byCategory.find((c) => c.name === 'Branding')!;
    expect(brand.committedVnd).toBe(100);
    expect(s.overruns.find((o) => o.name === 'Branding')?.overByVnd).toBe(20);
    expect(s.overruns.find((o) => o.name === 'Ads')).toBeDefined(); // planned=0 + committed>0 ⇒ overrun

    const uncat = s.byCategory.find((c) => c.categoryId === '__uncategorized__');
    expect(uncat?.committedVnd).toBe(20);

    const mkt = s.byWorkstream.find((w) => w.workstreamId === ws.id)!;
    expect(mkt.committedVnd).toBe(150);
  });

  itDb('overCap false when committed <= cap and no overruns when within 10%', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'bud2');
    orgId = owner.org.id;
    const p = await projects.create(owner.ctx, { name: 'C', status: 'PLANNING', budgetCapVnd: 1000 }, null);
    const cat = await deps.prisma.budgetCategory.create({
      data: { projectId: p.id, name: 'Ops', plannedVnd: 100n, order: 0 },
    });
    // committed=105 ≤ planned*1.1 = 110 → not an overrun
    await deps.prisma.task.create({
      data: { projectId: p.id, code: 'X1', title: 'x', budgetCategoryId: cat.id, budgetVnd: 105n },
    });
    const s = await budget.summary(owner.ctx, p.id);
    expect(s.overCap).toBe(false);
    expect(s.overruns).toHaveLength(0);
  });
});

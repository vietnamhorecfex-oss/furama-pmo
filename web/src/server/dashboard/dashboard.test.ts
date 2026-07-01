/**
 * Integration tests for dashboardOverview service function.
 * TDD: written before implementation — expect RED first, then GREEN after dashboard.ts is created.
 *
 * Covers:
 *  - byPhase progress grouping (total=2, completed=1)
 *  - overdue count >= 1 for past-deadline non-completed tasks
 *  - atRisk count: NOT_STARTED tasks with deadline in [now, now+7d]
 *  - upcomingDeadlines includes the near NOT_STARTED task by code
 *  - non-member gets Forbidden
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { dashboardOverview } from './dashboard';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let outsiderId: string;
let pid: string;
let phaseAId: string;
let nearTaskCode: string;
let ownerCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();

  const org = await prisma.organization.create({
    data: { slug: `dash-${ts}`, name: 'DashOrg' },
  });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: {
        orgId,
        name: 'Owner',
        email: `dash-owner-${ts}@x.test`,
        passwordHash: 'x',
        isActive: true,
      },
    })
  ).id;

  outsiderId = (
    await prisma.user.create({
      data: {
        orgId,
        name: 'Outsider',
        email: `dash-outsider-${ts}@x.test`,
        passwordHash: 'x',
        isActive: true,
      },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `DashProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerUserId,
    },
  });
  pid = project.id;

  await prisma.projectMember.create({
    data: { projectId: pid, userId: ownerUserId, role: 'OWNER' },
  });
  // outsider is NOT a member

  // Create Phase A
  const phaseA = await prisma.phase.create({
    data: { projectId: pid, name: 'Phase A', order: 0 },
  });
  phaseAId = phaseA.id;

  const now = new Date();

  // Task 1 in Phase A: COMPLETED
  await prisma.task.create({
    data: {
      projectId: pid,
      phaseId: phaseAId,
      code: `DASH-COMP-${ts}`,
      title: 'Completed Task',
      priority: 'MEDIUM',
      status: 'COMPLETED',
      percent: 100,
      budgetVnd: BigInt(0),
      actualVnd: BigInt(0),
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });

  // Task 2 in Phase A: NOT_STARTED, deadline ~3 days out (atRisk + upcoming)
  nearTaskCode = `DASH-NEAR-${ts}`;
  const nearDeadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  await prisma.task.create({
    data: {
      projectId: pid,
      phaseId: phaseAId,
      code: nearTaskCode,
      title: 'Near Deadline Task',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      deadline: nearDeadline,
      budgetVnd: BigInt(0),
      actualVnd: BigInt(0),
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });

  // Task 3: overdue (deadline yesterday, NOT_STARTED — no phase)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await prisma.task.create({
    data: {
      projectId: pid,
      code: `DASH-OVER-${ts}`,
      title: 'Overdue Task',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      deadline: yesterday,
      budgetVnd: BigInt(0),
      actualVnd: BigInt(0),
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });

  ownerCtx = { userId: ownerUserId, orgId };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.phase.deleteMany({ where: { projectId: pid } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('dashboardOverview', () => {
  it('aggregates phase progress, overdue, atRisk, and upcoming deadlines', async () => {
    const o = await dashboardOverview(ownerCtx, pid);

    // byPhase for Phase A: total=2, completed=1
    const phase = o.byPhase.find((g: any) => g.id === phaseAId)!;
    expect(phase).toBeDefined();
    expect(phase.total).toBe(2);
    expect(phase.completed).toBe(1);

    // overdue >= 1 (the yesterday task)
    expect(o.health.overdue).toBeGreaterThanOrEqual(1);

    // atRisk >= 1 (the 3-days-out NOT_STARTED task)
    expect(o.health.atRisk).toBeGreaterThanOrEqual(1);

    // upcomingDeadlines includes the near NOT_STARTED task by code
    expect(o.upcomingDeadlines.map((u: any) => u.code)).toContain(nearTaskCode);

    // overallPercent is a number (avg of 100, 0, 0 = ~33)
    expect(typeof o.health.overallPercent).toBe('number');

    // budget field present (BudgetSummary)
    expect(o.budget).toBeDefined();
    expect(typeof o.budget.committedVnd).toBe('number');
  });

  it('includes daysLeft for upcoming deadlines', async () => {
    const o = await dashboardOverview(ownerCtx, pid);
    const near = o.upcomingDeadlines.find((u: any) => u.code === nearTaskCode);
    expect(near).toBeDefined();
    expect(near!.daysLeft).toBeGreaterThanOrEqual(1);
    expect(near!.daysLeft).toBeLessThanOrEqual(7);
  });

  it('daysToOpening is null when project has no openingDate', async () => {
    const o = await dashboardOverview(ownerCtx, pid);
    expect(o.daysToOpening).toBeNull();
  });

  it('denies a non-member (Forbidden)', async () => {
    await expect(dashboardOverview({ userId: outsiderId, orgId }, pid)).rejects.toThrow(
      /member|forbidden/i,
    );
  });

  it('all money fields in budget are numbers (not BigInt)', async () => {
    const o = await dashboardOverview(ownerCtx, pid);
    expect(typeof o.budget.capVnd).toBe('number');
    expect(typeof o.budget.plannedVnd).toBe('number');
    expect(typeof o.budget.committedVnd).toBe('number');
    expect(typeof o.budget.actualVnd).toBe('number');
  });
});

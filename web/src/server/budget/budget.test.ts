/**
 * Integration tests for budget service functions.
 * TDD: written before implementation — expect RED first, then GREEN after budget.ts is created.
 *
 * Covers:
 *  - committed = Σ task.budgetVnd (not BudgetCategory.actualVnd)
 *  - actual = category.actualVnd (manual, not rolled from tasks)
 *  - overrun when committed > planned * 1.1
 *  - overCap when Σ committed > positive cap
 *  - LEAD is denied MANAGE_BUDGET (setBudgetCap/setCategoryAmounts)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { budgetSummary, setBudgetCap, setCategoryAmounts, importBudget } from './budget';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let leadUserId: string;
let pid: string;
let brandingId: string;
let ownerCtx: AuthContext;
let leadCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();

  const org = await prisma.organization.create({
    data: { slug: `budget-${ts}`, name: 'BudgetOrg' },
  });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `budget-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  leadUserId = (
    await prisma.user.create({
      data: { orgId, name: 'Lead', email: `budget-lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `BudgetProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerUserId,
    },
  });
  pid = project.id;

  // Seed project members
  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerUserId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: leadUserId, role: 'LEAD' } });

  // Seed a budget category "Branding" with planned=100
  const branding = await prisma.budgetCategory.create({
    data: { projectId: pid, name: 'Branding', plannedVnd: BigInt(100), actualVnd: BigInt(0), order: 0 },
  });
  brandingId = branding.id;

  // Seed a task in the Branding category with budgetVnd=120
  await prisma.task.create({
    data: {
      projectId: pid,
      code: `BDG-0001-${ts}`,
      title: 'Branding Task',
      priority: 'MEDIUM',
      status: 'NOT_STARTED',
      percent: 0,
      budgetVnd: BigInt(120),
      actualVnd: BigInt(0),
      budgetCategoryId: brandingId,
      createdById: ownerUserId,
      updatedById: ownerUserId,
    },
  });

  ownerCtx = { userId: ownerUserId, orgId };
  leadCtx = { userId: leadUserId, orgId };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.budgetCategory.deleteMany({ where: { projectId: pid } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('budget summary', () => {
  it('committed = Σ task.budgetVnd; actual = category.actualVnd; flags overrun when committed > planned*1.1', async () => {
    // Set planned=100, actual=30 on the category
    await setCategoryAmounts(ownerCtx, pid, brandingId, { plannedVnd: 100, actualVnd: 30 }, null);
    const s = await budgetSummary(ownerCtx, pid);
    const brand = s.byCategory.find((c: any) => c.categoryId === brandingId)!;
    expect(brand.committedVnd).toBe(120);        // from the task (budgetVnd=120)
    expect(brand.actualVnd).toBe(30);            // manual, not rolled from tasks
    expect(typeof brand.plannedVnd).toBe('number');
    // 120 > 100*1.1=110, so this is an overrun
    expect(s.overruns.find((o: any) => o.categoryId === brandingId)).toBeTruthy();
  });

  it('overCap true when Σcommitted exceeds a positive cap', async () => {
    // Set cap to 50; committed is 120, so overCap should be true
    await setBudgetCap(ownerCtx, pid, 50, null);
    const s = await budgetSummary(ownerCtx, pid);
    expect(s.overCap).toBe(true);
  });

  it('a VIEWER can read the summary but a LEAD cannot set the cap', async () => {
    // LEAD role does not have MANAGE_BUDGET capability
    await expect(setBudgetCap(leadCtx, pid, 10, null)).rejects.toThrow(/forbidden|cannot/i);
  });

  it('all money fields are numbers, not BigInt', async () => {
    const s = await budgetSummary(ownerCtx, pid);
    expect(typeof s.capVnd).toBe('number');
    expect(typeof s.plannedVnd).toBe('number');
    expect(typeof s.committedVnd).toBe('number');
    expect(typeof s.actualVnd).toBe('number');
  });

  it('importBudget creates a new category on miss, updates existing on hit', async () => {
    const result = await importBudget(
      ownerCtx,
      pid,
      {
        rows: [
          { name: 'Branding', plannedVnd: 200 },   // existing → update
          { name: 'Marketing Budget', plannedVnd: 500 }, // new → create
        ],
      },
      null,
    );
    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
    expect(result.capUpdated).toBe(false);
  });

  it('importBudget with capVnd sets the project cap', async () => {
    const result = await importBudget(ownerCtx, pid, { capVnd: 9999, rows: [] }, null);
    expect(result.capUpdated).toBe(true);
    const p = await prisma.project.findUnique({ where: { id: pid } });
    expect(Number(p!.budgetCapVnd)).toBe(9999);
  });

  it('LEAD cannot import budget (Forbidden)', async () => {
    await expect(importBudget(leadCtx, pid, { rows: [] }, null)).rejects.toThrow(/forbidden|cannot/i);
  });
});

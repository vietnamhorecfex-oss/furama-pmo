/**
 * Integration tests for budget categories service functions.
 * TDD: written before implementation — expect RED first, then GREEN after categories.ts is created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { listBudgetCategories, createBudgetCategory, updateBudgetCategory, deleteBudgetCategory, reorderBudgetCategories } from './categories';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerId: string;
let leadId: string;
let pid: string;
let ownerCtx: AuthContext;
let leadCtx: AuthContext;

beforeAll(async () => {
  const ts = Date.now();
  const org = await prisma.organization.create({ data: { slug: `bc-${ts}`, name: 'BudgetOrg' } });
  orgId = org.id;

  ownerId = (
    await prisma.user.create({
      data: { orgId, name: 'Owner', email: `bc-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  leadId = (
    await prisma.user.create({
      data: { orgId, name: 'Lead', email: `bc-lead-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: { orgId, name: `BudgetProject-${ts}`, budgetCapVnd: BigInt(0), createdById: ownerId },
  });
  pid = project.id;

  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: leadId, role: 'LEAD' } });
  ownerCtx = { userId: ownerId, orgId };
  leadCtx = { userId: leadId, orgId };
});

afterAll(async () => {
  await prisma.taskAssignment.deleteMany({ where: { task: { projectId: pid } } });
  await prisma.task.deleteMany({ where: { projectId: pid } });
  await prisma.budgetCategory.deleteMany({ where: { projectId: pid } });
  await prisma.memberWorkstream.deleteMany({ where: { projectMember: { projectId: pid } } });
  await prisma.projectMember.deleteMany({ where: { projectId: pid } });
  await prisma.auditLog.deleteMany({ where: { projectId: pid } });
  await prisma.project.delete({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('budgetCategories', () => {
  let catId: string;

  it('creates a budget category; plannedVnd is a number in the DTO', async () => {
    const cat = await createBudgetCategory(ownerCtx, pid, { name: 'Venue', plannedVnd: 5000000, order: 1 } as any, null);
    catId = cat.id;
    expect(typeof cat.plannedVnd).toBe('number');
    expect(cat.plannedVnd).toBe(5000000);
    expect(typeof cat.actualVnd).toBe('number');
  });

  it('lists budget categories', async () => {
    const list = await listBudgetCategories(ownerCtx, pid);
    expect(list.some((c) => c.id === catId)).toBe(true);
  });

  it('a LEAD is denied create (MANAGE_BUDGET required)', async () => {
    await expect(
      createBudgetCategory(leadCtx, pid, { name: 'Denied', plannedVnd: 0, order: 0 } as any, null),
    ).rejects.toThrow(/forbidden|cannot/i);
  });

  it('blocks deleting a category referenced by a task (Conflict)', async () => {
    const cat = await createBudgetCategory(ownerCtx, pid, { name: 'Referenced', plannedVnd: 0, order: 0 } as any, null);
    await prisma.task.create({
      data: {
        projectId: pid,
        code: `BC-T${Date.now()}`,
        title: 'test task',
        status: 'NOT_STARTED',
        priority: 'MEDIUM',
        budgetCategoryId: cat.id,
      },
    });
    await expect(deleteBudgetCategory(ownerCtx, pid, cat.id, null)).rejects.toThrow(/conflict|task/i);
  });
});

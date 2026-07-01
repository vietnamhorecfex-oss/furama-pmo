/**
 * Integration tests for import-export service functions.
 * TDD: written before implementation — expect RED first, then GREEN after import-export.ts.
 *
 * Load-bearing cases:
 *  - importPackedSeed inserts 2 rows on first import
 *  - re-import is idempotent (updated=2, inserted=0)
 *  - COMPLETED task has percent=100
 *  - Project.budgetCapVnd = Σ of all row budgets
 *  - exportTasksCsv has 12-col header and both task codes
 *  - VIEWER cannot import (Forbidden)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../prisma';
import { importPackedSeed, exportProject, exportTasksCsv } from './import-export';
import type { AuthContext } from '../rbac/rbac';

let orgId: string;
let ownerUserId: string;
let viewerUserId: string;
let pid: string;
let ownerCtx: AuthContext;
let viewerCtx: AuthContext;

const seed = {
  cols: ['code', 'title', 'phase', 'workstream', 'status', 'budgetVnd'],
  rows: [
    ['MKT-0001', 'Launch', 'Marketing', 'MKT', 'COMPLETED', 500],
    ['OPS-0001', 'Setup', 'Ops', 'OPS', 'NOT_STARTED', 300],
  ],
};

beforeAll(async () => {
  const ts = Date.now();

  const org = await prisma.organization.create({
    data: { slug: `ie-${ts}`, name: 'ImportExportOrg' },
  });
  orgId = org.id;

  ownerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'IEOwner', email: `ie-owner-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  viewerUserId = (
    await prisma.user.create({
      data: { orgId, name: 'IEViewer', email: `ie-viewer-${ts}@x.test`, passwordHash: 'x', isActive: true },
    })
  ).id;

  const project = await prisma.project.create({
    data: {
      orgId,
      name: `IEProject-${ts}`,
      budgetCapVnd: BigInt(0),
      createdById: ownerUserId,
    },
  });
  pid = project.id;

  await prisma.projectMember.create({ data: { projectId: pid, userId: ownerUserId, role: 'OWNER' } });
  await prisma.projectMember.create({ data: { projectId: pid, userId: viewerUserId, role: 'VIEWER' } });

  ownerCtx = { userId: ownerUserId, orgId };
  viewerCtx = { userId: viewerUserId, orgId };
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: pid } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerUserId, viewerUserId] } } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.$disconnect();
});

describe('importPackedSeed', () => {
  it('imports rows idempotently, forces percent=100 on COMPLETED, and sets the cap from Σ budget', async () => {
    const r1 = await importPackedSeed(ownerCtx, pid, seed, null);
    expect(r1.inserted).toBe(2);
    expect(r1.updated).toBe(0);
    expect(r1.total).toBe(2);

    const r2 = await importPackedSeed(ownerCtx, pid, seed, null);
    expect(r2.updated).toBe(2);
    expect(r2.inserted).toBe(0); // idempotent by code

    const t = await prisma.task.findFirst({ where: { projectId: pid, code: 'MKT-0001' } });
    expect(t?.percent).toBe(100);

    const p = await prisma.project.findUnique({ where: { id: pid } });
    expect(Number(p!.budgetCapVnd)).toBe(800);
  });

  it('creates phases and workstreams on import', async () => {
    const phases = await prisma.phase.findMany({ where: { projectId: pid } });
    const phaseNames = phases.map((p) => p.name);
    expect(phaseNames).toContain('Marketing');
    expect(phaseNames).toContain('Ops');

    const workstreams = await prisma.workstream.findMany({ where: { projectId: pid } });
    const tracks = workstreams.map((w) => w.track);
    expect(tracks).toContain('MARKETING');
    expect(tracks).toContain('OPERATIONS');
  });

  it('returns ImportResult with workstreamsCreated and phasesCreated > 0 on first import', async () => {
    // Clean up and re-import into a fresh project to measure creation counts
    const ts = Date.now();
    const freshProject = await prisma.project.create({
      data: { orgId, name: `IEFresh-${ts}`, budgetCapVnd: BigInt(0), createdById: ownerUserId },
    });
    await prisma.projectMember.create({
      data: { projectId: freshProject.id, userId: ownerUserId, role: 'OWNER' },
    });

    const r = await importPackedSeed(ownerCtx, freshProject.id, seed, null);
    expect(r.workstreamsCreated).toBe(2);
    expect(r.phasesCreated).toBe(2);
    expect(r.budgetCapVnd).toBe(800);

    // Cleanup
    await prisma.project.delete({ where: { id: freshProject.id } });
  });

  it('rejects an invalid packed seed payload', async () => {
    await expect(importPackedSeed(ownerCtx, pid, { invalid: true }, null)).rejects.toThrow(
      /invalid packed-seed/i,
    );
  });

  it('a VIEWER cannot import (Forbidden)', async () => {
    await expect(importPackedSeed(viewerCtx, pid, seed, null)).rejects.toThrow(/forbidden|cannot/i);
  });
});

describe('exportProject', () => {
  it('returns a full snapshot with project, tasks, phases, workstreams', async () => {
    const snapshot = await exportProject(ownerCtx, pid);
    const project = snapshot.project as Record<string, unknown>;
    const phases = snapshot.phases as unknown[];
    const workstreams = snapshot.workstreams as unknown[];
    const tasks = snapshot.tasks as Array<Record<string, unknown>>;
    expect(project).toBeDefined();
    expect(phases.length).toBeGreaterThanOrEqual(2);
    expect(workstreams.length).toBeGreaterThanOrEqual(2);
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    // Money fields must be numbers, not BigInt
    expect(typeof project.budgetCapVnd).toBe('number');
    const task = tasks.find((t) => t.code === 'MKT-0001');
    expect(task).toBeDefined();
    expect(typeof task!.budgetVnd).toBe('number');
  });

  it('a VIEWER cannot exportProject (Forbidden)', async () => {
    await expect(exportProject(viewerCtx, pid)).rejects.toThrow(/forbidden|cannot/i);
  });
});

describe('exportTasksCsv', () => {
  it('returns a CSV string with 12-col header and both task codes', async () => {
    const csv = await exportTasksCsv(ownerCtx, pid);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('code,title,phase,workstream,status,priority,percent,startDate,deadline,budgetVnd,actualVnd,inCharge');
    expect(csv).toContain('MKT-0001');
    expect(csv).toContain('OPS-0001');
  });

  it('a VIEWER cannot exportTasksCsv (Forbidden)', async () => {
    await expect(exportTasksCsv(viewerCtx, pid)).rejects.toThrow(/forbidden|cannot/i);
  });
});

/**
 * T-08 — ImportExportService integration tests.
 * Asserts: idempotent import of the real 628-task seed (run twice → still 628, no clones);
 * label→memberLabel autolink; CSV export shape; non-OWNER/PM cannot import.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import {
  SKIP_DB,
  bootIntegrationDeps,
  cleanupOrg,
  makeOrgWithUser,
  type TestDeps,
} from '../test-utils/integration-helpers';
import { ImportExportService } from './import-export.service';
import { ProjectsService } from '../projects/projects.service';

const itDb = SKIP_DB ? it.skip : it;
const SEED_PATH = resolve(__dirname, '../../../db/seed/tasks.seed.json');

describe('ImportExportService (M3 integration)', () => {
  let deps: TestDeps;
  let io: ImportExportService;
  let projects: ProjectsService;
  let orgId: string | undefined;
  let seedJson: unknown;

  beforeAll(async () => {
    if (SKIP_DB) return;
    deps = await bootIntegrationDeps();
    io = new ImportExportService(deps.prisma, deps.audit, deps.rbac);
    projects = new ProjectsService(deps.prisma, deps.audit, deps.rbac);
    seedJson = JSON.parse(await readFile(SEED_PATH, 'utf8'));
  });

  afterEach(async () => {
    await cleanupOrg(deps?.prisma, orgId);
    orgId = undefined;
  });

  afterAll(async () => {
    await deps?.prisma.$disconnect();
  });

  itDb('imports 628 tasks once, re-import is idempotent (0 inserted, 628 updated)', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'imp');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'Imp', status: 'PLANNING', budgetCapVnd: 0 }, null);

    const first = await io.importPackedSeed(owner.ctx, proj.id, seedJson, null);
    expect(first.total).toBe(628);
    expect(first.inserted).toBe(628);
    expect(first.updated).toBe(0);
    expect(first.workstreamsCreated).toBe(3);

    const second = await io.importPackedSeed(owner.ctx, proj.id, seedJson, null);
    expect(second.total).toBe(628);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(628);
    expect(second.workstreamsCreated).toBe(0);

    const count = await deps.prisma.task.count({ where: { projectId: proj.id } });
    expect(count).toBe(628);
  }, 60_000);

  itDb('TaskAssignment.userId autolinks via memberLabel when present', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'link');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'L', status: 'PLANNING', budgetCapVnd: 0 }, null);

    // Add a project member whose label matches an inCharge value from the seed.
    const linked = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'LU', email: `lu-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await deps.prisma.projectMember.create({
      data: { projectId: proj.id, userId: linked.id, role: 'MEMBER', memberLabel: 'PMO Lead' },
    });

    await io.importPackedSeed(owner.ctx, proj.id, seedJson, null);

    // EXE-0001 in the seed has inCharge="PMO Lead" — its assignment should be linked.
    const t = await deps.prisma.task.findFirst({
      where: { projectId: proj.id, code: 'EXE-0001' },
      include: { assignments: true },
    });
    const inCharge = t?.assignments.find((a) => a.role === 'IN_CHARGE');
    expect(inCharge).toBeDefined();
    expect(inCharge?.userId).toBe(linked.id);
  }, 60_000);

  itDb('exports CSV with the expected header and at least one row', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'csv');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'C', status: 'PLANNING', budgetCapVnd: 0 }, null);
    await io.importPackedSeed(owner.ctx, proj.id, seedJson, null);

    const csv = await io.exportTasksCsv(owner.ctx, proj.id);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'code,title,phase,workstream,status,priority,percent,startDate,deadline,budgetVnd,actualVnd,inCharge',
    );
    expect(lines.length).toBeGreaterThan(600);
  }, 60_000);

  itDb('non-OWNER/PM cannot import', async () => {
    const owner = await makeOrgWithUser(deps.prisma, 'guard');
    orgId = owner.org.id;
    const proj = await projects.create(owner.ctx, { name: 'G', status: 'PLANNING', budgetCapVnd: 0 }, null);
    const lead = await deps.prisma.user.create({
      data: { orgId: owner.org.id, name: 'Lead', email: `ld-${Date.now()}@x.test`, passwordHash: 'noop' },
    });
    await deps.prisma.projectMember.create({ data: { projectId: proj.id, userId: lead.id, role: 'LEAD' } });
    await expect(
      io.importPackedSeed({ userId: lead.id, orgId: owner.org.id }, proj.id, seedJson, null),
    ).rejects.toBeInstanceOf(ForbiddenException);
  }, 60_000);
});

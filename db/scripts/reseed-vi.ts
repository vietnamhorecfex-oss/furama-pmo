/**
 * One-off reseed to Vietnamese content.
 *
 * Wipes the seed project's tasks/phases/budget-categories/milestones (keeps org, admin,
 * project, membership, workstreams — workstreams are reused by track on import), then
 * re-imports the translated packed seed (db/seed/tasks.seed.json, now Vietnamese) and
 * regenerates milestones from phases so their names are Vietnamese too.
 *
 * Run: node scripts/db-env.mjs --direct tsx db/scripts/reseed-vi.ts
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { prisma, dbHealthy } from '../../web/src/server/prisma';
import { importPackedSeed } from '../../web/src/server/import-export/import-export';
import { generateFromPhases } from '../../web/src/server/milestones/milestones';

loadEnv({ path: resolve(__dirname, '../../.env') });

const SEED_ORG_SLUG = process.env.SEED_ORG_SLUG ?? 'furama';
const SEED_PROJECT_NAME = process.env.SEED_PROJECT_NAME ?? 'Furama Grand Opening 2026';
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'seed-admin@furama.test';

async function main(): Promise<void> {
  if (!(await dbHealthy())) throw new Error('Postgres unreachable');

  const org = await prisma.organization.findUnique({ where: { slug: SEED_ORG_SLUG } });
  if (!org) throw new Error(`Org "${SEED_ORG_SLUG}" not found — run npm run db:seed first`);
  const admin = await prisma.user.findFirst({ where: { orgId: org.id, email: SEED_ADMIN_EMAIL } });
  if (!admin) throw new Error(`Admin ${SEED_ADMIN_EMAIL} not found`);
  const project = await prisma.project.findFirst({ where: { orgId: org.id, name: SEED_PROJECT_NAME } });
  if (!project) throw new Error(`Project "${SEED_PROJECT_NAME}" not found`);
  const projectId = project.id;
  const ctx = { userId: admin.id, orgId: org.id };

  const before = {
    tasks: await prisma.task.count({ where: { projectId } }),
    phases: await prisma.phase.count({ where: { projectId } }),
    milestones: await prisma.milestone.count({ where: { projectId } }),
    budgetCategories: await prisma.budgetCategory.count({ where: { projectId } }),
  };
  console.log('[reseed] before:', before);

  // Wipe (order: milestones → tasks(cascade children) → budget categories → phases). Keep workstreams.
  console.log('[reseed] wiping project data…');
  await prisma.milestone.deleteMany({ where: { projectId } });
  await prisma.task.deleteMany({ where: { projectId } });
  await prisma.budgetCategory.deleteMany({ where: { projectId } });
  await prisma.phase.deleteMany({ where: { projectId } });

  // Re-import translated seed.
  const seedPath = resolve(__dirname, '../seed/tasks.seed.json');
  const raw = JSON.parse(await readFile(seedPath, 'utf8'));
  console.log(`[reseed] importing ${seedPath}…`);
  const result = await importPackedSeed(ctx, projectId, raw, null);
  console.log('[reseed] import result:', result);

  // Regenerate milestones (names = phase names, now Vietnamese).
  const gen = await generateFromPhases(ctx, projectId, null);
  console.log('[reseed] milestones generated:', gen);

  const after = {
    tasks: await prisma.task.count({ where: { projectId } }),
    phases: await prisma.phase.count({ where: { projectId } }),
    milestones: await prisma.milestone.count({ where: { projectId } }),
    budgetCategories: await prisma.budgetCategory.count({ where: { projectId } }),
  };
  console.log('[reseed] after:', after);

  await prisma.$disconnect();
  if (after.tasks !== 628) throw new Error(`Expected 628 tasks; got ${after.tasks}`);
  console.log('[reseed] DONE.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

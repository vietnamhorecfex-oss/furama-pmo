/**
 * Seed script. `npm run db:seed`.
 *
 * Idempotent bootstrap:
 *   1. Ensure an Organization with slug = SEED_ORG_SLUG.
 *   2. Ensure an admin User (`seed-admin@furama.test`) — password set so login works in dev.
 *   3. Ensure a Project named "Furama Grand Opening 2026" under that org, with the admin
 *      auto-added as OWNER.
 *   4. Read db/seed/tasks.seed.json and call importPackedSeed.
 *
 * Re-running this script must leave the DB in the same state (628 tasks, no duplicates).
 * Idempotency lives at every step: organization.upsert, user find-or-create by email,
 * project existence check by (orgId,name), task upsert by (projectId,code).
 *
 * Runs against the Next.js server layer (`web/src/server/**`) — the NestJS backend was
 * removed in Phase 6. These server modules use plain relative imports and no Next.js
 * runtime APIs on this path, so `tsx` executes them directly.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as argon2 from 'argon2';
import { config as loadEnv } from 'dotenv';
import { prisma, dbHealthy } from '../../web/src/server/prisma';
import { importPackedSeed } from '../../web/src/server/import-export/import-export';

loadEnv({ path: resolve(__dirname, '../../.env') });

const SEED_ORG_SLUG = process.env.SEED_ORG_SLUG ?? 'furama';
const SEED_PROJECT_NAME = process.env.SEED_PROJECT_NAME ?? 'Furama Grand Opening 2026';
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'seed-admin@furama.test';
const SEED_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'correctHorseBatteryStaple';

async function main(): Promise<void> {
  console.log(`[seed] connecting to DB…`);
  if (!(await dbHealthy())) {
    throw new Error('Postgres unreachable — check DATABASE_URL and that Postgres is running');
  }

  // 1. Org
  const org = await prisma.organization.upsert({
    where: { slug: SEED_ORG_SLUG },
    update: {},
    create: { slug: SEED_ORG_SLUG, name: 'Furama' },
  });
  console.log(`[seed] org=${org.slug} (${org.id})`);

  // 2. Admin user (idempotent by orgId + email).
  let admin = await prisma.user.findFirst({
    where: { orgId: org.id, email: SEED_ADMIN_EMAIL },
  });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        orgId: org.id,
        name: 'Seed Admin',
        email: SEED_ADMIN_EMAIL,
        passwordHash: await argon2.hash(SEED_ADMIN_PASSWORD, { type: argon2.argon2id }),
      },
    });
    console.log(`[seed] created admin user ${admin.email}`);
  } else {
    console.log(`[seed] admin user exists: ${admin.email}`);
  }

  // 3. Project + auto-OWNER membership.
  let project = await prisma.project.findFirst({
    where: { orgId: org.id, name: SEED_PROJECT_NAME },
  });
  if (!project) {
    project = await prisma.project.create({
      data: {
        orgId: org.id,
        name: SEED_PROJECT_NAME,
        status: 'PLANNING',
        budgetCapVnd: 0n,
        createdById: admin.id,
      },
    });
    console.log(`[seed] created project "${project.name}" (${project.id})`);
  } else {
    console.log(`[seed] project exists: "${project.name}"`);
  }
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: admin.id } },
    update: { role: 'OWNER' },
    create: { projectId: project.id, userId: admin.id, role: 'OWNER' },
  });

  // 4. Import packed seed.
  const seedPath = resolve(__dirname, '../seed/tasks.seed.json');
  console.log(`[seed] reading ${seedPath}…`);
  const raw = JSON.parse(await readFile(seedPath, 'utf8'));
  const result = await importPackedSeed(
    { userId: admin.id, orgId: org.id },
    project.id,
    raw,
    null,
  );
  console.log(`[seed] import result:`, result);

  const finalCount = await prisma.task.count({ where: { projectId: project.id } });
  console.log(`[seed] task count in DB: ${finalCount}`);

  await prisma.$disconnect();
  if (finalCount !== 628) {
    throw new Error(`Expected 628 tasks after seed; got ${finalCount}`);
  }
  console.log('[seed] DONE — 628 tasks present.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

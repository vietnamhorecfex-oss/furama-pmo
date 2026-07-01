/**
 * web/server port of backend ImportExportService
 * (backend/src/import-export/import-export.service.ts).
 *
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - BadRequestException → BadRequest from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.audit.record → auditRecord from ../audit/audit
 *  - All BigInt money fields → moneyToNumber at the response boundary
 *
 * ImportResult is defined here (not in @furama/shared) — matches backend interface exactly.
 *
 * Packed seed format (docs/02 §6): { cols: string[], rows: (string|number|null)[][] }.
 * Mapping:
 *   row.project (PMO|MKT|OPS)  → Workstream.track (PMO|MARKETING|OPERATIONS)
 *                              + auto-create one Workstream per (project,track) if missing
 *   row.phase                  → Phase (auto-create on first sight)
 *   row.inCharge/support/approver → TaskAssignment rows; userId resolved via memberLabelCache
 *   row.budget/actual          → BigInt VND via parseMoney
 *   row.code                   → idempotent upsert key on (projectId, code)
 */
import type { WorkstreamTrack } from '@prisma/client';
import { packedSeedSchema, type PackedSeed, type Priority, type TaskStatus } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { auditRecord } from '../audit/audit';
import { moneyToNumber } from '../http/serialize';
import { BadRequest } from '../http/errors';

// ─── public type (matches backend ImportResult interface exactly) ──────────────

export interface ImportResult {
  inserted: number;
  updated: number;
  total: number;
  workstreamsCreated: number;
  phasesCreated: number;
  budgetCategoriesCreated: number;
  budgetCapVnd: number;
  unknownStatuses: string[];
  unknownPriorities: string[];
}

// ─── lookup tables ────────────────────────────────────────────────────────────

const TRACK_MAP: Record<string, WorkstreamTrack> = {
  PMO: 'PMO',
  MKT: 'MARKETING',
  OPS: 'OPERATIONS',
};

const STATUS_MAP = new Map<string, TaskStatus>([
  ['not started', 'NOT_STARTED'],
  ['notstarted', 'NOT_STARTED'],
  ['in progress', 'IN_PROGRESS'],
  ['inprogress', 'IN_PROGRESS'],
  ['in review', 'IN_REVIEW'],
  ['inreview', 'IN_REVIEW'],
  ['blocked', 'BLOCKED'],
  ['completed', 'COMPLETED'],
  ['done', 'COMPLETED'],
]);

const PRIORITY_MAP = new Map<string, Priority>([
  ['critical', 'CRITICAL'],
  ['high', 'HIGH'],
  ['medium', 'MEDIUM'],
  ['low', 'LOW'],
]);

// ─── IMPORT ───────────────────────────────────────────────────────────────────

export async function importPackedSeed(
  ctx: AuthContext,
  projectId: string,
  raw: unknown,
  ip: string | null,
): Promise<ImportResult> {
  await assertCan(ctx, 'IMPORT_EXPORT', projectId);

  const parsed = packedSeedSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequest(`Invalid packed-seed payload: ${parsed.error.message}`);
  }
  const seed: PackedSeed = parsed.data;
  const idx = indexer(seed.cols);

  if (!seed.cols.includes('id') && !seed.cols.includes('code')) {
    throw new BadRequest('Seed is missing a task code column (id or code)');
  }

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new BadRequest('Project not found');

  // Pre-resolve existing DB rows into caches so the row loop does O(rows) DB ops.
  const phaseCache = new Map<string, string>(); // phase name → id
  const wsCache = new Map<WorkstreamTrack, string>(); // track → workstream id
  const memberLabelCache = new Map<string, string>(); // memberLabel → userId

  for (const p of await prisma.phase.findMany({ where: { projectId } })) {
    phaseCache.set(p.name, p.id);
  }
  for (const w of await prisma.workstream.findMany({ where: { projectId } })) {
    wsCache.set(w.track, w.id);
  }
  for (const m of await prisma.projectMember.findMany({
    where: { projectId, NOT: { memberLabel: null } },
  })) {
    if (m.memberLabel) memberLabelCache.set(m.memberLabel.toLowerCase(), m.userId);
  }

  const result: ImportResult = {
    inserted: 0,
    updated: 0,
    total: 0,
    workstreamsCreated: 0,
    phasesCreated: 0,
    budgetCategoriesCreated: 0,
    budgetCapVnd: 0,
    unknownStatuses: [],
    unknownPriorities: [],
  };
  const unknownStatusSet = new Set<string>();
  const unknownPrioSet = new Set<string>();

  // ── Pre-pass: derive budget categories + project cap ─────────────────────────
  // Each distinct non-empty `category` column that carries a positive budget becomes a
  // BudgetCategory whose plannedVnd = Σ row budgets. The project cap = Σ all row budgets.
  const categoryBudget = new Map<string, bigint>();
  let totalBudgetVnd = 0n;

  for (const row of seed.rows) {
    const cat = stringOf(safeGet(row, idx, 'category'));
    const b = parseMoney(safeGet(row, idx, 'budgetVnd') ?? safeGet(row, idx, 'budget'));
    totalBudgetVnd += b;
    if (cat && b > 0n) categoryBudget.set(cat, (categoryBudget.get(cat) ?? 0n) + b);
  }

  const rankedCats = [...categoryBudget.entries()].sort((a, b) =>
    b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
  );
  const categoryIdByName = new Map<string, string>();
  for (let i = 0; i < rankedCats.length; i++) {
    const [name, planned] = rankedCats[i]!;
    const cat = await prisma.budgetCategory.upsert({
      where: { projectId_name: { projectId, name } },
      update: { plannedVnd: planned, order: i },
      create: { projectId, name, plannedVnd: planned, order: i },
    });
    categoryIdByName.set(name, cat.id);
  }
  result.budgetCategoriesCreated = rankedCats.length;
  await prisma.project.update({
    where: { id: projectId },
    data: { budgetCapVnd: totalBudgetVnd },
  });
  result.budgetCapVnd = Number(totalBudgetVnd);

  // ── Row loop ──────────────────────────────────────────────────────────────────
  // PERF (Phase 7): batch this loop; consider maxDuration
  for (const row of seed.rows) {
    const code = stringOf(safeGet(row, idx, 'id') ?? safeGet(row, idx, 'code'));
    if (!code) continue;

    const projectKey = stringOf(safeGet(row, idx, 'project') ?? safeGet(row, idx, 'workstream')) ?? 'PMO';
    const phaseName = stringOf(safeGet(row, idx, 'phase'));
    const title = stringOf(safeGet(row, idx, 'title')) ?? '(untitled)';
    const description = stringOf(safeGet(row, idx, 'description'));
    const category = stringOf(safeGet(row, idx, 'category'));
    const inCharge = stringOf(safeGet(row, idx, 'inCharge'));
    const support = stringOf(safeGet(row, idx, 'support'));
    const approver = stringOf(safeGet(row, idx, 'approver'));
    const start = parseDate(safeGet(row, idx, 'startDate') ?? safeGet(row, idx, 'start'));
    const deadline = parseDate(safeGet(row, idx, 'deadline'));
    const duration = parseIntVal(safeGet(row, idx, 'durationDays') ?? safeGet(row, idx, 'duration'));
    const prioRaw = stringOf(safeGet(row, idx, 'priority'));
    const statusRaw = stringOf(safeGet(row, idx, 'status'));
    const percent = clampInt(parseIntVal(safeGet(row, idx, 'percent')) ?? 0, 0, 100);
    const budget = parseMoney(safeGet(row, idx, 'budgetVnd') ?? safeGet(row, idx, 'budget'));
    const actual = parseMoney(safeGet(row, idx, 'actualVnd') ?? safeGet(row, idx, 'actual'));
    const kpi = stringOf(safeGet(row, idx, 'kpi'));
    const deliverable = stringOf(safeGet(row, idx, 'deliverable'));
    const dependencyText = stringOf(safeGet(row, idx, 'dependency') ?? safeGet(row, idx, 'dependencyText'));
    const riskText = stringOf(safeGet(row, idx, 'risk') ?? safeGet(row, idx, 'riskText'));
    const audience = stringOf(safeGet(row, idx, 'audience'));
    const notes = stringOf(safeGet(row, idx, 'notes'));

    // Resolve / create workstream by track.
    const track = TRACK_MAP[projectKey] ?? 'PMO';
    let wsId = wsCache.get(track);
    if (!wsId) {
      const created = await prisma.workstream.create({
        data: { projectId, name: humanWorkstreamName(track), track, order: trackOrder(track) },
      });
      wsId = created.id;
      wsCache.set(track, wsId);
      result.workstreamsCreated++;
    }

    // Resolve / create phase by name (only when provided).
    let phaseId: string | null = null;
    if (phaseName) {
      const cached = phaseCache.get(phaseName);
      if (cached) {
        phaseId = cached;
      } else {
        const created = await prisma.phase.create({
          data: { projectId, name: phaseName, order: phaseCache.size },
        });
        phaseId = created.id;
        phaseCache.set(phaseName, phaseId);
        result.phasesCreated++;
      }
    }

    const status = mapStatus(statusRaw, unknownStatusSet);
    const priority = mapPriority(prioRaw, unknownPrioSet);
    const finalPercent = status === 'COMPLETED' ? 100 : percent;

    const data = {
      projectId,
      code,
      title,
      description: description ?? null,
      phaseId,
      workstreamId: wsId,
      category: category ?? null,
      budgetCategoryId: category ? (categoryIdByName.get(category) ?? null) : null,
      startDate: start,
      deadline,
      durationDays: duration ?? null,
      priority,
      status,
      percent: finalPercent,
      budgetVnd: budget,
      actualVnd: actual,
      kpi: kpi ?? null,
      deliverable: deliverable ?? null,
      dependencyText: dependencyText ?? null,
      riskText: riskText ?? null,
      audience: audience ?? null,
      notes: notes ?? null,
      inChargeLabel: inCharge ?? null,
      updatedById: ctx.userId,
      createdById: ctx.userId,
    };

    const existing = await prisma.task.findFirst({
      where: { projectId, code },
      select: { id: true },
    });

    let taskId: string;
    if (existing) {
      await prisma.task.update({ where: { id: existing.id }, data });
      taskId = existing.id;
      result.updated++;
    } else {
      const created = await prisma.task.create({ data });
      taskId = created.id;
      result.inserted++;
    }
    result.total++;

    // Rewrite assignments from scratch each import (label-set rarely changes; cheap).
    await prisma.taskAssignment.deleteMany({ where: { taskId } });
    const assignmentRows: Array<{
      taskId: string;
      label: string;
      role: 'IN_CHARGE' | 'SUPPORT' | 'APPROVER';
      userId: string | null;
    }> = [];
    if (inCharge) {
      assignmentRows.push({
        taskId,
        label: inCharge,
        role: 'IN_CHARGE',
        userId: memberLabelCache.get(inCharge.toLowerCase()) ?? null,
      });
    }
    if (support) {
      assignmentRows.push({
        taskId,
        label: support,
        role: 'SUPPORT',
        userId: memberLabelCache.get(support.toLowerCase()) ?? null,
      });
    }
    if (approver) {
      assignmentRows.push({
        taskId,
        label: approver,
        role: 'APPROVER',
        userId: memberLabelCache.get(approver.toLowerCase()) ?? null,
      });
    }
    if (assignmentRows.length > 0) {
      await prisma.taskAssignment.createMany({ data: assignmentRows });
    }
  }

  result.unknownStatuses = [...unknownStatusSet];
  result.unknownPriorities = [...unknownPrioSet];

  await auditRecord(
    { actorId: ctx.userId, projectId, ip },
    {
      action: 'import.packedSeed',
      entityType: 'Project',
      entityId: projectId,
      after: { ...result },
    },
  );

  if (result.unknownStatuses.length || result.unknownPriorities.length) {
    console.warn(
      `Import for project ${projectId} encountered unknown status/priority labels: ` +
        `statuses=${result.unknownStatuses.join(',')} priorities=${result.unknownPriorities.join(',')}`,
    );
  }
  return result;
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export async function exportProject(ctx: AuthContext, projectId: string): Promise<Record<string, unknown>> {
  await assertCan(ctx, 'IMPORT_EXPORT', projectId);

  const [project, phases, workstreams, statuses, priorities, budgets, members, tasks] =
    await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.phase.findMany({ where: { projectId } }),
      prisma.workstream.findMany({ where: { projectId } }),
      prisma.statusDef.findMany({ where: { projectId } }),
      prisma.priorityDef.findMany({ where: { projectId } }),
      prisma.budgetCategory.findMany({ where: { projectId } }),
      prisma.projectMember.findMany({ where: { projectId } }),
      prisma.task.findMany({
        where: { projectId },
        include: { assignments: true, dependencies: true },
      }),
    ]);

  if (!project) throw new BadRequest('Project not found');

  return {
    project: { ...project, budgetCapVnd: moneyToNumber(project.budgetCapVnd) },
    phases,
    workstreams,
    statuses,
    priorities,
    budgetCategories: budgets.map((b) => ({
      ...b,
      plannedVnd: moneyToNumber(b.plannedVnd),
      actualVnd: moneyToNumber(b.actualVnd),
    })),
    members,
    tasks: tasks.map((t) => ({
      ...t,
      budgetVnd: moneyToNumber(t.budgetVnd),
      actualVnd: moneyToNumber(t.actualVnd),
    })),
  };
}

export async function exportTasksCsv(ctx: AuthContext, projectId: string): Promise<string> {
  await assertCan(ctx, 'IMPORT_EXPORT', projectId);

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: { assignments: true, phase: true, workstream: true },
    orderBy: { code: 'asc' },
  });

  const header = [
    'code', 'title', 'phase', 'workstream', 'status', 'priority', 'percent',
    'startDate', 'deadline', 'budgetVnd', 'actualVnd', 'inCharge',
  ];
  const lines = [header.join(',')];

  for (const t of tasks) {
    const inCharge = t.assignments.find((a) => a.role === 'IN_CHARGE')?.label ?? '';
    lines.push(
      [
        csv(t.code),
        csv(t.title),
        csv(t.phase?.name ?? ''),
        csv(t.workstream?.name ?? ''),
        t.status,
        t.priority,
        String(t.percent),
        t.startDate?.toISOString().slice(0, 10) ?? '',
        t.deadline?.toISOString().slice(0, 10) ?? '',
        String(moneyToNumber(t.budgetVnd)),
        String(moneyToNumber(t.actualVnd)),
        csv(inCharge),
      ].join(','),
    );
  }

  return lines.join('\n');
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build an indexer from seed columns. Returns undefined (not an error) when column
 * is missing — the row loop uses safeGet with fallbacks for optional/renamed cols.
 */
function indexer(cols: string[]): (name: string) => number | undefined {
  const map = new Map(cols.map((c, i) => [c, i]));
  return (name: string) => map.get(name);
}

/**
 * Safe column accessor: returns the row value if the column exists, else undefined.
 */
function safeGet(
  row: (string | number | null)[],
  idx: (name: string) => number | undefined,
  name: string,
): string | number | null | undefined {
  const i = idx(name);
  if (i === undefined) return undefined;
  return row[i];
}

function stringOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseIntVal(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseDate(v: unknown): Date | null {
  const s = stringOf(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseMoney(v: unknown): bigint {
  if (v === null || v === undefined || v === '') return 0n;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0n;
  return BigInt(Math.trunc(n));
}

function mapStatus(raw: string | null, unknown: Set<string>): TaskStatus {
  if (!raw) return 'NOT_STARTED';
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  const m = STATUS_MAP.get(raw.toLowerCase()) ?? STATUS_MAP.get(key);
  if (m) return m;
  unknown.add(raw);
  return 'NOT_STARTED';
}

function mapPriority(raw: string | null, unknown: Set<string>): Priority {
  if (!raw) return 'MEDIUM';
  const m = PRIORITY_MAP.get(raw.toLowerCase());
  if (m) return m;
  unknown.add(raw);
  return 'MEDIUM';
}

function humanWorkstreamName(track: WorkstreamTrack): string {
  return track === 'MARKETING'
    ? 'Marketing · PR · Sales'
    : track === 'OPERATIONS'
      ? 'Operations · SOP'
      : 'PMO';
}

function trackOrder(track: WorkstreamTrack): number {
  return track === 'PMO' ? 0 : track === 'MARKETING' ? 1 : 2;
}

function csv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

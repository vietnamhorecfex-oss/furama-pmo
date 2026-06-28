/**
 * T-05 — ImportExportService.
 *
 * Packed seed format (docs/02 §6): { cols: string[], rows: (string|number|null)[][] }.
 * Mapping:
 *   row.project (PMO|MKT|OPS)  → Workstream.track (PMO|MARKETING|OPERATIONS)
 *                              + auto-create one Workstream per (project,track) if missing
 *   row.phase                  → Phase (auto-create on first sight)
 *   row.inCharge/support/approver → TaskAssignment rows; userId resolved later via memberLabel
 *   row.budget/actual          → BigInt VND
 *   row.code                   → row.id from the seed; idempotent upsert keyed on (projectId, code)
 *
 * Idempotency: re-running the import on the same project must yield the same row count.
 * We use upsert by (projectId, code) — duplicates update in place, missing rows insert.
 *
 * Statuses/priorities from the seed are free-text (e.g. "Not Started", "High"). We translate
 * them to the Prisma enum before write. Unknown labels default to NOT_STARTED / MEDIUM and
 * are reported in the result so the caller can fix the source.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma, WorkstreamTrack } from '@prisma/client';
import {
  packedSeedSchema,
  type PackedSeed,
  type Priority,
  type TaskStatus,
} from '@furama/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RbacService, type AuthContext } from '../rbac/rbac.service';

export interface ImportResult {
  inserted: number;
  updated: number;
  total: number;
  workstreamsCreated: number;
  phasesCreated: number;
  unknownStatuses: string[];
  unknownPriorities: string[];
}

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

@Injectable()
export class ImportExportService {
  private readonly logger = new Logger(ImportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ====================================================================== IMPORT
  async importPackedSeed(
    ctx: AuthContext,
    projectId: string,
    raw: unknown,
    ip: string | null,
  ): Promise<ImportResult> {
    await this.rbac.assertCan(ctx, 'IMPORT_EXPORT', projectId);

    const parsed = packedSeedSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(`Invalid packed-seed payload: ${parsed.error.message}`);
    }
    const seed: PackedSeed = parsed.data;
    const idx = indexer(seed.cols);

    // Pre-resolve known per-project rows so the row loop does only O(rows) DB ops.
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException('Project not found');

    const phaseCache = new Map<string, string>(); // phase name → id
    const wsCache = new Map<WorkstreamTrack, string>(); // track → workstream id
    const memberLabelCache = new Map<string, string>(); // memberLabel → userId

    for (const p of await this.prisma.phase.findMany({ where: { projectId } })) {
      phaseCache.set(p.name, p.id);
    }
    for (const w of await this.prisma.workstream.findMany({ where: { projectId } })) {
      wsCache.set(w.track, w.id);
    }
    for (const m of await this.prisma.projectMember.findMany({
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
      unknownStatuses: [],
      unknownPriorities: [],
    };
    const unknownStatusSet = new Set<string>();
    const unknownPrioSet = new Set<string>();

    for (const row of seed.rows) {
      const code = stringOf(row[idx('id')]);
      if (!code) continue;
      const projectKey = stringOf(row[idx('project')]) ?? 'PMO';
      const phaseName = stringOf(row[idx('phase')]);
      const title = stringOf(row[idx('title')]) ?? '(untitled)';
      const description = stringOf(row[idx('description')]);
      const category = stringOf(row[idx('category')]);
      const inCharge = stringOf(row[idx('inCharge')]);
      const support = stringOf(row[idx('support')]);
      const approver = stringOf(row[idx('approver')]);
      const start = parseDate(row[idx('start')]);
      const deadline = parseDate(row[idx('deadline')]);
      const duration = parseInt(row[idx('duration')]);
      const prioRaw = stringOf(row[idx('priority')]);
      const statusRaw = stringOf(row[idx('status')]);
      const percent = clampInt(parseInt(row[idx('percent')]) ?? 0, 0, 100);
      const budget = parseMoney(row[idx('budget')]);
      const actual = parseMoney(row[idx('actual')]);
      const kpi = stringOf(row[idx('kpi')]);
      const deliverable = stringOf(row[idx('deliverable')]);
      const dependencyText = stringOf(row[idx('dependency')]);
      const riskText = stringOf(row[idx('risk')]);
      const audience = stringOf(row[idx('audience')]);
      const notes = stringOf(row[idx('notes')]);

      // Resolve / create workstream by track.
      const track = TRACK_MAP[projectKey] ?? 'PMO';
      let wsId = wsCache.get(track);
      if (!wsId) {
        const created = await this.prisma.workstream.create({
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
        if (cached) phaseId = cached;
        else {
          const created = await this.prisma.phase.create({
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

      const data: Prisma.TaskUncheckedUpdateInput & Prisma.TaskUncheckedCreateInput = {
        projectId,
        code,
        title,
        description: description ?? null,
        phaseId,
        workstreamId: wsId,
        category: category ?? null,
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

      const existing = await this.prisma.task.findFirst({
        where: { projectId, code },
        select: { id: true },
      });

      let taskId: string;
      if (existing) {
        await this.prisma.task.update({ where: { id: existing.id }, data });
        taskId = existing.id;
        result.updated++;
      } else {
        const created = await this.prisma.task.create({ data });
        taskId = created.id;
        result.inserted++;
      }
      result.total++;

      // Rewrite assignments from scratch each import (label-set rarely changes; cheap).
      await this.prisma.taskAssignment.deleteMany({ where: { taskId } });
      const assignmentRows: Prisma.TaskAssignmentCreateManyInput[] = [];
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
        await this.prisma.taskAssignment.createMany({ data: assignmentRows });
      }
    }

    result.unknownStatuses = [...unknownStatusSet];
    result.unknownPriorities = [...unknownPrioSet];

    await this.audit.record(
      { actorId: ctx.userId, projectId, ip },
      {
        action: 'import.packedSeed',
        entityType: 'Project',
        entityId: projectId,
        after: { ...result },
      },
    );

    if (result.unknownStatuses.length || result.unknownPriorities.length) {
      this.logger.warn(
        `Import for project ${projectId} encountered unknown status/priority labels: ` +
          `statuses=${result.unknownStatuses.join(',')} priorities=${result.unknownPriorities.join(',')}`,
      );
    }
    return result;
  }

  // ====================================================================== EXPORT
  async exportProject(ctx: AuthContext, projectId: string) {
    await this.rbac.assertCan(ctx, 'IMPORT_EXPORT', projectId);
    const [project, phases, workstreams, statuses, priorities, budgets, members, tasks] =
      await Promise.all([
        this.prisma.project.findUnique({ where: { id: projectId } }),
        this.prisma.phase.findMany({ where: { projectId } }),
        this.prisma.workstream.findMany({ where: { projectId } }),
        this.prisma.statusDef.findMany({ where: { projectId } }),
        this.prisma.priorityDef.findMany({ where: { projectId } }),
        this.prisma.budgetCategory.findMany({ where: { projectId } }),
        this.prisma.projectMember.findMany({ where: { projectId } }),
        this.prisma.task.findMany({
          where: { projectId },
          include: { assignments: true, dependencies: true },
        }),
      ]);
    if (!project) throw new BadRequestException('Project not found');
    return {
      project: { ...project, budgetCapVnd: Number(project.budgetCapVnd) },
      phases,
      workstreams,
      statuses,
      priorities,
      budgetCategories: budgets.map((b) => ({ ...b, plannedVnd: Number(b.plannedVnd) })),
      members,
      tasks: tasks.map((t) => ({
        ...t,
        budgetVnd: Number(t.budgetVnd),
        actualVnd: Number(t.actualVnd),
      })),
    };
  }

  async exportTasksCsv(ctx: AuthContext, projectId: string): Promise<string> {
    await this.rbac.assertCan(ctx, 'IMPORT_EXPORT', projectId);
    const tasks = await this.prisma.task.findMany({
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
          String(Number(t.budgetVnd)),
          String(Number(t.actualVnd)),
          csv(inCharge),
        ].join(','),
      );
    }
    return lines.join('\n');
  }
}

// =========================================================================
// helpers
function indexer(cols: string[]): (name: string) => number {
  const map = new Map(cols.map((c, i) => [c, i]));
  return (name: string) => {
    const i = map.get(name);
    if (i === undefined) throw new BadRequestException(`Seed is missing required column "${name}"`);
    return i;
  };
}
function stringOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function parseInt(v: unknown): number | null {
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
  return track === 'MARKETING' ? 'Marketing · PR · Sales' : track === 'OPERATIONS' ? 'Operations · SOP' : 'PMO';
}
function trackOrder(track: WorkstreamTrack): number {
  return track === 'PMO' ? 0 : track === 'MARKETING' ? 1 : 2;
}
function csv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

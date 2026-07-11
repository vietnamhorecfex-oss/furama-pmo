/**
 * web/server port of backend DashboardService (backend/src/dashboard/dashboard.service.ts).
 * Mechanical transforms applied:
 *  - NestJS class → module functions
 *  - this.prisma → singleton import { prisma }
 *  - NotFoundException → NotFound from ../http/errors
 *  - this.rbac.assertCan → assertCan from ../rbac/rbac
 *  - this.budget.summary(ctx, projectId) → budgetSummary(ctx, projectId) from ../budget/budget
 *
 * Key computation semantics (do NOT change):
 *  - "Overdue" = deadline DAY has passed (date-only, UTC) AND status != COMPLETED
 *  - "At risk" = deadline within 7 days AND status = NOT_STARTED (strict: not in-progress)
 *  - "Upcoming deadlines" = deadline in [now, now+14d] AND not completed, ordered by deadline asc, take 12
 *  - byPhase/byWorkstream: join completed/total maps; append id:null "Unassigned" bucket if it has tasks
 *  - daysLeft = ceil((deadline - now) / 86400000)
 *  - daysToOpening = project.openingDate ? ceil((opening - now) / 86400000) : null
 *  - Run main $transaction and budgetSummary concurrently via Promise.all (both read-only)
 *  - No audit.
 *
 * PERF (Phase 7): dashboard fans out ~13 queries per request (plus budgetSummary's 5).
 * Consider consolidating or adding Vercel maxDuration if needed on Vercel Functions.
 */
import type { DashboardOverview, Priority, ProgressGroup, TaskStatus, UpcomingDeadline } from '@furama/shared';
import { prisma } from '../prisma';
import { assertCan } from '../rbac/rbac';
import type { AuthContext } from '../rbac/rbac';
import { NotFound } from '../http/errors';
import { budgetSummary } from '../budget/budget';
import { startOfTodayUtc } from '../../lib/schedule';

const ALL_STATUSES: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
const ALL_PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Compute the full dashboard overview for a project.
 * Requires VIEW_PROJECT. No audit written (read-only).
 */
export async function dashboardOverview(ctx: AuthContext, projectId: string): Promise<DashboardOverview> {
  await assertCan(ctx, 'VIEW_PROJECT', projectId);

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFound('Project not found');

  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Run the main aggregation $transaction and budgetSummary concurrently (both read-only).
  const [txResult, budget] = await Promise.all([
    prisma.$transaction([
      // 1. total task count
      prisma.task.count({ where: { projectId } }),
      // 2. groupBy status
      prisma.task.groupBy({
        by: ['status'],
        where: { projectId },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      // 3. groupBy priority
      prisma.task.groupBy({
        by: ['priority'],
        where: { projectId },
        _count: { _all: true },
        orderBy: { priority: 'asc' },
      }),
      // 4. overdue count: deadline DAY has passed AND status != COMPLETED (date-only: a task due
      //    today is not overdue until tomorrow — matches the client health chips / Kanban).
      prisma.task.count({
        where: { projectId, deadline: { lt: startOfTodayUtc(now) }, NOT: { status: 'COMPLETED' } },
      }),
      // 5. atRisk count: deadline in [now, now+7d] AND status = NOT_STARTED (strict)
      prisma.task.count({
        where: { projectId, deadline: { gte: now, lte: in7Days }, status: 'NOT_STARTED' },
      }),
      // 6. avg percent (overallPercent)
      prisma.task.aggregate({ where: { projectId }, _avg: { percent: true } }),
      // 7. groupBy phaseId total
      prisma.task.groupBy({
        by: ['phaseId'],
        where: { projectId },
        _count: { _all: true },
        orderBy: { phaseId: 'asc' },
      }),
      // 8. groupBy phaseId completed
      prisma.task.groupBy({
        by: ['phaseId'],
        where: { projectId, status: 'COMPLETED' },
        _count: { _all: true },
        orderBy: { phaseId: 'asc' },
      }),
      // 9. groupBy workstreamId total
      prisma.task.groupBy({
        by: ['workstreamId'],
        where: { projectId },
        _count: { _all: true },
        orderBy: { workstreamId: 'asc' },
      }),
      // 10. groupBy workstreamId completed
      prisma.task.groupBy({
        by: ['workstreamId'],
        where: { projectId, status: 'COMPLETED' },
        _count: { _all: true },
        orderBy: { workstreamId: 'asc' },
      }),
      // 11. phases ordered
      prisma.phase.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
      // 12. workstreams ordered
      prisma.workstream.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
      // 13. upcoming tasks: deadline in [now, now+14d], not completed
      prisma.task.findMany({
        where: {
          projectId,
          deadline: { gte: now, lte: in14Days },
          NOT: { status: 'COMPLETED' },
        },
        orderBy: { deadline: 'asc' },
        take: 12,
        select: { id: true, code: true, title: true, deadline: true, status: true },
      }),
    ]),
    budgetSummary(ctx, projectId),
  ]);

  const [
    total,
    byStatusRows,
    byPriorityRows,
    overdue,
    atRisk,
    percentAgg,
    byPhaseRows,
    byPhaseCompleted,
    byWsRows,
    byWsCompleted,
    phases,
    workstreams,
    upcomingRows,
  ] = txResult;

  // Build status and priority maps
  const byStatus: Record<TaskStatus, number> = blankCounts(ALL_STATUSES);
  for (const r of byStatusRows) byStatus[r.status] = countAll(r._count);

  const byPriority: Record<Priority, number> = blankCounts(ALL_PRIORITIES);
  for (const r of byPriorityRows) byPriority[r.priority] = countAll(r._count);

  // Build byPhase progress groups
  const phaseCompletedById = mapCount(byPhaseCompleted, 'phaseId');
  const phaseTotalById = mapCount(byPhaseRows, 'phaseId');
  const byPhase: ProgressGroup[] = phases.map((p) => {
    const t = phaseTotalById.get(p.id) ?? 0;
    const c = phaseCompletedById.get(p.id) ?? 0;
    return { id: p.id, name: p.name, total: t, completed: c, percent: pct(c, t) };
  });
  // Append the id:null "Unassigned phase" bucket if any tasks lack a phase
  const phasesWithoutAssignment = phaseTotalById.get(null) ?? 0;
  if (phasesWithoutAssignment > 0) {
    const c = phaseCompletedById.get(null) ?? 0;
    byPhase.push({
      id: null,
      name: 'Unassigned phase',
      total: phasesWithoutAssignment,
      completed: c,
      percent: pct(c, phasesWithoutAssignment),
    });
  }

  // Build byWorkstream progress groups
  const wsCompletedById = mapCount(byWsCompleted, 'workstreamId');
  const wsTotalById = mapCount(byWsRows, 'workstreamId');
  const byWorkstream: ProgressGroup[] = workstreams.map((w) => {
    const t = wsTotalById.get(w.id) ?? 0;
    const c = wsCompletedById.get(w.id) ?? 0;
    return { id: w.id, name: w.name, total: t, completed: c, percent: pct(c, t) };
  });

  // Build upcomingDeadlines
  const upcomingDeadlines: UpcomingDeadline[] = upcomingRows
    .filter((r): r is typeof r & { deadline: Date } => r.deadline !== null)
    .map((r) => ({
      taskId: r.id,
      code: r.code,
      title: r.title,
      deadline: r.deadline.toISOString(),
      daysLeft: Math.ceil((r.deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      status: r.status,
    }));

  const daysToOpening = project.openingDate
    ? Math.ceil((project.openingDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  return {
    projectId,
    projectName: project.name,
    openingDate: project.openingDate ? project.openingDate.toISOString() : null,
    daysToOpening,
    health: {
      total,
      byStatus,
      byPriority,
      overdue,
      atRisk,
      overallPercent: Math.round(percentAgg._avg.percent ?? 0),
    },
    byPhase,
    byWorkstream,
    upcomingDeadlines,
    budget,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function blankCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

function countAll(c: unknown): number {
  if (typeof c === 'number') return c;
  if (c && typeof c === 'object' && '_all' in c && typeof (c as { _all: unknown })._all === 'number') {
    return (c as { _all: number })._all;
  }
  return 0;
}

function mapCount<R extends Record<string, unknown>>(
  rows: R[],
  field: keyof R,
): Map<string | null, number> {
  const m = new Map<string | null, number>();
  for (const r of rows) {
    m.set((r[field] ?? null) as string | null, countAll((r as { _count?: unknown })._count));
  }
  return m;
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100);
}

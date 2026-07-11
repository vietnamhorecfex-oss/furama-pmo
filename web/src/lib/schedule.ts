/**
 * Schedule health — compares actual % against the % a task *should* be at given how much
 * of its start→deadline window has elapsed. Drives the progress indicators (ahead / on track /
 * behind / overdue) in the Tasks table and elsewhere.
 */
export type Health = 'DONE' | 'AHEAD' | 'ON_TRACK' | 'BEHIND' | 'OVERDUE' | 'NONE';

export interface SchedulableTask {
  status: string;
  percent: number;
  startDate: string | null;
  deadline: string | null;
}

/** Tolerance band (percentage points) around expected progress that still counts as on-track. */
const ON_TRACK_BAND = 10;

/**
 * True once a (date-only) deadline's whole DAY has passed. Deadlines are stored at UTC midnight,
 * so we compare against the start of today in UTC — a task due today is NOT overdue during its own
 * deadline day (the old `deadline < now` flagged it late from ~07:00 Vietnam time on the due date).
 */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isPastDeadline(deadline: string | Date | null, now: Date = new Date()): boolean {
  if (!deadline) return false;
  const d = typeof deadline === 'string' ? new Date(deadline) : deadline;
  return d.getTime() < startOfTodayUtc(now).getTime();
}

export function scheduleHealth(t: SchedulableTask, now: Date = new Date()): Health {
  if (t.status === 'COMPLETED' || t.percent >= 100) return 'DONE';
  if (!t.deadline) return 'NONE';

  const deadline = new Date(t.deadline);
  // Past the deadline DAY and not done → late, regardless of how much is left.
  if (isPastDeadline(t.deadline, now)) return 'OVERDUE';

  // No start date: can't model a curve. Treat as on track until the deadline passes.
  if (!t.startDate) return 'ON_TRACK';

  const start = new Date(t.startDate);
  const totalMs = deadline.getTime() - start.getTime();

  // Hasn't reached its scheduled start yet → on track (nothing is due).
  if (now.getTime() <= start.getTime()) return 'ON_TRACK';

  // Single-day (or inverted) window that has started but not passed deadline.
  if (totalMs <= 0) return t.percent > 0 ? 'ON_TRACK' : 'BEHIND';

  const expected = Math.min(100, ((now.getTime() - start.getTime()) / totalMs) * 100);
  const delta = t.percent - expected;
  if (delta >= ON_TRACK_BAND) return 'AHEAD';
  if (delta <= -ON_TRACK_BAND) return 'BEHIND';
  return 'ON_TRACK';
}

export const HEALTH_STYLE: Record<Health, { dot: string; chip: string }> = {
  DONE:     { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700' },
  AHEAD:    { dot: 'bg-green-500',   chip: 'bg-green-100 text-green-700' },
  ON_TRACK: { dot: 'bg-blue-500',    chip: 'bg-blue-100 text-blue-700' },
  BEHIND:   { dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800' },
  OVERDUE:  { dot: 'bg-red-500',     chip: 'bg-red-100 text-red-700' },
  NONE:     { dot: 'bg-slate-300',   chip: 'bg-slate-100 text-slate-500' },
};

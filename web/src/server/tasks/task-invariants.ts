/**
 * T-02 — Status/percent invariants (docs/03 §M-PROGRESS, §M-TASK §4).
 *
 * Pure function — no DB, no I/O. Called by tasks service update/updateProgress and
 * the Kanban move handler. Verbatim port from backend/src/tasks/task-invariants.ts.
 *
 *   status=COMPLETED            ⇒ percent=100
 *   percent=100                 ⇒ status=COMPLETED
 *   0<percent<100 & NOT_STARTED ⇒ status=IN_PROGRESS
 *   NOT_STARTED (forced)        ⇒ percent=0
 *
 * Conflicts where both fields are user-provided and contradictory (e.g. status=COMPLETED
 * with percent=42) are flagged via the second return value so the service can throw a
 * BadRequest instead of silently overriding the caller's intent.
 */
import type { Priority, TaskStatus } from '@furama/shared';

export interface TaskFields {
  status: TaskStatus;
  percent: number;
}

export interface InvariantInput {
  current: TaskFields;
  next: Partial<TaskFields>;
  /** True if this is a Kanban drag (NOT_STARTED column reset semantics apply). */
  kanbanMove?: boolean;
}

export interface InvariantResult {
  /** Resolved final values after applying invariants. */
  resolved: TaskFields;
  /** True iff caller passed conflicting status+percent that we had to reconcile. */
  conflict: boolean;
}

export function applyTaskInvariants(input: InvariantInput): InvariantResult {
  const status = input.next.status ?? input.current.status;
  let percent = input.next.percent ?? input.current.percent;

  // Kanban / status-picker moves make the TARGET status authoritative; we derive percent to fit
  // the chosen column so the auto-rules below don't bounce the card straight back. This must run
  // BEFORE the rules. Without it: dragging a 40% card to NOT_STARTED re-promotes to IN_PROGRESS
  // (Rule 3), and reopening a done card (COMPLETED/100 → IN_PROGRESS) snaps back to COMPLETED
  // (Rule 2) — both observed as "the card won't move".
  if (input.kanbanMove && input.next.status !== undefined && input.next.percent === undefined) {
    if (input.next.status === 'NOT_STARTED') {
      percent = 0; // discard progress
    } else if (input.next.status !== 'COMPLETED' && percent >= 100) {
      percent = 0; // reopening a completed card → drop below 100 so it isn't re-completed
    }
  }

  let conflict = false;

  // Caller-supplied status=COMPLETED + percent != 100 (explicitly given) is a conflict.
  if (
    input.next.status === 'COMPLETED' &&
    input.next.percent !== undefined &&
    input.next.percent !== 100
  ) {
    conflict = true;
  }
  // Mirror case: percent=100 + status != COMPLETED (both explicitly given).
  if (
    input.next.percent === 100 &&
    input.next.status !== undefined &&
    input.next.status !== 'COMPLETED'
  ) {
    conflict = true;
  }

  // Rule 1: COMPLETED forces percent to 100.
  if (status === 'COMPLETED') {
    return { resolved: { status: 'COMPLETED', percent: 100 }, conflict };
  }

  // Rule 2: percent=100 forces COMPLETED.
  if (percent === 100) {
    return { resolved: { status: 'COMPLETED', percent: 100 }, conflict };
  }

  // Rule 3: 0 < percent < 100 with NOT_STARTED → IN_PROGRESS.
  if (status === 'NOT_STARTED' && percent > 0 && percent < 100) {
    return { resolved: { status: 'IN_PROGRESS', percent }, conflict };
  }

  return { resolved: { status, percent }, conflict };
}

/** Convenience: validate any priority string strictly against the enum. */
export function isPriority(value: unknown): value is Priority {
  return value === 'CRITICAL' || value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}

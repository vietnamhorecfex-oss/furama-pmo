/**
 * Pure unit tests for applyTaskInvariants — no DB, no I/O.
 * TDD: RED first, GREEN after task-invariants.ts is implemented.
 */
import { describe, it, expect } from 'vitest';
import { applyTaskInvariants } from './task-invariants';

describe('applyTaskInvariants', () => {
  // Rule 1: COMPLETED ⇒ percent=100
  it('COMPLETED forces percent=100', () => {
    const { resolved } = applyTaskInvariants({
      current: { status: 'NOT_STARTED', percent: 0 },
      next: { status: 'COMPLETED' },
    });
    expect(resolved.status).toBe('COMPLETED');
    expect(resolved.percent).toBe(100);
  });

  // Rule 2: percent=100 ⇒ COMPLETED
  it('percent=100 forces COMPLETED', () => {
    const { resolved } = applyTaskInvariants({
      current: { status: 'IN_PROGRESS', percent: 50 },
      next: { percent: 100 },
    });
    expect(resolved.status).toBe('COMPLETED');
    expect(resolved.percent).toBe(100);
  });

  // Rule 3: 0 < percent < 100 & NOT_STARTED ⇒ IN_PROGRESS
  it('0<percent<100 with NOT_STARTED promotes to IN_PROGRESS', () => {
    const { resolved } = applyTaskInvariants({
      current: { status: 'NOT_STARTED', percent: 0 },
      next: { percent: 40 },
    });
    expect(resolved.status).toBe('IN_PROGRESS');
    expect(resolved.percent).toBe(40);
  });

  // Kanban move: NOT_STARTED with no explicit percent → percent resets to 0
  it('kanbanMove + NOT_STARTED + no explicit percent resets percent to 0', () => {
    const { resolved } = applyTaskInvariants({
      current: { status: 'IN_PROGRESS', percent: 40 },
      next: { status: 'NOT_STARTED' },
      kanbanMove: true,
    });
    expect(resolved.status).toBe('NOT_STARTED');
    expect(resolved.percent).toBe(0);
  });

  // Conflict: COMPLETED + explicit percent≠100
  it('flags conflict when COMPLETED + explicit percent≠100', () => {
    const { conflict } = applyTaskInvariants({
      current: { status: 'NOT_STARTED', percent: 0 },
      next: { status: 'COMPLETED', percent: 50 },
    });
    expect(conflict).toBe(true);
  });

  // Conflict: percent=100 + explicit status≠COMPLETED
  it('flags conflict when percent=100 + explicit status≠COMPLETED', () => {
    const { conflict } = applyTaskInvariants({
      current: { status: 'NOT_STARTED', percent: 0 },
      next: { percent: 100, status: 'IN_PROGRESS' },
    });
    expect(conflict).toBe(true);
  });

  // No conflict when only status or only percent provided
  it('no conflict when only status=COMPLETED provided (percent assumed from current)', () => {
    const { conflict } = applyTaskInvariants({
      current: { status: 'IN_PROGRESS', percent: 50 },
      next: { status: 'COMPLETED' },
    });
    expect(conflict).toBe(false);
  });

  // Passthrough for non-conflicting non-edge case
  it('passes through IN_PROGRESS with 50 unchanged', () => {
    const { resolved, conflict } = applyTaskInvariants({
      current: { status: 'NOT_STARTED', percent: 0 },
      next: { status: 'IN_PROGRESS', percent: 50 },
    });
    expect(resolved.status).toBe('IN_PROGRESS');
    expect(resolved.percent).toBe(50);
    expect(conflict).toBe(false);
  });
});

import { applyTaskInvariants } from './task-invariants';

describe('task invariants', () => {
  const base = { current: { status: 'NOT_STARTED' as const, percent: 0 } };

  it('status=COMPLETED forces percent=100', () => {
    const r = applyTaskInvariants({ ...base, next: { status: 'COMPLETED' } });
    expect(r.resolved).toEqual({ status: 'COMPLETED', percent: 100 });
  });

  it('percent=100 forces status=COMPLETED', () => {
    const r = applyTaskInvariants({ ...base, next: { percent: 100 } });
    expect(r.resolved).toEqual({ status: 'COMPLETED', percent: 100 });
  });

  it('0<percent<100 + NOT_STARTED → IN_PROGRESS', () => {
    const r = applyTaskInvariants({ ...base, next: { percent: 25 } });
    expect(r.resolved).toEqual({ status: 'IN_PROGRESS', percent: 25 });
  });

  it('partial percent does not touch a non-NOT_STARTED status', () => {
    const r = applyTaskInvariants({
      current: { status: 'BLOCKED', percent: 10 },
      next: { percent: 50 },
    });
    expect(r.resolved).toEqual({ status: 'BLOCKED', percent: 50 });
  });

  it('Kanban move to NOT_STARTED resets percent to 0', () => {
    const r = applyTaskInvariants({
      current: { status: 'IN_PROGRESS', percent: 40 },
      next: { status: 'NOT_STARTED' },
      kanbanMove: true,
    });
    expect(r.resolved).toEqual({ status: 'NOT_STARTED', percent: 0 });
  });

  it('flags a conflict when caller passes COMPLETED + percent != 100', () => {
    const r = applyTaskInvariants({ ...base, next: { status: 'COMPLETED', percent: 42 } });
    expect(r.conflict).toBe(true);
    expect(r.resolved).toEqual({ status: 'COMPLETED', percent: 100 }); // we still resolve consistently
  });

  it('flags a conflict when caller passes percent=100 + status != COMPLETED', () => {
    const r = applyTaskInvariants({ ...base, next: { status: 'BLOCKED', percent: 100 } });
    expect(r.conflict).toBe(true);
  });
});

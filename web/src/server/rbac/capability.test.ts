import { describe, it, expect } from 'vitest';
import { roleHasCapability } from './capability';

describe('CAPABILITY_MATRIX', () => {
  it('OWNER can ARCHIVE_PROJECT but PM cannot', () => {
    expect(roleHasCapability('OWNER', 'ARCHIVE_PROJECT')).toBe(true);
    expect(roleHasCapability('PM', 'ARCHIVE_PROJECT')).toBe(false);
  });
  it('LEAD EDIT_TASK is scope-gated; VIEWER cannot comment', () => {
    expect(roleHasCapability('LEAD', 'EDIT_TASK')).toBe('scope');
    expect(roleHasCapability('VIEWER', 'COMMENT_TASK')).toBe(false);
  });
  it('MEMBER UPDATE_TASK_PROGRESS is scope-gated', () => {
    expect(roleHasCapability('MEMBER', 'UPDATE_TASK_PROGRESS')).toBe('scope');
  });
});

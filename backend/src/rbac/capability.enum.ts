/**
 * A-08 — Capability enum. Re-exports the shared list and provides the role→capability
 * matrix from docs/03 §2 (authoritative). Tests in rbac.service.spec.ts assert every cell.
 *
 * `'scope'` means the capability is granted only when the caller's role-scope matches the
 * resource (LEAD: workstream match; MEMBER: assignee match). Pure boolean checks should use
 * `roleHasCapability(role, capability) === true`; scope-aware checks live in RbacService.
 */
import { Capability, MemberRole } from '@furama/shared';

export { Capability } from '@furama/shared';

export type CapabilityGrant = true | 'scope' | false;

/**
 * Authoritative role × capability matrix. Mirrors docs/03 §2.
 *  true   = always allowed
 *  'scope'= allowed only within own scope (LEAD: assigned workstream; MEMBER: assignee)
 *  false  = denied
 */
export const CAPABILITY_MATRIX: Record<MemberRole, Record<Capability, CapabilityGrant>> = {
  OWNER: {
    VIEW_PROJECT: true,
    COMMENT_TASK: true,
    UPDATE_TASK_PROGRESS: true,
    CREATE_TASK: true,
    EDIT_TASK: true,
    DELETE_TASK: true,
    MANAGE_BUDGET: true,
    MANAGE_MILESTONE: true,
    MANAGE_CONFIG: true,
    MANAGE_MEMBERS: true,
    IMPORT_EXPORT: true,
    ARCHIVE_PROJECT: true,
    VIEW_AUDIT: true,
  },
  PM: {
    VIEW_PROJECT: true,
    COMMENT_TASK: true,
    UPDATE_TASK_PROGRESS: true,
    CREATE_TASK: true,
    EDIT_TASK: true,
    DELETE_TASK: true,
    MANAGE_BUDGET: true,
    MANAGE_MILESTONE: true,
    MANAGE_CONFIG: true,
    MANAGE_MEMBERS: true,
    IMPORT_EXPORT: true,
    ARCHIVE_PROJECT: false, // OWNER only (docs/03 §2)
    VIEW_AUDIT: true,
  },
  LEAD: {
    VIEW_PROJECT: true,
    COMMENT_TASK: true,
    UPDATE_TASK_PROGRESS: 'scope',
    CREATE_TASK: 'scope',
    EDIT_TASK: 'scope',
    DELETE_TASK: false,
    MANAGE_BUDGET: false,
    MANAGE_MILESTONE: 'scope', // status update only — enforced in service layer
    MANAGE_CONFIG: false,
    MANAGE_MEMBERS: false,
    IMPORT_EXPORT: false,
    ARCHIVE_PROJECT: false,
    VIEW_AUDIT: 'scope',
  },
  MEMBER: {
    VIEW_PROJECT: true,
    COMMENT_TASK: true,
    UPDATE_TASK_PROGRESS: 'scope', // assignee-only
    CREATE_TASK: false,
    EDIT_TASK: false,
    DELETE_TASK: false,
    MANAGE_BUDGET: false,
    MANAGE_MILESTONE: false,
    MANAGE_CONFIG: false,
    MANAGE_MEMBERS: false,
    IMPORT_EXPORT: false,
    ARCHIVE_PROJECT: false,
    VIEW_AUDIT: false,
  },
  VIEWER: {
    VIEW_PROJECT: true,
    COMMENT_TASK: false,
    UPDATE_TASK_PROGRESS: false,
    CREATE_TASK: false,
    EDIT_TASK: false,
    DELETE_TASK: false,
    MANAGE_BUDGET: false,
    MANAGE_MILESTONE: false,
    MANAGE_CONFIG: false,
    MANAGE_MEMBERS: false,
    IMPORT_EXPORT: false,
    ARCHIVE_PROJECT: false,
    VIEW_AUDIT: false,
  },
};

/** Plain lookup — `true | 'scope' | false`. Use RbacService for scope resolution. */
export function roleHasCapability(role: MemberRole, capability: Capability): CapabilityGrant {
  return CAPABILITY_MATRIX[role][capability];
}

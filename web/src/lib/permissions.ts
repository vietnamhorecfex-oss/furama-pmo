'use client';
/**
 * Client-side mirror of the backend RBAC matrix (capability.enum.ts) for UI gating only.
 * The server is the source of truth and still enforces every write; this just hides/disables
 * actions a role can't perform so users don't hit avoidable 403s. 'scope' capabilities
 * (LEAD workstream / MEMBER assignee) are treated as allowed here — the server checks scope.
 */
import { useMembers } from '../features/team/useMembers';
import { useAuth } from './auth-store';

export type Role = 'OWNER' | 'PM' | 'LEAD' | 'MEMBER' | 'VIEWER';
export type Cap =
  | 'VIEW' | 'COMMENT' | 'UPDATE_PROGRESS' | 'EDIT_TASK' | 'DELETE_TASK'
  | 'MANAGE_MEMBERS' | 'MANAGE_CONFIG' | 'MANAGE_BUDGET' | 'MANAGE_MILESTONE' | 'IMPORT_EXPORT'
  | 'VIEW_AUDIT';

// true = allowed (scope-limited capabilities are `true` here; server enforces the scope).
// MANAGE_MILESTONE here gates full create/generate (Owner/PM); LEAD's setStatus-only scope
// is enforced server-side, so the status dropdown stays visible to all and 403s if denied.
const UI_MATRIX: Record<Role, Record<Cap, boolean>> = {
  OWNER:  { VIEW: true, COMMENT: true, UPDATE_PROGRESS: true, EDIT_TASK: true, DELETE_TASK: true,  MANAGE_MEMBERS: true,  MANAGE_CONFIG: true,  MANAGE_BUDGET: true,  MANAGE_MILESTONE: true,  IMPORT_EXPORT: true,  VIEW_AUDIT: true },
  PM:     { VIEW: true, COMMENT: true, UPDATE_PROGRESS: true, EDIT_TASK: true, DELETE_TASK: true,  MANAGE_MEMBERS: true,  MANAGE_CONFIG: true,  MANAGE_BUDGET: true,  MANAGE_MILESTONE: true,  IMPORT_EXPORT: true,  VIEW_AUDIT: true },
  LEAD:   { VIEW: true, COMMENT: true, UPDATE_PROGRESS: true, EDIT_TASK: true, DELETE_TASK: false, MANAGE_MEMBERS: false, MANAGE_CONFIG: false, MANAGE_BUDGET: false, MANAGE_MILESTONE: false, IMPORT_EXPORT: false, VIEW_AUDIT: true },
  MEMBER: { VIEW: true, COMMENT: true, UPDATE_PROGRESS: true, EDIT_TASK: false, DELETE_TASK: false, MANAGE_MEMBERS: false, MANAGE_CONFIG: false, MANAGE_BUDGET: false, MANAGE_MILESTONE: false, IMPORT_EXPORT: false, VIEW_AUDIT: false },
  VIEWER: { VIEW: true, COMMENT: false, UPDATE_PROGRESS: false, EDIT_TASK: false, DELETE_TASK: false, MANAGE_MEMBERS: false, MANAGE_CONFIG: false, MANAGE_BUDGET: false, MANAGE_MILESTONE: false, IMPORT_EXPORT: false, VIEW_AUDIT: false },
};

export function can(role: Role | null | undefined, cap: Cap): boolean {
  return role ? UI_MATRIX[role][cap] : false;
}

/** The current user's role in this project, derived from the members list (null until loaded). */
export function useMyRole(projectId: string | undefined): Role | null {
  const meId = useAuth((s) => s.user?.id);
  const members = useMembers(projectId);
  if (!meId) return null;
  return (members.data?.find((m) => m.userId === meId)?.role as Role | undefined) ?? null;
}

/** Convenience: returns a `can(cap)` bound to the current user's role in this project. */
export function usePermissions(projectId: string | undefined) {
  const role = useMyRole(projectId);
  return { role, can: (cap: Cap) => can(role, cap) };
}

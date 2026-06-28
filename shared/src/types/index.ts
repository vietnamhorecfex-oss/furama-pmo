/**
 * S-02 — Shared domain types (single source of truth for enums & DTO-facing types).
 * Mirrors prisma/schema.prisma enums (docs/02-data-model.md §3). Keep in sync.
 */

export const ProjectStatus = {
  PLANNING: 'PLANNING',
  ACTIVE: 'ACTIVE',
  OPENING: 'OPENING',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const MemberRole = {
  OWNER: 'OWNER',
  PM: 'PM',
  LEAD: 'LEAD',
  MEMBER: 'MEMBER',
  VIEWER: 'VIEWER',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const WorkstreamTrack = {
  PMO: 'PMO',
  MARKETING: 'MARKETING',
  OPERATIONS: 'OPERATIONS',
} as const;
export type WorkstreamTrack = (typeof WorkstreamTrack)[keyof typeof WorkstreamTrack];

export const TaskStatus = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const Priority = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];

export const AssignmentRole = {
  IN_CHARGE: 'IN_CHARGE',
  SUPPORT: 'SUPPORT',
  APPROVER: 'APPROVER',
} as const;
export type AssignmentRole = (typeof AssignmentRole)[keyof typeof AssignmentRole];

export const MilestoneType = {
  MILESTONE: 'MILESTONE',
  GATE: 'GATE',
} as const;
export type MilestoneType = (typeof MilestoneType)[keyof typeof MilestoneType];

export const GateStatus = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  FAILED: 'FAILED',
  NA: 'NA',
} as const;
export type GateStatus = (typeof GateStatus)[keyof typeof GateStatus];

/** RBAC capability identifiers — authoritative list mirrors docs/03 §2 RBAC matrix. */
export const Capability = {
  VIEW_PROJECT: 'VIEW_PROJECT',
  COMMENT_TASK: 'COMMENT_TASK',
  UPDATE_TASK_PROGRESS: 'UPDATE_TASK_PROGRESS',
  CREATE_TASK: 'CREATE_TASK',
  EDIT_TASK: 'EDIT_TASK',
  DELETE_TASK: 'DELETE_TASK',
  MANAGE_BUDGET: 'MANAGE_BUDGET',
  MANAGE_MILESTONE: 'MANAGE_MILESTONE',
  MANAGE_CONFIG: 'MANAGE_CONFIG',
  MANAGE_MEMBERS: 'MANAGE_MEMBERS',
  IMPORT_EXPORT: 'IMPORT_EXPORT',
  ARCHIVE_PROJECT: 'ARCHIVE_PROJECT',
  VIEW_AUDIT: 'VIEW_AUDIT',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

/** Standard API error envelope (docs/04 §4). */
export interface ApiError {
  error: {
    code:
      | 'VALIDATION'
      | 'UNAUTHORIZED'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'RATE_LIMITED'
      | 'INTERNAL';
    message: string;
    requestId?: string;
  };
}

/** Paginated list response shape (docs/04 §6). */
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

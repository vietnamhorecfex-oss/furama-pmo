/**
 * C-04 — Team & permissions: member cards (avatar, role, workstream scope, task-label usage),
 * add/edit via modal, remove with confirm, and a static role→capability matrix. Task counts
 * are derived client-side by matching each member's label against task assignment labels.
 */
import { useMemo, useState } from 'react';
import type { MemberDto, MemberRole } from '@furama/shared';
import { useMembers, useAddMember, useUpdateMember, useRemoveMember } from './useMembers';
import { useWorkstreams } from './useWorkstreams';
import { useAllTasks } from '../tasks/useTasks';
import { useDashboard } from '../dashboard/useDashboard';
import { useAuth } from '../../lib/auth-store';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { MemberFormModal, ROLE_DISPLAY, type MemberFormValue } from './MemberFormModal';

interface Props { projectId: string }

const AVATAR_COLORS = [
  'bg-red-600', 'bg-teal-800', 'bg-blue-600', 'bg-violet-600',
  'bg-orange-500', 'bg-slate-500', 'bg-emerald-600', 'bg-pink-600', 'bg-amber-600',
];

export function TeamPage({ projectId }: Props) {
  const { t } = useI18n();
  const members = useMembers(projectId);
  const workstreams = useWorkstreams(projectId);
  const tasks = useAllTasks(projectId, { sort: 'code', order: 'asc' });
  const dashboard = useDashboard(projectId);
  const meId = useAuth((s) => s.user?.id);
  const { can } = usePermissions(projectId);
  const canManage = can('MANAGE_MEMBERS');

  const add = useAddMember(projectId);
  const update = useUpdateMember(projectId);
  const remove = useRemoveMember(projectId);

  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; member: MemberDto } | null>(null);

  const wsName = useMemo(
    () => new Map((workstreams.data ?? []).map((w) => [w.id, w.name])),
    [workstreams.data],
  );

  // label → number of tasks assigned to that label (any role).
  const taskCountByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const task of tasks.data?.tasks ?? []) {
      const labels = new Set((task.assignments ?? []).map((a) => a.label));
      for (const l of labels) m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [tasks.data]);

  const days = dashboard.data?.daysToOpening;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t.teamTitle}</h2>
          <p className="text-sm text-slate-500">{t.teamSubtitle}</p>
        </div>
        {days != null && days >= 0 && (
          <div className="text-right">
            <p className="text-3xl font-bold text-slate-900 tabular-nums leading-none">{days}</p>
            <p className="text-xs text-slate-500">{t.daysToOpeningLabel}</p>
          </div>
        )}
      </div>

      {/* Add button — only roles that can manage members */}
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setModal({ mode: 'add' })}
            className="rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2"
          >
            + {t.addUser}
          </button>
        </div>
      )}

      {/* Member cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {members.data?.map((m) => (
          <MemberCard
            key={m.id}
            m={m}
            isSelf={m.userId === meId}
            canManage={canManage}
            wsName={wsName}
            taskCount={m.memberLabel ? (taskCountByLabel.get(m.memberLabel) ?? 0) : 0}
            onEdit={() => setModal({ mode: 'edit', member: m })}
            onRemove={() => { if (confirm(t.removeMemberConfirm)) remove.mutate(m.id); }}
            t={t}
          />
        ))}
        {members.data && members.data.length === 0 && (
          <p className="text-sm text-slate-400 col-span-full text-center py-8">{t.noMembers}</p>
        )}
      </div>

      {(update.isError || remove.isError) && (
        <p className="text-sm text-red-700">
          {((update.error ?? remove.error) as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? t.error}
        </p>
      )}

      {/* Permission matrix */}
      <PermissionMatrix t={t} />

      {modal?.mode === 'add' && (
        <MemberFormModal
          mode="add"
          workstreams={workstreams.data ?? []}
          pending={add.isPending}
          error={add.error}
          onSubmit={(v: MemberFormValue) =>
            add.mutate(
              { userId: v.userId, role: v.role, memberLabel: v.memberLabel, workstreamIds: v.workstreamIds },
              { onSuccess: () => setModal(null) },
            )
          }
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'edit' && (
        <MemberFormModal
          mode="edit"
          initial={modal.member}
          workstreams={workstreams.data ?? []}
          pending={update.isPending}
          error={update.error}
          onSubmit={(v: MemberFormValue) =>
            update.mutate(
              { memberId: modal.member.id, dto: { role: v.role, memberLabel: v.memberLabel ?? null, workstreamIds: v.workstreamIds } },
              { onSuccess: () => setModal(null) },
            )
          }
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function MemberCard({
  m, isSelf, canManage, wsName, taskCount, onEdit, onRemove, t,
}: {
  m: MemberDto;
  isSelf: boolean;
  canManage: boolean;
  wsName: Map<string, string>;
  taskCount: number;
  onEdit: () => void;
  onRemove: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const title = m.memberLabel ?? ROLE_DISPLAY[m.role];
  const scopeNames = m.workstreamIds.map((id) => wsName.get(id)).filter(Boolean) as string[];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={`shrink-0 w-11 h-11 rounded-full ${avatarColor(title)} text-white font-semibold flex items-center justify-center`}>
          {initials(title)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900 truncate">{title}</h3>
            {isSelf && <span className="text-xs bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{t.you}</span>}
          </div>
          <p className="text-sm text-slate-500">{ROLE_DISPLAY[m.role]}</p>
        </div>
      </div>

      {(scopeNames.length > 0 || (m.memberLabel && taskCount > 0)) && (
        <div className="mt-3 space-y-1 text-sm text-slate-600">
          {scopeNames.length > 0 && (
            <p><span className="text-slate-400">{t.wsScope}:</span> {scopeNames.join(' · ')}</p>
          )}
          {m.memberLabel && (
            <p>
              <span className="text-slate-400">{t.inTaskAs}:</span>{' '}
              <span className="font-semibold text-slate-800">{m.memberLabel}</span>
              {' · '}{taskCount} {t.taskUnit}
            </p>
          )}
        </div>
      )}

      {canManage && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={onEdit}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">{t.edit}</button>
          {!isSelf && (
            <button type="button" onClick={onRemove}
              className="rounded-md border border-red-200 text-red-600 px-3 py-1 text-sm hover:bg-red-50">{t.remove}</button>
          )}
        </div>
      )}
    </div>
  );
}

type Cell = boolean | string;
const MATRIX: { role: MemberRole; cells: [Cell, Cell, Cell, Cell, Cell, Cell] }[] = [
  // view, progress, editTask, deleteTask, manageUsers, config
  { role: 'OWNER',  cells: [true, 'all', 'all', true, true, true] },
  { role: 'PM',     cells: [true, 'all', 'all', true, true, true] },
  { role: 'LEAD',   cells: [true, 'own', 'own', false, false, false] },
  { role: 'MEMBER', cells: [true, 'assigned', false, false, false, false] },
  { role: 'VIEWER', cells: [true, false, false, false, false, false] },
];

function PermissionMatrix({ t }: { t: ReturnType<typeof useI18n>['t'] }) {
  const cols = [t.permView, t.permProgress, t.permEditTask, t.permDeleteTask, t.permManageUsers, t.permConfig];
  const scopeLabel = (v: string) => (v === 'all' ? t.permAll : v === 'own' ? t.permOwn : t.permAssigned);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 overflow-auto">
      <h3 className="font-semibold text-slate-800 mb-3">{t.permissionsByRole}</h3>
      <table className="min-w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="text-left px-3 py-2">{t.roleLabel}</th>
            {cols.map((c) => <th key={c} className="text-left px-3 py-2 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {MATRIX.map(({ role, cells }) => (
            <tr key={role}>
              <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{ROLE_DISPLAY[role]}</td>
              {cells.map((cell, i) => (
                <td key={i} className="px-3 py-2 whitespace-nowrap">
                  {cell === false ? (
                    <span className="text-slate-300">—</span>
                  ) : cell === true ? (
                    <span className="text-emerald-600">✓</span>
                  ) : (
                    <span className="text-emerald-600">✓ <span className="text-slate-500">{scopeLabel(cell)}</span></span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s/]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

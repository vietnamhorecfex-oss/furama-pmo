/**
 * C-04 — Team UI: list members with role + memberLabel + workstream chips. Inline role
 * change via <select> calls PATCH; LEADs get a workstream-scope picker. Add-member form
 * accepts a raw userId (the simplest path until we wire a user search). Last-OWNER guard
 * surfaces as an inline 400 on demote/remove attempts.
 */
import { useState } from 'react';
import type { MemberRole, MemberDto } from '@furama/shared';
import { useMembers, useAddMember, useUpdateMember, useRemoveMember } from './useMembers';
import { useWorkstreams } from './useWorkstreams';

const ROLES: MemberRole[] = ['OWNER', 'PM', 'LEAD', 'MEMBER', 'VIEWER'];

interface Props { projectId: string }

export function TeamPage({ projectId }: Props) {
  const members = useMembers(projectId);
  const workstreams = useWorkstreams(projectId);
  const add = useAddMember(projectId);
  const update = useUpdateMember(projectId);
  const remove = useRemoveMember(projectId);

  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<MemberRole>('MEMBER');
  const [newLabel, setNewLabel] = useState('');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-3">Add member</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newUserId.trim()) return;
            add.mutate(
              {
                userId: newUserId.trim(),
                role: newRole,
                memberLabel: newLabel.trim() || undefined,
              },
              {
                onSuccess: () => { setNewUserId(''); setNewLabel(''); },
              },
            );
          }}
          className="grid grid-cols-1 md:grid-cols-4 gap-2"
        >
          <input
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="userId (cuid)"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as MemberRole)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="memberLabel (optional)"
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!newUserId.trim() || add.isPending}
            className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-60"
          >
            {add.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
        {add.isError && (
          <p className="text-xs text-red-700 mt-2">
            {(add.error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'Failed to add member.'}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">User</th>
              <th className="text-left px-3 py-2">Role</th>
              <th className="text-left px-3 py-2">memberLabel</th>
              <th className="text-left px-3 py-2">Workstreams (LEAD)</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.data?.map((m) => (
              <Row
                key={m.id}
                m={m}
                workstreams={workstreams.data ?? []}
                onRole={(role) => update.mutate({ memberId: m.id, dto: { role } })}
                onScope={(ids) => update.mutate({ memberId: m.id, dto: { workstreamIds: ids } })}
                onRemove={() => remove.mutate(m.id)}
              />
            ))}
            {members.data && members.data.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(update.isError || remove.isError) && (
        <p className="text-sm text-red-700">
          {((update.error ?? remove.error) as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? 'Failed to update.'}
        </p>
      )}
    </div>
  );
}

function Row({
  m,
  workstreams,
  onRole,
  onScope,
  onRemove,
}: {
  m: MemberDto;
  workstreams: { id: string; name: string }[];
  onRole: (role: MemberRole) => void;
  onScope: (ids: string[]) => void;
  onRemove: () => void;
}) {
  const isLead = m.role === 'LEAD';
  return (
    <tr>
      <td className="px-3 py-2">
        <span className="font-mono text-xs text-slate-500">{m.userId.slice(-8)}</span>
      </td>
      <td className="px-3 py-2">
        <select
          value={m.role}
          onChange={(e) => onRole(e.target.value as MemberRole)}
          className="rounded border border-slate-300 px-1 py-0.5 text-xs"
        >
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td className="px-3 py-2 text-slate-700">{m.memberLabel ?? <span className="text-slate-400">—</span>}</td>
      <td className="px-3 py-2">
        {isLead ? (
          <details>
            <summary className="text-xs cursor-pointer text-indigo-600">
              {m.workstreamIds.length} selected
            </summary>
            <ul className="mt-1 text-xs space-y-0.5">
              {workstreams.map((w) => {
                const on = m.workstreamIds.includes(w.id);
                return (
                  <li key={w.id}>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => {
                          const next = on
                            ? m.workstreamIds.filter((x) => x !== w.id)
                            : [...m.workstreamIds, w.id];
                          onScope(next);
                        }}
                      />
                      {w.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          </details>
        ) : (
          <span className="text-xs text-slate-400">n/a</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => { if (confirm('Remove this member?')) onRemove(); }}
          className="text-xs text-red-600 hover:underline"
        >Remove</button>
      </td>
    </tr>
  );
}

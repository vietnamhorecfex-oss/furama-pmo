'use client';
/**
 * Add/Edit member modal. Add mode takes a raw userId (until a user-search/invite flow
 * exists); edit mode locks the userId and lets you change role, label, and — for a
 * Workstream Lead — the workstream scope. Server enforces the last-OWNER guard + RBAC.
 */
import { useState } from 'react';
import type { MemberDto, MemberRole } from '@furama/shared';
import { useI18n } from '../../lib/i18n';
import type { WorkstreamLite } from './useWorkstreams';

const ROLES: MemberRole[] = ['OWNER', 'PM', 'LEAD', 'MEMBER', 'VIEWER'];

export const ROLE_DISPLAY: Record<MemberRole, string> = {
  OWNER: 'Owner / GM',
  PM: 'Project Manager',
  LEAD: 'Workstream Lead',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

export interface MemberFormValue {
  userId: string;
  role: MemberRole;
  memberLabel?: string;
  workstreamIds?: string[];
}

interface Props {
  mode: 'add' | 'edit';
  initial?: MemberDto;
  workstreams: WorkstreamLite[];
  pending: boolean;
  error?: unknown;
  onSubmit: (v: MemberFormValue) => void;
  onClose: () => void;
}

export function MemberFormModal({ mode, initial, workstreams, pending, error, onSubmit, onClose }: Props) {
  const { t } = useI18n();
  const [userId, setUserId] = useState(initial?.userId ?? '');
  const [role, setRole] = useState<MemberRole>(initial?.role ?? 'MEMBER');
  const [label, setLabel] = useState(initial?.memberLabel ?? '');
  const [wsIds, setWsIds] = useState<string[]>(initial?.workstreamIds ?? []);

  const errMsg =
    (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'add' && !userId.trim()) return;
    onSubmit({
      userId: userId.trim(),
      role,
      memberLabel: label.trim() || undefined,
      workstreamIds: role === 'LEAD' ? wsIds : [],
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4"
      >
        <h3 className="text-lg font-semibold text-slate-900">
          {mode === 'add' ? t.addMember : t.editMember}
        </h3>

        <label className="block">
          <span className="text-xs uppercase text-slate-500 tracking-wide">{t.userIdLabel}</span>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={mode === 'edit'}
            placeholder="cuid…"
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-mono disabled:bg-slate-100 disabled:text-slate-400"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase text-slate-500 tracking-wide">{t.roleLabel}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
            >
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_DISPLAY[r]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase text-slate-500 tracking-wide">{t.memberLabelField}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. PMO Lead"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        {role === 'LEAD' && (
          <div>
            <span className="text-xs uppercase text-slate-500 tracking-wide">{t.wsScopeHint}</span>
            <div className="mt-1 space-y-1">
              {workstreams.map((w) => {
                const on = wsIds.includes(w.id);
                return (
                  <label key={w.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setWsIds((cur) => (on ? cur.filter((x) => x !== w.id) : [...cur, w.id]))
                      }
                    />
                    {w.name}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {errMsg && <p className="text-xs text-red-700">{errMsg}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={pending || (mode === 'add' && !userId.trim())}
            className="rounded-md bg-indigo-600 text-white text-sm px-4 py-1.5 disabled:opacity-60"
          >
            {pending ? (mode === 'add' ? t.adding : t.saving) : mode === 'add' ? t.addUser : t.save}
          </button>
        </div>
      </form>
    </div>
  );
}
/**
 * W-08 — Gates panel: lists milestones + gates with readiness bars and a status
 * dropdown for OWNER/PM/LEAD (server enforces RBAC; UI shows the dropdown to everyone
 * and surfaces the 403 inline if it returns).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GateStatus, MilestoneDto } from '@furama/shared';
import { api } from '../../lib/api-client';
import { useMilestones } from '../dashboard/useDashboard';

const STATUSES: GateStatus[] = ['PENDING', 'PASSED', 'FAILED', 'NA'];
const COLOR: Record<GateStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PASSED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  NA: 'bg-slate-100 text-slate-600',
};

interface Props { projectId: string }

export function GatesPanel({ projectId }: Props) {
  const q = useMilestones(projectId);
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: async (vars: { id: string; status: GateStatus }) => {
      const { data } = await api.patch<MilestoneDto>(`/milestones/${vars.id}/status`, { status: vars.status });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
  });

  if (q.isLoading) return <p className="text-slate-500">Loading milestones…</p>;
  if (q.isError || !q.data) return <p className="text-red-600">Failed to load milestones.</p>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800 mb-3">Milestones &amp; Gates</h3>
      <ul className="divide-y divide-slate-100">
        {q.data.map((m) => (
          <li key={m.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs uppercase text-slate-400 mr-2">{m.type}</span>
                <span className="font-medium text-slate-800">{m.name}</span>
                {m.date && (
                  <span className="text-xs text-slate-500 ml-2">{m.date.slice(0, 10)}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${COLOR[m.status]}`}>{m.status}</span>
                {m.type === 'GATE' && (
                  <select
                    value={m.status}
                    onChange={(e) => setStatus.mutate({ id: m.id, status: e.target.value as GateStatus })}
                    disabled={setStatus.isPending}
                    className="text-xs rounded border border-slate-300 px-1 py-0.5"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            </div>
            {m.readinessPct !== null && (
              <div className="mt-2">
                <div className="text-xs text-slate-500 mb-1">
                  Readiness: {m.completedCount}/{m.totalCount} tasks complete
                </div>
                <div className="h-1.5 bg-slate-100 rounded">
                  <div
                    className={`h-1.5 rounded ${m.readinessPct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ width: `${m.readinessPct}%` }}
                  />
                </div>
              </div>
            )}
          </li>
        ))}
        {q.data.length === 0 && (
          <li className="text-sm text-slate-400 py-2">No milestones yet.</li>
        )}
      </ul>
      {setStatus.isError && (
        <p className="text-xs text-red-700 mt-2">
          {(setStatus.error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message
            ?? 'Failed to update gate status.'}
        </p>
      )}
    </div>
  );
}

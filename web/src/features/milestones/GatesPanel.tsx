'use client';
/**
 * W-08 — Gates panel: lists milestones + gates with readiness bars and a status
 * dropdown for OWNER/PM/LEAD (server enforces RBAC; UI shows the dropdown to everyone
 * and surfaces the 403 inline if it returns).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { GateStatus, GenerateMilestonesResult, MilestoneDto } from '@furama/shared';
import { api } from '../../lib/api-client';
import { useMilestones } from '../dashboard/useDashboard';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';

const STATUSES: GateStatus[] = ['PENDING', 'PASSED', 'FAILED', 'NA'];
const COLOR: Record<GateStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  PASSED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  NA: 'bg-slate-100 text-slate-600',
};

interface Props { projectId: string }

export function GatesPanel({ projectId }: Props) {
  const { t } = useI18n();
  const { can } = usePermissions(projectId);
  const q = useMilestones(projectId);
  const qc = useQueryClient();
  const setStatus = useMutation({
    mutationFn: async (vars: { id: string; status: GateStatus }) => {
      const { data } = await api.patch<MilestoneDto>(`/milestones/${vars.id}/status`, { status: vars.status });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
  });
  const generate = useMutation({
    mutationFn: async (): Promise<GenerateMilestonesResult> => {
      const { data } = await api.post<GenerateMilestonesResult>(`/projects/${projectId}/milestones/generate-from-phases`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones', projectId] }),
  });

  if (q.isLoading) return <p className="text-slate-500">{t.loading}</p>;
  if (q.isError || !q.data) return <p className="text-red-600">{t.error}</p>;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="font-semibold text-slate-800">{t.milestonesTitle}</h3>
        {can('MANAGE_MILESTONE') && (
          <button
            type="button"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1.5 disabled:opacity-60"
          >
            {generate.isPending ? t.generatingMilestones : `⤓ ${t.autoFromPhases}`}
          </button>
        )}
      </div>
      {generate.isSuccess && generate.data && (
        <p className="text-xs text-emerald-700 mb-2">
          {t.milestonesGenerated.replace('{c}', String(generate.data.created)).replace('{u}', String(generate.data.updated))}
        </p>
      )}
      {generate.isError && (
        <p className="text-xs text-red-700 mb-2">
          {(generate.error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? t.error}
        </p>
      )}
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
                  {t.readinessLabel}: {m.completedCount}/{m.totalCount} {t.tasksComplete}
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
          <li className="text-sm text-slate-400 py-2">{t.noMilestones}</li>
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
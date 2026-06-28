/**
 * W-04 — Tasks table with server-side filter + pagination + inline status change.
 * The status <select> dispatches updateProgress; the invariant (COMPLETED → 100%) is
 * enforced server-side, so the UI just reflects the response.
 */
import { useState } from 'react';
import type { Priority, TaskDto, TaskStatus } from '@furama/shared';
import { useTasks, useUpdateProgress } from './useTasks';

const STATUSES: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface Props {
  projectId: string;
  onOpen: (taskId: string) => void;
}

export function TasksTable({ projectId, onOpen }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [q, setQ] = useState('');

  const list = useTasks(projectId, {
    page,
    pageSize,
    sort: 'code',
    order: 'asc',
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(q ? { q } : {}),
  });
  const updateProgress = useUpdateProgress(projectId);

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / pageSize)) : 1;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-200">
        <input
          value={q}
          onChange={(e) => { setPage(1); setQ(e.target.value); }}
          placeholder="Search title / code / description"
          className="flex-1 min-w-[200px] rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          value={status}
          onChange={(e) => { setPage(1); setStatus(e.target.value as TaskStatus | ''); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select
          value={priority}
          onChange={(e) => { setPage(1); setPriority(e.target.value as Priority | ''); }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Code</th>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2">Priority</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">%</th>
              <th className="text-left px-3 py-2">Deadline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
            )}
            {list.data?.data.map((t: TaskDto) => (
              <tr
                key={t.id}
                onClick={() => onOpen(t.id)}
                className="hover:bg-slate-50 cursor-pointer"
              >
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{t.code}</td>
                <td className="px-3 py-2 max-w-[420px] truncate">{t.title}</td>
                <td className="px-3 py-2">
                  <span className={priorityClass(t.priority)}>{t.priority}</span>
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={t.status}
                    disabled={updateProgress.isPending}
                    onChange={(e) =>
                      updateProgress.mutate({
                        taskId: t.id,
                        payload: { status: e.target.value as TaskStatus },
                      })
                    }
                    className="rounded-md border border-slate-300 px-1 py-0.5 text-xs"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{t.percent}%</td>
                <td className="px-3 py-2 text-slate-500">{t.deadline ? t.deadline.slice(0, 10) : '—'}</td>
              </tr>
            ))}
            {list.data && list.data.data.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No tasks match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 flex items-center justify-between text-sm border-t border-slate-200">
        <span className="text-slate-500">
          {list.data ? `${list.data.total} tasks · page ${list.data.page}/${totalPages}` : ''}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function priorityClass(p: Priority): string {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
  switch (p) {
    case 'CRITICAL': return `${base} bg-red-100 text-red-700`;
    case 'HIGH': return `${base} bg-amber-100 text-amber-700`;
    case 'MEDIUM': return `${base} bg-sky-100 text-sky-700`;
    case 'LOW': return `${base} bg-slate-100 text-slate-600`;
  }
}

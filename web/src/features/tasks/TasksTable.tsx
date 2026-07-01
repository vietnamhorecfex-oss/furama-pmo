'use client';
/**
 * W-04 — Tasks table: rich columns (dept / PIC / start / deadline / schedule health),
 * client-side filtering + sorting + pagination over the full task set, and inline status
 * change. Loads all tasks once (useAllTasks) so the computed health filter and date sort
 * work across the whole project, not just one server page.
 */
import { useMemo, useState } from 'react';
import type { Priority, TaskDto, TaskStatus } from '@furama/shared';
import { useAllTasks, useUpdateProgress } from './useTasks';
import { useWorkstreams } from '../team/useWorkstreams';
import { useI18n } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { scheduleHealth, HEALTH_STYLE, type Health } from '@/lib/schedule';

const STATUSES: TaskStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const HEALTHS: Health[] = ['AHEAD', 'ON_TRACK', 'BEHIND', 'OVERDUE', 'DONE', 'NONE'];
type SortField = 'code' | 'startDate' | 'deadline' | 'percent' | 'priority' | 'updatedAt';
const PAGE_SIZE = 25;
const PRIO_RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

interface Props {
  projectId: string;
  onOpen: (taskId: string) => void;
}

export function TasksTable({ projectId, onOpen }: Props) {
  const { t } = useI18n();
  const list = useAllTasks(projectId, { sort: 'code', order: 'asc' });
  const workstreams = useWorkstreams(projectId);
  const updateProgress = useUpdateProgress(projectId);
  const { can } = usePermissions(projectId);
  const canEditProgress = can('UPDATE_PROGRESS');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [dept, setDept] = useState('');
  const [health, setHealth] = useState<Health | ''>('');
  const [sortField, setSortField] = useState<SortField>('deadline');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const wsName = useMemo(
    () => new Map((workstreams.data ?? []).map((w) => [w.id, w.name])),
    [workstreams.data],
  );

  const HEALTH_LABEL: Record<Health, string> = {
    DONE: t.healthDone, AHEAD: t.healthAhead, ON_TRACK: t.healthOnTrack,
    BEHIND: t.healthBehind, OVERDUE: t.healthOverdue, NONE: t.healthNone,
  };

  // Compute health once per task, then filter + sort entirely client-side.
  const now = useMemo(() => new Date(), []);
  const rows = useMemo(() => {
    const all = (list.data?.tasks ?? []).map((task) => ({
      task,
      health: scheduleHealth(task, now),
      pic: pic(task),
    }));
    const term = q.trim().toLowerCase();
    const filtered = all.filter(({ task, health: h, pic: p }) => {
      if (status && task.status !== status) return false;
      if (priority && task.priority !== priority) return false;
      if (dept && task.workstreamId !== dept) return false;
      if (health && h !== health) return false;
      if (term) {
        const hay = `${task.code} ${task.title} ${task.description ?? ''} ${p}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    const dir = order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => dir * cmp(a, b, sortField));
    return filtered;
  }, [list.data, q, status, priority, dept, health, sortField, order, now]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const reset = () => { setQ(''); setStatus(''); setPriority(''); setDept(''); setHealth(''); setPage(1); };
  const onFilter = <T,>(setter: (v: T) => void) => (v: T) => { setPage(1); setter(v); };

  const selectCls = 'rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white';

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Filter / sort toolbar */}
      <div className="p-3 flex flex-wrap items-center gap-2 border-b border-slate-200">
        <input
          value={q}
          onChange={(e) => onFilter(setQ)(e.target.value)}
          placeholder={t.searchTasks}
          className="flex-1 min-w-[180px] rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select value={status} onChange={(e) => onFilter(setStatus)(e.target.value as TaskStatus | '')} className={selectCls}>
          <option value="">{t.allStatuses}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={priority} onChange={(e) => onFilter(setPriority)(e.target.value as Priority | '')} className={selectCls}>
          <option value="">{t.allPriorities}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={dept} onChange={(e) => onFilter(setDept)(e.target.value)} className={selectCls}>
          <option value="">{t.allDepartments}</option>
          {(workstreams.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={health} onChange={(e) => onFilter(setHealth)(e.target.value as Health | '')} className={selectCls}>
          <option value="">{t.allHealth}</option>
          {HEALTHS.map((h) => <option key={h} value={h}>{HEALTH_LABEL[h]}</option>)}
        </select>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-xs text-slate-400">{t.sortBy}</span>
          <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} className={selectCls}>
            <option value="deadline">{t.sortDeadline}</option>
            <option value="startDate">{t.sortStart}</option>
            <option value="code">{t.sortCode}</option>
            <option value="percent">{t.sortPercent}</option>
            <option value="priority">{t.sortPriority}</option>
            <option value="updatedAt">{t.sortUpdated}</option>
          </select>
          <button
            type="button"
            onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm hover:bg-slate-50"
            title={order === 'asc' ? t.asc : t.desc}
          >
            {order === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
            <tr>
              <Th>{t.colCode}</Th>
              <Th>{t.colTitle}</Th>
              <Th>{t.colDept}</Th>
              <Th>{t.colPic}</Th>
              <Th>{t.colStart}</Th>
              <Th>{t.colDeadline}</Th>
              <Th>{t.colPriority}</Th>
              <Th>{t.colStatus}</Th>
              <Th className="text-right">{t.colPercent}</Th>
              <Th>{t.colHealth}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.isLoading && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">{t.loading}</td></tr>
            )}
            {pageRows.map(({ task, health: h, pic: p }) => (
              <tr key={task.id} onClick={() => onOpen(task.id)} className="hover:bg-slate-50 cursor-pointer">
                <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">{task.code}</td>
                <td className="px-3 py-2 max-w-[280px] truncate">{task.title}</td>
                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{task.workstreamId ? (wsName.get(task.workstreamId) ?? '—') : '—'}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">{p || '—'}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDate(task.startDate)}</td>
                <td className={`px-3 py-2 whitespace-nowrap ${h === 'OVERDUE' ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>{fmtDate(task.deadline)}</td>
                <td className="px-3 py-2"><span className={priorityClass(task.priority)}>{task.priority}</span></td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  {canEditProgress ? (
                    <select
                      value={task.status}
                      disabled={updateProgress.isPending}
                      onChange={(e) => updateProgress.mutate({ taskId: task.id, payload: { status: e.target.value as TaskStatus } })}
                      className="rounded-md border border-slate-300 px-1 py-0.5 text-xs bg-white"
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-600">{task.status.replace('_', ' ')}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{task.percent}%</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_STYLE[h].chip}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${HEALTH_STYLE[h].dot}`} />
                    {HEALTH_LABEL[h]}
                  </span>
                </td>
              </tr>
            ))}
            {!list.isLoading && pageRows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">{t.noTasksMatch}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="p-3 flex items-center justify-between text-sm border-t border-slate-200">
        <span className="text-slate-500">
          {rows.length} {t.tasksCount} · {t.page} {safePage}/{totalPages}
          {(q || status || priority || dept || health) && (
            <button type="button" onClick={reset} className="ml-3 text-indigo-600 hover:text-indigo-800">{t.resetFilters}</button>
          )}
        </span>
        <div className="flex gap-2">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">{t.prev}</button>
          <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50">{t.next}</button>
        </div>
      </div>
    </div>
  );
}

/** PIC = the IN_CHARGE assignment label, falling back to the task's inChargeLabel. */
function pic(task: TaskDto): string {
  return task.assignments?.find((a) => a.role === 'IN_CHARGE')?.label ?? task.inChargeLabel ?? '';
}

function cmp(
  a: { task: TaskDto }, b: { task: TaskDto }, field: SortField,
): number {
  const ta = a.task, tb = b.task;
  switch (field) {
    case 'priority': return PRIO_RANK[ta.priority] - PRIO_RANK[tb.priority];
    case 'percent': return ta.percent - tb.percent;
    case 'code': return ta.code.localeCompare(tb.code);
    case 'startDate': return dateVal(ta.startDate) - dateVal(tb.startDate);
    case 'deadline': return dateVal(ta.deadline) - dateVal(tb.deadline);
    case 'updatedAt': return dateVal(ta.updatedAt) - dateVal(tb.updatedAt);
  }
}

/** Null dates sort last in ascending order. */
function dateVal(d: string | null): number {
  return d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER;
}

function fmtDate(d: string | null): string {
  return d ? d.slice(0, 10) : '—';
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left font-medium whitespace-nowrap ${className}`}>{children}</th>;
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

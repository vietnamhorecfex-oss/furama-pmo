/**
 * W-05 — Kanban board with HTML5 native drag (no extra DnD library).
 *
 * Five columns by TaskStatus. Dropping a card on a column calls updateProgress with the new
 * status. Server-side invariants take care of the special cases (COMPLETED → 100%; dropping
 * to NOT_STARTED → percent=0 via Kanban-move semantics — though that flag only fires when
 * the caller is explicit; for this board we send `{status}` only, which yields the
 * "0<percent<100 + NOT_STARTED → IN_PROGRESS" path if there was prior progress. That's
 * acceptable for v1; explicit reset is a TaskDrawer affordance).
 *
 * To keep things performant on a 628-task project we limit the board to the first 500 cards
 * the table is filtering on. The full task list lives in TasksTable.
 */
import { useState } from 'react';
import type { TaskDto, TaskStatus } from '@furama/shared';
import { useTasks, useUpdateProgress } from './useTasks';

const COLUMNS: { key: TaskStatus; label: string; accent: string }[] = [
  { key: 'NOT_STARTED', label: 'Not started', accent: 'bg-slate-100' },
  { key: 'IN_PROGRESS', label: 'In progress', accent: 'bg-blue-50' },
  { key: 'IN_REVIEW', label: 'In review', accent: 'bg-violet-50' },
  { key: 'BLOCKED', label: 'Blocked', accent: 'bg-red-50' },
  { key: 'COMPLETED', label: 'Completed', accent: 'bg-emerald-50' },
];

interface Props {
  projectId: string;
  onOpen: (taskId: string) => void;
}

export function KanbanBoard({ projectId, onOpen }: Props) {
  const list = useTasks(projectId, { page: 1, pageSize: 500, sort: 'code', order: 'asc' });
  const update = useUpdateProgress(projectId);
  const [dragId, setDragId] = useState<string | null>(null);

  const byStatus: Record<TaskStatus, TaskDto[]> = {
    NOT_STARTED: [],
    IN_PROGRESS: [],
    IN_REVIEW: [],
    BLOCKED: [],
    COMPLETED: [],
  };
  for (const t of list.data?.data ?? []) byStatus[t.status].push(t);

  const truncated = list.data && list.data.total > 500;

  return (
    <div>
      {truncated && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5 mb-2">
          Board shows the first 500 tasks. Use the table view + filters for the full project.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 min-h-[400px]">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={() => {
              if (dragId) {
                update.mutate({ taskId: dragId, payload: { status: col.key } });
                setDragId(null);
              }
            }}
            className={`rounded-xl border border-slate-200 ${col.accent} flex flex-col`}
          >
            <header className="px-3 py-2 flex items-center justify-between border-b border-slate-200/60">
              <span className="font-semibold text-slate-700 text-sm">{col.label}</span>
              <span className="text-xs text-slate-500">{byStatus[col.key].length}</span>
            </header>
            <div className="p-2 space-y-2 overflow-auto max-h-[70vh]">
              {byStatus[col.key].map((t) => (
                <article
                  key={t.id}
                  draggable
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                  onClick={() => onOpen(t.id)}
                  className="bg-white rounded-lg border border-slate-200 p-2 cursor-pointer shadow-xs hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[10px] text-slate-400">{t.code}</span>
                    <span className="text-[10px] uppercase font-medium text-slate-500">{t.priority}</span>
                  </div>
                  <p className="text-sm text-slate-800 mt-1 line-clamp-3">{t.title}</p>
                  <div className="mt-2 h-1 bg-slate-100 rounded">
                    <div
                      className="h-1 rounded bg-indigo-500"
                      style={{ width: `${t.percent}%` }}
                    />
                  </div>
                </article>
              ))}
              {byStatus[col.key].length === 0 && (
                <p className="text-xs text-slate-400 text-center py-6">Drop here</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

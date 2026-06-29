/**
 * W-05 — Kanban board with HTML5 native drag.
 * Real-time sync via WS → TanStack Query invalidation (ws.ts).
 * Shows a live/syncing indicator in the header.
 */
import { useState } from 'react';
import type { TaskDto, TaskStatus } from '@furama/shared';
import { useAllTasks, useUpdateProgress } from './useTasks';
import { useI18n } from '../../lib/i18n';

interface Props {
  projectId: string;
  onOpen: (taskId: string) => void;
}

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: 'text-red-600 bg-red-50',
  HIGH: 'text-orange-600 bg-orange-50',
  MEDIUM: 'text-yellow-600 bg-yellow-50',
  LOW: 'text-slate-500 bg-slate-100',
};

export function KanbanBoard({ projectId, onOpen }: Props) {
  const { t } = useI18n();
  const list = useAllTasks(projectId, { sort: 'code', order: 'asc' });
  const update = useUpdateProgress(projectId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState<TaskStatus | null>(null);

  const COLUMNS: { key: TaskStatus; label: string; accent: string; border: string }[] = [
    { key: 'NOT_STARTED', label: t.notStarted, accent: 'bg-slate-50', border: 'border-slate-200' },
    { key: 'IN_PROGRESS',  label: t.inProgress,  accent: 'bg-blue-50',  border: 'border-blue-200' },
    { key: 'IN_REVIEW',   label: t.inReview,   accent: 'bg-violet-50', border: 'border-violet-200' },
    { key: 'BLOCKED',     label: t.blocked,     accent: 'bg-red-50',   border: 'border-red-200' },
    { key: 'COMPLETED',   label: t.completed,   accent: 'bg-emerald-50', border: 'border-emerald-200' },
  ];

  const byStatus: Record<TaskStatus, TaskDto[]> = {
    NOT_STARTED: [], IN_PROGRESS: [], IN_REVIEW: [], BLOCKED: [], COMPLETED: [],
  };
  for (const task of list.data?.tasks ?? []) byStatus[task.status].push(task);

  const truncated = list.data?.truncated ?? false;
  const isLive = !list.isFetching && !list.isLoading;

  return (
    <div>
      {/* Status bar */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
          list.isFetching ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            list.isFetching ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
          }`} />
          {list.isFetching ? t.syncing : t.synced}
        </div>
        {truncated && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            {t.boardTruncated}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 min-h-[400px]">
        {COLUMNS.map((col) => {
          const isDragTarget = draggingOver === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDraggingOver(col.key); }}
              onDragLeave={() => setDraggingOver(null)}
              onDrop={() => {
                setDraggingOver(null);
                if (dragId) {
                  update.mutate({ taskId: dragId, payload: { status: col.key } });
                  setDragId(null);
                }
              }}
              className={`rounded-xl border flex flex-col transition-all ${col.accent} ${
                isDragTarget ? 'border-indigo-400 ring-2 ring-indigo-200 scale-[1.01]' : col.border
              }`}
            >
              <header className="px-3 py-2.5 flex items-center justify-between border-b border-slate-200/60">
                <span className="font-semibold text-slate-700 text-sm">{col.label}</span>
                <span className="text-xs font-bold text-slate-500 bg-white rounded-full px-2 py-0.5 border border-slate-200">
                  {byStatus[col.key].length}
                </span>
              </header>
              <div className="p-2 space-y-2 overflow-auto max-h-[68vh] flex-1">
                {byStatus[col.key].map((task) => (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => { setDragId(null); setDraggingOver(null); }}
                    onClick={() => onOpen(task.id)}
                    className={`bg-white rounded-lg border border-slate-200 p-2.5 cursor-pointer shadow-xs hover:shadow-md transition-shadow select-none ${
                      dragId === task.id ? 'opacity-50 rotate-1' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="font-mono text-[10px] text-slate-400">{task.code}</span>
                      <span className={`text-[10px] uppercase font-semibold px-1 rounded ${PRIORITY_BADGE[task.priority] ?? ''}`}>
                        {task.priority}
                      </span>
                    </div>
                    <p className="text-sm text-slate-800 line-clamp-2 leading-snug">{task.title}</p>
                    {task.deadline && (
                      <p className={`text-[10px] mt-1 ${
                        new Date(task.deadline) < new Date() && task.status !== 'COMPLETED'
                          ? 'text-red-600 font-semibold'
                          : 'text-slate-400'
                      }`}>
                        {new Date(task.deadline).toLocaleDateString('vi-VN')}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all ${
                            task.status === 'COMPLETED' ? 'bg-emerald-500' :
                            task.status === 'BLOCKED' ? 'bg-red-400' : 'bg-indigo-500'
                          }`}
                          style={{ width: `${task.percent}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 w-6 text-right">{task.percent}%</span>
                    </div>
                  </article>
                ))}
                {byStatus[col.key].length === 0 && !list.isLoading && isLive && (
                  <div className={`flex flex-col items-center justify-center py-8 rounded-lg border-2 border-dashed ${
                    isDragTarget ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200'
                  }`}>
                    <svg className="w-6 h-6 text-slate-300 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <p className="text-xs text-slate-400">{t.dropHere}</p>
                  </div>
                )}
                {list.isLoading && (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * W-06 — Slide-over drawer showing a task detail + comment thread. Closes on Esc or backdrop
 * click. Comment add is enabled for any signed-in non-VIEWER (enforced server-side; UI
 * always shows the input for simplicity and we surface the 403 inline if it returns).
 */
import { useEffect, useState } from 'react';
import type { TaskDto } from '@furama/shared';
import { useTask } from './useTasks';
import { useAddComment, useComments } from '../comments/useComments';

interface Props {
  taskId: string;
  onClose: () => void;
}

export function TaskDrawer({ taskId, onClose }: Props) {
  const task = useTask(taskId);
  const comments = useComments(taskId);
  const add = useAddComment(taskId);
  const [body, setBody] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = task.data;

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-white shadow-xl border-l border-slate-200 flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-400">{t?.code ?? '…'}</p>
            <h2 className="text-lg font-semibold text-slate-900">{t?.title ?? 'Loading…'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 rounded-full px-2 py-1"
            aria-label="Close"
          >×</button>
        </header>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {t && <TaskFacts t={t} />}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Comments</h3>
            <ol className="space-y-2 mb-3">
              {comments.data?.map((c) => (
                <li key={c.id} className="bg-slate-50 rounded-lg p-2 text-sm">
                  <p className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</p>
                  <p className="text-slate-800 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
              {comments.data && comments.data.length === 0 && (
                <li className="text-xs text-slate-400">No comments yet.</li>
              )}
            </ol>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (body.trim()) add.mutate(body.trim(), { onSuccess: () => setBody('') });
              }}
              className="space-y-2"
            >
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Add a comment…"
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                maxLength={4000}
              />
              {add.isError && (
                <p className="text-xs text-red-600">
                  {(add.error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'Failed to comment'}
                </p>
              )}
              <button
                type="submit"
                disabled={!body.trim() || add.isPending}
                className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-60"
              >
                {add.isPending ? 'Posting…' : 'Post comment'}
              </button>
            </form>
          </section>
        </div>
      </aside>
    </div>
  );
}

function TaskFacts({ t }: { t: TaskDto }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <DT label="Status">{t.status.replace('_', ' ')}</DT>
      <DT label="Priority">{t.priority}</DT>
      <DT label="Progress">{t.percent}%</DT>
      <DT label="Deadline">{t.deadline ? t.deadline.slice(0, 10) : '—'}</DT>
      <DT label="In charge">{t.assignments?.find((a) => a.role === 'IN_CHARGE')?.label ?? '—'}</DT>
      <DT label="Support">{t.assignments?.find((a) => a.role === 'SUPPORT')?.label ?? '—'}</DT>
      {t.description && (
        <div className="col-span-2 mt-2">
          <dt className="text-xs uppercase text-slate-500 tracking-wide">Description</dt>
          <dd className="text-slate-800 whitespace-pre-wrap">{t.description}</dd>
        </div>
      )}
    </dl>
  );
}

function DT({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500 tracking-wide">{label}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

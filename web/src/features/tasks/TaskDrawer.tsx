/**
 * W-06 — Slide-over drawer: task detail, progress editor, update history, comment thread.
 * Closes on Esc or backdrop click. Progress + comment writes are enforced server-side; the
 * UI surfaces a 403 inline if the caller lacks the capability.
 */
import { useEffect, useState } from 'react';
import type { AuditLogDto, TaskDto, TaskStatus } from '@furama/shared';
import { useTask, useTaskHistory, useUpdateProgress, useUpdateTask } from './useTasks';
import { useAddComment, useComments } from '../comments/useComments';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { formatVnd, formatVndFull } from '../../lib/format';

interface Props {
  taskId: string;
  onClose: () => void;
}

const STATUS_OPTIONS: TaskStatus[] = [
  'NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED',
];

const STATUS_BADGE: Record<TaskStatus, string> = {
  NOT_STARTED: 'bg-slate-200 text-slate-700',
  IN_PROGRESS: 'bg-blue-200 text-blue-800',
  IN_REVIEW: 'bg-violet-200 text-violet-800',
  BLOCKED: 'bg-red-200 text-red-800',
  COMPLETED: 'bg-emerald-200 text-emerald-800',
};

function statusLabel(s: TaskStatus, t: ReturnType<typeof useI18n>['t']): string {
  return {
    NOT_STARTED: t.notStarted, IN_PROGRESS: t.inProgress, IN_REVIEW: t.inReview,
    BLOCKED: t.blocked, COMPLETED: t.completed,
  }[s];
}

export function TaskDrawer({ taskId, onClose }: Props) {
  const { t } = useI18n();
  const task = useTask(taskId);
  const comments = useComments(taskId);
  const add = useAddComment(taskId);
  const [body, setBody] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const data = task.data;
  const { can } = usePermissions(data?.projectId);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 h-full w-full sm:w-[560px] bg-white shadow-xl border-l border-slate-200 flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-slate-400">{data?.code ?? '…'}</p>
            <h2 className="text-lg font-semibold text-slate-900">{data?.title ?? t.loading}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-800 rounded-full px-2 py-1"
            aria-label="Close"
          >×</button>
        </header>

        <div className="flex-1 overflow-auto p-4 space-y-5">
          {data && <TaskFacts t={data} i18n={t} />}
          {data && can('UPDATE_PROGRESS') && <ProgressEditor task={data} i18n={t} />}
          {data && <TaskBudgetEditor task={data} canEdit={can('EDIT_TASK')} i18n={t} />}
          {data && <HistoryTimeline projectId={data.projectId} taskId={taskId} i18n={t} />}

          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">{t.comments}</h3>
            <ol className="space-y-2 mb-3">
              {comments.data?.map((c) => (
                <li key={c.id} className="bg-slate-50 rounded-lg p-2 text-sm">
                  <p className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</p>
                  <p className="text-slate-800 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
              {comments.data && comments.data.length === 0 && (
                <li className="text-xs text-slate-400">{t.noComments}</li>
              )}
            </ol>
            {can('COMMENT') && (
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
                placeholder={t.addComment}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                maxLength={4000}
              />
              {add.isError && <ErrMsg error={add.error} fallback={t.error} />}
              <button
                type="submit"
                disabled={!body.trim() || add.isPending}
                className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-60"
              >
                {add.isPending ? t.posting : t.postComment}
              </button>
            </form>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

/** Per-task budget allocation. Saving rolls up to Committed on the Budget tab. */
function TaskBudgetEditor({ task, canEdit, i18n }: { task: TaskDto; canEdit: boolean; i18n: ReturnType<typeof useI18n>['t'] }) {
  const update = useUpdateTask(task.projectId);
  const [budget, setBudget] = useState(task.budgetVnd);
  useEffect(() => { setBudget(task.budgetVnd); }, [task.id, task.budgetVnd]);

  const dirty = budget !== task.budgetVnd;
  const save = () => { if (dirty) update.mutate({ taskId: task.id, payload: { budgetVnd: Math.max(0, Math.trunc(budget)) } }); };

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{i18n.taskBudgetTitle}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-2">
        <div>
          <dt className="text-xs uppercase text-slate-500 tracking-wide">{i18n.linkedCategory}</dt>
          <dd className="text-slate-800">{task.category ?? '—'}</dd>
        </div>
      </dl>
      {canEdit ? (
        <div className="flex items-end gap-2 flex-wrap">
          <label className="text-xs text-slate-500">
            <span className="block mb-0.5">{i18n.budgetAllocated}</span>
            <input
              type="number" min={0} step={1_000_000}
              value={budget}
              disabled={update.isPending}
              onChange={(e) => setBudget(Number(e.target.value))}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              className="w-44 rounded border border-slate-300 px-2 py-1 text-sm tabular-nums bg-white"
            />
          </label>
          <span className="text-xs text-slate-400 pb-1.5" title={formatVndFull(budget)}>{formatVnd(budget)}</span>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || update.isPending}
            className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-50 ml-auto"
          >
            {update.isPending ? i18n.savingProgress : i18n.save}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-700">{i18n.budgetAllocated}: <span className="font-semibold">{formatVnd(task.budgetVnd)}</span></p>
      )}
      <p className="text-[11px] text-slate-400 mt-1.5">↳ {i18n.rollupHint}</p>
      {update.isError && <ErrMsg error={update.error} fallback={i18n.error} />}
    </section>
  );
}

function ProgressEditor({ task, i18n }: { task: TaskDto; i18n: ReturnType<typeof useI18n>['t'] }) {
  const update = useUpdateProgress(task.projectId);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [percent, setPercent] = useState<number>(task.percent);
  const [note, setNote] = useState('');

  // Re-sync local form when a different task / external update lands.
  useEffect(() => {
    setStatus(task.status);
    setPercent(task.percent);
  }, [task.id, task.status, task.percent]);

  const dirty = status !== task.status || percent !== task.percent || note.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const payload: { status?: TaskStatus; percent?: number; notes?: string } = {};
    if (status !== task.status) payload.status = status;
    if (percent !== task.percent) payload.percent = percent;
    if (note.trim()) payload.notes = note.trim();
    update.mutate({ taskId: task.id, payload }, { onSuccess: () => setNote('') });
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{i18n.updateProgress}</h3>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase text-slate-500 tracking-wide">{i18n.statusLabel}</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{statusLabel(s, i18n)}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase text-slate-500 tracking-wide">{i18n.percentLabel}</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number" min={0} max={100} step={5}
                value={percent}
                onChange={(e) => setPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                className="w-16 rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
              />
              <input
                type="range" min={0} max={100} step={5}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="flex-1 accent-indigo-600"
              />
            </div>
          </label>
        </div>
        <label className="block">
          <span className="text-xs uppercase text-slate-500 tracking-wide">{i18n.progressNote}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={i18n.progressNotePlaceholder}
            maxLength={4000}
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm bg-white"
          />
        </label>
        {update.isError && <ErrMsg error={update.error} fallback={i18n.error} />}
        <button
          type="submit"
          disabled={!dirty || update.isPending}
          className="rounded bg-indigo-600 text-white text-sm px-3 py-1.5 disabled:opacity-50"
        >
          {update.isPending ? i18n.savingProgress : i18n.saveProgress}
        </button>
      </form>
    </section>
  );
}

function HistoryTimeline({
  projectId, taskId, i18n,
}: { projectId: string; taskId: string; i18n: ReturnType<typeof useI18n>['t'] }) {
  const history = useTaskHistory(projectId, taskId);
  const entries = (history.data ?? []).filter((e) =>
    e.action === 'task.progress' || e.action === 'task.updated' || e.action === 'task.created',
  );

  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{i18n.history}</h3>
      {history.isLoading ? (
        <p className="text-xs text-slate-400">{i18n.loading}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-slate-400">{i18n.noHistory}</p>
      ) : (
        <ol className="relative border-l border-slate-200 ml-1.5 space-y-3">
          {entries.map((e) => (
            <HistoryItem key={e.id} entry={e} i18n={i18n} />
          ))}
        </ol>
      )}
    </section>
  );
}

function HistoryItem({ entry, i18n }: { entry: AuditLogDto; i18n: ReturnType<typeof useI18n>['t'] }) {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const note = typeof after.note === 'string' ? after.note : null;

  const statusChanged = 'status' in after && before.status !== after.status;
  const percentChanged = 'percent' in after && before.percent !== after.percent;

  return (
    <li className="ml-4">
      <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500 border-2 border-white" />
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
        {entry.actorName && <span className="text-slate-500">· {entry.actorName}</span>}
        {entry.action === 'task.created' && (
          <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
            {i18n.created}
          </span>
        )}
      </div>
      <div className="mt-1 space-y-1">
        {statusChanged && (
          <p className="text-sm flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[before.status as TaskStatus] ?? 'bg-slate-100'}`}>
              {statusLabel(before.status as TaskStatus, i18n)}
            </span>
            <span className="text-slate-400">→</span>
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[after.status as TaskStatus] ?? 'bg-slate-100'}`}>
              {statusLabel(after.status as TaskStatus, i18n)}
            </span>
          </p>
        )}
        {percentChanged && (
          <p className="text-sm text-slate-700">
            {i18n.percentLabel}: <span className="text-slate-400">{String(before.percent ?? 0)}%</span>
            {' → '}
            <span className="font-semibold text-indigo-600">{String(after.percent)}%</span>
          </p>
        )}
        {note && (
          <p className="text-sm text-slate-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            <span className="text-[11px] uppercase text-amber-700 font-semibold mr-1">{i18n.note}:</span>
            <span className="whitespace-pre-wrap">{note}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function TaskFacts({ t, i18n }: { t: TaskDto; i18n: ReturnType<typeof useI18n>['t'] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <DT label={i18n.statusLabel}>
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS_BADGE[t.status] ?? ''}`}>
          {statusLabel(t.status, i18n)}
        </span>
      </DT>
      <DT label="Priority">{t.priority}</DT>
      <DT label={i18n.percentLabel}>{t.percent}%</DT>
      <DT label="Deadline">{t.deadline ? t.deadline.slice(0, 10) : '—'}</DT>
      <DT label={i18n.inCharge}>{t.assignments?.find((a) => a.role === 'IN_CHARGE')?.label ?? '—'}</DT>
      <DT label={i18n.support}>{t.assignments?.find((a) => a.role === 'SUPPORT')?.label ?? '—'}</DT>
      {t.description && (
        <div className="col-span-2 mt-1">
          <dt className="text-xs uppercase text-slate-500 tracking-wide">{i18n.description}</dt>
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

function ErrMsg({ error, fallback }: { error: unknown; fallback: string }) {
  const msg =
    (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? fallback;
  return <p className="text-xs text-red-600">{msg}</p>;
}

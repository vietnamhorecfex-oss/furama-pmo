'use client';
/**
 * C-02 — Activity feed: paginated audit rows for the project, scoped by role on the server
 * (OWNER/PM full; LEAD = own workstream tasks + comments; MEMBER/VIEWER = 403).
 */
import { useState } from 'react';
import { useActivityFeed } from './useActivity';

interface Props { projectId: string }

export function ActivityFeed({ projectId }: Props) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const q = useActivityFeed(projectId, page, PAGE_SIZE);

  if (q.isLoading) return <p className="text-slate-500">Loading activity…</p>;
  if (q.isError) {
    const msg = (q.error as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message;
    return <p className="text-red-600">{msg ?? 'Failed to load activity.'}</p>;
  }
  if (!q.data) return null;
  const totalPages = Math.max(1, Math.ceil(q.data.total / PAGE_SIZE));

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <header className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
        <h3 className="font-semibold text-slate-800">Activity</h3>
        <span className="text-xs text-slate-500">{q.data.total} entries</span>
      </header>
      <ol className="divide-y divide-slate-100">
        {q.data.data.map((row) => (
          <li key={row.id} className="px-4 py-2 flex items-start gap-3 text-sm">
            <div className="w-32 shrink-0 text-xs text-slate-500">
              {new Date(row.createdAt).toLocaleString()}
            </div>
            <div className="flex-1">
              <span className="font-medium text-slate-700">{row.actorName ?? '(system)'}</span>
              {' '}<span className="text-slate-500">→</span>{' '}
              <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{row.action}</code>
              {' '}<span className="text-slate-500">on</span>{' '}
              <span className="text-slate-700">{row.entityType}</span>
              {row.entityId && (
                <span className="ml-1 font-mono text-xs text-slate-400">#{row.entityId.slice(-6)}</span>
              )}
              <Diff before={row.before} after={row.after} />
            </div>
          </li>
        ))}
        {q.data.data.length === 0 && (
          <li className="px-4 py-6 text-center text-slate-400 text-sm">No activity yet.</li>
        )}
      </ol>
      <footer className="px-4 py-2 border-t border-slate-200 flex items-center justify-between text-sm">
        <span className="text-slate-500">Page {q.data.page}/{totalPages}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
          >Prev</button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50"
          >Next</button>
        </div>
      </footer>
    </div>
  );
}

/** Tiny inline before/after summary — primitive values only, no recursion. */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return null;
  const beforeStr = stringify(before);
  const afterStr = stringify(after);
  if (!beforeStr && !afterStr) return null;
  return (
    <div className="mt-1 text-xs text-slate-500 font-mono">
      {beforeStr && <span className="text-red-600">{beforeStr}</span>}
      {beforeStr && afterStr && <span className="mx-1">→</span>}
      {afterStr && <span className="text-emerald-700">{afterStr}</span>}
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined && typeof val !== 'object')
    .slice(0, 4);
  return entries.length ? entries.map(([k, val]) => `${k}=${String(val)}`).join(' ') : '';
}
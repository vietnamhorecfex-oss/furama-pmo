/**
 * W-08 — Budget panel: categories with planned vs committed bars; overrun + over-cap badges.
 */
import { useBudgetSummary } from '../dashboard/useDashboard';
import { formatVnd } from '../../lib/format';

interface Props { projectId: string }

export function BudgetPanel({ projectId }: Props) {
  const q = useBudgetSummary(projectId);
  if (q.isLoading) return <p className="text-slate-500">Loading budget…</p>;
  if (q.isError || !q.data) return <p className="text-red-600">Failed to load budget.</p>;
  const b = q.data;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-3">Project totals</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Cell label="Cap" value={formatVnd(b.capVnd)} />
          <Cell label="Planned" value={formatVnd(b.plannedVnd)} />
          <Cell label="Committed" value={formatVnd(b.committedVnd)} accent={b.overCap ? 'text-red-700' : ''} />
          <Cell label="Actual" value={formatVnd(b.actualVnd)} />
        </div>
        {b.overCap && (
          <p className="text-sm text-red-700 mt-2">
            ⚠ Committed exceeds cap by {formatVnd(b.committedVnd - b.capVnd)}.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-3">By category</h3>
        <ul className="space-y-3">
          {b.byCategory.map((c) => {
            const isOverrun = b.overruns.some((o) => o.categoryId === c.categoryId);
            const planned = c.plannedVnd;
            const committed = c.committedVnd;
            const max = Math.max(planned, committed, 1);
            return (
              <li key={c.categoryId}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-800">
                    {c.name}
                    {isOverrun && (
                      <span className="ml-2 text-xs rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5">
                        overrun
                      </span>
                    )}
                  </span>
                  <span className="text-slate-500 tabular-nums">
                    {formatVnd(committed)} / {formatVnd(planned)}
                  </span>
                </div>
                <div className="mt-1 grid grid-cols-1 gap-1">
                  <Bar fill="bg-slate-300" pct={(planned / max) * 100} label="planned" />
                  <Bar fill={isOverrun ? 'bg-red-500' : 'bg-emerald-500'} pct={(committed / max) * 100} label="committed" />
                </div>
              </li>
            );
          })}
          {b.byCategory.length === 0 && (
            <li className="text-sm text-slate-400">No budget categories configured.</li>
          )}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800 mb-3">By workstream</h3>
        <ul className="space-y-1.5 text-sm">
          {b.byWorkstream.map((w) => (
            <li key={w.workstreamId ?? 'unassigned'} className="flex justify-between">
              <span>{w.name}</span>
              <span className="text-slate-500 tabular-nums">
                {formatVnd(w.committedVnd)} <span className="text-slate-400">/ actual {formatVnd(w.actualVnd)}</span>
              </span>
            </li>
          ))}
          {b.byWorkstream.length === 0 && <li className="text-slate-400">No spend tracked yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function Cell({ label, value, accent = '' }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-500 tracking-wide">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${accent}`}>{value}</p>
    </div>
  );
}

function Bar({ fill, pct, label }: { fill: string; pct: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20 text-slate-500">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
        <div className={`h-2 ${fill}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
    </div>
  );
}

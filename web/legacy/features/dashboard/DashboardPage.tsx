/**
 * W-07 — Dashboard. KPI grid + progress bars by phase/workstream + countdown +
 * upcoming-deadlines list + budget snapshot.
 */
import type { DashboardOverview, ProgressGroup } from '@furama/shared';
import { useDashboard } from './useDashboard';
import { formatVnd } from '../../lib/format';

interface Props { projectId: string }

export function DashboardPage({ projectId }: Props) {
  const q = useDashboard(projectId);
  if (q.isLoading) return <p className="text-slate-500">Loading dashboard…</p>;
  if (q.isError || !q.data) return <p className="text-red-600">Failed to load dashboard.</p>;
  const d = q.data;

  return (
    <div className="space-y-4">
      <Header d={d} />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Tasks" value={d.health.total} />
        <Kpi label="Completed" value={d.health.byStatus.COMPLETED ?? 0} accent="text-emerald-700" />
        <Kpi label="In progress" value={d.health.byStatus.IN_PROGRESS ?? 0} accent="text-blue-700" />
        <Kpi label="Blocked" value={d.health.byStatus.BLOCKED ?? 0} accent="text-red-700" />
        <Kpi label="Overdue" value={d.health.overdue} accent="text-red-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProgressCard title="By phase" groups={d.byPhase} />
        <ProgressCard title="By workstream" groups={d.byWorkstream} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Upcoming d={d} />
        <BudgetSnapshot d={d} />
      </div>
    </div>
  );
}

function Header({ d }: { d: DashboardOverview }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{d.projectName}</h2>
        <p className="text-sm text-slate-500">
          Overall progress: <span className="font-semibold text-slate-800">{d.health.overallPercent}%</span>
          {' · '}
          At risk: <span className="font-medium text-amber-700">{d.health.atRisk}</span>
        </p>
      </div>
      <div className="text-right">
        <p className="text-xs uppercase text-slate-500 tracking-wide">Opening</p>
        <p className="text-lg font-semibold">
          {d.openingDate ? new Date(d.openingDate).toLocaleDateString() : '—'}
        </p>
        {d.daysToOpening !== null && (
          <p className={`text-sm ${d.daysToOpening < 0 ? 'text-emerald-700' : d.daysToOpening < 30 ? 'text-red-700' : 'text-slate-500'}`}>
            {d.daysToOpening < 0 ? `${Math.abs(d.daysToOpening)} days ago` : `${d.daysToOpening} days to go`}
          </p>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <p className="text-xs uppercase text-slate-500 tracking-wide">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent ?? 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function ProgressCard({ title, groups }: { title: string; groups: ProgressGroup[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800 mb-3">{title}</h3>
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={`${title}-${g.id ?? 'unassigned'}`}>
            <div className="flex justify-between text-sm">
              <span className="text-slate-700">{g.name}</span>
              <span className="text-slate-500 tabular-nums">
                {g.completed}/{g.total} · {g.percent}%
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-slate-100 rounded">
              <div className="h-1.5 rounded bg-indigo-500" style={{ width: `${g.percent}%` }} />
            </div>
          </li>
        ))}
        {groups.length === 0 && <li className="text-sm text-slate-400">No data.</li>}
      </ul>
    </div>
  );
}

function Upcoming({ d }: { d: DashboardOverview }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800 mb-3">Upcoming deadlines (14 days)</h3>
      <ul className="space-y-1.5 text-sm">
        {d.upcomingDeadlines.map((u) => (
          <li key={u.taskId} className="flex justify-between">
            <span className="flex-1 truncate">
              <span className="font-mono text-xs text-slate-400 mr-2">{u.code}</span>
              {u.title}
            </span>
            <span className={`tabular-nums ${u.daysLeft <= 3 ? 'text-red-700' : 'text-slate-500'}`}>
              {u.daysLeft}d
            </span>
          </li>
        ))}
        {d.upcomingDeadlines.length === 0 && (
          <li className="text-slate-400">Nothing due in the next 14 days.</li>
        )}
      </ul>
    </div>
  );
}

function BudgetSnapshot({ d }: { d: DashboardOverview }) {
  const b = d.budget;
  const utilization = b.capVnd === 0 ? 0 : Math.min(100, Math.round((b.committedVnd / b.capVnd) * 100));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800 mb-3">Budget snapshot</h3>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-slate-500">Cap</dt><dd className="text-right tabular-nums">{formatVnd(b.capVnd)}</dd>
        <dt className="text-slate-500">Planned</dt><dd className="text-right tabular-nums">{formatVnd(b.plannedVnd)}</dd>
        <dt className="text-slate-500">Committed</dt><dd className="text-right tabular-nums">{formatVnd(b.committedVnd)}</dd>
        <dt className="text-slate-500">Actual</dt><dd className="text-right tabular-nums">{formatVnd(b.actualVnd)}</dd>
      </dl>
      <div className="mt-3 h-2 bg-slate-100 rounded overflow-hidden">
        <div className={`h-2 ${b.overCap ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${utilization}%` }} />
      </div>
      {b.overCap && (
        <p className="text-xs text-red-700 mt-1">Over cap — committed exceeds the project cap.</p>
      )}
      {b.overruns.length > 0 && (
        <p className="text-xs text-amber-700 mt-1">{b.overruns.length} category overrun(s).</p>
      )}
    </div>
  );
}

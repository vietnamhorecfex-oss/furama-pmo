/**
 * App shell: signed-out → LoginPage, signed-in → workspace with project selector and
 * view tabs. Drawer opens when a row/card is clicked. WS connection established on sign-in.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-store';
import { connectWs, disconnectWs, joinProjectRoom } from '../lib/ws';
import { useI18n, type Lang } from '../lib/i18n';
import { LoginPage } from '../features/auth/LoginPage';
import { useLogout } from '../features/auth/useLogin';
import { useProjects } from '../features/projects/useProjects';
import { TasksTable } from '../features/tasks/TasksTable';
import { KanbanBoard } from '../features/tasks/KanbanBoard';
import { TaskDrawer } from '../features/tasks/TaskDrawer';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { BudgetPanel } from '../features/budget/BudgetPanel';
import { GatesPanel } from '../features/milestones/GatesPanel';
import { ActivityFeed } from '../features/activity/ActivityFeed';
import { TeamPage } from '../features/team/TeamPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ImportExportPanel } from '../features/io/ImportExportPanel';
import { AssistantPanel } from '../features/ai/AssistantPanel';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { CalendarView } from '../features/calendar/CalendarView';

type View =
  | 'dashboard' | 'table' | 'board'
  | 'budget' | 'gates'
  | 'activity' | 'team' | 'settings' | 'io' | 'ai' | 'calendar';

export function App() {
  const token = useAuth((s) => s.accessToken);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!token) return;
    connectWs();
    return () => disconnectWs();
  }, [token]);

  if (!token) return <LoginPage />;
  return <Workspace userEmail={user?.email ?? ''} />;
}

function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="flex items-center gap-1 text-xs border border-slate-200 rounded-lg overflow-hidden">
      {(['vi', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          title={t.language}
          className={`px-2 py-1 font-medium uppercase transition-colors ${
            lang === l ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Workspace({ userEmail }: { userEmail: string }) {
  const { t } = useI18n();
  const projects = useProjects();
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<View>('dashboard');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const logout = useLogout();

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  useEffect(() => {
    if (projectId) joinProjectRoom(projectId);
  }, [projectId]);

  const VIEW_LABELS: Record<View, string> = {
    dashboard: t.dashboard,
    table: t.tasks,
    board: t.board,
    budget: t.budget,
    gates: t.gates,
    activity: t.activity,
    team: t.team,
    settings: t.settings,
    io: t.io,
    ai: t.ai,
    calendar: t.calendar,
  };

  const ALL_VIEWS: View[] = [
    'dashboard', 'table', 'board', 'calendar',
    'budget', 'gates', 'activity', 'team', 'settings', 'io', 'ai',
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-indigo-700">Furama PMO</h1>
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || undefined)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="" disabled>{t.selectProject}</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-3">
            <LangToggle />
            {projectId && <NotificationBell projectId={projectId} />}
            <span className="text-sm text-slate-600">{userEmail}</span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100"
            >
              {t.signOut}
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 flex-wrap">
          {ALL_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                view === v ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {projectId ? renderView(view, projectId, setOpenTaskId) : (
          <p className="text-slate-500">{t.selectProject}</p>
        )}
      </main>

      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  );
}

function renderView(
  view: View,
  projectId: string,
  setOpenTaskId: (id: string) => void,
): JSX.Element {
  switch (view) {
    case 'dashboard': return <DashboardPage projectId={projectId} />;
    case 'table': return <TasksTable projectId={projectId} onOpen={setOpenTaskId} />;
    case 'board': return <KanbanBoard projectId={projectId} onOpen={setOpenTaskId} />;
    case 'calendar': return <CalendarView projectId={projectId} onOpen={setOpenTaskId} />;
    case 'budget': return <BudgetPanel projectId={projectId} />;
    case 'gates': return <GatesPanel projectId={projectId} />;
    case 'activity': return <ActivityFeed projectId={projectId} />;
    case 'team': return <TeamPage projectId={projectId} />;
    case 'settings': return <SettingsPage projectId={projectId} />;
    case 'io': return <ImportExportPanel projectId={projectId} />;
    case 'ai': return <AssistantPanel projectId={projectId} />;
  }
}

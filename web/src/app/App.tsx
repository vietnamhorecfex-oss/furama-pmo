/**
 * App shell: signed-out → LoginPage, signed-in → workspace with project selector and
 * Table/Board view tabs. Drawer opens when a row/card is clicked. WS connection is
 * established once on sign-in and reuses on view switch.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth-store';
import { connectWs, disconnectWs, joinProjectRoom } from '../lib/ws';
import { LoginPage } from '../features/auth/LoginPage';
import { useLogout } from '../features/auth/useLogin';
import { useProjects } from '../features/projects/useProjects';
import { TasksTable } from '../features/tasks/TasksTable';
import { KanbanBoard } from '../features/tasks/KanbanBoard';
import { TaskDrawer } from '../features/tasks/TaskDrawer';

type View = 'table' | 'board';

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

function Workspace({ userEmail }: { userEmail: string }) {
  const projects = useProjects();
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<View>('table');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const logout = useLogout();

  useEffect(() => {
    if (!projectId && projects.data?.[0]) setProjectId(projects.data[0].id);
  }, [projects.data, projectId]);

  useEffect(() => {
    if (projectId) joinProjectRoom(projectId);
  }, [projectId]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold">Furama PMO</h1>
          <select
            value={projectId ?? ''}
            onChange={(e) => setProjectId(e.target.value || undefined)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="" disabled>Select a project…</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <span>{userEmail}</span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2 flex gap-2">
          {(['table', 'board'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm rounded ${
                view === v ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {v === 'table' ? 'Table' : 'Board'}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {projectId ? (
          view === 'table' ? (
            <TasksTable projectId={projectId} onOpen={(id) => setOpenTaskId(id)} />
          ) : (
            <KanbanBoard projectId={projectId} onOpen={(id) => setOpenTaskId(id)} />
          )
        ) : (
          <p className="text-slate-500">Select a project to begin.</p>
        )}
      </main>

      {openTaskId && <TaskDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  );
}

'use client';
import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { api } from '@/lib/api-client';
import { useI18n, type Lang } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useProjects } from '@/features/projects/useProjects';
import { useLogout } from '@/features/auth/useLogin';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { TaskDrawerHost } from '@/features/tasks/TaskDrawerHost';
import type { MeResponse } from '@furama/shared';

type Tab = { seg: string; key: string; cap?: 'MANAGE_CONFIG' | 'IMPORT_EXPORT' };
const TABS: Tab[] = [
  { seg: 'dashboard', key: 'dashboard' }, { seg: 'tasks', key: 'tasks' },
  { seg: 'board', key: 'board' }, { seg: 'calendar', key: 'calendar' },
  { seg: 'budget', key: 'budget' }, { seg: 'gates', key: 'gates' },
  { seg: 'activity', key: 'activity' }, { seg: 'team', key: 'team' },
  { seg: 'settings', key: 'settings', cap: 'MANAGE_CONFIG' },
  { seg: 'io', key: 'io', cap: 'IMPORT_EXPORT' },
  { seg: 'ai', key: 'ai' },
];

function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="flex items-center gap-1 text-xs border border-slate-200 rounded-lg overflow-hidden">
      {(['vi', 'en'] as Lang[]).map((l) => (
        <button key={l} type="button" onClick={() => setLang(l)} title={t.language}
          className={`px-2 py-1 font-medium uppercase transition-colors ${lang === l ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function ProjectLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const projects = useProjects();
  const logout = useLogout();
  const { can } = usePermissions(projectId);
  const [ready, setReady] = useState<boolean>(!!user);

  // Session rehydrate on cold load.
  useEffect(() => {
    if (user) { setReady(true); return; }
    api.get<MeResponse>('/auth/me')
      .then(({ data }) => { setSession(useAuth.getState().accessToken ?? '', data.user); setReady(true); })
      .catch(() => router.replace('/login'));
  }, [user, setSession, router]);

  const labels = t as Record<string, string>;
  const visible = TABS.filter((tab) => !tab.cap || can(tab.cap));

  if (!ready) return <div className="min-h-screen grid place-items-center text-slate-400">…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <h1 className="text-lg font-bold text-indigo-700">Furama PMO</h1>
          <select value={projectId}
            onChange={(e) => router.push(`/projects/${e.target.value}/dashboard`)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-3">
            <LangToggle />
            <NotificationBell projectId={projectId} />
            <span className="text-sm text-slate-600">{user?.email}</span>
            <button type="button" onClick={() => logout.mutate()}
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100">{t.signOut}</button>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 flex-wrap">
          {visible.map((tab) => {
            const href = `/projects/${projectId}/${tab.seg}`;
            const active = pathname === href;
            return (
              <Link key={tab.seg} href={href}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {labels[tab.key]}
              </Link>
            );
          })}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-4">{children}</main>
      <TaskDrawerHost projectId={projectId} />
    </div>
  );
}

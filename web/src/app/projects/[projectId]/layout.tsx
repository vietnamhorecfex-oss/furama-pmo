'use client';
import { type ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { bootstrapSession } from '@/lib/api-client';
import { useI18n, type Lang } from '@/lib/i18n';
import { usePermissions, type Cap } from '@/lib/permissions';
import { useProjects } from '@/features/projects/useProjects';
import { useLogout } from '@/features/auth/useLogin';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { TaskDrawerHost } from '@/features/tasks/TaskDrawerHost';
import { Spinner } from '@/components/Spinner';
import { ProgressLink } from '@/components/ProgressLink';

type Tab = { seg: string; key: string; cap?: Cap };
const TABS: Tab[] = [
  { seg: 'dashboard', key: 'dashboard' }, { seg: 'tasks', key: 'tasks' },
  { seg: 'board', key: 'board' }, { seg: 'calendar', key: 'calendar' },
  { seg: 'budget', key: 'budget' }, { seg: 'gates', key: 'gates' },
  { seg: 'activity', key: 'activity', cap: 'VIEW_AUDIT' }, { seg: 'team', key: 'team' },
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
          className={`px-2.5 py-2 sm:px-2 sm:py-1 font-medium uppercase transition-colors ${lang === l ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
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
  const projects = useProjects();
  const logout = useLogout();
  const { can } = usePermissions(projectId);
  const [ready, setReady] = useState<boolean>(!!user);

  // Session rehydrate on cold load: refresh from the cookie, then load the profile.
  useEffect(() => {
    if (user) { setReady(true); return; }
    bootstrapSession()
      .then(() => setReady(true))
      .catch(() => router.replace('/login'));
  }, [user, router]);

  const labels = t as Record<string, string>;
  const visible = TABS.filter((tab) => !tab.cap || can(tab.cap));

  // Mobile tab strip scrolls horizontally — keep the active tab in view.
  // Deps: the strip only mounts once `ready`, and permission-gated tabs appear
  // later (when `can()` resolves), shifting the active tab — re-center on both.
  const navRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname, ready, visible.length]);

  if (!ready) return <div className="min-h-screen grid place-items-center"><Spinner className="h-8 w-8" /></div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-4">
          <h1 className="sm:order-1 text-lg font-bold text-indigo-700 whitespace-nowrap">Furama PMO</h1>
          <div className="sm:order-3 ml-auto flex items-center gap-1.5 sm:gap-3">
            <LangToggle />
            <NotificationBell projectId={projectId} />
            <span className="hidden md:inline text-sm text-slate-600 truncate max-w-[180px] lg:max-w-none">{user?.email}</span>
            <button type="button" onClick={() => logout.mutate()}
              className="rounded border border-slate-300 px-2 py-1.5 sm:py-1 text-sm hover:bg-slate-100 whitespace-nowrap">{t.signOut}</button>
          </div>
          {/* Last in source so the phone layout wraps it to its own full-width row. */}
          <select value={projectId}
            onChange={(e) => router.push(`/projects/${e.target.value}/dashboard`)}
            className="sm:order-2 w-full min-w-0 sm:w-auto rounded-md border border-slate-300 px-2 py-1.5 text-sm">
            {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div ref={navRef} className="max-w-7xl mx-auto px-4 pb-2 flex gap-1 overflow-x-auto no-scrollbar sm:flex-wrap sm:overflow-x-visible">
          {visible.map((tab) => {
            const href = `/projects/${projectId}/${tab.seg}`;
            const active = pathname === href;
            return (
              <ProgressLink key={tab.seg} href={href} aria-current={active ? 'page' : undefined}
                className={`px-3 py-1.5 text-sm rounded transition-colors whitespace-nowrap shrink-0 ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {labels[tab.key]}
              </ProgressLink>
            );
          })}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-4">{children}</main>
      <Suspense fallback={null}>
        <TaskDrawerHost />
      </Suspense>
    </div>
  );
}

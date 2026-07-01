# Phase 5 — App Router UI: route tree + feature migration + polling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the legacy Vite tab-workspace (`web/legacy/`) with a real Next.js App Router route tree, migrating all 11 feature views + shared libs into `web/src/`, wiring them to the already-ported `/api/v1` route handlers, and replacing the dropped WebSocket layer with TanStack Query polling.

**Architecture:** A canonical axios api-client (ported from legacy, single-inflight refresh) + zustand auth-store back every feature hook. `web/src/app/projects/page.tsx` lists projects; `web/src/app/projects/[projectId]/layout.tsx` is the workspace shell (header, project selector, nav `<Link>` tabs, notification bell, language toggle, logout, and a task drawer opened via the `?task=<id>` search param). Eleven sibling sub-routes render one migrated feature component each. Feature components and hooks move nearly verbatim from `legacy/features/**`; the only rewrites are import-path fixes, dropping `ws.ts`, and adding `refetchInterval` polling to the queries WS used to invalidate.

**Tech Stack:** Next.js 14 App Router (client components), TanStack Query 5, axios, zustand, Tailwind 3, zod DTOs from `@furama/shared`. No new backend. No streaming.

## Global Constraints

- **Faithful UI port.** The visual/UX contract is the legacy components under `web/legacy/features/**` and `web/legacy/lib/**`. Move them with minimal change; do NOT redesign. Any behavioral deviation beyond the mechanical rules below MUST be recorded in `docs/CHANGELOG.md` (Golden Rule #1).
- **Mechanical migration rules (apply to every moved file):**
  1. Move `legacy/features/X/*` → `src/features/X/*` and `legacy/lib/*` → `src/lib/*` (except `ws.ts`, `api-client.ts`, `auth-store.ts`, `query-client.ts` — see below).
  2. Fix relative imports only: `../../lib/api-client` etc. keep resolving to the new `src/lib`. Prefer the `@/` alias (`@/lib/...`, `@/features/...`) for cross-tree imports in NEW files; moved files may keep working relative paths if they still resolve.
  3. Add `'use client';` as the FIRST line of every moved component/hook file that uses hooks, state, effects, or event handlers (all of them do). Legacy Vite files had no directive; Next requires it.
  4. Drop all `ws.ts` imports (`connectWs`/`disconnectWs`/`joinProjectRoom`/`leaveProjectRoom`). Replace their realtime effect with polling — see the Polling rule.
  5. Do NOT change component markup, Tailwind classes, i18n keys, query keys, or API paths. Byte-for-byte where possible.
- **Canonical api-client = the legacy axios client.** Port `legacy/lib/api-client.ts` to `src/lib/api-client.ts` verbatim (axios instance, request interceptor attaching the bearer token, single-inflight `refreshAccessTokenOnce`, response interceptor retrying one 401). Add `axios` to `web/package.json` dependencies. This REPLACES the current fetch-based `api<T>()`. Legacy hooks call `api.get/post/patch/delete(url, { params })` and read `.data` — keep that shape.
- **auth-store reconciliation.** The store must expose every method both the current code and the legacy code call: `accessToken`, `user`, `setSession(token, user)`, `setToken(token)`, `setAccessToken(token)` (alias of setToken — legacy name), `clear()`. `user` is `PublicUser | null` from `@furama/shared` (has `.id`, `.email`).
- **Polling replaces WebSocket.** Define `export const POLL_MS = 20_000;` in `src/lib/query-client.ts`. Every query key the old `ws.ts` invalidated gets `refetchInterval: POLL_MS`: tasks lists (`['tasks', …]`), single task (`['task', …]`), comments (`['comments', …]`). Dashboard and budget queries also get `refetchInterval: POLL_MS` (they reflect task changes). The notification query already polls at 30s — leave it. Do not add polling to config/members/workstreams/project-list queries (rarely change; refetchOnWindowFocus suffices).
- **Session survives reload.** zustand state is in-memory, so a page reload loses `accessToken` + `user`. The `[projectId]/layout.tsx` (or a small `AuthBootstrap` client component it renders) MUST, on mount when `user` is null, call `GET /api/v1/auth/me` via the api-client (which silently refreshes the access token from the `furama_refresh` cookie on its first 401) and `setSession` the result. Until bootstrap resolves, render a lightweight loading state. If `/auth/me` fails, `router.replace('/login')`.
- **RBAC is UI-gating only.** `usePermissions(projectId).can(cap)` hides/disables actions; the server still enforces every write. Migrate `permissions.ts` verbatim. Never rely on it for security.
- **No new lint/type debt.** `npx tsc --noEmit` clean after every task; `npx next build` clean at the layout task and the final task. No new `any` beyond what legacy already had.

---

## File Structure (target)

```
src/lib/
  api-client.ts      (REWRITE: axios port of legacy)
  auth-store.ts      (EXTEND: add setAccessToken alias)
  query-client.ts    (EXTEND: add POLL_MS export)
  i18n.tsx           (MOVE from legacy)
  permissions.ts     (MOVE from legacy)
  format.ts          (MOVE from legacy)
  schedule.ts        (MOVE from legacy)
src/features/**       (MOVE all 11 features + their hooks from legacy/features/**)
src/app/
  providers.tsx      (EXTEND: wrap children in <I18nProvider>)
  login/page.tsx     (KEEP; optional: route to /projects on existing session)
  projects/page.tsx  (REWRITE: project list → links into workspace)
  projects/[projectId]/
    layout.tsx       (NEW: workspace shell + AuthBootstrap + task drawer via ?task=)
    dashboard/page.tsx  tasks/page.tsx  board/page.tsx  calendar/page.tsx
    budget/page.tsx  gates/page.tsx  activity/page.tsx  team/page.tsx
    settings/page.tsx  io/page.tsx  ai/page.tsx
```

After migration the `web/legacy/` directory is DELETED (final task). `middleware.ts` already guards `/projects*` by the refresh cookie — no change needed.

---

## Task 5.1: Client foundation (api-client, auth-store, query-client, libs, providers)

**Files:**
- Rewrite: `src/lib/api-client.ts` (axios port)
- Modify: `src/lib/auth-store.ts` (add `setAccessToken`), `src/lib/query-client.ts` (add `POLL_MS`), `src/app/providers.tsx` (add `I18nProvider`), `web/package.json` (add `axios`)
- Move: `legacy/lib/i18n.tsx` → `src/lib/i18n.tsx`; `legacy/lib/permissions.ts` → `src/lib/permissions.ts`; `legacy/lib/format.ts` → `src/lib/format.ts`; `legacy/lib/schedule.ts` → `src/lib/schedule.ts`

**Interfaces:**
- Produces: `api` (axios instance) from `@/lib/api-client`; `useAuth` store with `setSession/setToken/setAccessToken/clear` from `@/lib/auth-store`; `POLL_MS` + `makeQueryClient` from `@/lib/query-client`; `I18nProvider`, `useI18n`, `Lang` from `@/lib/i18n`; `usePermissions`, `useMyRole`, `can`, `Role`, `Cap` from `@/lib/permissions`; `format`/`schedule` helpers.
- Note: `permissions.ts` imports `useMembers` from `../features/team/useMembers` — that hook is moved in Task 5.5. To keep 5.1 self-contained and typecheck-clean, ALSO move `legacy/features/team/useMembers.ts` → `src/features/team/useMembers.ts` as part of this task (it is a leaf data hook with no component deps). Add `'use client'` to it.

- [ ] **Step 1: Add axios dependency**

Edit `web/package.json` dependencies to add `"axios": "^1.7.2"`, then:
```bash
cd /Users/bcmac/Desktop/projects/furama-pmo && npm install
```
Expected: installs axios, no errors.

- [ ] **Step 2: Port the axios api-client**

Copy `web/legacy/lib/api-client.ts` to `web/src/lib/api-client.ts` VERBATIM, then prepend `'use client';` as the first line. It imports `useAuth` from `./auth-store` — keep that path (both are in `src/lib/`). It calls `useAuth.getState().setAccessToken(...)` and `.clear()` — both must exist after Step 3.

- [ ] **Step 3: Extend auth-store**

Modify `src/lib/auth-store.ts` to add `setAccessToken` (alias of `setToken`). Final store:

```ts
'use client';
import { create } from 'zustand';
import type { PublicUser } from '@furama/shared';

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setSession: (token: string, user: PublicUser) => void;
  setToken: (token: string) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
}
export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setToken: (accessToken) => set({ accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ accessToken: null, user: null }),
}));
```

- [ ] **Step 4: Extend query-client with POLL_MS**

Modify `src/lib/query-client.ts` to add `export const POLL_MS = 20_000;` (keep `makeQueryClient` unchanged).

- [ ] **Step 5: Move i18n, permissions, format, schedule**

```bash
cd /Users/bcmac/Desktop/projects/furama-pmo/web
git mv legacy/lib/i18n.tsx src/lib/i18n.tsx
git mv legacy/lib/permissions.ts src/lib/permissions.ts
git mv legacy/lib/format.ts src/lib/format.ts
git mv legacy/lib/schedule.ts src/lib/schedule.ts
mkdir -p src/features/team && git mv legacy/features/team/useMembers.ts src/features/team/useMembers.ts
```
Then: prepend `'use client';` to `i18n.tsx`, `permissions.ts`, and `useMembers.ts` (format.ts/schedule.ts are pure — add `'use client'` only if they use browser APIs; check and add if `Intl`/`Date` usage requires it — pure functions do NOT need the directive, leave them alone if they export only pure functions). Fix any relative import in `useMembers.ts` (`../../lib/api-client` still resolves from `src/features/team/` → `src/lib/`; confirm).

- [ ] **Step 6: Wire I18nProvider into providers**

Modify `src/app/providers.tsx`:
```tsx
'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { makeQueryClient } from '@/lib/query-client';
import { I18nProvider } from '@/lib/i18n';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <I18nProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </I18nProvider>
  );
}
```

- [ ] **Step 7: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: no type errors; build succeeds (the existing login/projects pages + api routes compile). If `next build` complains about a moved file's missing `'use client'`, add it.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): client foundation — axios api-client, i18n/permissions/format/schedule, polling constant"
```

---

## Task 5.2: Workspace shell — project list, `[projectId]` layout, nav, auth bootstrap, task drawer

**Files:**
- Move: `legacy/features/projects/useProjects.ts` → `src/features/projects/useProjects.ts`; `legacy/features/auth/useLogin.ts` → `src/features/auth/useLogin.ts` (provides `useLogout`)
- Rewrite: `src/app/projects/page.tsx` (project list)
- Create: `src/app/projects/[projectId]/layout.tsx`, `src/app/projects/[projectId]/dashboard/page.tsx` (placeholder rendering "Dashboard" until Task 5.4 — see note), and a shared `src/features/_shell/` if needed for the nav.
- Note: the layout references the 11 feature components. To keep this task building BEFORE those are migrated, each not-yet-migrated sub-route gets a temporary placeholder `page.tsx` returning `<div className="p-4 text-slate-400">…</div>`. Later tasks replace placeholders with real components. Create all 11 sub-route folders with placeholders in THIS task so the nav links resolve.

**Interfaces:**
- Consumes: `useProjects` (`['projects']` query, `GET /projects`), `useLogout`, `usePermissions`, `useI18n`, `useAuth`, `api`.
- Produces: the route shell every feature page renders inside. `TaskDrawerHost` reads `useSearchParams().get('task')` and renders the drawer (drawer component itself lands in Task 5.3 — until then the host renders nothing when task param present, or a placeholder).

- [ ] **Step 1: Move projects + auth hooks**

```bash
cd /Users/bcmac/Desktop/projects/furama-pmo/web
mkdir -p src/features/projects src/features/auth
git mv legacy/features/projects/useProjects.ts src/features/projects/useProjects.ts
git mv legacy/features/auth/useLogin.ts src/features/auth/useLogin.ts
```
Prepend `'use client';` to both. Verify their api-client import path resolves.

- [ ] **Step 2: Project list page**

Rewrite `src/app/projects/page.tsx` — a client page listing projects, each linking to `/projects/<id>/dashboard`. Full code:

```tsx
'use client';
import Link from 'next/link';
import { useProjects } from '@/features/projects/useProjects';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth-store';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

export default function ProjectsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const setSession = useAuth((s) => s.setSession);
  const projects = useProjects();

  // Rehydrate user on a cold load (cookie present, in-memory store empty).
  useEffect(() => {
    if (user) return;
    api.get('/auth/me').then(({ data }) => setSession(useAuth.getState().accessToken ?? '', data))
      .catch(() => router.replace('/login'));
  }, [user, setSession, router]);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-lg font-bold text-indigo-700 mb-4">Furama PMO — {t.selectProject}</h1>
      {projects.isLoading && <p className="text-slate-400">…</p>}
      <ul className="space-y-2">
        {projects.data?.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}/dashboard`}
              className="block rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50/40">
              <span className="font-medium text-slate-800">{p.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: Workspace layout**

Create `src/app/projects/[projectId]/layout.tsx`. This is the migrated `App.tsx` `Workspace` shell, but projectId comes from the route and view navigation uses `<Link>`/`usePathname` instead of `useState<View>`. Full code:

```tsx
'use client';
import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { api } from '@/lib/api-client';
import { useI18n, type Lang } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useProjects } from '@/features/projects/useProjects';
import { useLogout } from '@/features/auth/useLogin';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { TaskDrawerHost } from '@/features/tasks/TaskDrawerHost';

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
    api.get('/auth/me')
      .then(({ data }) => { setSession(useAuth.getState().accessToken ?? '', data); setReady(true); })
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
```

- [ ] **Step 4: TaskDrawerHost stub**

Create `src/features/tasks/TaskDrawerHost.tsx` (real drawer wired in Task 5.3):
```tsx
'use client';
import { useRouter, useSearchParams } from 'next/navigation';

export function TaskDrawerHost({ projectId }: { projectId: string }) {
  const taskId = useSearchParams().get('task');
  const router = useRouter();
  void projectId;
  if (!taskId) return null;
  // Real TaskDrawer lands in Task 5.3. Placeholder keeps the route contract stable.
  return null;
}
```
(Task 5.3 replaces the body with the actual `<TaskDrawer taskId onClose={() => router.push(pathname)} />`.)

- [ ] **Step 5: Placeholder sub-pages (all 11)**

Create `src/app/projects/[projectId]/<seg>/page.tsx` for each of: dashboard, tasks, board, calendar, budget, gates, activity, team, settings, io, ai. Each:
```tsx
export default function Page() {
  return <div className="p-4 text-slate-400">…</div>;
}
```
(These are Server Components by default — fine as static placeholders. Later tasks convert each to `'use client'` rendering the feature component.)

- [ ] **Step 6: NotificationBell early-move**

The layout imports `NotificationBell`. Move it now: `git mv legacy/features/notifications/NotificationBell.tsx src/features/notifications/NotificationBell.tsx`, prepend `'use client';`, fix imports (`../../lib/api-client`→ resolves; `../../lib/i18n`→ resolves). It already polls at 30s — leave that.

- [ ] **Step 7: Typecheck + build + smoke**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: clean. Then document a manual smoke in the report (login → `/projects` list → click a project → workspace shell with tabs renders; tab links navigate; reload keeps you in the workspace via `/auth/me`). If the dev server isn't runnable in your environment, note the smoke as deferred and rely on `next build`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): workspace route shell — project list, [projectId] layout, nav, auth bootstrap, notification bell"
```

---

## Task 5.3: Task views — table, board, calendar, drawer + hooks

**Files:**
- Move: `legacy/features/tasks/*` → `src/features/tasks/*` (TasksTable, KanbanBoard, TaskDrawer, useTasks), `legacy/features/comments/useComments.ts` → `src/features/comments/useComments.ts`, `legacy/features/calendar/CalendarView.tsx` → `src/features/calendar/CalendarView.tsx`
- Rewrite: `src/features/tasks/TaskDrawerHost.tsx` (real drawer), the `tasks/`, `board/`, `calendar/` sub-pages
- Polling: add `refetchInterval: POLL_MS` to `useTasks`, `useAllTasks`, `useTask`, `useComments`.

**Interfaces:**
- Consumes: `usePermissions`, `useI18n`, `format`, `schedule`, `api`, DTOs.
- Produces: `<TasksTable projectId onOpen>`, `<KanbanBoard projectId onOpen>`, `<CalendarView projectId onOpen>`, `<TaskDrawer taskId onClose>`. The `onOpen(taskId)` prop now pushes `?task=<id>`.

- [ ] **Step 1: Move task/comment/calendar files**

```bash
cd /Users/bcmac/Desktop/projects/furama-pmo/web
mkdir -p src/features/comments src/features/calendar
git mv legacy/features/tasks/TasksTable.tsx src/features/tasks/TasksTable.tsx
git mv legacy/features/tasks/KanbanBoard.tsx src/features/tasks/KanbanBoard.tsx
git mv legacy/features/tasks/TaskDrawer.tsx src/features/tasks/TaskDrawer.tsx
git mv legacy/features/tasks/useTasks.ts src/features/tasks/useTasks.ts
git mv legacy/features/comments/useComments.ts src/features/comments/useComments.ts
git mv legacy/features/calendar/CalendarView.tsx src/features/calendar/CalendarView.tsx
```
Prepend `'use client';` to each. Fix imports (relative `../../lib/*` still resolve; `../comments/useComments` resolves).

- [ ] **Step 2: Drop ws + add polling**

In `useTasks.ts`: add `refetchInterval: POLL_MS` (import `POLL_MS` from `@/lib/query-client`) to the `useQuery` options in `useTasks`, `useAllTasks`, and `useTask`. In `useComments.ts`: add `refetchInterval: POLL_MS` to its list query. Remove any `ws`/`connectWs`/`joinProjectRoom` import if present in these files (grep first). Do NOT change query keys, params, or mutation logic.

- [ ] **Step 3: Wire the onOpen→search-param bridge**

The legacy components take `onOpen: (id: string) => void`. Keep the prop. The pages pass an `onOpen` that pushes the search param. Real `TaskDrawerHost`:
```tsx
'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TaskDrawer } from './TaskDrawer';

export function TaskDrawerHost({ projectId }: { projectId: string }) {
  const taskId = useSearchParams().get('task');
  const router = useRouter();
  const pathname = usePathname();
  void projectId;
  if (!taskId) return null;
  return <TaskDrawer taskId={taskId} onClose={() => router.push(pathname)} />;
}
```
If `TaskDrawer`'s prop signature differs (e.g. needs `projectId`), adapt the call to match the moved component's actual props — read `TaskDrawer.tsx` and wire exactly what it declares.

- [ ] **Step 4: Real sub-pages (tasks, board, calendar)**

`src/app/projects/[projectId]/tasks/page.tsx`:
```tsx
'use client';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { TasksTable } from '@/features/tasks/TasksTable';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  return <TasksTable projectId={projectId} onOpen={(id) => router.push(`${pathname}?task=${id}`)} />;
}
```
Board and calendar pages are identical with `KanbanBoard`/`CalendarView` swapped in. (If a component's prop name isn't `onOpen`, match its real signature.)

- [ ] **Step 5: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: clean. Fix any surfaced import/`'use client'` issue.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): task views (table/board/calendar/drawer) + polling, drawer via ?task="
```

---

## Task 5.4: Analytics & activity views — dashboard, budget, gates, activity

**Files:**
- Move: `legacy/features/dashboard/*`, `legacy/features/budget/*`, `legacy/features/milestones/GatesPanel.tsx`, `legacy/features/activity/*` → mirrored `src/features/**`
- Rewrite the `dashboard/`, `budget/`, `gates/`, `activity/` sub-pages to render the components.
- Polling: add `refetchInterval: POLL_MS` to the dashboard query and the budget query.

- [ ] **Step 1: Move files**

```bash
cd /Users/bcmac/Desktop/projects/furama-pmo/web
mkdir -p src/features/dashboard src/features/budget src/features/milestones src/features/activity
git mv legacy/features/dashboard/DashboardPage.tsx src/features/dashboard/DashboardPage.tsx
git mv legacy/features/dashboard/useDashboard.ts src/features/dashboard/useDashboard.ts
git mv legacy/features/budget/BudgetPanel.tsx src/features/budget/BudgetPanel.tsx
git mv legacy/features/budget/useBudget.ts src/features/budget/useBudget.ts
git mv legacy/features/budget/budgetCsv.ts src/features/budget/budgetCsv.ts
git mv legacy/features/milestones/GatesPanel.tsx src/features/milestones/GatesPanel.tsx
git mv legacy/features/activity/ActivityFeed.tsx src/features/activity/ActivityFeed.tsx
git mv legacy/features/activity/useActivity.ts src/features/activity/useActivity.ts
```
Prepend `'use client';` to each `.tsx`/hook (budgetCsv.ts is likely pure — check; add directive only if it uses browser APIs like `Blob`/`URL.createObjectURL`, which it may for CSV download → then it needs `'use client'`).

- [ ] **Step 2: Add polling**

`useDashboard.ts` and `useBudget.ts`: add `refetchInterval: POLL_MS` to their `useQuery` options. Remove any ws import.

- [ ] **Step 3: Real sub-pages**

Each page mirrors the pattern (client component, read `projectId` from `useParams`, render the feature component). Example `dashboard/page.tsx`:
```tsx
'use client';
import { useParams } from 'next/navigation';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <DashboardPage projectId={projectId} />;
}
```
`budget`, `gates`, `activity` pages follow the same shape with `BudgetPanel`/`GatesPanel`/`ActivityFeed`. Match each component's real prop names (read the moved file).

- [ ] **Step 4: Typecheck + build**

Run: `cd web && npx tsc --noEmit && npx next build` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): analytics & activity views (dashboard/budget/gates/activity) + polling"
```

---

## Task 5.5: Admin & AI views + delete legacy

**Files:**
- Move: `legacy/features/team/*` (TeamPage, MemberFormModal, useWorkstreams — useMembers already moved in 5.1), `legacy/features/settings/*` (SettingsPage, ConfigLists, useConfig), `legacy/features/io/ImportExportPanel.tsx`, `legacy/features/ai/AssistantPanel.tsx` → mirrored `src/features/**`
- Rewrite the `team/`, `settings/`, `io/`, `ai/` sub-pages.
- Move `legacy/features/auth/LoginPage.tsx` only if the current `src/app/login/page.tsx` should be replaced by it — otherwise DELETE the legacy LoginPage (the Next login page already exists and works). Decide by comparing; default: keep the existing Next login page, drop legacy LoginPage.
- DELETE the entire `web/legacy/` directory.

- [ ] **Step 1: Move remaining features**

```bash
cd /Users/bcmac/Desktop/projects/furama-pmo/web
mkdir -p src/features/settings src/features/io src/features/ai
git mv legacy/features/team/TeamPage.tsx src/features/team/TeamPage.tsx
git mv legacy/features/team/MemberFormModal.tsx src/features/team/MemberFormModal.tsx
git mv legacy/features/team/useWorkstreams.ts src/features/team/useWorkstreams.ts
git mv legacy/features/settings/SettingsPage.tsx src/features/settings/SettingsPage.tsx
git mv legacy/features/settings/ConfigLists.tsx src/features/settings/ConfigLists.tsx
git mv legacy/features/settings/useConfig.ts src/features/settings/useConfig.ts
git mv legacy/features/io/ImportExportPanel.tsx src/features/io/ImportExportPanel.tsx
git mv legacy/features/ai/AssistantPanel.tsx src/features/ai/AssistantPanel.tsx
```
Prepend `'use client';` to each. Fix imports.

- [ ] **Step 2: Real sub-pages (team, settings, io, ai)**

Same client-page pattern, rendering `TeamPage`/`SettingsPage`/`ImportExportPanel`/`AssistantPanel` with `projectId` from `useParams`. Match each component's real props.

- [ ] **Step 3: Delete legacy + prune**

```bash
cd /Users/bcmac/Desktop/projects/furama-pmo/web
git rm -r legacy
```
Remove the `"legacy"` entry from `tsconfig.json` `"exclude"` (it no longer exists). Confirm no `src/**` file imports from `../legacy` or `legacy/` (grep — must be zero).

- [ ] **Step 4: Full typecheck + build + suite**

Run: `cd web && npx tsc --noEmit && npx next build && npx vitest run`
Expected: type-clean, build succeeds, server tests still 159/159 (UI move must not touch server tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): admin & AI views (team/settings/io/ai); remove legacy Vite tree"
```

---

## Post-plan: CHANGELOG

Add a Phase 5 section to `docs/CHANGELOG.md`: tab-workspace → App Router route tree (`/projects/[projectId]/<view>`); task drawer via `?task=` search param instead of `openTaskId` state; WebSocket (`ws.ts`, socket.io) DROPPED, replaced by `refetchInterval: POLL_MS` (20s) polling on tasks/task/comments/dashboard/budget queries; canonical api-client switched to the axios legacy client; session-on-reload fixed via `/auth/me` bootstrap; `web/legacy/` deleted. Note socket.io-client is no longer a dependency.

## Self-Review (plan author)

- **Coverage:** all 11 views mapped to routes + tasks; shared libs (i18n/permissions/format/schedule) in 5.1; drawer + polling in 5.3; legacy deletion + full build in 5.5. Login already works (Phase 0). Notifications bell in 5.2 (layout needs it).
- **Ordering/deps:** 5.1 foundation (api-client, libs, useMembers for permissions) → 5.2 shell (needs foundation + NotificationBell) → 5.3/5.4/5.5 fill placeholder routes. `useMembers` moved early (5.1) because `permissions.ts` imports it. Placeholders in 5.2 keep the build green while views land incrementally.
- **Risk:** UI has no unit tests (vitest env is `node`); gate is `tsc --noEmit` + `next build` (validates route tree + RSC/'use client' boundaries) + a documented manual smoke. Playwright E2E is Phase 7. This is the accepted trade-off for a faithful move-and-rewire.
- **Verify-at-execution (implementer must read the moved file, not guess):** exact prop signatures of each feature component (`onOpen` name, whether `projectId` required), whether `format.ts`/`schedule.ts`/`budgetCsv.ts` need `'use client'` (only if they touch browser APIs), and whether `TaskDrawer` needs `projectId`. These are called out inline; do not assume.

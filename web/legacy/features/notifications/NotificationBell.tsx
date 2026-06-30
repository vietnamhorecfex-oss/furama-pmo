/**
 * Notification bell — fetches from GET /projects/:pid/notifications,
 * shows unread badge, marks individual items read on click.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { useI18n } from '../../lib/i18n';

interface Notification {
  id: string;
  type: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  INFO: 'bg-blue-100 text-blue-700',
  WARN: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-red-100 text-red-700',
};

export function NotificationBell({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications', projectId],
    queryFn: async (): Promise<Notification[]> => {
      const { data } = await api.get(`/projects/${projectId}/notifications`);
      return data as Notification[];
    },
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', projectId] }),
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const unread = (query.data ?? []).filter((n) => !n.readAt);
      await Promise.all(unread.map((n) => api.post(`/notifications/${n.id}/read`)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', projectId] }),
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const notifications = query.data ?? [];
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
        title={t.notifications}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-0.5">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="font-semibold text-sm text-slate-800">{t.notifications}</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                {t.markAllRead}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">{t.noNotifications}</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => { if (!n.readAt) markRead.mutate(n.id); }}
                  className={`w-full text-left px-4 py-3 border-b border-slate-50 hover:bg-slate-50 transition-colors ${!n.readAt ? 'bg-indigo-50/40' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${SEVERITY_COLOR[n.severity]}`}>
                      {n.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.readAt ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!n.readAt && (
                      <div className="mt-1.5 w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

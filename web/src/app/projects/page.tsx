'use client';
import Link from 'next/link';
import { useProjects } from '@/features/projects/useProjects';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth-store';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { bootstrapSession } from '@/lib/api-client';

export default function ProjectsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const projects = useProjects();

  // Rehydrate user on a cold load: refresh from the cookie, then load the profile.
  useEffect(() => {
    if (user) return;
    bootstrapSession().catch(() => router.replace('/login'));
  }, [user, router]);

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

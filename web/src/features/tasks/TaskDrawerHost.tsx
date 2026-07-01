'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TaskDrawer } from './TaskDrawer';

export function TaskDrawerHost() {
  const taskId = useSearchParams().get('task');
  const router = useRouter();
  const pathname = usePathname();
  if (!taskId) return null;
  return <TaskDrawer taskId={taskId} onClose={() => router.push(pathname)} />;
}

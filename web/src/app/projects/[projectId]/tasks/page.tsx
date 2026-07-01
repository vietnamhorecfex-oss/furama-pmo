'use client';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { TasksTable } from '@/features/tasks/TasksTable';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  return <TasksTable projectId={projectId} onOpen={(id) => router.push(`${pathname}?task=${id}`)} />;
}

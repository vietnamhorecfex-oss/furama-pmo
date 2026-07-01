'use client';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { KanbanBoard } from '@/features/tasks/KanbanBoard';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  return <KanbanBoard projectId={projectId} onOpen={(id) => router.push(`${pathname}?task=${id}`)} />;
}

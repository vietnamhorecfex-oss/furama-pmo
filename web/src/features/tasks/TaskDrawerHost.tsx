'use client';
import { useSearchParams } from 'next/navigation';

export function TaskDrawerHost({ projectId }: { projectId: string }) {
  const taskId = useSearchParams().get('task');
  void projectId;
  if (!taskId) return null;
  // Real TaskDrawer lands in Task 5.3. Placeholder keeps the route contract stable.
  return null;
}

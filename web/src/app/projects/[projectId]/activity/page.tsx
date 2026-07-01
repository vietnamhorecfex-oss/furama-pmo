'use client';
import { useParams } from 'next/navigation';
import { ActivityFeed } from '@/features/activity/ActivityFeed';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ActivityFeed projectId={projectId} />;
}

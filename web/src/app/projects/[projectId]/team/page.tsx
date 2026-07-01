'use client';
import { useParams } from 'next/navigation';
import { TeamPage } from '@/features/team/TeamPage';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <TeamPage projectId={projectId} />;
}

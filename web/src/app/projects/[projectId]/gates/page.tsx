'use client';
import { useParams } from 'next/navigation';
import { GatesPanel } from '@/features/milestones/GatesPanel';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <GatesPanel projectId={projectId} />;
}

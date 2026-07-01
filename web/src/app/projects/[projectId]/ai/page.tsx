'use client';
import { useParams } from 'next/navigation';
import { AssistantPanel } from '@/features/ai/AssistantPanel';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <AssistantPanel projectId={projectId} />;
}

'use client';
import { useParams } from 'next/navigation';
import { DigestPanel } from '@/features/ai/DigestPanel';
import { AssistantPanel } from '@/features/ai/AssistantPanel';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <div className="space-y-4">
      <DigestPanel projectId={projectId} />
      <AssistantPanel projectId={projectId} />
    </div>
  );
}

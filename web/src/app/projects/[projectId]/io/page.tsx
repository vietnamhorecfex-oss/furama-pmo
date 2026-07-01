'use client';
import { useParams } from 'next/navigation';
import { ImportExportPanel } from '@/features/io/ImportExportPanel';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ImportExportPanel projectId={projectId} />;
}

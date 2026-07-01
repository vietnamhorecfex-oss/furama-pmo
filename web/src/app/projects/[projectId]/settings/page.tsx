'use client';
import { useParams } from 'next/navigation';
import { SettingsPage } from '@/features/settings/SettingsPage';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <SettingsPage projectId={projectId} />;
}

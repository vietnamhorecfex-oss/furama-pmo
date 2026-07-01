'use client';
import { useParams } from 'next/navigation';
import { DashboardPage } from '@/features/dashboard/DashboardPage';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <DashboardPage projectId={projectId} />;
}

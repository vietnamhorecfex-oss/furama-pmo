'use client';
import { useParams } from 'next/navigation';
import { BudgetPanel } from '@/features/budget/BudgetPanel';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  return <BudgetPanel projectId={projectId} />;
}

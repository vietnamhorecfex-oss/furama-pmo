'use client';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { CalendarView } from '@/features/calendar/CalendarView';

export default function Page() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const pathname = usePathname();
  return <CalendarView projectId={projectId} onOpen={(id) => router.push(`${pathname}?task=${id}`)} />;
}

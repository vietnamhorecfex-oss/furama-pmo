import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';

export interface WorkstreamLite {
  id: string;
  name: string;
  track: 'PMO' | 'MARKETING' | 'OPERATIONS';
  order: number;
}

export function useWorkstreams(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['workstreams', projectId],
    queryFn: async (): Promise<WorkstreamLite[]> => {
      const { data } = await api.get<WorkstreamLite[]>(`/projects/${projectId}/workstreams`);
      return data;
    },
  });
}

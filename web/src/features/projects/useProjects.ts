import { useQuery } from '@tanstack/react-query';
import type { ProjectDto } from '@furama/shared';
import { api } from '../../lib/api-client';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<ProjectDto[]> => {
      const { data } = await api.get<ProjectDto[]>('/projects');
      return data;
    },
  });
}

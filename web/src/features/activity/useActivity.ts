'use client';
import { useQuery } from '@tanstack/react-query';
import type { AuditLogDto, Paginated } from '@furama/shared';
import { api } from '../../lib/api-client';

export function useActivityFeed(
  projectId: string | undefined,
  page: number,
  pageSize = 20,
) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['activity', projectId, page, pageSize],
    queryFn: async (): Promise<Paginated<AuditLogDto>> => {
      const { data } = await api.get<Paginated<AuditLogDto>>(`/projects/${projectId}/activity`, {
        params: { page, pageSize, sort: 'createdAt', order: 'desc' },
      });
      return data;
    },
  });
}
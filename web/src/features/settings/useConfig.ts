'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';

export type DimKind = 'phases' | 'workstreams' | 'statuses' | 'priorities' | 'budget-categories';

export interface DimRow {
  id: string;
  order: number;
  /** name (Phase / Workstream / BudgetCategory) OR key (StatusDef / PriorityDef). */
  name?: string;
  key?: string;
  color?: string;
  track?: string;
  isTerminal?: boolean;
  plannedVnd?: number;
}

export function useDim(projectId: string | undefined, kind: DimKind) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['config', projectId, kind],
    queryFn: async (): Promise<DimRow[]> => {
      const { data } = await api.get<DimRow[]>(`/projects/${projectId}/${kind}`);
      return data;
    },
  });
}

export function useCreateDim(projectId: string, kind: DimKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await api.post<DimRow>(`/projects/${projectId}/${kind}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config', projectId, kind] }),
  });
}

export function useDeleteDim(projectId: string, kind: DimKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/projects/${projectId}/${kind}/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config', projectId, kind] }),
  });
}
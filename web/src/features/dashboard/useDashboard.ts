'use client';
import { useQuery } from '@tanstack/react-query';
import type { BudgetSummary, DashboardOverview, MilestoneDto } from '@furama/shared';
import { api } from '../../lib/api-client';
import { POLL_MS } from '../../lib/query-client';

export function useDashboard(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['dashboard', projectId],
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<DashboardOverview> => {
      const { data } = await api.get<DashboardOverview>(`/projects/${projectId}/dashboard`);
      return data;
    },
  });
}

export function useBudgetSummary(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['budget', projectId],
    refetchInterval: POLL_MS,
    queryFn: async (): Promise<BudgetSummary> => {
      const { data } = await api.get<BudgetSummary>(`/projects/${projectId}/budget/summary`);
      return data;
    },
  });
}

export function useMilestones(projectId: string | undefined) {
  return useQuery({
    enabled: !!projectId,
    queryKey: ['milestones', projectId],
    queryFn: async (): Promise<MilestoneDto[]> => {
      const { data } = await api.get<MilestoneDto[]>(`/projects/${projectId}/milestones`);
      return data;
    },
  });
}
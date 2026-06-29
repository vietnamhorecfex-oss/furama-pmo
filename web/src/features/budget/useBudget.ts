/**
 * Budget edit mutations — set cap, set a category's planned amount, and bulk import.
 * All return/refresh the budget summary; cap/planned also touch the dashboard rollup.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BudgetImportDto, BudgetImportResult, BudgetSummary } from '@furama/shared';
import { api } from '../../lib/api-client';

function useBudgetInvalidation(projectId: string | undefined) {
  const qc = useQueryClient();
  return (summary?: BudgetSummary) => {
    if (summary) qc.setQueryData(['budget', projectId], summary);
    qc.invalidateQueries({ queryKey: ['budget', projectId] });
    qc.invalidateQueries({ queryKey: ['dashboard', projectId] });
  };
}

export function useSetBudgetCap(projectId: string | undefined) {
  const refresh = useBudgetInvalidation(projectId);
  return useMutation({
    mutationFn: async (capVnd: number): Promise<BudgetSummary> => {
      const { data } = await api.patch<BudgetSummary>(`/projects/${projectId}/budget/cap`, { capVnd });
      return data;
    },
    onSuccess: (data) => refresh(data),
  });
}

export function useSetCategoryPlanned(projectId: string | undefined) {
  const refresh = useBudgetInvalidation(projectId);
  return useMutation({
    mutationFn: async (vars: { categoryId: string; plannedVnd: number }): Promise<BudgetSummary> => {
      const { data } = await api.patch<BudgetSummary>(
        `/projects/${projectId}/budget/categories/${vars.categoryId}/planned`,
        { plannedVnd: vars.plannedVnd },
      );
      return data;
    },
    onSuccess: (data) => refresh(data),
  });
}

export function useImportBudget(projectId: string | undefined) {
  const refresh = useBudgetInvalidation(projectId);
  return useMutation({
    mutationFn: async (dto: BudgetImportDto): Promise<BudgetImportResult> => {
      const { data } = await api.post<BudgetImportResult>(`/projects/${projectId}/budget/import`, dto);
      return data;
    },
    onSuccess: () => refresh(),
  });
}

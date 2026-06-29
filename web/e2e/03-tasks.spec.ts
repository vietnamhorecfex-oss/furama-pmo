/**
 * E2E Journey 3 — Task management (docs/07 §4 journeys 3 + 5).
 * OWNER creates a task, updates progress, sees it in Board view.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, apiCreateProject, loginViaUI } from './helpers';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

test.describe('Task management journey', () => {
  test('can create a task via API and see it in the Tasks tab', async ({ page, request }) => {
    const owner = await apiRegister(request, 'taskOwner');
    const projectId = await apiCreateProject(request, owner.token, 'Task Journey Project');

    // Create a task via API
    const taskRes = await request.post(`${API_URL}/api/v1/projects/${projectId}/tasks`, {
      data: { title: 'E2E Test Task', priority: 'HIGH' },
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(taskRes.ok()).toBeTruthy();
    const task = await taskRes.json();
    expect((task as { title: string }).title).toBe('E2E Test Task');

    await loginViaUI(page, owner.email, owner.password);
    await page.getByRole('combobox').selectOption({ label: 'Task Journey Project' });
    await page.getByRole('button', { name: 'Tasks' }).click();

    // Task should appear in the list
    await expect(page.getByText('E2E Test Task')).toBeVisible({ timeout: 10_000 });
  });

  test('Board view renders without errors', async ({ page, request }) => {
    const owner = await apiRegister(request, 'boardOwner');
    const projectId = await apiCreateProject(request, owner.token, 'Board Journey Project');

    await request.post(`${API_URL}/api/v1/projects/${projectId}/tasks`, {
      data: { title: 'Board Task' },
      headers: { Authorization: `Bearer ${owner.token}` },
    });

    await loginViaUI(page, owner.email, owner.password);
    await page.getByRole('combobox').selectOption({ label: 'Board Journey Project' });
    await page.getByRole('button', { name: 'Board' }).click();

    // Kanban columns should render
    await expect(page.getByText(/not started/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('main')).not.toContainText('500');
  });

  test('Budget tab renders without errors', async ({ page, request }) => {
    const owner = await apiRegister(request, 'budgetOwner');
    await apiCreateProject(request, owner.token, 'Budget Journey Project');

    await loginViaUI(page, owner.email, owner.password);
    await page.getByRole('combobox').selectOption({ label: 'Budget Journey Project' });
    await page.getByRole('button', { name: 'Budget' }).click();

    await expect(page.getByText(/budget|planned|committed/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('main')).not.toContainText('500');
  });
});

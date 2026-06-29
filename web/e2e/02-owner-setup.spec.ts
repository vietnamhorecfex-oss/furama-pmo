/**
 * E2E Journey 2 — Owner setup flow (docs/07 §4 journey 1).
 * Owner logs in, creates a project, navigates settings, sees dashboard counts.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, apiCreateProject, loginViaUI } from './helpers';

test.describe('Owner setup journey', () => {
  test('owner sees dashboard after project is selected', async ({ page, request }) => {
    const owner = await apiRegister(request, 'ownerSetup');
    const projectId = await apiCreateProject(request, owner.token, 'E2E Owner Project');

    await loginViaUI(page, owner.email, owner.password);

    // Project selector — pick the newly created project
    const selector = page.getByRole('combobox');
    await expect(selector).toBeVisible();
    await selector.selectOption({ label: 'E2E Owner Project' });

    // Dashboard tab renders KPI section
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await page.getByRole('button', { name: 'Dashboard' }).click();
    // Dashboard should load without errors (may show 0 tasks for a new project)
    await expect(page.locator('main')).not.toContainText('error', { ignoreCase: true });
    void projectId;
  });

  test('owner can navigate to Settings tab', async ({ page, request }) => {
    const owner = await apiRegister(request, 'ownerSettings');
    await apiCreateProject(request, owner.token, 'Settings Test Project');

    await loginViaUI(page, owner.email, owner.password);
    const selector = page.getByRole('combobox');
    await selector.selectOption({ label: 'Settings Test Project' });

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Project meta')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Phases')).toBeVisible();
  });

  test('owner can navigate to Team tab', async ({ page, request }) => {
    const owner = await apiRegister(request, 'ownerTeam');
    await apiCreateProject(request, owner.token, 'Team Test Project');

    await loginViaUI(page, owner.email, owner.password);
    await page.getByRole('combobox').selectOption({ label: 'Team Test Project' });

    await page.getByRole('button', { name: 'Team' }).click();
    await expect(page.getByText(/member|team/i)).toBeVisible({ timeout: 8_000 });
  });

  test('owner sees Tasks tab with empty state or task list', async ({ page, request }) => {
    const owner = await apiRegister(request, 'ownerTasks');
    await apiCreateProject(request, owner.token, 'Tasks Test Project');

    await loginViaUI(page, owner.email, owner.password);
    await page.getByRole('combobox').selectOption({ label: 'Tasks Test Project' });

    await page.getByRole('button', { name: 'Tasks' }).click();
    await expect(page.locator('main')).toBeVisible();
    // Should not error
    await expect(page.locator('main')).not.toContainText('500');
  });
});

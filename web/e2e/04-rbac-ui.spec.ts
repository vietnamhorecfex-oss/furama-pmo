/**
 * E2E Journey 4 — RBAC UI gates (docs/07 §4 journeys 2 + 4).
 * Verifies that non-privileged roles see appropriate UI state when they hit
 * capability boundaries. API-level enforcement is tested in backend security.spec.ts;
 * this validates the UI surface (error messages, 403 inline).
 */
import { test, expect } from '@playwright/test';
import { apiRegister, apiCreateProject, apiAddMember, loginViaUI } from './helpers';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

test.describe('RBAC UI gates', () => {
  test('MEMBER: Activity tab shows 403 / access-denied message', async ({ page, request }) => {
    const owner = await apiRegister(request, 'rbacOwner');
    const member = await apiRegister(request, 'rbacMember');
    const projectId = await apiCreateProject(request, owner.token, 'RBAC Test Project');
    await apiAddMember(request, owner.token, projectId, member.userId, 'MEMBER');

    await loginViaUI(page, member.email, member.password);
    await page.getByRole('combobox').selectOption({ label: 'RBAC Test Project' });
    await page.getByRole('button', { name: 'Activity' }).click();

    // Should show a forbidden/access-denied message, not crash
    await expect(page.getByText(/403|forbidden|permission|not allowed/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('VIEWER: cannot see Settings controls (direct API call returns 403)', async ({ request }) => {
    const owner = await apiRegister(request, 'viewerOwner');
    const viewer = await apiRegister(request, 'viewerUser');
    const projectId = await apiCreateProject(request, owner.token, 'Viewer Project');
    await apiAddMember(request, owner.token, projectId, viewer.userId, 'VIEWER');

    // Direct API check — VIEWER cannot update project meta
    const res = await request.patch(`${API_URL}/api/v1/projects/${projectId}`, {
      data: { name: 'Hacked by Viewer' },
      headers: { Authorization: `Bearer ${viewer.token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('OWNER can access Activity feed without error', async ({ page, request }) => {
    const owner = await apiRegister(request, 'activityOwner');
    await apiCreateProject(request, owner.token, 'Activity Owner Project');

    await loginViaUI(page, owner.email, owner.password);
    await page.getByRole('combobox').selectOption({ label: 'Activity Owner Project' });
    await page.getByRole('button', { name: 'Activity' }).click();

    // Should render (may show empty feed for a fresh project)
    await expect(page.locator('main')).not.toContainText('500');
    await expect(page.locator('main')).not.toContainText('403');
  });

  test('MEMBER: import/export API is forbidden', async ({ request }) => {
    const owner = await apiRegister(request, 'ioOwner');
    const member = await apiRegister(request, 'ioMember');
    const projectId = await apiCreateProject(request, owner.token, 'IO Project');
    await apiAddMember(request, owner.token, projectId, member.userId, 'MEMBER');

    const exportRes = await request.get(`${API_URL}/api/v1/projects/${projectId}/export`, {
      headers: { Authorization: `Bearer ${member.token}` },
    });
    expect(exportRes.status()).toBe(403);
  });
});

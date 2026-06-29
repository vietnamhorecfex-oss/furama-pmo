/**
 * E2E Journey 1 — Authentication: login page renders, sign-in works, sign-out works.
 * Tests the full login→workspace→logout cycle.
 */
import { test, expect } from '@playwright/test';
import { apiRegister, loginViaUI } from './helpers';

test.describe('Auth journey', () => {
  test('login page renders key elements', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('invalid credentials show error message', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('nobody@example.test');
    await page.getByLabel('Password').fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid|incorrect|failed|error/i)).toBeVisible({ timeout: 8_000 });
  });

  test('valid login enters workspace and shows project selector', async ({ page, request }) => {
    const user = await apiRegister(request, 'authOwner');
    await loginViaUI(page, user.email, user.password);

    await expect(page.getByRole('heading', { name: 'Furama PMO' })).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
    // Tab navigation should include Dashboard
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
  });

  test('sign out returns to login page', async ({ page, request }) => {
    const user = await apiRegister(request, 'authLogout');
    await loginViaUI(page, user.email, user.password);

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 8_000 });
  });
});

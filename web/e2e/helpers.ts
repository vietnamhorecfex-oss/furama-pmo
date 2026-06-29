/**
 * Shared E2E helpers: API seed, login shortcuts, common selectors.
 */
import { type Page, type APIRequestContext, expect } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function apiRegister(
  request: APIRequestContext,
  hint: string,
): Promise<{ email: string; password: string; orgId: string; userId: string; token: string }> {
  const slug = `e2e-${hint}-${Date.now()}`;
  const email = `${slug}@example.test`;
  const password = 'E2ePass123!';

  await request.post(`${API_URL}/api/v1/auth/register`, {
    data: { orgSlug: slug, name: hint, email, password },
  });

  const loginRes = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email, password },
  });
  const body = await loginRes.json();
  return { email, password, orgId: body.user.orgId, userId: body.user.id, token: body.accessToken };
}

export async function apiCreateProject(
  request: APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const slug = `prj-${Date.now()}`;
  const res = await request.post(`${API_URL}/api/v1/projects`, {
    data: { name, slug },
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return (body as { id: string }).id;
}

export async function apiAddMember(
  request: APIRequestContext,
  token: string,
  projectId: string,
  userId: string,
  role: string,
): Promise<void> {
  await request.post(`${API_URL}/api/v1/projects/${projectId}/members`, {
    data: { userId, role },
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function apiCleanupOrg(
  request: APIRequestContext,
  token: string,
  orgId: string,
): Promise<void> {
  // Soft-clean: just archive the project; the org and user stay in the DB
  // but are isolated by org-slug. Full teardown is via the admin DB runbook.
  void orgId; void token; // no public teardown endpoint — keep data isolated by slug
}

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Furama PMO')).toBeVisible({ timeout: 10_000 });
}

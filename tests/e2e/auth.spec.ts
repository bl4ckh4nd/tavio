import { test, expect } from '@playwright/test';

// These tests run without saved auth — clear any stored state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Auth page — login mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
  });

  test('renders "Welcome back" heading and form fields', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByPlaceholder('name@company.com')).toBeVisible();
    await expect(page.getByPlaceholder('••••••••')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('correct credentials redirect to /admin', async ({ page }) => {
    const e2eEmail = process.env.E2E_EMAIL;
    const e2ePassword = process.env.E2E_PASSWORD;
    if (!e2eEmail || !e2ePassword) test.skip(true, 'E2E_EMAIL and E2E_PASSWORD must be set');
    await page.getByPlaceholder('name@company.com').fill(e2eEmail!);
    await page.getByPlaceholder('••••••••').fill(e2ePassword!);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/admin', { timeout: 15_000 });
    expect(page.url()).toContain('/admin');
  });

  test('wrong password shows error message', async ({ page }) => {
    const e2eEmail = process.env.E2E_EMAIL ?? 'test@example.com';
    await page.getByPlaceholder('name@company.com').fill(e2eEmail);
    await page.getByPlaceholder('••••••••').fill('wrong-password-xyz');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Error text should appear (not redirected)
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('forgot password link switches to reset mode', async ({ page }) => {
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
    // Password field should be hidden in forgot mode
    await expect(page.getByPlaceholder('••••••••')).not.toBeVisible();
  });

  test('sign up link switches to register mode', async ({ page }) => {
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('back to sign in from forgot-password mode', async ({ page }) => {
    await page.getByRole('button', { name: /forgot password/i }).click();
    await expect(page.getByRole('heading', { name: /reset password/i })).toBeVisible();
    await page.getByRole('button', { name: /back to sign in/i }).click();
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });
});

test.describe('Auth page — register mode', () => {
  test('navigating to /auth/register shows Create an account form', async ({ page }) => {
    await page.goto('/auth/register');
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('already have an account link switches to login', async ({ page }) => {
    await page.goto('/auth/register');
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });
});

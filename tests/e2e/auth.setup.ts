import { test as setup } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authFile = path.join(__dirname, '../../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/auth/login');

  // Wait for form to render
  await page.waitForSelector('input[placeholder="name@company.com"]');

  const e2eEmail = process.env.E2E_EMAIL;
  const e2ePassword = process.env.E2E_PASSWORD;
  if (!e2eEmail || !e2ePassword) {
    throw new Error('E2E_EMAIL and E2E_PASSWORD are required for chromium-project tests; --project=layout does not need them');
  }
  await page.getByPlaceholder('name@company.com').fill(e2eEmail);
  await page.getByPlaceholder('••••••••').fill(e2ePassword);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for redirect to /admin after successful login
  await page.waitForURL('**/admin', { timeout: 15_000 });

  // On a fresh workspace the tour makes the dashboard inert until dismissed.
  const closeTour = page.getByRole('button', { name: 'Close tour' });
  if (await closeTour.waitFor({ timeout: 3000 }).then(() => true, () => false)) await closeTour.click();

  // Save authenticated session
  await page.context().storageState({ path: authFile });
});

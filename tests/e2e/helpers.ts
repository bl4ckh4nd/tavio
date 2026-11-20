import { expect, type Page } from '@playwright/test';

export const E2E_ROOM_SLUG = process.env.E2E_ROOM_SLUG || 'meeting';
export const E2E_ROOM_PASSWORD = process.env.E2E_ROOM_PASSWORD || '123456';

export async function joinMeeting(
  page: Page,
  { name, slug = E2E_ROOM_SLUG, password = E2E_ROOM_PASSWORD, waitForHost = false }:
    { name: string; slug?: string; password?: string; waitForHost?: boolean },
) {
  await page.goto(`/room/${encodeURIComponent(slug)}`);
  await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder(/enter your name/i).fill(name);
  if (waitForHost) await expect(page.getByText(/participants? already in the room/i)).toBeVisible();

  const protectedButton = page.getByRole('button', { name: /join with password/i });
  const isProtected = (await protectedButton.count()) > 0;
  const joinButton = isProtected ? protectedButton : page.getByRole('button', { name: /join.*meeting/i });
  await expect(joinButton).toBeEnabled({ timeout: 10_000 });
  await joinButton.click();

  if (isProtected) {
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible({ timeout: 5_000 });
    await passwordInput.fill(password);
    await page.getByRole('button', { name: /^join$/i }).last().click();
  }

  await page.waitForURL(`**/meeting/${encodeURIComponent(slug)}`, { timeout: 25_000 });
}

export async function fakeDisplayMedia(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const context = canvas.getContext('2d');
      let frame = 0;

      const draw = () => {
        if (!context) return;
        context.fillStyle = `hsl(${frame % 360} 70% 45%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#fff';
        context.font = '48px sans-serif';
        context.fillText('E2E screen share', 48, 96);
        frame += 7;
      };
      draw();
      window.setInterval(draw, 200);

      return canvas.captureStream(5);
    };
  });
}

const HOST = { email: 'host-e2e@example.test', password: 'host-e2e-password-1', name: 'Lena' };

/**
 * Signs in as the local stack's test host, made through the auth API on first use. The first signed-in
 * person to join an open room becomes its host. Only for the local stack: it creates an account.
 */
export async function signInAsHost(page: Page) {
  const site = process.env.E2E_CONVEX_SITE_URL;
  if (!site) throw new Error('signInAsHost needs the local stack (E2E_CONVEX_SITE_URL)');
  const origin = `http://localhost:${process.env.E2E_PORT ?? 3334}`;
  // Made once; afterwards the auth API answers that the account exists, which is fine.
  await fetch(`${site}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(HOST),
  });
  await page.goto('/auth/login');
  await page.getByPlaceholder('name@company.com').fill(HOST.email);
  await page.getByPlaceholder('••••••••').fill(HOST.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15_000 });
}

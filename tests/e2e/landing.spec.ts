import { test, expect } from '@playwright/test';
import { E2E_ROOM_SLUG } from './helpers';

// Landing is public — no auth needed
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('product shots fill the box reserved for them', async ({ page }) => {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      for (const locale of ['en', 'de']) {
        await page.setViewportSize(viewport);
        await page.evaluate((next) => localStorage.setItem('tavio:locale', next), locale);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const shots = page.locator('.landing figure img');
        await expect(shots).toHaveCount(5);
        // The attributes on <img> and <source> reserve the space, so a recaptured picture of another shape would shift the page.
        const offShape = await shots.evaluateAll(async (images) => {
          const wrong: string[] = [];
          for (const image of images as HTMLImageElement[]) {
            image.loading = 'eager';
            await image.decode();
            const source = image.closest('picture')?.querySelector('source');
            const box = source && matchMedia(source.media).matches ? source : image;
            const reserved = Number(box.getAttribute('width')) / Number(box.getAttribute('height'));
            if (Math.abs(reserved - image.naturalWidth / image.naturalHeight) > 0.005) wrong.push(image.currentSrc);
          }
          return wrong;
        });
        expect(offShape).toEqual([]);
      }
    }
  });

  test('renders Tavio logo and hero headline', async ({ page }) => {
    await expect(page.getByRole('button', { name: /tavio home/i })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Meetings that leave a mark.' })).toBeVisible();
  });

  test('Docs nav link navigates to /docs', async ({ page }) => {
    await page.getByRole('button', { name: /docs/i }).first().click();
    await page.waitForURL('**/docs');
    expect(page.url()).toContain('/docs');
  });

  test('typing a room slug and clicking Join navigates to lobby', async ({ page }) => {
    const joinForm = page.locator('form').filter({ has: page.getByRole('textbox', { name: /room name/i }) });
    await joinForm.getByRole('textbox', { name: /room name/i }).fill(E2E_ROOM_SLUG);
    await joinForm.getByRole('button', { name: /^join$/i }).click();
    await page.waitForURL(`**/room/${encodeURIComponent(E2E_ROOM_SLUG)}`, { timeout: 10_000 });
    expect(page.url()).toContain(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
  });

  test('/docs renders help content', async ({ page }) => {
    await page.goto('/docs');
    // The Docs page should have some heading content
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('Log In button navigates to /auth/login', async ({ page }) => {
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL('**/auth/login');
    expect(page.url()).toContain('/auth/login');
  });

  test('Create your first room button navigates to /auth/register', async ({ page }) => {
    await page.getByRole('button', { name: /create your first room/i }).first().click();
    await page.waitForURL('**/auth/register');
    expect(page.url()).toContain('/auth/register');
  });
});

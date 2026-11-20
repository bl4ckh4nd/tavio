import { test, expect } from '@playwright/test';

test.describe('Admin — unauthenticated redirect', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('GET /admin redirects to /auth/login', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/auth/login', { timeout: 10_000 });
    expect(page.url()).toContain('/auth/login');
  });
});

test.describe('Admin — authenticated', () => {
  // Uses saved auth from auth.setup.ts (default storageState)

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
    // Wait for dashboard to load
    await page.waitForSelector('h1', { timeout: 10_000 });
  });

  test('shows admin dashboard heading', async ({ page }) => {
    // The heading changes based on active tab; default is OVERVIEW, headed by the workspace's own name
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).not.toBeEmpty();
    await expect(page.locator('#admin-sidebar').getByRole('button', { name: /overview/i })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText(/open a live room or create the next one/i)).toBeVisible();
  });

  test('admin top bar is visible', async ({ page }) => {
    await expect(page.locator('#admin-sidebar')).toBeVisible();
    await expect(page.getByRole('button', { name: /overview/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /rooms/i }).first()).toBeVisible();
  });

  test('navigating to Rooms tab shows rooms list or empty state', async ({ page }) => {
    // Click the Rooms nav button
    await page.locator('#admin-nav-rooms').getByRole('button', { name: /rooms/i }).click();
    // Wait for rooms section to render
    await expect(page.getByRole('heading', { name: /meeting rooms/i })).toBeVisible({ timeout: 8_000 });
    // Either the table or the "no rooms" card should be present
    const roomsContent = page.getByRole('table', { name: /rooms/i }).or(page.getByText(/no rooms yet/i));
    await expect(roomsContent.first()).toBeVisible();
    // Search lives on this tab and nowhere else
    await expect(page.getByPlaceholder(/search by name or slug/i)).toBeVisible();
    await page.locator('#admin-sidebar').getByRole('button', { name: /overview/i }).click();
    await expect(page.getByPlaceholder(/search by name or slug/i)).toHaveCount(0);
  });

  test('header fits a phone and keeps only the icon help button', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const header = page.locator('#admin-new-room-btn');
    await expect(header.getByRole('button', { name: /new room/i })).toBeVisible();
    // Button's base inline-flex used to beat a plain `hidden`, which pushed the page past the screen.
    // Exactly one help control is left, and its name comes from aria-label, not from visible text.
    const help = header.getByRole('button', { name: /help & docs/i });
    await expect(help).toHaveCount(1);
    await expect(help).toBeVisible();
    await expect(help).not.toContainText(/help/i);
    // The tabs moved to a bar pinned at the bottom.
    await expect(page.locator('#admin-nav-rooms')).toBeHidden();
    await expect(page.getByRole('navigation', { name: /workspace navigation/i }).getByRole('button', { name: /rooms/i })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('"New Room" button on Overview tab opens create-room modal', async ({ page }) => {
    // Make sure we're on OVERVIEW tab (default) where "New Room" header button is shown
    await expect(page.locator('#admin-new-room-btn')).toBeVisible();
    await page.locator('#admin-new-room-btn').getByRole('button', { name: /new room/i }).click();
    await expect(page.getByRole('heading', { name: /create new room/i })).toBeVisible({ timeout: 5_000 });
  });

  test('room modal shows validation error when name is empty', async ({ page }) => {
    await page.locator('#admin-new-room-btn').getByRole('button', { name: /new room/i }).click();
    await expect(page.getByRole('heading', { name: /create new room/i })).toBeVisible();

    // Submit without filling in name/slug
    await page.getByRole('button', { name: /create room/i }).click();

    // Validation error should appear on name field
    await expect(page.getByText(/room name is required/i)).toBeVisible({ timeout: 3_000 });
  });

  test('valid name+slug creates room and modal closes', async ({ page }) => {
    const testSlug = `e2e-test-${Date.now()}`;
    const testName = `E2E Test Room ${Date.now()}`;

    await page.locator('#admin-new-room-btn').getByRole('button', { name: /new room/i }).click();
    await expect(page.getByRole('heading', { name: /create new room/i })).toBeVisible();

    await page.getByPlaceholder(/weekly standup/i).fill(testName);
    await page.getByPlaceholder(/weekly-standup/i).fill(testSlug);

    await page.getByRole('button', { name: /create room/i }).click();

    // Modal should close (heading disappears)
    await expect(page.getByRole('heading', { name: /create new room/i })).not.toBeVisible({ timeout: 10_000 });

    // New room should appear somewhere in the page
    await expect(page.getByText(testName)).toBeVisible({ timeout: 10_000 });
  });

  test('delete room shows confirmation modal, confirming removes it', async ({ page }) => {
    // First create a room to delete
    const testSlug = `e2e-del-${Date.now()}`;
    const testName = `E2E Delete Test ${Date.now()}`;

    await page.locator('#admin-new-room-btn').getByRole('button', { name: /new room/i }).click();
    await page.getByPlaceholder(/weekly standup/i).fill(testName);
    await page.getByPlaceholder(/weekly-standup/i).fill(testSlug);
    await page.getByRole('button', { name: /create room/i }).click();
    await expect(page.getByRole('heading', { name: /create new room/i })).not.toBeVisible({ timeout: 10_000 });

    // Navigate to Rooms tab to find and delete the room
    await page.locator('#admin-nav-rooms').getByRole('button', { name: /rooms/i }).click();
    await expect(page.getByText(testName)).toBeVisible({ timeout: 10_000 });

    // Delete sits in the row's menu
    const roomRow = page.getByRole('row').filter({ hasText: testName });
    await roomRow.getByRole('button', { name: /more room actions/i }).click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // Confirmation modal
    await expect(page.getByRole('heading', { name: /delete room/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Room should no longer appear
    await expect(roomRow).toHaveCount(0, { timeout: 10_000 });
  });
});

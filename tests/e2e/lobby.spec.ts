import { test, expect } from '@playwright/test';
import { E2E_ROOM_PASSWORD, E2E_ROOM_SLUG } from './helpers';

// Lobby tests use saved auth
test.describe('Lobby — configured E2E room', () => {
  test('renders lobby with room name or loading state', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    // Either loading spinner or the "Ready?" join heading should appear
    const ready = page.getByRole('heading', { name: /ready/i });
    const loading = page.getByText(/loading room/i);
    await expect(ready.or(loading)).toBeVisible({ timeout: 10_000 });
  });

  test('lobby shows Display Name input and Join button', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    // Wait past loading
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByPlaceholder(/enter your name/i)).toBeVisible();
    // Join button (text: "Join Meeting" or "Join (Protected)")
    await expect(page.getByRole('button', { name: /join/i })).toBeVisible();
  });

  test('lobby shows device controls (mic/camera toggle buttons)', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });
    // Mic and camera toggle buttons in the video preview
    const micOrCameraBtn = page.locator('button svg').first();
    await expect(micOrCameraBtn).toBeVisible();
  });

  test('Back button navigates to landing page', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /back/i }).click();
    await page.waitForURL('**/', { timeout: 5_000 });
    expect(page.url()).toMatch(/\/$|\/$/);
  });

  test('password-protected room shows protected join button', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });
    // The configured E2E room has access=PASSWORD so join button should say "Join (Protected)"
    await expect(page.getByRole('button', { name: /join with password/i })).toBeVisible({ timeout: 5_000 });
  });

  test('entering name and clicking Join (Protected) opens password modal', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });

    // Fill in a name to enable the join button
    await page.getByPlaceholder(/enter your name/i).fill('TestUser');

    const joinBtn = page.getByRole('button', { name: /join with password/i });
    await expect(joinBtn).toBeEnabled({ timeout: 8_000 });
    await joinBtn.click();

    // Password modal should appear
    await expect(page.getByRole('heading', { name: /passcode|password|protected/i })).toBeVisible({ timeout: 5_000 });
  });

  test('entering correct password and joining redirects to the meeting route', async ({ page }) => {
    await page.goto(`/room/${encodeURIComponent(E2E_ROOM_SLUG)}`);
    await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder(/enter your name/i).fill('TestUser');
    const joinBtn = page.getByRole('button', { name: /join with password/i });
    await expect(joinBtn).toBeEnabled({ timeout: 8_000 });
    await joinBtn.click();

    // Password modal - fill in the password
    const passwordInput = page.getByRole('textbox').filter({ hasNot: page.getByPlaceholder(/enter your name/i) }).last();
    await passwordInput.fill(E2E_ROOM_PASSWORD);

    // Click the confirm/join button in the modal
    await page.getByRole('button', { name: /join|confirm|submit/i }).last().click();

    // Should navigate to the configured E2E room.
    await page.waitForURL(`**/meeting/${encodeURIComponent(E2E_ROOM_SLUG)}`, { timeout: 20_000 });
    expect(page.url()).toContain(`/meeting/${encodeURIComponent(E2E_ROOM_SLUG)}`);
  });
});

test.describe('Lobby — non-existent room', () => {
  test('shows Room Not Found for an unknown slug', async ({ page }) => {
    await page.goto('/room/definitely-does-not-exist-xyz');
    await expect(page.getByRole('heading', { name: /room not found/i })).toBeVisible({ timeout: 10_000 });
  });
});

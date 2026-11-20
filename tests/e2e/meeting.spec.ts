import { test, expect } from '@playwright/test';
import { E2E_ROOM_PASSWORD, E2E_ROOM_SLUG, joinMeeting } from './helpers';

async function joinTestRoomMutedWithNoiseReductionDisabled(
  page: import('@playwright/test').Page,
  name = 'E2EUserMuted',
) {
  await page.goto(`/room/${E2E_ROOM_SLUG}`);
  await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder(/enter your name/i).fill(name);
  await expect(page.getByRole('button', { name: /join.*(password|meeting)/i })).toBeEnabled({ timeout: 10_000 });

  await expect(page.locator('button[title="Effects"]')).toBeEnabled({ timeout: 10_000 });
  await page.locator('button[title="Effects"]').click();

  const noiseToggle = page.getByRole('switch', { name: /toggle noise reduction/i });
  await expect(noiseToggle).toBeVisible({ timeout: 5_000 });

  if ((await noiseToggle.getAttribute('aria-checked')) === 'true') {
    await noiseToggle.click();
    await expect(noiseToggle).toHaveAttribute('aria-checked', 'false');
  }
  await page.getByRole('button', { name: /^done$/i }).click();

  const micToggle = page.getByRole('button', { name: /^mute microphone$/i });
  await expect(micToggle).toBeVisible({ timeout: 5_000 });
  await micToggle.click();

  const joinBtn = page.getByRole('button', { name: /join.*(password|meeting)/i });
  await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
  await joinBtn.click();

  const passwordInput = page.locator('input[type="password"]');
  if (await passwordInput.count()) {
    await passwordInput.fill(E2E_ROOM_PASSWORD);
    await page.getByRole('button', { name: /^join$/i }).last().click();
  }

  await page.waitForURL(`**/meeting/${E2E_ROOM_SLUG}`, { timeout: 25_000 });
}

async function joinTestRoomWithBlurAndMuted(
  page: import('@playwright/test').Page,
  name = 'E2EUserBlurMuted',
) {
  await page.goto(`/room/${E2E_ROOM_SLUG}`);
  await expect(page.getByRole('heading', { name: /ready/i })).toBeVisible({ timeout: 10_000 });

  await page.getByPlaceholder(/enter your name/i).fill(name);
  await expect(page.locator('button[title="Effects"]')).toBeEnabled({ timeout: 10_000 });

  await page.locator('button[title="Effects"]').click();
  const blurPreset = page.getByRole('button', { name: /^blur$/i });
  await expect(blurPreset).toBeVisible({ timeout: 5_000 });
  await blurPreset.click();
  await expect(blurPreset).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^done$/i }).click();

  const micToggle = page.getByRole('button', { name: /^mute microphone$/i });
  await expect(micToggle).toBeVisible({ timeout: 5_000 });
  await micToggle.click();

  const joinBtn = page.getByRole('button', { name: /join.*(password|meeting)/i });
  await expect(joinBtn).toBeEnabled({ timeout: 10_000 });
  await joinBtn.click();

  const passwordInput = page.locator('input[type="password"]');
  if (await passwordInput.count()) {
    await passwordInput.fill(E2E_ROOM_PASSWORD);
    await page.getByRole('button', { name: /^join$/i }).last().click();
  }

  await page.waitForURL(`**/meeting/${E2E_ROOM_SLUG}`, { timeout: 25_000 });
}

test.describe('Meeting — UI controls', () => {
  test.beforeEach(async ({ page }) => {
    await joinMeeting(page, { name: 'E2EUser' });
  });

  test('URL is the meeting route after joining', async ({ page }) => {
    expect(page.url()).toContain(`/meeting/${E2E_ROOM_SLUG}`);
  });

  test('MeetingControls toolbar is visible', async ({ page }) => {
    // Toolbar contains mute, camera, and leave buttons
    await expect(page.getByRole('button', { name: /mute|unmute/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /turn camera (on|off)/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /leave/i })).toBeVisible();
  });

  test('mute button toggles its label', async ({ page }) => {
    const muteBtn = page.getByRole('button', { name: /mute/i });
    await expect(muteBtn).toBeVisible({ timeout: 8_000 });
    const labelBefore = await muteBtn.getAttribute('aria-label');
    await muteBtn.click();
    // After click, label should flip.
    await expect
      .poll(() => page.getByRole('button', { name: /mute|unmute/i }).getAttribute('aria-label'))
      .not.toBe(labelBefore);
  });

  test('Chat button opens chat panel', async ({ page }) => {
    await page.getByRole('button', { name: /^chat$/i }).click();
    // Chat panel should become visible
    await expect(page.getByText(/send a message|type a message|chat/i).first()).toBeVisible({ timeout: 5_000 });
  });

  test('Notes button opens shared notes panel', async ({ page }) => {
    await page.getByRole('button', { name: /^notes$/i }).click();
    // Notes panel / TipTap editor should appear
    await expect(page.locator('.ProseMirror, [role="textbox"]').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Whiteboard button opens whiteboard panel', async ({ page }) => {
    await page.getByRole('button', { name: /^whiteboard$/i }).click();
    // Canvas element should appear
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 5_000 });
  });

  test('Leave opens the meeting summary', async ({ page }) => {
    await page.getByRole('button', { name: /leave/i }).click();
    await expect(page).toHaveURL(/\/goodbye$/);
    await expect(page.getByRole('heading', { name: /the call is over/i })).toBeVisible();
  });
});

test.describe('Meeting — muted join and unmute constraints', () => {
  test('joining muted then unmuting requests microphone with noise suppression disabled', async ({ page }) => {
    await page.addInitScript(() => {
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      (window as any).__gumCalls = [];
      navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
        (window as any).__gumCalls.push(structuredClone(constraints));
        return originalGetUserMedia(constraints);
      };
    });

    await joinTestRoomMutedWithNoiseReductionDisabled(page);

    const muteBtn = page.getByRole('button', { name: /mute|unmute/i }).first();
    await expect(muteBtn).toBeVisible({ timeout: 8_000 });
    await expect(muteBtn).toHaveAccessibleName(/unmute/i);

    // Isolate getUserMedia calls caused by in-meeting unmute.
    await page.evaluate(() => {
      (window as any).__gumCalls = [];
    });

    await muteBtn.click();
    await expect
      .poll(() => page.evaluate(() => ((window as any).__gumCalls ?? []).length), { timeout: 10_000 })
      .toBeGreaterThan(0);

    const calls = await page.evaluate(() => (window as any).__gumCalls as MediaStreamConstraints[]);
    const audioOnlyCall = calls.find((c) => {
      const hasAudioObject = typeof c.audio === 'object' && c.audio !== null;
      const videoDisabled = c.video === false || c.video === undefined;
      return hasAudioObject && videoDisabled;
    });

    expect(audioOnlyCall).toBeTruthy();
    const audioConstraints = audioOnlyCall!.audio as MediaTrackConstraints;
    expect(audioConstraints.noiseSuppression).toBe(false);
  });

  test('joining with blur and muted persists both states into the meeting', async ({ page }) => {
    await joinTestRoomWithBlurAndMuted(page);

    const muteBtn = page.getByRole('button', { name: /mute|unmute/i }).first();
    await expect(muteBtn).toBeVisible({ timeout: 8_000 });
    await expect(muteBtn).toHaveAccessibleName(/unmute/i);
    await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: /^effects$/i }).click();
    const meetingBlurPreset = page.getByRole('button', { name: /^blur$/i }).first();
    await expect(meetingBlurPreset).toHaveAttribute('aria-pressed', 'true');
  });
});

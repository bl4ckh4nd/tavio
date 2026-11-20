import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, test, expect, type Browser, type Page } from '@playwright/test';
import { fakeDisplayMedia, joinMeeting } from './helpers';

test('two users publish and receive fake audio/video tracks', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3333');
  const contextA = await browser.newContext({ baseURL });
  const contextB = await browser.newContext({ baseURL });

  try {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const runtimeErrors: string[] = [];
    for (const page of [pageA, pageB]) {
      page.on('console', (message) => {
        const text = message.text();
        if (/A VideoFrame was garbage collected|Element not part of the array|could not establish pc connection/i.test(text)) {
          runtimeErrors.push(text);
        }
      });
      page.on('pageerror', (error) => {
        if (/A VideoFrame was garbage collected|Element not part of the array|could not establish pc connection/i.test(error.message)) {
          runtimeErrors.push(error.message);
        }
      });
    }

    await joinMeeting(pageA, { name: 'Alice' });
    await joinMeeting(pageB, { name: 'Bob' });

    for (const page of [pageA, pageB]) {
      // On a wide stage both people are tiles.
      await expect(page.locator('.lk-participant-tile')).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator('video[data-lk-source="camera"][data-lk-local-participant="false"]')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator('audio[data-lk-source="microphone"][data-lk-local-participant="false"]')).toHaveCount(1, { timeout: 30_000 });

      const mute = page.getByRole('button', { name: /^(mute|unmute) microphone$/i });
      const camera = page.getByRole('button', { name: /^turn camera (on|off)$/i });
      await expect(mute).toBeVisible();
      await expect(camera).toBeVisible();

      const muteBefore = await mute.getAttribute('aria-label');
      await mute.click();
      await expect.poll(() => mute.getAttribute('aria-label')).not.toBe(muteBefore);

      const cameraBefore = await camera.getAttribute('aria-label');
      await camera.click();
      await expect.poll(() => camera.getAttribute('aria-label')).not.toBe(cameraBefore);
    }

    // These failures used to appear only after the placeholder/processor state
    // had been alive for several seconds.
    await pageA.waitForTimeout(15_000);
    expect(runtimeErrors, runtimeErrors.join('\n')).toEqual([]);
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});

// Real room, real LiveKit: costs 4 tokens/run. Screenshots and stage/report.json go to test-results/stage.
test('tiles keep the shape of each camera across desktops and phones', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3333');
  const out = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/stage`;
  mkdirSync(out, { recursive: true });
  const browsers: Browser[] = [];
  const join = async (name: string, shape: 'wide' | 'tall', viewport: { width: number; height: number }, touch = false): Promise<Page> => {
    const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream=device-count=2'] });
    browsers.push(browser);
    const context = await browser.newContext({ baseURL, viewport, hasTouch: touch, isMobile: touch, permissions: ['camera', 'microphone'] });
    const page = await context.newPage();
    // Chrome's fake camera cannot film upright, so a portrait camera is a canvas in that shape.
    if (shape === 'tall') {
      await page.addInitScript(() => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await original({ audio: constraints?.audio ?? false, video: false }).catch(() => new MediaStream());
          if (!constraints?.video) return stream;
          const canvas = document.createElement('canvas');
          canvas.width = 720;
          canvas.height = 1280;
          const context2d = canvas.getContext('2d')!;
          let frame = 0;
          window.setInterval(() => {
            context2d.fillStyle = `hsl(${frame % 360} 60% 45%)`;
            context2d.fillRect(0, 0, 720, 1280);
            context2d.fillStyle = '#fff';
            context2d.fillRect(40, 40, 640, 80);
            context2d.fillRect(40, 1160, 640, 80);
            frame += 5;
          }, 100);
          stream.addTrack(canvas.captureStream(10).getVideoTracks()[0]);
          return stream;
        };
      });
    }
    await joinMeeting(page, { name });
    return page;
  };
  // Everything a person sees as a video, with the shape of its box and of the picture inside.
  const shapes = (page: Page) => page.locator('.mtile video[data-lk-source="camera"]').evaluateAll((videos) => videos.map((node) => {
    const video = node as HTMLVideoElement;
    const box = video.closest('.lk-grid-tile-wrapper, [data-testid="local-pip"]')!.getBoundingClientRect();
    return { box: box.width / box.height, picture: video.videoWidth / video.videoHeight, height: video.videoHeight };
  }));
  const expectUncropped = async (page: Page, count: number) => {
    await expect.poll(async () => {
      const all = await shapes(page);
      return all.length === count && all.every((shape) => shape.height > 0 && Math.abs(shape.box - shape.picture) < 0.05);
    }, { timeout: 45_000 }).toBe(true);
  };
  const localLabel = (page: Page) => page.locator('video[data-lk-source="camera"][data-lk-local-participant="true"]').evaluate((video) => (
    (video as HTMLVideoElement).srcObject as MediaStream | null)?.getVideoTracks()[0]?.label ?? '');

  try {
    const desktop = await join('Desktop Wide', 'wide', { width: 1280, height: 720 });
    const desktopTall = await join('Desktop Tall', 'tall', { width: 1280, height: 720 });
    const phone = await join('Phone Tall', 'tall', { width: 390, height: 844 }, true);
    const phoneWide = await join('Phone Wide', 'wide', { width: 390, height: 844 }, true);

    await expectUncropped(desktop, 4);
    await expectUncropped(phone, 4);
    const self = phone.getByTestId('local-pip');
    await expect(self).toBeVisible();
    await desktop.screenshot({ path: `${out}/desktop-grid.png` });
    await desktopTall.screenshot({ path: `${out}/desktop-tall-grid.png` });
    await phone.screenshot({ path: `${out}/phone-grid.png` });
    await phoneWide.screenshot({ path: `${out}/phone-wide-grid.png` });

    // Touch: one tap on a tile, large view, fill, and the one way back.
    await phone.getByRole('button', { name: 'Options for Desktop Wide' }).tap();
    await phone.waitForTimeout(500);
    await phone.screenshot({ path: `${out}/phone-sheet.png` });
    await phone.getByRole('dialog').getByRole('button', { name: 'Show large' }).tap();
    await expect.poll(() => phone.locator('.lk-focus-layout video').first().evaluate((video) => (video as HTMLVideoElement).videoHeight), { timeout: 15_000 }).toBeGreaterThan(0);
    await phone.waitForTimeout(1500);
    await phone.screenshot({ path: `${out}/phone-large.png` });
    const large = phone.getByRole('button', { name: 'Options for Desktop Wide' });
    await large.tap();
    await phone.getByRole('dialog').getByRole('button', { name: 'Fill the frame' }).tap();
    await expect(phone.locator('.lk-focus-layout [data-fill="true"] video')).toHaveCSS('object-fit', 'cover');
    await phone.screenshot({ path: `${out}/phone-fill.png` });
    await phone.getByRole('button', { name: 'Back to grid' }).tap();
    await expect(phone.locator('.lk-grid-layout')).toBeVisible();

    // Mouse: pin from the tile's tools, and the tag says why this view stays.
    const tile = desktop.locator('.lk-grid-layout .mtile').filter({ hasText: 'Phone Tall' });
    await tile.hover();
    await desktop.screenshot({ path: `${out}/desktop-tools.png` });
    await tile.getByRole('button', { name: /^Pin .* for me$/ }).click();
    await expect(desktop.getByText('Pinned for you')).toBeVisible();
    await desktop.waitForTimeout(1500);
    await desktop.screenshot({ path: `${out}/desktop-pinned.png` });
    await desktop.getByRole('button', { name: 'Back to grid' }).click();

    // Sideways the phone keeps your window and lays the tiles out for the new shape.
    await phoneWide.setViewportSize({ width: 844, height: 390 });
    await phoneWide.waitForTimeout(1000);
    await expectUncropped(phoneWide, 4);
    await phoneWide.screenshot({ path: `${out}/phone-sideways.png` });
    await phoneWide.setViewportSize({ width: 390, height: 844 });

    // The second camera stays selected: the lobby's choice used to snap back.
    const before = await localLabel(phoneWide);
    await phoneWide.getByTestId('local-pip').getByRole('button', { name: 'Switch camera' }).tap();
    await expect.poll(async () => { const label = await localLabel(phoneWide); return label !== '' && label !== before; }, { timeout: 15_000 }).toBe(true);
    const after = await localLabel(phoneWide);
    await phoneWide.waitForTimeout(3000);
    expect(await localLabel(phoneWide)).toBe(after);
    await phoneWide.screenshot({ path: `${out}/phone-switched.png` });
    const facingMode = await phoneWide.locator('video[data-lk-source="camera"][data-lk-local-participant="true"]').evaluate((video) => (
      (video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0].getSettings().facingMode ?? null);

    writeFileSync(`${out}/report.json`, JSON.stringify({
      desktop: await shapes(desktop),
      phone: await shapes(phone),
      cameraSwitch: { before, after, facingMode },
    }, null, 2));
  } finally {
    await Promise.all(browsers.map((browser) => browser.close()));
  }
});

// Real room, real LiveKit: costs 2 tokens/run. Screenshots go to test-results/share.
test('a phone can read a shared screen upright and sideways', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3333');
  const out = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/share`;
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const sharerContext = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 }, permissions: ['camera', 'microphone'] });
    const phoneContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ['camera', 'microphone'] });
    const sharer = await sharerContext.newPage();
    const phone = await phoneContext.newPage();
    await fakeDisplayMedia(sharer);
    await joinMeeting(sharer, { name: 'Sharer' });
    await joinMeeting(phone, { name: 'Phone' });
    await expect(sharer.locator('video[data-lk-source="camera"][data-lk-local-participant="false"]')).toHaveCount(1, { timeout: 30_000 });
    await sharer.waitForTimeout(2000);
    await sharer.getByRole('button', { name: /share screen/i }).click();

    const share = phone.locator('video[data-lk-source="screen_share"]');
    await expect.poll(() => share.evaluate((video) => (video as HTMLVideoElement).videoWidth).catch(() => 0), { timeout: 30_000 }).toBeGreaterThan(0);

    // Sideways the people move beside the screen, so it gets the height of the stage.
    await phone.setViewportSize({ width: 844, height: 390 });
    await expect(phone.locator('.lk-carousel')).toHaveAttribute('data-lk-orientation', 'vertical');
    await phone.waitForTimeout(500);
    const sideways = (await share.boundingBox())!;
    const strip = (await phone.locator('.lk-carousel').boundingBox())!;
    expect(strip.x).toBeGreaterThanOrEqual(sideways.x + sideways.width);
    // The picture sits whole inside this box: with the strip below it was only about 300 wide.
    expect(Math.min(sideways.width, sideways.height * (16 / 9))).toBeGreaterThan(450);
    await phone.screenshot({ path: `${out}/sideways.png` });
    await phone.setViewportSize({ width: 390, height: 844 });
    await expect(phone.locator('.lk-carousel')).toHaveAttribute('data-lk-orientation', 'horizontal');

    // Pinch with two real touch points, as only a browser can tell whether the page zooms instead.
    const box = (await share.boundingBox())!;
    const y = box.y + box.height / 2;
    const cdp = await phoneContext.newCDPSession(phone);
    const touch = (type: string, spread: number) => cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: type === 'touchEnd' ? [] : [{ x: 195 - spread, y, id: 1 }, { x: 195 + spread, y, id: 2 }],
    });
    await touch('touchStart', 40);
    for (const spread of [60, 80, 100, 120]) await touch('touchMove', spread);
    await touch('touchEnd', 120);

    const reset = phone.getByRole('button', { name: 'Reset zoom' });
    await expect(reset).toBeVisible();
    await expect(phone.getByRole('dialog')).toHaveCount(0);
    expect((await share.boundingBox())!.width).toBeGreaterThan(box.width * 2);
    expect(await phone.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await phone.screenshot({ path: `${out}/pinched.png` });

    await reset.tap();
    await expect(reset).toHaveCount(0);
    expect((await share.boundingBox())!.width).toBeCloseTo(box.width, 0);
  } finally {
    await browser.close();
  }
});

// Real room, two guests: costs 2 tokens/run. Screenshots and chat/report.json go to test-results/chat.
test('two people chat with formatting, a reaction and an image', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3333');
  const out = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/chat`;
  mkdirSync(out, { recursive: true });
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ baseURL, locale: 'en-US', viewport: { width: 1280, height: 800 } })));
  try {
    const [alice, bob] = await Promise.all(contexts.map((context) => context.newPage()));
    const stamp = Date.now().toString(36);
    await joinMeeting(alice, { name: 'Alice' });
    await joinMeeting(bob, { name: 'Bob' });
    for (const page of [alice, bob]) await page.getByRole('button', { name: /^chat$/i }).click();

    // Alice writes two lines with a link, bold text and a shortcode. Shift+Enter breaks the line, Enter sends.
    const field = alice.getByRole('textbox', { name: 'Type a message...' });
    await field.fill(`**hello ${stamp}** :tada:`);
    await field.press('Shift+Enter');
    await field.pressSequentially('see https://example.com/a?x=1&y=2.');
    await field.press('Enter');
    await expect(field).toHaveValue('');

    const bobLog = bob.getByRole('log', { name: 'Messages' });
    const message = bobLog.locator('.chat__item').filter({ hasText: stamp });
    await expect(message.locator('strong')).toHaveText(`hello ${stamp}`);
    await expect(message).toContainText('🎉');
    const link = message.getByRole('link', { name: 'https://example.com/a?x=1&y=2' });
    await expect(link).toHaveAttribute('href', 'https://example.com/a?x=1&y=2');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(message.locator('br')).toHaveCount(1);

    // Bob reacts; Alice sees the count and that the reaction is not hers.
    await message.hover();
    await message.getByRole('button', { name: 'Add reaction' }).click();
    await bob.getByRole('dialog', { name: 'Add reaction' }).getByRole('button', { name: '👍' }).click();
    const aliceReaction = alice.getByRole('log', { name: 'Messages' }).locator('.chat__item').filter({ hasText: stamp }).locator('.chat__react');
    await expect(aliceReaction).toHaveText('👍1');
    await expect(aliceReaction).toHaveAttribute('aria-pressed', 'false');

    // Alice shares an image through the file picker; it uploads as a guest and Bob opens it.
    await alice.locator('input[type="file"][accept^="image/"]').setInputFiles('public/landing/lobby.webp');
    await expect(alice.getByText('Image ready to send')).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Send message' })).toBeEnabled({ timeout: 20_000 });
    await alice.getByRole('button', { name: 'Send message' }).click();
    const image = bobLog.getByRole('button', { name: 'Open image from Alice' }).last();
    await expect(image.locator('img')).toHaveJSProperty('complete', true, { timeout: 20_000 });
    expect(await image.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await bob.screenshot({ path: `${out}/bob-chat.png` });

    await image.click();
    const lightbox = bob.getByRole('dialog', { name: 'Image from Alice' });
    await expect(lightbox).toBeVisible();
    await lightbox.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
    // The picture must be on top, not clipped by the side panel.
    const box = (await lightbox.locator('img').boundingBox())!;
    const topmost = await bob.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(topmost).toBe('IMG');
    expect(box.width).toBeGreaterThan(400);
    await bob.screenshot({ path: `${out}/bob-lightbox.png` });
    // Escape closes the picture and leaves the chat open.
    await bob.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(bob.getByRole('complementary', { name: 'Chat' })).toBeVisible();
    // The full emoji sheet for the last message opens inside the window, not clipped by the list.
    const last = bobLog.locator('.chat__item').last();
    await last.hover();
    await last.getByRole('button', { name: 'Add reaction' }).click();
    await bob.getByRole('button', { name: 'More emoji' }).click();
    const reactSheet = bob.getByRole('dialog', { name: 'Add reaction' });
    await reactSheet.locator('emoji-picker').getByRole('menuitem').first().waitFor({ timeout: 15_000 });
    const sheetBox = (await reactSheet.boundingBox())!;
    expect(sheetBox.y).toBeGreaterThanOrEqual(0);
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(800);
    expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(1280);
    await bob.screenshot({ path: `${out}/bob-react-sheet.png` });
    await bob.keyboard.press('Escape');
    await expect(reactSheet).toHaveCount(0);
    await expect(bob.getByRole('complementary', { name: 'Chat' })).toBeVisible();

    // Dark mode on a phone: the chat fills the screen and the sheets follow the mode.
    await bob.getByRole('button', { name: 'Switch to dark mode' }).click();
    await bob.setViewportSize({ width: 390, height: 844 });
    await bob.waitForTimeout(300);
    await bob.screenshot({ path: `${out}/bob-phone-dark.png` });

    // The emoji sheet loads its data from this app, not a CDN, and puts the emoji at the cursor.
    const cdnRequests: string[] = [];
    alice.on('request', (request) => { if (/jsdelivr|unpkg/.test(request.url())) cdnRequests.push(request.url()); });
    await alice.getByRole('button', { name: 'Emoji', exact: true }).click();
    const sheet = alice.getByRole('dialog', { name: 'Emoji' });
    await sheet.locator('emoji-picker').getByRole('menuitem').first().waitFor({ timeout: 15_000 });
    await alice.screenshot({ path: `${out}/alice-emoji.png` });
    await sheet.locator('emoji-picker').getByRole('menuitem').first().click();
    await expect(field).not.toHaveValue('');
    await alice.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(alice.getByRole('complementary', { name: 'Chat' })).toBeVisible();
    expect(cdnRequests).toEqual([]);
    await field.fill('');
    await alice.screenshot({ path: `${out}/alice-chat.png` });

    writeFileSync(`${out}/report.json`, JSON.stringify({
      stamp,
      baseURL,
      convexUrl: process.env.E2E_CONVEX_URL ?? null,
      checks: ['bold', 'shortcode', 'line break', 'link href with &', 'reaction count', 'guest image upload', 'lightbox escape', 'reaction sheet inside window', 'emoji sheet without CDN'],
      screenshots: ['bob-chat.png', 'bob-lightbox.png', 'bob-react-sheet.png', 'bob-phone-dark.png', 'alice-emoji.png', 'alice-chat.png'],
    }, null, 2));
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

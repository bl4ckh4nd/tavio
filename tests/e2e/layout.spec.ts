// Token budget: simulated layout tests cost 0 tokens; the real-room test costs 3 tokens/run.
// Env knobs: E2E_ROOM_SLUG and E2E_ROOM_PASSWORD select the room under test.
import { test, expect, type Page } from '@playwright/test';
import { fakeDisplayMedia, joinMeeting } from './helpers';

const OUT = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/layout-shots`;

test.describe.configure({ mode: 'default' });

async function simulateParticipants(
  page: Page,
  count: number,
  // On a wide stage you are a tile; where the stage folds you are a small window once someone joined.
  { selfWindow = false, expectedGridTiles = selfWindow && count > 1 ? count - 1 : count }: { selfWindow?: boolean; expectedGridTiles?: number } = {},
) {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__lkRoom)), { timeout: 10_000 })
    .toBe(true);
  await page.evaluate(async (participantCount) => {
    const w = window as any;
    if (!w.__rtcReceiverShimmed) {
      w.__rtcReceiverShimmed = true;
      // Simulated rooms have no real connection; a constructible receiver is enough.
      w.RTCRtpReceiver = function () {} as any;
    }
    await w.__lkRoom.simulateParticipants({
      participants: { count: participantCount },
    });
  }, count);
  await expect(page.locator('.lk-grid-layout .lk-participant-tile')).toHaveCount(expectedGridTiles, { timeout: 10_000 });
  await expect(page.getByTestId('local-pip')).toHaveCount(selfWindow && count > 1 ? 1 : 0, { timeout: 10_000 });
}

test.describe('Meeting layout', () => {
  test('public pages remain readable at 320px and activate the stored locale', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(() => localStorage.setItem('tavio:locale', 'de'));
    await page.goto('/docs');

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('h1')).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `${OUT}/docs-320.png`, fullPage: true });
  });

  test('grid matrix selects expected columns', async ({ page }) => {
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    const grid = page.locator('.lk-grid-layout');

    // The page size follows these columns; the rows themselves follow the shape of the videos.
    // If simulation ever needs a reload fallback, keep that recovery in this test only.
    for (const [count, expectedColumns] of [
      [1, 1],
      [2, 2],
      [3, 2],
      [5, 3],
      [8, 3],
      [13, 4],
    ] as const) {
      await simulateParticipants(page, count);
      await expect
        .poll(() =>
          grid.evaluate((element) => getComputedStyle(element).getPropertyValue('--lk-col-count').trim()),
        )
        .toBe(String(expectedColumns));
      await page.screenshot({ path: `${OUT}/grid-${count}.png`, fullPage: true });
    }
  });

  test('pagination exposes page two for thirteen participants at 800x600', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 13, { selfWindow: true, expectedGridTiles: 9 });

    const grid = page.locator('.lk-grid-layout');
    const pagination = grid.locator('.lk-pagination-control');
    const count = grid.locator('.lk-pagination-count');
    await expect(pagination).toBeVisible();
    await expect(count).toHaveText('1/2');
    await pagination.locator('button').last().click();
    await expect(count).toHaveText('2/2');
    await page.screenshot({ path: `${OUT}/pagination-page-2.png`, fullPage: true });
  });

  test('pagination reads as one pill and stays clear of the local preview on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    // Six tiles fit a phone, so the eighth person (seven tiles plus your own window) is the first to page.
    await simulateParticipants(page, 7, { selfWindow: true, expectedGridTiles: 6 });
    await expect(page.locator('.lk-pagination-controls')).toHaveCount(0);
    await simulateParticipants(page, 8, { selfWindow: true, expectedGridTiles: 6 });

    const pill = page.locator('.lk-pagination-controls');
    const count = pill.locator('.lk-pagination-count');
    await expect(count).toHaveText('1/2');
    expect((await count.boundingBox())?.height ?? 0).toBeLessThan(24);

    // LiveKit's stylesheet rotates the first button's icon, which made both arrows point right.
    const previousIcon = pill.getByRole('button', { name: /previous page/i }).locator('svg');
    await expect.poll(() => previousIcon.evaluate((icon) => getComputedStyle(icon).transform)).toBe('none');

    const pillBox = await pill.boundingBox();
    const pipBox = await page.getByTestId('local-pip').boundingBox();
    expect(pillBox && pipBox).toBeTruthy();
    const overlaps =
      pillBox!.x < pipBox!.x + pipBox!.width &&
      pipBox!.x < pillBox!.x + pillBox!.width &&
      pillBox!.y < pipBox!.y + pipBox!.height &&
      pipBox!.y < pillBox!.y + pillBox!.height;
    expect(overlaps).toBe(false);
    await page.screenshot({ path: `${OUT}/pagination-phone.png`, fullPage: true });
  });

  test('notes toolbar keeps every format control reachable in the side panel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 3);
    await page.getByRole('button', { name: /^notes$/i }).first().click();
    await expect(page.getByRole('button', { name: /close notes/i })).toBeVisible();

    for (const name of ['Bold', 'Italic', 'Strikethrough', 'Heading 1', 'Heading 2', 'Bullet List', 'Ordered List']) {
      const control = page.getByRole('button', { name, exact: true });
      // Hit-testing catches both a clipped control and one lying under its neighbour.
      const reachable = await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      });
      expect(reachable, `${name} is reachable`).toBe(true);
    }
    await page.screenshot({ path: `${OUT}/notes-toolbar.png`, fullPage: true });
  });

  test('notes show headings and lists as headings and lists', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 3);
    await page.getByRole('button', { name: /^notes$/i }).first().click();
    await expect(page.getByRole('button', { name: /close notes/i })).toBeVisible();

    // The editor opens on its starter document, which holds a heading, a paragraph and a list.
    const styles = await page.locator('.ProseMirror').evaluate((editor) => {
      const read = (selector: string) => getComputedStyle(editor.querySelector(selector) as Element);
      return { heading: parseFloat(read('h2').fontSize), body: parseFloat(read('p').fontSize), marker: read('ul').listStyleType };
    });
    expect(styles.heading).toBeGreaterThan(styles.body);
    expect(styles.marker).toBe('disc');
  });

  test('shows a participant large from the tile and returns to the grid', async ({ page }) => {
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 5);

    const tile = page.locator('.lk-grid-layout .mtile').nth(3);
    // The simulated tracks publish just after the tiles appear. That remounts the grid, and a click in that moment is lost.
    await expect(async () => {
      await tile.hover();
      await tile.getByRole('button', { name: /^show .* large$/i }).click({ timeout: 1000 });
      await expect(page.locator('.lk-focus-layout')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page.locator('.lk-grid-layout')).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/show-large.png`, fullPage: true });

    await page.getByRole('button', { name: 'Back to grid' }).click();
    await expect(page.locator('.lk-grid-layout')).toBeVisible();
    await expect(page.locator('.lk-focus-layout')).toHaveCount(0);
  });

  test('your own window on a phone starts open and folds to a pill and back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 5, { selfWindow: true });

    const pip = page.getByTestId('local-pip');
    await expect(pip.getByRole('button', { name: /minimize your camera/i })).toBeVisible();
    await page.screenshot({ path: `${OUT}/self-window.png`, fullPage: true });
    await pip.getByRole('button', { name: /minimize your camera/i }).click();
    await page.getByRole('button', { name: /expand your camera/i }).click();
    await expect(pip.getByRole('button', { name: /minimize your camera/i })).toBeVisible();
  });

  test('your own window can be dragged to another corner', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 3, { selfWindow: true });

    const pip = page.getByTestId('local-pip');
    const start = (await pip.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(40, 120, { steps: 5 });
    await page.mouse.up();

    await expect(pip).toHaveAttribute('data-corner', 'tl');
    const end = (await pip.boundingBox())!;
    expect(end.x).toBeLessThan(start.x);
    expect(end.y).toBeLessThan(start.y);
  });

  test('keeps a short last row centred under the rows above', async ({ page }) => {
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 5);

    const rows = page.locator('.lk-grid-row');
    await expect.poll(() => rows.count()).toBeGreaterThan(1);
    const geometry = await rows.last().evaluate((row) => {
      const rowBox = row.getBoundingClientRect();
      const tiles = [...row.querySelectorAll<HTMLElement>('.lk-grid-tile-wrapper')].map((tile) => tile.getBoundingClientRect());
      return { rowCenter: rowBox.left + rowBox.width / 2, tileCenter: (tiles[0].left + tiles.at(-1)!.right) / 2 };
    });
    expect(Math.abs(geometry.rowCenter - geometry.tileCenter)).toBeLessThan(2);
    await page.screenshot({ path: `${OUT}/centered-last-row.png`, fullPage: true });
  });

  test('mobile controls stay within the viewport and expose breakout/settings', async ({ page }) => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/meeting/e2e-sim?e2eSim=1');

      await expect(page.getByTestId('meeting-control-bar')).toBeVisible();
      await expect(page.getByText('Meeting', { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
      await expect.poll(() => page.getByTestId('meeting-control-bar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth)).toBe(true);

      await page.getByRole('button', { name: 'More', exact: true }).click();
      const more = page.getByRole('menu');
      // The toolbar's folded tools are all in the sheet, and the sheet stays on screen.
      for (const name of ['Participants', 'Share', 'Raise Hand', 'Whiteboard', 'Transcript', 'Breakout Rooms', 'Effects', 'Switch to another device', 'Settings']) {
        await expect(more.getByRole('menuitem', { name })).toBeVisible();
      }
      const moreBox = await more.boundingBox();
      expect((moreBox?.y ?? -1) >= 0 && (moreBox?.y ?? 0) + (moreBox?.height ?? Infinity) <= viewport.height).toBe(true);
      await more.getByRole('menuitem', { name: 'Breakout Rooms' }).click();
      await page.getByRole('button', { name: 'Close panel' }).click();

      await page.getByRole('button', { name: 'Settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(settings).toBeVisible();
      const settingsBox = await settings.boundingBox();
      expect(settingsBox?.height ?? Infinity).toBeLessThanOrEqual(viewport.height - 32);
      await expect.poll(() => settings.evaluate((modal) => getComputedStyle(modal).overflowY)).toBe('auto');

      await settings.getByRole('button', { name: 'Switch to another device' }).click();
      const handoff = page.getByRole('dialog', { name: 'Switch device' });
      await expect(handoff).toBeVisible();
      const handoffBox = await handoff.boundingBox();
      expect(handoffBox?.height ?? Infinity).toBeLessThanOrEqual(viewport.height - 16);
      await expect.poll(() => handoff.evaluate((modal) => modal.scrollWidth <= modal.clientWidth)).toBe(true);
      await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press('Escape');
    }
  });

  test('two real users share screen, chat, and disconnect cleanly', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = String(testInfo.project.use.baseURL ?? 'http://localhost:3333');
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });
    let contextBClosed = false;
    try {
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      await fakeDisplayMedia(pageB);
      await joinMeeting(pageA, { name: 'Alice' });
      await joinMeeting(pageB, { name: 'Bob' });

      // A share started while the room is still connecting never publishes (known, still open).
      await expect(pageB.locator('video[data-lk-source="camera"][data-lk-local-participant="false"]')).toHaveCount(1, { timeout: 30_000 });
      await pageB.waitForTimeout(2000);
      const shareButton = pageB.getByRole('button', { name: /share screen/i });
      await expect(shareButton).toBeVisible();
      await shareButton.click();
      await expect(pageB.getByRole('button', { name: /stop sharing/i })).toBeVisible({ timeout: 10_000 });

      // Bob sees his own screen only as a small live preview, not as a large echo.
      await expect(pageB.getByTestId('presenting-placeholder')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.getByText(/you are presenting to everyone/i)).toBeVisible();
      const preview = pageB.locator('.mpresent__preview');
      await expect.poll(() => preview.locator('video').evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
      await expect.poll(async () => (await preview.boundingBox())?.width ?? 0).toBeLessThanOrEqual(340);
      await expect(pageB.locator('.lk-focus-layout')).toBeVisible();
      await pageB.screenshot({ path: `${OUT}/presenting-placeholder.png`, fullPage: true });

      const screenVideo = pageA.locator('.lk-participant-media-video[data-lk-source="screen_share"]').first();
      await expect(screenVideo).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => screenVideo.evaluate((element) => getComputedStyle(element).objectFit)).toBe('contain');
      const focusLayout = pageA.locator('.lk-focus-layout');
      await expect(focusLayout).toBeVisible();
      const focusTile = focusLayout.locator('.lk-participant-tile').last();
      const videoArea = focusLayout.locator('..');
      await expect
        .poll(async () => {
          const [area, tile] = await Promise.all([videoArea.boundingBox(), focusTile.boundingBox()]);
          return area && tile ? tile.width / area.width : 0;
        })
        .toBeGreaterThan(0.55);
      await pageA.screenshot({ path: `${OUT}/multi-user-screen-share.png`, fullPage: true });

      await pageB.getByRole('button', { name: /stop presenting/i }).click();
      await expect(pageA.locator('.lk-grid-layout')).toBeVisible({ timeout: 15_000 });
      await expect(pageB.locator('.lk-grid-layout')).toBeVisible({ timeout: 15_000 });
      await expect(pageA.locator('.lk-focus-layout')).not.toBeVisible({ timeout: 15_000 });
      await expect(pageB.locator('.lk-focus-layout')).not.toBeVisible({ timeout: 15_000 });
      await expect(screenVideo).not.toBeVisible({ timeout: 15_000 });

      const message = `hello from Alice ${Date.now()}`;
      await pageA.getByRole('button', { name: /^chat$/i }).click();
      await pageA.getByPlaceholder(/type a message/i).fill(message);
      await pageA.getByRole('button', { name: /send message/i }).click();
      await pageB.getByRole('button', { name: /^chat$/i }).click();
      await expect(pageB.getByText(message, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

      await expect.poll(() => pageA.locator('.lk-participant-tile').count()).toBeGreaterThanOrEqual(2);
      const before = await pageA.locator('.lk-participant-tile').count();
      await contextB.close();
      contextBClosed = true;
      await expect.poll(() => pageA.locator('.lk-participant-tile').count(), { timeout: 20_000 }).toBe(before - 1);
    } finally {
      if (!contextBClosed) await contextB.close();
      await contextA.close();
    }
  });

  test('whiteboard canvas follows its sheet when a panel opens beside it', async ({ page }) => {
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 3);
    await page.getByRole('button', { name: 'Whiteboard' }).click();

    const sizes = () => page.locator('.wb').evaluate((sheet) => {
      const canvas = sheet.querySelector('canvas')!;
      return { sheet: sheet.clientWidth, canvas: canvas.width };
    });
    await expect.poll(async () => { const s = await sizes(); return s.sheet > 0 && s.canvas === s.sheet; }).toBe(true);
    const before = (await sizes()).sheet;

    await page.getByRole('button', { name: 'Chat' }).click();

    await expect.poll(async () => (await sizes()).sheet).toBeLessThan(before);
    await expect.poll(async () => { const s = await sizes(); return s.canvas === s.sheet; }).toBe(true);
  });

  test('view switcher and chat sidebar resize the video grid', async ({ page }) => {
    await page.goto('/meeting/e2e-sim?e2eSim=1');
    await simulateParticipants(page, 5);

    const gridButton = page.getByRole('button', { name: 'Grid view' });
    const speakerButton = page.getByRole('button', { name: 'Speaker view' });
    await expect(gridButton).toBeVisible();
    await expect(speakerButton).toBeVisible();
    await gridButton.click();
    await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
    await expect(speakerButton).toHaveAttribute('aria-pressed', 'false');
    await speakerButton.click();
    await expect(speakerButton).toHaveAttribute('aria-pressed', 'true');
    await expect(gridButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.lk-focus-layout')).toBeVisible();
    await gridButton.click();
    await expect(page.locator('.lk-grid-layout')).toBeVisible();

    const grid = page.locator('.lk-grid-layout');
    const initialWidth = (await grid.boundingBox())?.width ?? 0;
    expect(initialWidth).toBeGreaterThan(0);

    await page.getByRole('button', { name: /^chat$/i }).click();
    await expect
      .poll(async () => initialWidth - ((await grid.boundingBox())?.width ?? initialWidth), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(300);
    await page.screenshot({ path: `${OUT}/sidebar-open.png`, fullPage: true });

    await page.getByRole('button', { name: 'Close panel' }).click();
    await expect
      .poll(async () => (await grid.boundingBox())?.width ?? 0, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(initialWidth - 20);
  });

  // Active-speaker E2E coverage is skipped: simulated tracks do not emit speaking events.
});

test('open notes show another participant’s edits without closing the panel', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const openNotes = async (client: Page) => {
    await client.getByTestId('meeting-control-bar').getByRole('button', { name: 'Notes', exact: true }).click();
    const editor = client.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    return editor;
  };
  let holdFirstSave = false;
  let releaseSave: (() => void) | undefined;
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, browserSocket => {
    const serverSocket = browserSocket.connectToServer();
    browserSocket.onMessage(message => {
      if (holdFirstSave && typeof message === 'string' && JSON.parse(message).udfPath === 'meetingDoc:save') {
        releaseSave = () => serverSocket.send(message);
        return;
      }
      serverSocket.send(message);
    });
  });

  await joinMeeting(page, { name: 'Lena' });
  const first = await openNotes(page);
  const otherContext = await browser.newContext({ baseURL });
  try {
    const other = await otherContext.newPage();
    await joinMeeting(other, { name: 'Jonas' });
    const second = await openNotes(other);

    const prefix = `Decision ${Date.now()}`;
    await first.locator('p').last().click();
    await first.press('Control+End');
    await first.press('Enter');
    await first.pressSequentially(prefix);
    await expect(first).toContainText(prefix);
    await expect(second).toContainText(prefix, { timeout: 10_000 });

    await second.press('Control+End');
    await second.press('Enter');
    await second.pressSequentially('Schedule the review');
    await expect(first).toContainText('Schedule the review', { timeout: 10_000 });
    await expect(first).toContainText(prefix);
    await first.screenshot({ path: testInfo.outputPath('shared-notes.png') });

    holdFirstSave = true;
    await first.press('Control+End');
    await first.press('Enter');
    await first.pressSequentially('First browser draft');
    await expect.poll(() => Boolean(releaseSave)).toBe(true);

    const saved = `Second browser saved ${Date.now()}`;
    await second.press('Control+End');
    await second.press('Enter');
    await second.pressSequentially(saved);
    await expect(other.getByText('Saved in this room', { exact: true })).toBeVisible();

    holdFirstSave = false;
    releaseSave!();
    await expect(page.getByRole('alert')).toContainText('Someone else updated the notes.');
    await expect(first).toContainText('First browser draft');
    await expect(second).toContainText(saved);
    await expect(second).not.toContainText('First browser draft');

    await page.getByTestId('meeting-control-bar').getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(first).toHaveCount(0);
    await openNotes(page);
    await expect(first).toContainText('First browser draft');
    await first.screenshot({ path: testInfo.outputPath('retained-notes-draft.png') });
  } finally {
    await otherContext.close();
  }
});

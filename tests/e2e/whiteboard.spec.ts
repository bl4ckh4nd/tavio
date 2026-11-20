// Drawing on the whiteboard the way a drawing program works, on the local stack (npm run e2e:local:up):
//   E2E_PORT=3334 E2E_CONVEX_URL=http://127.0.0.1:3210 E2E_CONVEX_SITE_URL=http://127.0.0.1:3211 npx playwright test --project=board
// Lena draws and styles shapes, joins them with an arrow, writes, moves a shape and the arrow follows.
// Lena pastes an image. Jonas joins later, sees it, and exports the board as SVG; the file and the screenshots land in test-results/whiteboard/.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { joinMeeting } from './helpers';

// E2E_ARTIFACTS moves the files when test-results/ cannot be written.
const OUT = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/whiteboard`;

const openBoard = async (page: Page) => {
  await page.getByTestId('meeting-control-bar').getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect(page.locator('canvas[aria-label="Whiteboard"]')).toBeVisible();
};

/** A board point to a page point: at 100 % and unpanned they are the canvas's own pixels. */
const at = async (page: Page, x: number, y: number) => {
  const box = (await page.locator('canvas[aria-label="Whiteboard"]').boundingBox())!;
  return { x: box.x + x, y: box.y + y };
};

const clickAt = async (page: Page, x: number, y: number) => {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
};

const BLUE = [37, 99, 235];
const near = (actual: number[], expected: number[]) => actual.every((c, i) => Math.abs(c - expected[i]) <= 8);
/** The colour at a board point; without one, in the middle of the board, where a pasted image lands. */
const colourAt = (page: Page, point?: [number, number]) =>
  page.locator('canvas[aria-label="Whiteboard"]').evaluate((canvas: HTMLCanvasElement, point) => {
    const [x, y] = point ?? [Math.round(canvas.width / 2), Math.round(canvas.height / 2)];
    return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, point);
/** Where Lena moves the image to, clear of the drawing. */
const IMAGE_AT: [number, number] = [880, 470];

const drag = async (page: Page, from: [number, number], to: [number, number]) => {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
};

/** Whether a dark line crosses a short stretch of the row at y. Empty canvas is transparent black, so alpha counts. */
const inkAcross = (page: Page, x: number, y: number, width: number) =>
  page.locator('canvas[aria-label="Whiteboard"]').evaluate((canvas: HTMLCanvasElement, [x, y, width]) => {
    const data = canvas.getContext('2d')!.getImageData(x, y, width, 1).data;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] < 200) return true;
    return false;
  }, [x, y, width]);

/** A clean board for this run. The server empties it; drawing before that arrives would be drawn on the old one. */
const startCleanBoard = async (page: Page) => {
  await page.getByRole('button', { name: /^Board/ }).click();
  const newBoard = page.getByRole('menuitem', { name: 'New board' });
  if (await newBoard.isEnabled()) await newBoard.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByText('Empty whiteboard')).toBeVisible();
};

test('two people: one draws, styles, connects and writes on the board, the other exports it', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);

  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });
  const style = page.getByRole('region', { name: 'Style' });

  // A rectangle from the toolbar, styled from the card while it is still selected.
  await tools.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, [320, 200], [480, 300]);
  await style.getByRole('button', { name: 'Background #fbe7b0' }).click();
  await style.getByRole('group', { name: 'Fill' }).getByRole('button', { name: 'Hatched' }).click();
  await style.getByRole('group', { name: 'Stroke style' }).getByRole('button', { name: 'Dashed' }).click();

  // A diamond by its key, an arrow from the rectangle into the diamond.
  await page.keyboard.press('d');
  await drag(page, [640, 200], [800, 320]);
  await page.keyboard.press('a');
  await drag(page, [400, 250], [720, 262]);
  // The arrow docks on the rectangle's edge instead of starting in its middle.
  await expect.poll(() => inkAcross(page, 500, 254, 100)).toBe(true);
  expect(await inkAcross(page, 500, 204, 100)).toBe(false);

  // Free text, and text inside the rectangle.
  await page.keyboard.press('t');
  const textAt = await at(page, 320, 380);
  await page.mouse.click(textAt.x, textAt.y);
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Launch plan');
  await page.keyboard.press('Escape');
  const inRect = await at(page, 400, 250);
  await page.mouse.dblclick(inRect.x, inRect.y);
  await page.getByRole('textbox', { name: 'Text in the shape' }).fill('Design');
  await page.screenshot({ path: `${OUT}/1-writing.png` });
  await page.keyboard.press('Escape');
  // What was written stays, also once the saves of the steps before it come back from the server.
  await page.waitForTimeout(1500);
  // Words in a shape sit in its middle.
  await expect.poll(() => inkAcross(page, 370, 250, 60)).toBe(true);
  await page.screenshot({ path: `${OUT}/2-drawn.png` });

  // Moving the rectangle up takes the arrow's start with it.
  await drag(page, [360, 285], [360, 185]);
  await page.screenshot({ path: `${OUT}/3-moved.png` });
  await expect.poll(() => inkAcross(page, 500, 204, 100)).toBe(true);
  await expect.poll(() => inkAcross(page, 500, 254, 100)).toBe(false);

  // Undo puts it back, redo moves it again.
  await page.keyboard.press('Control+z');
  await expect.poll(() => inkAcross(page, 500, 254, 100)).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => inkAcross(page, 500, 204, 100)).toBe(true);

  // An image pasted from the clipboard is stored in the room, so the others can load it too.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'blue.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
  });
  await expect.poll(async () => near(await colourAt(page), BLUE), { timeout: 15_000 }).toBe(true);
  const middle = await page.locator('canvas[aria-label="Whiteboard"]').evaluate((canvas: HTMLCanvasElement) => [Math.round(canvas.width / 2), Math.round(canvas.height / 2)] as [number, number]);
  await drag(page, middle, IMAGE_AT);
  await expect.poll(async () => near(await colourAt(page, IMAGE_AT), BLUE)).toBe(true);
  await page.screenshot({ path: `${OUT}/3b-image.png` });

  const jonasContext = await browser.newContext({ baseURL, acceptDownloads: true });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas' });
    await openBoard(jonas);
    await expect.poll(() => inkAcross(jonas, 500, 204, 100), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => near(await colourAt(jonas, IMAGE_AT), BLUE)).toBe(true);
    await jonas.screenshot({ path: `${OUT}/4-jonas.png` });

    // The stored image keeps the canvas exportable: a tainted canvas would refuse to give out a PNG.
    await jonas.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'Download' }).click();
    const [png] = await Promise.all([
      jonas.waitForEvent('download'),
      jonas.getByRole('menuitem', { name: 'Board as PNG' }).click(),
    ]);
    await png.saveAs(`${OUT}/board.png`);
    expect((await readFile(`${OUT}/board.png`)).subarray(1, 4).toString()).toBe('PNG');

    await jonas.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'Download' }).click();
    const [download] = await Promise.all([
      jonas.waitForEvent('download'),
      jonas.getByRole('menuitem', { name: 'Board as SVG' }).click(),
    ]);
    const file = `${OUT}/board.svg`;
    await download.saveAs(file);
    const svg = await readFile(file, 'utf8');
    expect(svg).toContain('Launch plan');
    expect(svg).toMatch(/<div xmlns="http:\/\/www.w3.org\/1999\/xhtml"[^>]*>Design</);
    // The diamond, with the round corners the card starts with.
    expect(svg).toMatch(/<path d="M[^"]+Q[^"]+Z"/);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('<pattern');
    expect(svg).toMatch(/<path d="M/);
    expect(svg).toMatch(/<image[^>]+href="https?:\/\/[^"]+"/);
    expect(svg).not.toContain('blob:');
    // The file on its own, as another program opens it.
    await jonas.goto(`file://${resolve(file)}`);
    await jonas.screenshot({ path: `${OUT}/5-board-svg.png` });
    await expect(jonas.getByText('Design')).toBeVisible();
  } finally {
    await jonasContext.close();
  }
});

const NOTE_BLUE = [214, 230, 251];

test('two people brainstorm: notes in a row, a section that carries them, a labelled connector, a stamp, and cursors with a sentence', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);
  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });
  const written = page.getByRole('textbox', { name: 'Text in the shape' });

  // A section by its key, named right away.
  await page.keyboard.press('s');
  const sectionAt = await at(page, 200, 160);
  await page.mouse.click(sectionAt.x, sectionAt.y);
  await written.fill('Ideas');
  await page.keyboard.press('Enter');

  // A note on it, and Tab writes the next one beside it.
  await tools.getByRole('button', { name: 'Note' }).click();
  const noteAt = await at(page, 330, 290);
  await page.mouse.click(noteAt.x, noteAt.y);
  await written.fill('First idea');
  await page.keyboard.press('Tab');
  await written.fill('Second');
  await page.keyboard.press('Escape');

  // The second note is still selected: its bar turns it blue.
  await page.getByRole('toolbar', { name: 'Note' }).getByRole('button', { name: 'Blue' }).click();
  await expect.poll(async () => near(await colourAt(page, [640, 210]), NOTE_BLUE)).toBe(true);

  // The plus under the first note adds the next one, already connected.
  const first = await at(page, 260, 210);
  await page.mouse.click(first.x, first.y);
  const plus = await at(page, 330, 418);
  await page.mouse.click(plus.x, plus.y);
  await written.fill('Third');
  await page.keyboard.press('Escape');
  await expect.poll(() => inkAcross(page, 320, 430, 20)).toBe(true);

  // The connector gets a label.
  // The new note's bar sits over the connector; a second Escape lets go of the note.
  await page.keyboard.press('Escape');
  const connector = await at(page, 330, 430);
  await page.mouse.dblclick(connector.x, connector.y);
  await page.getByRole('textbox', { name: 'Label' }).fill('next');
  await page.keyboard.press('Enter');

  // A heart on the second note.
  await tools.getByRole('button', { name: 'Stamp' }).click();
  await page.getByRole('menuitemradio', { name: 'Heart' }).click();
  const onSecond = await at(page, 620, 220);
  await page.mouse.click(onSecond.x, onSecond.y);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${OUT}/6-brainstorm.png` });

  // Dragging the section by its name tab takes the notes on it along, the stamp with them.
  await drag(page, [220, 146], [220, 206]);
  await expect.poll(async () => near(await colourAt(page, [640, 420]), NOTE_BLUE)).toBe(true);
  expect(near(await colourAt(page, [640, 200]), NOTE_BLUE)).toBe(false);
  // The heart came along on the note.
  expect(near(await colourAt(page, [620, 280]), [220, 38, 38])).toBe(true);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/7-section-moved.png` });

  const jonasContext = await browser.newContext({ baseURL, acceptDownloads: true });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas' });
    await openBoard(jonas);
    await expect.poll(async () => near(await colourAt(jonas, [640, 420]), NOTE_BLUE), { timeout: 15_000 }).toBe(true);

    // Both write at once: Lena is still in her note while Jonas adds and finishes his. Neither is lost.
    await page.keyboard.press('n');
    const lenaNote = await at(page, 960, 130);
    await page.mouse.click(lenaNote.x, lenaNote.y);
    await written.fill('Lena writes');
    await jonas.keyboard.press('n');
    const jonasNote = await at(jonas, 960, 420);
    await jonas.mouse.click(jonasNote.x, jonasNote.y);
    await jonas.getByRole('textbox', { name: 'Text in the shape' }).fill('From Jonas');
    await jonas.keyboard.press('Escape');
    await jonas.keyboard.press('Escape');
    // Jonas also moves the third note out of the way.
    await drag(jonas, [300, 520], [750, 520]);
    await jonas.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    const YELLOW = [251, 231, 176];
    for (const board of [page, jonas]) {
      // Lena's new note takes the blue she chose last.
      await expect.poll(async () => near(await colourAt(board, [1040, 200]), NOTE_BLUE), { timeout: 10_000 }).toBe(true);
      await expect.poll(async () => near(await colourAt(board, [1040, 500]), YELLOW), { timeout: 10_000 }).toBe(true);
      await expect.poll(async () => near(await colourAt(board, [860, 560]), YELLOW), { timeout: 10_000 }).toBe(true);
      await board.screenshot({ path: `${OUT}/7b-both-wrote-${board === page ? 'lena' : 'jonas'}.png` });
    }

    // Jonas points and says something there; Lena sees his name and the sentence at his cursor.
    const pointing = await at(jonas, 700, 300);
    await jonas.mouse.move(pointing.x - 20, pointing.y);
    await jonas.mouse.move(pointing.x, pointing.y, { steps: 5 });
    await jonas.keyboard.press('/');
    await jonas.getByRole('textbox', { name: 'Say something at your cursor' }).fill('Look here');
    await jonas.keyboard.press('Enter');
    await expect(page.locator('.wb__cursor').filter({ hasText: 'Jonas' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.wb__cursor').filter({ hasText: 'Look here' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/8-cursor-chat.png` });

    await jonas.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'Download' }).click();
    const [download] = await Promise.all([
      jonas.waitForEvent('download'),
      jonas.getByRole('menuitem', { name: 'Board as SVG' }).click(),
    ]);
    const file = `${OUT}/brainstorm.svg`;
    await download.saveAs(file);
    const svg = await readFile(file, 'utf8');
    for (const words of ['Ideas', 'First idea', 'Second', 'Third', 'next', 'Lena', 'Lena writes', 'From Jonas']) expect(svg).toContain(words);
    // The heart, filled in red.
    expect(svg).toMatch(/<path d="M12 21s[^"]*" [^>]*fill="#dc2626"/);
    await jonas.goto(`file://${resolve(file)}`);
    await jonas.screenshot({ path: `${OUT}/9-brainstorm-svg.png` });
  } finally {
    await jonasContext.close();
  }
});

test('text goes onto the board from the clipboard and back out as text, and a copy elsewhere on the page stays a copy of that page text', async ({ page }) => {
  test.setTimeout(60_000);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  // Text copied in another program lands on the board as text.
  await page.evaluate(() => navigator.clipboard.writeText('Pasted from elsewhere'));
  await page.keyboard.press('Control+v');
  const middle = await page.locator('canvas[aria-label="Whiteboard"]').evaluate((canvas: HTMLCanvasElement) => [Math.round(canvas.width / 2), Math.round(canvas.height / 2)]);
  await expect.poll(() => inkAcross(page, middle[0] - 150, middle[1], 300)).toBe(true);
  await page.keyboard.press('Escape');

  // A note copied on the board reads as its text anywhere else, and pastes back onto the board as a note.
  await page.keyboard.press('n');
  const noteAt = await at(page, 300, 200);
  await page.mouse.click(noteAt.x, noteAt.y);
  await page.getByRole('textbox', { name: 'Text in the shape' }).fill('Copy me');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+c');
  await expect.poll(clipboard).toBe('Copy me');
  await page.keyboard.press('Control+v');
  // The copy lands a step beside the original: this point is on the copy only.
  await expect.poll(async () => near(await colourAt(page, [410, 310]), [251, 231, 176])).toBe(true);
  await page.screenshot({ path: `${OUT}/10-paste.png` });

  // With a note still selected, copying text selected on the page copies that text.
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('header *, [class*="top"] *')].find(el => el.childElementCount === 0 && el.textContent?.trim() === 'Meeting')!;
    const range = document.createRange();
    range.selectNodeContents(title);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.press('Control+c');
  await expect.poll(clipboard).toBe('Meeting');
});

test('a page of HTML goes onto the board for everyone and shows as a browser shows it, with no script running and nothing loaded from elsewhere', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);
  let fetched = false;
  await page.context().route('https://tracker.example/**', route => { fetched = true; return route.abort(); });

  const overview = '<!doctype html><html><head><title>Quarterly overview</title><style>h1 { color: rgb(37, 99, 235) }</style></head>'
    + '<body><h1>Quarterly overview</h1><table><tr><td>Web</td><td>done</td></tr></table>'
    + '<script>document.querySelector("h1").textContent = "Script ran"</script><img src="https://tracker.example/pixel.png" alt=""></body></html>';
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'HTML page' }).click(),
  ]);
  await chooser.setFiles({ name: 'overview.html', mimeType: 'text/html', buffer: Buffer.from(overview) });

  const shown = page.frameLocator('iframe[title="Quarterly overview"]');
  await expect(shown.getByRole('heading', { name: 'Quarterly overview' })).toBeVisible({ timeout: 10_000 });
  await expect(shown.getByRole('heading')).toHaveCSS('color', 'rgb(37, 99, 235)');
  expect(fetched).toBe(false);

  // The page is moved like anything else on the board: by dragging it.
  const before = (await page.locator('iframe[title="Quarterly overview"]').boundingBox())!;
  await page.mouse.move(before.x + 300, before.y + 200);
  await page.mouse.down();
  await page.mouse.move(before.x + 300, before.y + 320, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');

  const jonasContext = await browser.newContext({ baseURL });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas' });
    await openBoard(jonas);
    const there = jonas.frameLocator('iframe[title="Quarterly overview"]');
    await expect(there.getByRole('cell', { name: 'done' })).toBeVisible({ timeout: 15_000 });
    await expect(there.getByRole('heading')).toHaveText('Quarterly overview');
    await expect.poll(async () => (await jonas.locator('iframe[title="Quarterly overview"]').boundingBox())!.y - (await jonas.locator('canvas[aria-label="Whiteboard"]').boundingBox())!.y)
      .toBeCloseTo(before.y - (await page.locator('canvas[aria-label="Whiteboard"]').boundingBox())!.y + 120, -1);
    await jonas.screenshot({ path: `${OUT}/11-html-page.png` });
  } finally {
    await jonasContext.close();
  }
});

test('more shapes come from one menu and are drawn by dragging, like the others', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);
  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });

  await tools.getByRole('button', { name: 'More shapes' }).click();
  await page.getByRole('menuitemradio', { name: 'Star' }).click();
  await drag(page, [300, 200], [500, 400]);
  await page.keyboard.press('Escape');
  // A star's top point is in the middle of its box's top edge; its top corners stay empty.
  await expect.poll(() => inkAcross(page, 380, 206, 40)).toBe(true);
  expect(await inkAcross(page, 302, 210, 30)).toBe(false);

  await tools.getByRole('button', { name: 'More shapes' }).click();
  await page.getByRole('menuitemradio', { name: 'Speech bubble' }).click();
  await drag(page, [600, 200], [800, 340]);
  await page.keyboard.press('Escape');
  await expect.poll(() => inkAcross(page, 650, 200, 100)).toBe(true);
  await page.screenshot({ path: `${OUT}/12-more-shapes.png` });
});

test('a template lays out its sections with a starter note in each, ready to write in', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);
  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });

  await tools.getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('menuitem', { name: 'Kanban' }).click();
  await tools.getByRole('button', { name: 'Sections' }).click();
  for (const name of ['To do', 'Doing', 'Done']) await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${OUT}/13-template.png` });
});

test('a task card is written, given a person and a date, ticked off, and is in the record when the call ends', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);

  await page.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'Task' }).click();
  const first = await at(page, 300, 200);
  await page.mouse.click(first.x, first.y);
  await page.getByRole('textbox', { name: 'Text in the shape' }).fill('Send the figures');
  await page.keyboard.press('Escape');
  const task = page.getByRole('toolbar', { name: 'Task' });
  await task.getByRole('combobox', { name: 'Who' }).fill('Jonas');
  await task.getByLabel('Due').fill('2026-11-20');
  await task.getByRole('checkbox', { name: 'Done' }).check();
  await page.keyboard.press('Escape');

  const second = await at(page, 700, 200);
  await page.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'Task' }).click();
  await page.mouse.click(second.x, second.y);
  await page.getByRole('textbox', { name: 'Text in the shape' }).fill('Test the recording');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${OUT}/14-tasks.png` });

  await page.getByTestId('meeting-control-bar').getByRole('button', { name: 'Leave' }).click();
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByRole('listitem')).toHaveText([/Test the recording/, /Send the figures.*Jonas.*Nov/]);
  await expect(tasks.getByRole('listitem').nth(1).getByText('Done')).toBeVisible();
  await page.screenshot({ path: `${OUT}/15-tasks-record.png` });
});

const RED = [220, 38, 38];
const MARKER_YELLOW = [253, 224, 71];
test('beside the chat the style card is still there and below the toolbar; marker, tape, a table filled with Tab and a mind map grown with Tab and Enter all land in the export', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);
  // The chat beside it makes the board narrow; the style card used to hide there.
  await page.getByTestId('meeting-control-bar').getByRole('button', { name: 'Chat' }).click();
  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });
  const style = page.getByRole('region', { name: 'Style' });

  await tools.getByRole('button', { name: 'Rectangle' }).click();
  await expect(style).toBeVisible();
  const toolBox = (await tools.boundingBox())!;
  expect((await style.boundingBox())!.y).toBeGreaterThanOrEqual(toolBox.y + toolBox.height);
  await drag(page, [300, 240], [460, 320]);
  await style.getByRole('button', { name: 'Stroke #dc2626' }).click();
  await style.getByRole('group', { name: 'Stroke width' }).getByRole('button', { name: 'Extra bold' }).click();
  // Above the handle in the middle of the left side.
  await expect.poll(async () => near(await colourAt(page, [300, 266]), RED)).toBe(true);

  // A table: Tab walks from cell to cell, past the last one into a new row.
  await tools.getByRole('button', { name: 'Table' }).click();
  await clickAt(page, 330, 430);
  for (const cell of ['Option', 'Price', 'Notes', 'Basic']) {
    await page.keyboard.type(cell);
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Escape');

  // A mind map: Tab grows a child, Enter a sibling; each branch off the root has its own colour.
  await page.keyboard.press('Escape');
  await tools.getByRole('button', { name: 'Mind map' }).click();
  await clickAt(page, 320, 640);
  await page.keyboard.type('Launch');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Press');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Website');
  await page.keyboard.press('Escape');

  // A marker stroke, see-through; tape on the table's head.
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  await drag(page, [300, 760], [520, 760]);
  await expect.poll(async () => near(await colourAt(page, [420, 760]), MARKER_YELLOW)).toBe(true);
  await page.keyboard.press('Escape');
  await tools.getByRole('button', { name: 'Stamp' }).click();
  await page.getByRole('menuitemradio', { name: 'Tape' }).click();
  await clickAt(page, 330, 372);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/13-later-kinds.png` });

  await tools.getByRole('button', { name: 'Download' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Board as SVG' }).click()]);
  const file = `${OUT}/later-kinds.svg`;
  await download.saveAs(file);
  const svg = await readFile(file, 'utf8');
  for (const words of ['Option', 'Price', 'Notes', 'Basic', 'Launch', 'Press', 'Website']) expect(svg).toContain(`>${words}<`);
  // Two branches off the root, in two colours.
  const links = [...svg.matchAll(/<path d="M[^"]+C[^"]+" fill="none" stroke="(#[0-9a-f]+)"/g)].map(m => m[1]);
  expect(links).toHaveLength(2);
  expect(new Set(links).size).toBe(2);
  expect(svg).toContain('stroke="#fde047"');
  expect(svg).toMatch(/fill="rgba\(236, 224, 196, 0.82\)"/);
  expect(svg).toContain('stroke="#dc2626"');
});

test('finishing a drawing preserves another participant’s move and deletion', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);

  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });
  await tools.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, [320, 200], [450, 280]);
  await tools.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, [525, 200], [630, 280]);
  await expect.poll(() => inkAcross(page, 550, 200, 40)).toBe(true);

  const otherContext = await browser.newContext({ baseURL });
  try {
    const other = await otherContext.newPage();
    await joinMeeting(other, { name: 'Jonas' });
    await openBoard(other);
    await expect.poll(() => inkAcross(other, 365, 200, 40)).toBe(true);
    await expect.poll(() => inkAcross(other, 550, 200, 40)).toBe(true);

    await tools.getByRole('button', { name: 'Rectangle' }).click();
    const start = await at(page, 760, 360);
    const end = await at(page, 890, 450);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });

    await drag(other, [380, 230], [380, 330]);
    await clickAt(other, 575, 240);
    await other.keyboard.press('Delete');

    // Read the saved changes from a fresh page while the writer stays connected.
    const observer = await otherContext.newPage();
    await joinMeeting(observer, { name: 'Board observer' });
    await openBoard(observer);
    await expect.poll(() => inkAcross(observer, 365, 300, 40)).toBe(true);
    await expect.poll(() => inkAcross(observer, 550, 200, 40)).toBe(false);

    await page.mouse.up();
    await expect.poll(() => inkAcross(observer, 800, 360, 45)).toBe(true);
    expect(await inkAcross(observer, 365, 300, 40)).toBe(true);
    expect(await inkAcross(observer, 365, 200, 40)).toBe(false);
    expect(await inkAcross(observer, 550, 200, 40)).toBe(false);
    await observer.screenshot({ path: testInfo.outputPath('merged-board.png') });
  } finally {
    await otherContext.close();
  }
});

test('someone else deleting what was drawn here last takes it off this board too', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  await joinMeeting(page, { name: 'Lena' });
  await openBoard(page);
  await startCleanBoard(page);

  const tools = page.getByRole('toolbar', { name: 'Whiteboard' });
  await tools.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, [320, 200], [450, 280]);
  await tools.getByRole('button', { name: 'Rectangle' }).click();
  await drag(page, [525, 200], [630, 280]);

  const otherContext = await browser.newContext({ baseURL });
  try {
    const other = await otherContext.newPage();
    await joinMeeting(other, { name: 'Jonas' });
    await openBoard(other);
    await expect.poll(() => inkAcross(other, 550, 200, 40)).toBe(true);
    // The board is now as Lena's first save left it.
    await clickAt(other, 575, 240);
    await other.keyboard.press('Delete');
    await expect.poll(() => inkAcross(other, 550, 200, 40)).toBe(false);

    await expect.poll(() => inkAcross(page, 550, 200, 40)).toBe(false);
    expect(await inkAcross(page, 365, 200, 40)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('deleted-by-other.png') });
  } finally {
    await otherContext.close();
  }
});

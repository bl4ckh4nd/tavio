// Running a call: the room timer, voting with dots and comment pins, on the local stack (npm run e2e:local:up):
//   E2E_PORT=3334 E2E_CONVEX_URL=http://127.0.0.1:3210 E2E_CONVEX_SITE_URL=http://127.0.0.1:3211 npx playwright test --project=board facilitation
// Lena is the signed-in host of the open room `facilitation` (seeded by e2e:local:up); Jonas joins as a guest.
// Who may moderate, the three dots and their secrecy are in convex/timer.integration.test.ts and convex/voting.integration.test.ts;
// comments in the session history in convex/roomSessions.test.ts.
// Screenshots land in test-results/facilitation/.
import { test, expect, type Page } from '@playwright/test';
import { joinMeeting, signInAsHost } from './helpers';

const ROOM = 'facilitation';

const OUT = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/facilitation`;

const openBoard = async (page: Page) => {
  await page.getByTestId('meeting-control-bar').getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await expect(page.locator('canvas[aria-label="Whiteboard"]')).toBeVisible();
};
/** Clicks a board point: at 100 % and unpanned it is the canvas's own pixel. */
const clickBoard = async (page: Page, x: number, y: number) => {
  const box = (await page.locator('canvas[aria-label="Whiteboard"]').boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
};

/** Seconds left on a timer chip that reads mm:ss. */
const secondsOn = async (page: Page) => {
  const [m, s] = (await page.getByRole('timer').innerText()).match(/(\d+):(\d+)/)!.slice(1).map(Number);
  return m * 60 + s;
};

test('the room timer: one person starts it, everyone counts down the same time, it pauses, gets a minute more and stops', async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await signInAsHost(page);
  await joinMeeting(page, { name: 'Lena', slug: ROOM });
  // A timer from an earlier run goes first.
  await page.getByRole('button', { name: 'Timer' }).click();
  const stopOld = page.getByRole('menuitem', { name: 'Stop timer' });
  if (await stopOld.isVisible()) await stopOld.click();
  else await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Timer' }).click();
  await page.getByRole('menuitem', { name: '3 min' }).click();
  await expect(page.getByRole('timer')).toContainText(/0[23]:\d\d/);

  const jonasContext = await browser.newContext({ baseURL });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas', slug: ROOM, waitForHost: true });
    await expect(jonas.getByRole('timer')).toBeVisible({ timeout: 15_000 });
    expect(Math.abs((await secondsOn(jonas)) - (await secondsOn(page)))).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: 'Timer' }).click();
    await page.getByRole('menuitem', { name: 'Pause' }).click();
    await expect(jonas.getByRole('timer')).toContainText('Paused');
    const paused = await secondsOn(page);
    await expect.poll(() => secondsOn(jonas)).toBe(paused);

    await page.getByRole('button', { name: 'Timer' }).click();
    await page.getByRole('menuitem', { name: '+1 min' }).click();
    await expect.poll(() => secondsOn(jonas)).toBe(paused + 60);
    await jonas.screenshot({ path: `${OUT}/1-timer-paused.png` });

    await page.getByRole('button', { name: 'Timer' }).click();
    await page.getByRole('menuitem', { name: 'Stop timer' }).click();
    await expect(jonas.getByRole('timer')).toHaveCount(0);
  } finally {
    await jonasContext.close();
  }
});

test('dot voting: the moderator starts a round, each person spends three dots unseen, the result comes sorted', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await signInAsHost(page);
  await joinMeeting(page, { name: 'Lena', slug: ROOM });
  await openBoard(page);
  // A clean board with two ideas.
  await page.getByRole('button', { name: /^Board/ }).click();
  const newBoard = page.getByRole('menuitem', { name: 'New board' });
  if (await newBoard.isEnabled()) await newBoard.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByText('Empty whiteboard')).toBeVisible();
  const written = page.getByRole('textbox', { name: 'Text in the shape' });
  await page.keyboard.press('n');
  await clickBoard(page, 300, 250);
  await written.fill('Idea A');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await clickBoard(page, 700, 250);
  await written.fill('Idea B');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  const vote = page.getByRole('region', { name: 'Dot vote' });
  if (await vote.isVisible()) await vote.getByRole('button', { name: 'End vote' }).click();
  await page.getByRole('button', { name: 'Start a dot vote' }).click();
  await expect(vote).toContainText('3 of 3 dots left');

  const jonasContext = await browser.newContext({ baseURL });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas', slug: ROOM, waitForHost: true });
    await openBoard(jonas);
    const jonasVote = jonas.getByRole('region', { name: 'Dot vote' });
    await expect(jonasVote).toContainText('3 of 3 dots left', { timeout: 15_000 });

    const give = jonasVote.getByRole('button', { name: 'Give a dot' });
    await expect(give).toBeDisabled();
    await clickBoard(jonas, 720, 270);
    await give.click();
    await give.click();
    await clickBoard(jonas, 320, 270);
    await give.click();
    await expect(jonasVote).toContainText('0 of 3 dots left');
    await expect(give).toBeDisabled();
    // A dot can be taken back and spent again.
    await jonasVote.getByRole('button', { name: 'Take a dot back' }).click();
    await expect(jonasVote).toContainText('1 of 3 dots left');
    await give.click();

    await clickBoard(page, 720, 270);
    await vote.getByRole('button', { name: 'Give a dot' }).click();
    await expect(vote).toContainText('2 people have voted');
    // Until the result is shown nobody sees the others' dots.
    await expect(vote.getByRole('list', { name: 'Result' })).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/2-vote-hidden.png` });

    await vote.getByRole('button', { name: 'Show result' }).click();
    const result = jonasVote.getByRole('list', { name: 'Result' }).getByRole('listitem');
    await expect(result).toHaveCount(2);
    await expect(result.nth(0)).toContainText('Idea B');
    await expect(result.nth(0)).toContainText('3 dots');
    await expect(result.nth(1)).toContainText('Idea A');
    await expect(result.nth(1)).toContainText('1 dot');
    await expect(jonasVote.getByRole('button', { name: 'Give a dot' })).toHaveCount(0);
    await jonas.screenshot({ path: `${OUT}/3-vote-result.png` });

    await vote.getByRole('button', { name: 'End vote' }).click();
    await expect(jonasVote).toHaveCount(0);
  } finally {
    await jonasContext.close();
  }
});

test('comment pins: a comment hangs on a note, the other person replies, it moves with the note and is ticked done', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await signInAsHost(page);
  await joinMeeting(page, { name: 'Lena', slug: ROOM });
  await openBoard(page);
  await page.getByRole('button', { name: /^Board/ }).click();
  const newBoard = page.getByRole('menuitem', { name: 'New board' });
  if (await newBoard.isEnabled()) await newBoard.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByText('Empty whiteboard')).toBeVisible();
  await page.keyboard.press('n');
  await clickBoard(page, 300, 250);
  await page.getByRole('textbox', { name: 'Text in the shape' }).fill('Pricing');
  await page.keyboard.press('Escape');

  // The note is still selected: its pin offers a comment.
  await page.getByRole('button', { name: 'Comment on this element' }).click();
  const lenaThread = page.getByRole('dialog', { name: 'Comments' });
  await lenaThread.getByRole('textbox', { name: 'Comment' }).fill('Is this the right price?');
  await lenaThread.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(lenaThread.getByRole('listitem')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(lenaThread).toHaveCount(0);

  const jonasContext = await browser.newContext({ baseURL });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas', slug: ROOM, waitForHost: true });
    await openBoard(jonas);
    const pin = jonas.getByRole('button', { name: /^1 comment/ });
    await expect(pin).toBeVisible({ timeout: 15_000 });
    await pin.click();
    const jonasThread = jonas.getByRole('dialog', { name: 'Comments' });
    await expect(jonasThread).toContainText('Is this the right price?');
    await jonasThread.getByRole('textbox', { name: 'Comment' }).fill('Ten euros less');
    await jonasThread.getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByRole('button', { name: /^2 comments/ })).toBeVisible();
    await jonas.keyboard.press('Escape');

    // Lena moves the note; the pin goes with it.
    const before = (await jonas.getByRole('button', { name: /^2 comments/ }).boundingBox())!;
    const box = (await page.locator('canvas[aria-label="Whiteboard"]').boundingBox())!;
    await page.mouse.move(box.x + 320, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 520, box.y + 400, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await jonas.getByRole('button', { name: /^2 comments/ }).boundingBox())!.x - before.x), { timeout: 10_000 }).toBe(200);

    await page.getByRole('button', { name: /^2 comments/ }).click();
    await page.getByRole('dialog', { name: 'Comments' }).getByRole('checkbox', { name: 'Done' }).check();
    await expect(jonas.getByRole('button', { name: /^2 comments, done/ })).toBeVisible();
    await jonas.getByRole('button', { name: /^2 comments, done/ }).click();
    await expect(jonas.getByRole('dialog', { name: 'Comments' }).getByRole('checkbox', { name: 'Done' })).toBeChecked();
    await jonas.screenshot({ path: `${OUT}/4-comment-done.png` });
  } finally {
    await jonasContext.close();
  }
});

// The meeting assistant end to end, on the local stack (npm run e2e:local:up) with the worker running:
//   cd agent && set -a && . ./.env && set +a && LIVEKIT_URL=ws://localhost:7880 LIVEKIT_API_KEY=devkey \
//     LIVEKIT_API_SECRET=secret DEEPGRAM_API_KEY=… .venv/bin/python -m tavio_assistant.main dev
//   E2E_PORT=3334 E2E_CONVEX_URL=http://127.0.0.1:3210 E2E_CONVEX_SITE_URL=http://127.0.0.1:3211 npx playwright test --project=assistant
// Speech and the model are outside this test: it acts with the worker's own grant, taken from the
// LiveKit dispatch, the way the worker does after a command. Screenshots land in test-results/assistant/ (or $E2E_ARTIFACTS/assistant/).
import { test, expect, type Page } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { joinMeeting } from './helpers';

const LIVEKIT_API = process.env.E2E_LIVEKIT_API ?? 'http://localhost:7880';
const LIVEKIT_KEY = process.env.E2E_LIVEKIT_KEY ?? 'devkey';
const LIVEKIT_SECRET = process.env.E2E_LIVEKIT_SECRET ?? 'secret';
const ROOM = process.env.E2E_ASSISTANT_ROOM_SLUG ?? 'assistant-e2e';
const SHOTS = `${process.env.E2E_ARTIFACTS ?? 'test-results'}/assistant`;

type Grant = { roomId: string; accessToken: string; convexUrl: string };

/** What the dispatch handed the worker: the room, its grant and where Convex is. */
const workerGrant = async (): Promise<Grant> => {
  const rooms = new RoomServiceClient(LIVEKIT_API, LIVEKIT_KEY, LIVEKIT_SECRET);
  const dispatch = new AgentDispatchClient(LIVEKIT_API, LIVEKIT_KEY, LIVEKIT_SECRET);
  for (const room of await rooms.listRooms()) {
    if (room.name !== ROOM && !room.name.startsWith(`${ROOM}__session__`)) continue;
    for (const d of await dispatch.listDispatch(room.name)) {
      if (d.metadata) return JSON.parse(d.metadata);
    }
  }
  throw new Error('No assistant dispatch found');
};

const asWorker = async (grant: Grant, name: string, args: Record<string, unknown>) => {
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL ?? grant.convexUrl);
  return client.mutation(name as any, { roomId: grant.roomId, accessToken: grant.accessToken, ...args });
};

const openMore = async (page: Page) => {
  await page.getByTestId('meeting-control-bar').getByRole('button', { name: 'More', exact: true }).click();
};

const openPanel = async (page: Page, name: 'Whiteboard' | 'Notes') => {
  await page.getByTestId('meeting-control-bar').getByRole('button', { name, exact: true }).click();
};

// The board is a canvas. At 100 % and unpanned, a board point is the same canvas pixel.
const STICKY_YELLOW = [251, 231, 176];
const STICKY_GREEN = [212, 237, 217];
/** Inside the first and second note the assistant places on an empty board, below their text. */
const FIRST_NOTE = { x: 180, y: 260 };
const SECOND_NOTE = { x: 404, y: 260 };
/** Lena's rectangle, to the right of the notes. */
const LENA_BOX = { x: 640, y: 200, w: 160, h: 120 };

const colourAt = (page: Page, { x, y }: { x: number; y: number }) =>
  page.locator('canvas[aria-label="Whiteboard"]').evaluate((canvas: HTMLCanvasElement, [x, y]) =>
    Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3)), [x, y]);

/** Whether a dark line crosses the row at y between x and x + width (a stroke is a few pixels wide). Empty canvas is transparent black. */
const hasInkAcross = (page: Page, x: number, y: number, width: number) =>
  page.locator('canvas[aria-label="Whiteboard"]').evaluate((canvas: HTMLCanvasElement, [x, y, width]) => {
    const data = canvas.getContext('2d')!.getImageData(x, y, width, 1).data;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] < 200) return true;
    return false;
  }, [x, y, width]);

const near = (actual: number[], expected: number[]) => actual.every((c, i) => Math.abs(c - expected[i]) <= 6);

test('the assistant joins, writes on the board and into the notes, keeps what people add, and is sent away', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
  await joinMeeting(page, { name: 'Lena', slug: ROOM });
  const tiles = page.locator('.lk-grid-layout .lk-participant-tile');
  await expect(tiles).toHaveCount(1, { timeout: 15_000 });

  await openMore(page);
  await page.getByRole('menuitem', { name: 'Bring in the assistant' }).click();

  // Everyone sees that it listens; it gets no tile.
  await expect(page.getByText('Assistant is listening', { exact: true })).toBeVisible({ timeout: 45_000 });
  const hint = page.getByRole('dialog', { name: /Say “Vivo”/ });
  await expect(hint).toBeVisible();
  await expect(tiles).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/1-listening.png` });
  await hint.getByRole('button', { name: 'Got it' }).click();

  const grant = await workerGrant();

  // A clean board, so the assistant places its notes at the top left.
  await openPanel(page, 'Whiteboard');
  await page.getByRole('button', { name: /^Board/ }).click();
  const newBoard = page.getByRole('menuitem', { name: 'New board' });
  if (await newBoard.isEnabled()) await newBoard.click();
  else await page.keyboard.press('Escape');
  await expect(page.getByText('Empty whiteboard')).toBeVisible();

  // Something unwanted, undone from the toast.
  await asWorker(grant, 'assistant:addToBoard', { heard: 'Vivo, write draft on the board', items: [{ kind: 'sticky', text: 'Draft' }] });
  const draftToast = page.getByRole('status').filter({ hasText: 'Vivo, write draft' });
  await expect(draftToast).toContainText('Put 1 note on the board');
  await expect.poll(async () => near(await colourAt(page, FIRST_NOTE), STICKY_YELLOW)).toBe(true);
  await draftToast.getByRole('button', { name: 'Undo' }).click();
  await expect(draftToast).toContainText('Undone');
  await expect.poll(async () => near(await colourAt(page, FIRST_NOTE), STICKY_YELLOW)).toBe(false);
  await page.screenshot({ path: `${SHOTS}/2-board-undone.png` });

  const placed = await asWorker(grant, 'assistant:addToBoard', {
    heard: 'Vivo, put on the board: release on December 3, Lena tests the recording',
    items: [{ kind: 'sticky', text: 'Release on December 3' }, { kind: 'sticky', text: 'Lena tests the recording', color: 'green' }],
  });
  await expect(page.getByRole('status').filter({ hasText: 'Vivo, put on the board' })).toContainText('Put 2 notes on the board');
  await expect.poll(async () => near(await colourAt(page, SECOND_NOTE), STICKY_GREEN)).toBe(true);

  // Lena draws next to them; her save carries the board as she sees it.
  await page.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name: 'Rectangle' }).click();
  const box = (await page.locator('canvas[aria-label="Whiteboard"]').boundingBox())!;
  await page.mouse.move(box.x + LENA_BOX.x, box.y + LENA_BOX.y);
  await page.mouse.down();
  await page.mouse.move(box.x + LENA_BOX.x + LENA_BOX.w, box.y + LENA_BOX.y + LENA_BOX.h, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: `${SHOTS}/3-board.png` });


  // More below its notes than the screen holds: Lena's board moves so she sees it all.
  const zoom = page.getByRole('button', { name: 'Zoom to fit' });
  await expect(zoom).toHaveText('100%');
  const commandId = `steps-${Date.now()}`;
  await asWorker(grant, 'assistant:addToBoard', {
    heard: 'Vivo, list the steps below the release', commandId,
    items: ['Plan', 'Build', 'Test', 'Ship', 'Review'].map(text => ({ kind: 'sticky', text })),
    layout: 'column', near: (placed as { ids: Record<string, string> }).ids['0'], side: 'below',
  });
  await expect(zoom).not.toHaveText('100%');
  await page.screenshot({ path: `${SHOTS}/3b-revealed.png` });

  // Asked to show the board, it opens it for her. Part of the same command, it shows as one line.
  await openPanel(page, 'Whiteboard');
  await expect(page.locator('canvas[aria-label="Whiteboard"]')).toHaveCount(0);
  await asWorker(grant, 'assistant:showOnBoard', { heard: 'Vivo, list the steps below the release', commandId, mode: 'fit' });
  await expect(page.locator('canvas[aria-label="Whiteboard"]')).toBeVisible();
  await expect(zoom).not.toHaveText('100%');
  const stepsToast = page.getByRole('status').filter({ hasText: 'Vivo, list the steps' });
  await expect(stepsToast).toContainText('Put 5 notes on the board');
  await expect(stepsToast).not.toContainText('Moved the view');
  await page.screenshot({ path: `${SHOTS}/3c-shown.png` });

  // An overview built from the board's own parts: drawn as a page, readable like one.
  await asWorker(grant, 'assistant:addViewToBoard', {
    heard: 'Vivo, give us an overview of the teams',
    title: 'Team status',
    spec: {
      root: 'page',
      elements: {
        page: { type: 'Stack', props: {}, children: ['title', 'figures', 'teams'] },
        title: { type: 'Heading', props: { text: 'Team status', level: 1 }, children: [] },
        figures: { type: 'Grid', props: { columns: 2 }, children: ['open', 'done'] },
        open: { type: 'Stat', props: { label: 'Open', value: '4' }, children: [] },
        done: { type: 'Progress', props: { label: 'Done', value: 60 }, children: [] },
        teams: { type: 'Table', props: { columns: ['Team', 'Status'], rows: [['Web', 'ready'], ['App', 'testing']] }, children: [] },
      },
    },
  });
  const overview = page.getByRole('document', { name: 'Team status' });
  await expect(overview.getByRole('heading', { name: 'Team status' })).toBeVisible({ timeout: 10_000 });
  await expect(overview.getByRole('cell', { name: 'testing' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'give us an overview' })).toContainText('Put an overview on the board');
  await page.screenshot({ path: `${SHOTS}/3d-overview.png` });

  // Ideas someone said become a mind map; Vivo's cursor points at them for a moment.
  await asWorker(grant, 'assistant:addBranchesToBoard', { heard: 'Vivo, mind map launch: press, customers, blog', topic: 'Launch', branches: ['Press', 'Customers', 'Blog'] });
  await expect(page.getByRole('status').filter({ hasText: 'mind map launch' })).toContainText('Put 4 ideas on the mind map');
  await expect(page.locator('.wb__cursor').filter({ hasText: 'Vivo' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3e-mindmap.png` });

  // The notes: the assistant adds a task while Lena has them open, then she writes below it.
  await openPanel(page, 'Notes');
  const editor = page.locator('.mdoc .doc');
  await expect(editor).toBeVisible();
  // The room's notes outlive a run; this run's lines are the ones with its own mark.
  const mark = Date.now().toString(36);
  const task = `Jonas sends the numbers ${mark}`;
  const lenasLine = `Lena checks the slides ${mark}`;
  await asWorker(grant, 'assistant:appendToNotes', {
    heard: 'Vivo, add a task: Jonas sends the numbers',
    heading: 'Tasks',
    bullets: [`${task} (by Friday)`],
  });
  await expect(editor.locator('[data-assistant]').filter({ hasText: task })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Written into the notes' })).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(lenasLine);
  await page.screenshot({ path: `${SHOTS}/4-notes.png` });

  // Jonas joins later and gets what was saved: the assistant's notes and Lena's rectangle on the board,
  // the task and Lena's line in the notes.
  const jonasContext = await browser.newContext({ baseURL });
  try {
    const jonas = await jonasContext.newPage();
    await jonas.addInitScript(() => localStorage.setItem('tavio:locale', 'en'));
    await joinMeeting(jonas, { name: 'Jonas', slug: ROOM });
    await jonas.getByRole('dialog', { name: /Say “Vivo”/ }).getByRole('button', { name: 'Got it' }).click();
    await openPanel(jonas, 'Whiteboard');
    await expect.poll(async () => near(await colourAt(jonas, FIRST_NOTE), STICKY_YELLOW), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => near(await colourAt(jonas, SECOND_NOTE), STICKY_GREEN)).toBe(true);
    await expect.poll(() => hasInkAcross(jonas, LENA_BOX.x - 6, LENA_BOX.y + LENA_BOX.h / 2, 12)).toBe(true);
    await jonas.screenshot({ path: `${SHOTS}/5-jonas-board.png` });

    await openPanel(jonas, 'Notes');
    const jonasNotes = jonas.locator('.mdoc .doc');
    await expect(jonasNotes.locator('[data-assistant]').filter({ hasText: task })).toBeVisible({ timeout: 15_000 });
    await expect(jonasNotes).toContainText(lenasLine);
    await jonas.screenshot({ path: `${SHOTS}/6-jonas-notes.png` });
  } finally {
    await jonasContext.close();
  }

  await openMore(page);
  await page.getByRole('menuitem', { name: 'Send the assistant away' }).click();
  await expect(page.getByText('Assistant is listening', { exact: true })).toHaveCount(0, { timeout: 30_000 });
  // Its grant is gone with it.
  await expect(asWorker(grant, 'assistant:reply', { heard: 'x', text: 'y' })).rejects.toThrow();
  await page.screenshot({ path: `${SHOTS}/7-sent-away.png` });
});

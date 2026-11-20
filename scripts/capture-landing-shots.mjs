// Takes the landing page's product shots from the running app: one real call on the local stack with seven people.
// Needs an empty stack (`npm run e2e:local:up`) and ImageMagick. Run: npm run shots:landing
// See docs/E2E.md. E2E_ENV_FILE selects another stack.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '..');
const ENV_FILE = process.env.E2E_ENV_FILE ?? path.join(ROOT, '.env.e2e-local');
const PORT = process.env.E2E_PORT ?? '3334';
const BASE = `http://localhost:${PORT}`;
const RAW_DIR = path.join(ROOT, 'test-results/landing-shots');
const LOCALES = ['en', 'de'];
const ROOM = 'design-sync';
const DURATION = '18:42';
// The hero shows tavio.app as the room's address, whatever host the shot is taken on.
const SHOWN_HOST = 'tavio.app';

const convexUrl = readFileSync(ENV_FILE, 'utf8').match(/^CONVEX_SELF_HOSTED_URL=(.+)$/m)?.[1];
if (!convexUrl || !['localhost', '127.0.0.1'].includes(new URL(convexUrl).hostname)) {
  throw new Error(`Shots seed and write data, so they only run against a local stack. Got: ${convexUrl}`);
}
const convexRun = (fn) => execFileSync('npx', ['convex', 'run', fn, '{}', '--env-file', ENV_FILE], { cwd: ROOT, stdio: 'pipe' });
const siteUrl = convexUrl.replace(/\d+$/, (port) => String(Number(port) + 1));

// Each person's cell in public/participant-portraits.webp (3 x 2). Lena has no portrait and keeps the camera off.
const PEOPLE = [
  { name: 'Lena R.', cell: null },
  { name: 'James M.', cell: [0, 0] },
  { name: 'Ava K.', cell: [1, 0] },
  { name: 'Tom C.', cell: [2, 0] },
  { name: 'Sara L.', cell: [0, 1] },
  { name: 'Morgan O.', cell: [1, 1] },
];
const PRIYA = { name: 'Priya N.', cell: [2, 1], speaking: true };

const DEVICE_LABELS = {
  en: { audioinput: 'Built-in microphone', videoinput: 'FaceTime HD camera', audiooutput: 'Built-in speakers' },
  de: { audioinput: 'Integriertes Mikrofon', videoinput: 'FaceTime-HD-Kamera', audiooutput: 'Integrierte Lautsprecher' },
};

const NOTES = {
  en: { agenda: 'Review the current flow and record decisions in the room.', decided: 'Decided', guests: 'Guests join from the room link', stay: 'Notes stay with the room', next: 'Next', step: 'Share the prototype before Friday.' },
  de: { agenda: 'Den aktuellen Ablauf prüfen und Entscheidungen im Raum festhalten.', decided: 'Entschieden', guests: 'Gäste treten über den Raumlink bei', stay: 'Notizen bleiben beim Raum', next: 'Als Nächstes', step: 'Prototyp bis Freitag teilen.' },
};
const notesHtml = (n) => `<h1>Design sync</h1><h2>Agenda</h2><p>${n.agenda}</p><h2>${n.decided}</h2><ul><li>${n.guests}</li><li>${n.stay}</li></ul><h2>${n.next}</h2><p>${n.step}</p>`;

const CHAT = [
  'Morning, everyone.', 'Agenda is in the notes.', 'Can you see my screen?', 'Yes, all good.', 'The lobby flow looks right to me.', 'Guests got in without an account.',
  'Let us keep the room link as it is.', 'Agreed.', 'I will write that down.', 'Who shares the prototype?', 'I can, before Friday.', 'Thanks, all.',
];

// One camera per person: a portrait on a canvas, because Chrome's fake camera can only show one file per browser.
const LEAVE = { en: 'Leave', de: 'Verlassen' };
const CALL_OVER = { en: 'The call is over.', de: 'Der Anruf ist vorbei.' };

const stageCamera = ({ cell, speaking, labels, locale }) => {
  localStorage.setItem('tavio:locale', locale);
  const media = navigator.mediaDevices;
  const original = media.getUserMedia.bind(media);
  const enumerate = media.enumerateDevices.bind(media);
  media.enumerateDevices = async () => (await enumerate()).map((device) => ({
    deviceId: device.deviceId, groupId: device.groupId, kind: device.kind, label: labels[device.kind], toJSON() { return this; },
  }));
  media.getUserMedia = async (constraints) => {
    const stream = new MediaStream();
    if (constraints?.audio) {
      // Only the person speaking makes a sound, so one tile carries the speaker's mark.
      const audio = speaking
        ? await original({ audio: constraints.audio, video: false })
        : new AudioContext().createMediaStreamDestination().stream;
      stream.addTrack(audio.getAudioTracks()[0]);
    }
    if (constraints?.video) {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 720;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      const portrait = new Image();
      portrait.src = '/participant-portraits.webp';
      await portrait.decode();
      const size = portrait.naturalWidth / 3;
      const draw = () => {
        if (cell) context.drawImage(portrait, cell[0] * size, cell[1] * size + size * 0.06, size, size * 0.75, 0, 0, 960, 720);
      };
      draw();
      setInterval(draw, 100);
      stream.addTrack(canvas.captureStream(10).getVideoTracks()[0]);
    }
    return stream;
  };
};

const browser = await (async () => {
  execFileSync('node', ['scripts/fetch-fonts.mjs'], { cwd: ROOT, stdio: 'inherit' });
  return chromium.launch({ channel: 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
})();

const vite = spawn('npx', ['vite', '--port', PORT, '--strictPort'], {
  cwd: ROOT,
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, VITE_CONVEX_URL: convexUrl, VITE_CONVEX_SITE_URL: siteUrl },
});

const report = [];
const output = (name, locale) => (locale === 'de' ? `public/landing/de/${name}.webp` : `public/landing/${name}.webp`);

/** Saves a screenshot under every given path as webp, scaled to the width the landing page ships. */
const save = (png, name, width, targets) => {
  mkdirSync(RAW_DIR, { recursive: true });
  const raw = path.join(RAW_DIR, `${name}.png`);
  writeFileSync(raw, png);
  for (const target of targets) {
    execFileSync('magick', [raw, '-resize', `${width}x`, '-quality', '84', path.join(ROOT, target)]);
    const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', path.join(ROOT, target)]).toString().split(' ').map(Number);
    report.push({ file: target, width: w, height: h, sha256: createHash('sha256').update(readFileSync(path.join(ROOT, target))).digest('hex') });
  }
};

/** Viewport-relative box of an element, widened by a margin and kept on the page. */
const boxOf = async (page, locator, margin = 0) => {
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  return { x, y, width: Math.min(size.width - x, box.width + margin * 2), height: Math.min(size.height - y, box.height + margin * 2) };
};

const openPerson = async (person, locale, viewport) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale, permissions: ['camera', 'microphone'] });
  await context.addInitScript(stageCamera, { cell: person.cell, speaking: Boolean(person.speaking), labels: DEVICE_LABELS[locale], locale });
  const page = await context.newPage();
  await page.goto(`${BASE}/room/${ROOM}`);
  return page;
};

const join = async (page, person) => {
  await page.getByPlaceholder('Enter your name').fill(person.name);
  if (!person.cell) await page.getByRole('button', { name: 'Turn camera off' }).click();
  const button = page.getByRole('button', { name: 'Join Meeting' });
  await button.waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /join meeting/i.test(b.textContent) && !b.disabled));
  await button.click();
  await page.waitForURL(`**/meeting/${ROOM}`, { timeout: 30_000 });
};

const setLocale = async (page, locale, label) => {
  await page.evaluate(async (next) => {
    localStorage.setItem('tavio:locale', next);
    const { loadCatalog } = await import('/src/lib/i18n.ts');
    await loadCatalog(next);
  }, locale);
  // The tree re-renders in parts, so a picture taken at once can mix both languages.
  if (label) await page.getByText(label[locale]).first().waitFor();
  await page.waitForTimeout(1500);
};

const holdTimer = (page) => page.evaluate((duration) => {
  const timer = document.querySelector('.mtop__time');
  const hold = () => { if (timer.textContent !== duration) timer.textContent = duration; };
  hold();
  new MutationObserver(hold).observe(timer, { childList: true, characterData: true, subtree: true });
}, DURATION);

const shootLobby = async () => {
  for (const locale of LOCALES) {
    const page = await openPerson(PRIYA, locale, { width: 1280, height: 720 });
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.getByRole('textbox').first().fill(PRIYA.name);
    await page.waitForFunction(() => document.querySelector('.prev__view video')?.videoWidth > 0);
    await page.locator('.linktag__url').evaluate((node, host) => { node.textContent = `${host}/room/design-sync`; }, SHOWN_HOST);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(2500);
    // From the room-link slip down to the sheets: the top bar is not part of the picture.
    const [tag, preview, sheet] = await Promise.all(['.linktag', '.prev', '.joinsheet'].map((selector) => page.locator(selector).boundingBox()));
    const top = tag.y - 16;
    const bottom = Math.max(preview.y + preview.height, sheet.y + sheet.height) + 24;
    const left = preview.x - 24;
    const right = sheet.x + sheet.width + 24;
    await save(await page.screenshot({ clip: { x: left, y: top, width: right - left, height: bottom - top } }), `${locale}-lobby`, 1800, [output('lobby', locale)]);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(800);
    // One height for both languages, because the landing page reserves one box for this picture.
    await save(await page.screenshot({ clip: { x: 0, y: 0, width: 390, height: 870 } }), `${locale}-phone-lobby`, 780, [output('phone-lobby', locale)]);
    await page.context().close();
  }
};

const drawBoard = async (page) => {
  const canvas = page.getByRole('img', { name: 'Whiteboard' }).or(page.locator('.wb canvas')).first();
  const box = await canvas.boundingBox();
  // The sketch is laid out on the shipped 1400 x 706 picture.
  const scale = box.width / 1400;
  const at = (x, y) => [box.x + x * scale, box.y + y * scale];
  const tool = (name) => page.getByRole('toolbar', { name: 'Whiteboard' }).getByRole('button', { name, exact: true }).click();
  // The style card sits on the left; on a narrow sheet it opens from the toolbar and is closed again before drawing.
  const panel = page.getByRole('region', { name: 'Style' });
  const withPanel = async (act) => {
    const opened = !(await panel.isVisible());
    if (opened) await tool('Style');
    await act();
    if (opened) await tool('Style');
  };
  const color = (hex) => withPanel(() => panel.getByRole('button', { name: `Stroke ${hex}` }).click());
  const drag = async (from, to) => {
    await page.mouse.move(...at(...from));
    await page.mouse.down();
    await page.mouse.move(...at(...to), { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  const stroke = async (points) => {
    await page.mouse.move(...at(...points[0]));
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(...at(...point), { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  await tool('Pen');
  await withPanel(() => panel.getByRole('group', { name: 'Stroke width' }).getByRole('button', { name: 'Bold' }).click());
  await color('#18181b');

  // After a shape the board goes back to selecting, so each one starts with its tool.
  for (const [from, to] of [
    [[130, 190], [430, 470]], [[156, 216], [404, 360]],
    [[548, 190], [848, 470]], [[574, 216], [692, 324]], [[706, 216], [824, 324]], [[574, 338], [692, 446]], [[706, 338], [824, 446]],
    [[966, 190], [1266, 470]],
  ]) { await tool('Rectangle'); await drag(from, to); }

  await tool('Pen');
  for (const line of [
    [[156, 394], [240, 390], [324, 394]], [[156, 430], [220, 426], [284, 430]],
    [[992, 226], [1120, 230], [1242, 226]], [[992, 264], [1090, 268], [1190, 264]], [[992, 302], [1100, 306], [1220, 302]], [[992, 340], [1064, 344], [1140, 340]],
    [[442, 330], [490, 334], [538, 330]], [[520, 312], [540, 330], [520, 348]],
    [[860, 330], [908, 334], [956, 330]], [[938, 312], [958, 330], [938, 348]],
  ]) await stroke(line);

  await tool('Circle');
  await color('#dc2626');
  await drag([978, 374], [1168, 450]);

  await tool('Pen');
  await color('#2563eb');
  const arc = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return [(1 - t) ** 2 * 1118 + 2 * t * (1 - t) * 908 + t ** 2 * 698, (1 - t) ** 2 * 484 + 2 * t * (1 - t) * 724 + t ** 2 * 486];
  });
  await stroke(arc);
  await stroke([[724, 474], [698, 486], [722, 508]]);

  await color('#18181b');
  await page.waitForTimeout(1500);
};

try {
  for (let attempt = 0; ; attempt += 1) {
    try { await fetch(BASE); break; } catch { if (attempt > 60) throw new Error('Vite did not start'); await new Promise((r) => setTimeout(r, 1000)); }
  }
  convexRun('e2e:seedShotRoom');

  // Everyone is in the room when Priya reaches the lobby, so it reads "6 participants already in the room".
  const pages = [];
  for (const person of PEOPLE) {
    const lena = person.name === 'Lena R.';
    const page = await openPerson(person, 'en', lena ? { width: 1000, height: 538 } : { width: 800, height: 450 });
    if (lena) {
      const host = { name: person.name, email: 'landing-shots@example.test', password: crypto.randomUUID() };
      const signup = await fetch(`${siteUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE },
        body: JSON.stringify(host),
      });
      if (!signup.ok) throw new Error(`Could not create the local screenshot host (${signup.status})`);
      await page.goto(`${BASE}/auth/login`);
      await page.getByPlaceholder('name@company.com').fill(host.email);
      await page.getByPlaceholder('••••••••').fill(host.password);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      await page.waitForURL('**/admin');
      await page.goto(`${BASE}/room/${ROOM}`);
    } else {
      await page.getByText(/participants? already in the room/).waitFor();
    }
    await join(page, person);
    pages.push(page);
  }
  const lena = pages[0];
  await lena.waitForTimeout(3000);
  await shootLobby();

  const priya = await openPerson(PRIYA, 'en', { width: 800, height: 450 });
  await join(priya, PRIYA);
  await lena.locator('.lk-grid-layout .lk-participant-tile').nth(6).waitFor({ timeout: 30_000 });
  await lena.waitForFunction(() => {
    const videos = [...document.querySelectorAll('.mtile video[data-lk-source="camera"]')];
    return videos.length === 6 && videos.every((video) => video.videoHeight > 0);
  }, null, { timeout: 45_000 });

  // The whiteboard carries no words, so one picture serves both languages and the login screen.
  await lena.setViewportSize({ width: 1440, height: 810 });
  await lena.getByRole('button', { name: 'Whiteboard', exact: true }).click();
  await lena.locator('.wb').waitFor();
  await lena.waitForTimeout(800);
  await drawBoard(lena);
  await lena.mouse.move(0, 0);
  const wb = await lena.locator('.wb').boundingBox();
  // Inset past the rounded corners, in the shipped shape.
  const wbWidth = wb.width - 16;
  await save(
    await lena.screenshot({ clip: { x: wb.x + 8, y: wb.y + 8, width: wbWidth, height: Math.round((wbWidth * 706) / 1400) } }),
    'board-canvas', 1400, ['public/landing/board-canvas.webp', 'public/landing/de/board-canvas.webp', 'public/threshold/board-canvas.webp'],
  );
  await lena.getByRole('button', { name: 'Whiteboard', exact: true }).click();

  await lena.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = lena.getByPlaceholder('Type a message...');
  for (const line of CHAT) {
    await input.fill(line);
    await input.press('Enter');
    await lena.waitForFunction(() => document.querySelector('input[placeholder="Type a message..."]')?.value === '');
    await lena.waitForTimeout(250);
  }
  await lena.getByRole('button', { name: 'Chat', exact: true }).click();

  await holdTimer(lena);
  await lena.setViewportSize({ width: 1000, height: 538 });
  // Video layers follow the tile size, so give them a moment to arrive before each picture.
  await lena.waitForTimeout(10_000);
  for (const locale of LOCALES) {
    await setLocale(lena, locale, LEAVE);
    await lena.mouse.move(0, 0);
    await save(await lena.screenshot(), `${locale}-hero-grid`, 2000, [output('hero-grid', locale)]);
  }

  await setLocale(lena, 'en', LEAVE);
  await lena.setViewportSize({ width: 1200, height: 675 });
  // With a panel open one tile goes large. By default that is Lena's, whose camera is off.
  await lena.getByRole('button', { name: 'Show Priya N. large' }).click();
  await lena.getByRole('button', { name: 'Notes', exact: true }).click();
  await lena.locator('.ProseMirror').waitFor();
  await lena.waitForTimeout(8000);
  for (const locale of LOCALES) {
    await lena.setViewportSize({ width: 1200, height: 675 });
    await setLocale(lena, locale, LEAVE);
    await lena.locator('.ProseMirror').click();
    await lena.keyboard.press('Control+A');
    await lena.locator('.ProseMirror').evaluate((editor, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, notesHtml(NOTES[locale]));
    await lena.evaluate(() => document.activeElement?.blur());
    await lena.mouse.move(0, 0);
    await lena.waitForTimeout(2500);
    await save(await lena.screenshot(), `${locale}-room-notes`, 2000, [output('room-notes', locale)]);

    await lena.setViewportSize({ width: 390, height: 760 });
    await lena.waitForTimeout(1200);
    await save(await lena.screenshot(), `${locale}-phone-notes`, 780, [output('phone-notes', locale)]);
  }

  // The summary reads the room's state at the moment of leaving.
  await setLocale(lena, 'en', LEAVE);
  await lena.setViewportSize({ width: 1280, height: 800 });
  convexRun('e2e:seedShotRecording');
  await lena.waitForTimeout(2000);
  await lena.getByRole('button', { name: 'Leave', exact: true }).click();
  await lena.waitForTimeout(600);
  if (!lena.url().includes('/goodbye')) await lena.getByRole('button', { name: /^leave/i }).last().click();
  await lena.waitForURL('**/goodbye', { timeout: 15_000 });
  await lena.setViewportSize({ width: 1100, height: 900 });
  await lena.locator('.record').waitFor();
  for (const locale of LOCALES) {
    await setLocale(lena, locale, CALL_OVER);
    await lena.locator('.record__row .fig').first().evaluate((node, duration) => { node.textContent = duration; }, DURATION);
    await lena.mouse.move(0, 0);
    await lena.waitForTimeout(300);
    // Desk below the record: the landing page lays its "next step" slip there.
    const record = await boxOf(lena, lena.locator('.record'), 28);
    await save(await lena.screenshot({ clip: { ...record, height: record.height + 96 } }), `${locale}-summary`, 1200, [output('summary', locale)]);
  }

  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim();
  writeFileSync(path.join(RAW_DIR, 'report.json'), `${JSON.stringify({ revision, files: report }, null, 2)}\n`);
  for (const { file, width, height } of report) console.log(`${file}  ${width}x${height}`);
} finally {
  await browser.close();
  try { process.kill(-vite.pid); } catch { /* already gone */ }
}

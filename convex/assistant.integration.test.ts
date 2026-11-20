import { describe, expect, it, vi } from 'vitest';

vi.mock('./lib/rateLimit', () => ({
  checkWhiteboardRateLimit: vi.fn(async () => {}),
  checkMeetingDocRateLimit: vi.fn(async () => {}),
  checkAssistantRateLimit: vi.fn(async () => {}),
}));

import { createFakeCtx } from '../tests/fakeConvexDb';
import {
  addBranchesToBoard, addTasksToBoard, addToBoard, addViewToBoard, appendToNotes, arrangeOnBoard, changeOnBoard, connectOnBoard, context, deleteFromBoard,
  recent, removeFromNotes, reply, showOnBoard, undo, undoLast,
} from './assistant';
import { removeBlock } from './lib/assistantEdits';
import { hashRoomAccessToken } from './lib/roomAccess';
import { get as getWall, html as getHtml, save as saveWall } from './whiteboard';
import { get as getNotes, save as saveNotes } from './meetingDoc';
import { restore, startNew } from './boards';

const ROOM = 'room-1';
const HOUR = 60 * 60 * 1000;

const call = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);

/** An open room without a workspace. The assistant and a guest each hold a join grant. */
const makeCtx = async (seed: Record<string, any[]> = {}) =>
  createFakeCtx(
    {
      rooms: [{ _id: ROOM, access: 'OPEN', name: 'Weekly', slug: 'weekly' }],
      roomAccessGrants: [
        { roomId: ROOM, identity: 'assistant:a1', tokenHash: await hashRoomAccessToken('bot-token'), expiresAt: Date.now() + HOUR },
        { roomId: ROOM, identity: 'guest-1', tokenHash: await hashRoomAccessToken('guest-token'), expiresAt: Date.now() + HOUR },
      ],
      ...seed,
    },
    null,
  );

const bot = { roomId: ROOM, accessToken: 'bot-token' };
const guest = { roomId: ROOM, accessToken: 'guest-token' };

const stroke = (id: string) => ({ id, type: 'stroke', tool: 'pen', color: '#18181b', size: 2, points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] });

const rect = (id: string, x: number, y: number) => ({ id, type: 'shape', shapeType: 'rectangle', x, y, width: 200, height: 100, strokeColor: '#18181b', fillColor: 'transparent', strokeWidth: 2 });
const overlaps = (a: any, b: any) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const wallIds = async (ctx: any) => (await call(getWall, ctx, guest)).elements.map((el: any) => el.id);

describe('assistant on the whiteboard', () => {
  it('lays notes with their text on the board and records what it did', async () => {
    const ctx = await makeCtx();
    const result = await call(addToBoard, ctx, {
      ...bot,
      heard: 'Tavio, schreib aufs Whiteboard: Release am 3. Dezember',
      items: [{ kind: 'sticky', text: 'Release am 3. Dezember', color: 'yellow' }, { kind: 'sticky', text: 'Lena testet' }],
    });

    const wall = await call(getWall, ctx, guest);
    expect(wall.elements).toHaveLength(2);
    expect(wall.elements[0]).toMatchObject({ type: 'shape', shapeType: 'note', width: 200, height: 200, text: 'Release am 3. Dezember', by: 'Vivo', author: 'assistant' });
    // Two notes sit side by side, not on top of each other.
    expect(wall.elements[1].x).toBeGreaterThan(wall.elements[0].x + wall.elements[0].width - 1);

    const edits = await call(recent, ctx, guest);
    expect(edits[0]).toMatchObject({ id: result.editId, kind: 'board', count: 2, heard: expect.stringContaining('Release') });
  });

  it('adds nothing to a board that would then hold more than 10,000 elements', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: Array.from({ length: 9_999 }, (_, i) => rect(`r${i}`, (i % 100) * 220, Math.floor(i / 100) * 120)) });

    await expect(call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'A' }, { kind: 'sticky', text: 'B' }] }))
      .rejects.toThrow('The board is full');
    expect(await wallIds(ctx)).toHaveLength(9_999);
  });

  it('does not undo a deletion onto a board people have filled up since', async () => {
    const ctx = await makeCtx();
    const board = Array.from({ length: 10_000 }, (_, i) => rect(`r${i}`, (i % 100) * 220, Math.floor(i / 100) * 120));
    await call(saveWall, ctx, { ...guest, elements: board });
    const { editId } = await call(deleteFromBoard, ctx, { ...bot, heard: 'x', ids: ['r0'] });
    await call(saveWall, ctx, { ...guest, elements: [...board.slice(1), rect('extra', 0, 0)] });

    await expect(call(undo, ctx, { ...guest, editId })).rejects.toThrow('The board is full');
  });

  it('lays notes onto a section people drew, not beside it, and draws arrows across it', async () => {
    const ctx = await makeCtx();
    const section = { id: 's', type: 'shape', shapeType: 'section', text: 'Ideen', x: 0, y: 0, width: 1200, height: 900, strokeColor: '#18181b', fillColor: '#f4f1ec', strokeWidth: 0 };
    await call(saveWall, ctx, { ...guest, elements: [section] });

    await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ key: 'a', kind: 'sticky', text: 'A' }, { key: 'b', kind: 'sticky', text: 'B' }], links: [{ from: 'a', to: 'b' }] });

    const [, a, b, arrow] = (await call(getWall, ctx, guest)).elements;
    expect(a.x + a.width <= 1200 && a.y + a.height <= 900 && a.x >= 0 && a.y >= 0).toBe(true);
    expect(arrow).toMatchObject({ start: { id: a.id, fx: 1, fy: 0.5 }, end: { id: b.id, fx: 0, fy: 0.5 } });
  });

  it('puts new notes into free space beside the drawing, never on it', async () => {
    const ctx = await makeCtx();
    const drawing = { ...stroke('s1'), points: [{ x: 0, y: 0 }, { x: 300, y: 400 }] };
    const box = { id: 'b1', type: 'shape', shapeType: 'rectangle', x: 600, y: 0, width: 200, height: 100, strokeColor: '#18181b', fillColor: 'transparent', strokeWidth: 2 };
    await call(saveWall, ctx, { ...guest, elements: [drawing, box], seenAssistantIds: [] });
    await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'A' }, { kind: 'sticky', text: 'B' }] });
    const [a, b] = (await call(getWall, ctx, guest)).elements.slice(2);
    for (const note of [a, b]) {
      expect(overlaps(note, { x: 0, y: 0, width: 300, height: 400 })).toBe(false);
      expect(overlaps(note, box)).toBe(false);
      // Within the area people already work in, not somewhere below it.
      expect(note.y).toBeLessThan(400);
    }
  });

  it('puts notes next to the element it was asked to, and returns handles for them', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 100, 100)], seenAssistantIds: [] });
    const result = await call(addToBoard, ctx, { ...bot, heard: 'x', near: 'r1', side: 'right', items: [{ key: 'n', kind: 'sticky', text: 'Daneben' }] });
    const note = (await call(getWall, ctx, guest)).elements.find((el: any) => el.id === result.ids.n);
    expect(note.x).toBeGreaterThanOrEqual(100 + 200);
    expect(note.x).toBeLessThan(100 + 200 + 100);
    expect(Math.abs(note.y - 100)).toBeLessThan(60);
  });

  it('builds a small diagram in one go: shapes in a row, joined by arrows that stay on them', async () => {
    const ctx = await makeCtx();
    const result = await call(addToBoard, ctx, {
      ...bot, heard: 'x', layout: 'row',
      items: [{ key: 'a', kind: 'rectangle', text: 'Idee' }, { key: 'b', kind: 'diamond', text: 'Entwurf?' }, { key: 'c', kind: 'text', text: 'Test' }],
      links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    });
    const wall = (await call(getWall, ctx, guest)).elements;
    const byId = new Map(wall.map((el: any) => [el.id, el]));
    const [a, b, c] = ['a', 'b', 'c'].map(k => byId.get(result.ids[k]) as any);
    expect(b).toMatchObject({ type: 'shape', shapeType: 'diamond', text: 'Entwurf?' });
    expect(c).toMatchObject({ type: 'text', text: 'Test' });
    expect(b.x).toBeGreaterThan(a.x + a.width - 1);
    const arrows = wall.filter((el: any) => el.type === 'line');
    expect(arrows).toHaveLength(2);
    expect(arrows[0]).toMatchObject({ endArrow: true, start: { id: a.id }, end: { id: b.id } });
    // The arrow leaves a's right edge and reaches b's left edge.
    expect(arrows[0].points[0].x).toBe(a.x + a.width);
    expect(arrows[0].points[1].x).toBe(b.x);
  });

  it('lays an overview built from the board\'s own parts beside what is there, and later sees only its title', async () => {
    const ctx = await makeCtx();
    await call(addToBoard, ctx, { ...bot, heard: 'Ziele', items: [{ kind: 'sticky', text: 'Ziele' }] });
    const spec = {
      root: 'page',
      elements: {
        page: { type: 'Stack', props: {}, children: ['title', 'teams'] },
        title: { type: 'Heading', props: { text: 'Stand der Teams', level: 1 }, children: [] },
        teams: { type: 'Table', props: { columns: ['Team', 'Stand'], rows: [['Web', 'fertig']] }, children: [] },
      },
    };

    const result = await call(addViewToBoard, ctx, { ...bot, heard: 'Vivo, mach eine Übersicht', title: 'Stand der Teams', spec });

    const wall = (await call(getWall, ctx, guest)).elements;
    const page = wall.find((el: any) => el.id === result.id);
    expect(page).toMatchObject({ type: 'html', title: 'Stand der Teams', width: 640, height: 480 });
    expect(overlaps(page, wall[0])).toBe(false);
    expect(JSON.parse((await call(getHtml, ctx, { ...guest, page: page.page })).spec)).toEqual(spec);
    const seen = await call(context, ctx, bot);
    expect(seen.board.find((el: any) => el.id === result.id)).toMatchObject({ type: 'html', title: 'Stand der Teams' });
    expect(JSON.stringify(seen)).not.toContain('fertig');
  });

  it.each([
    ['a part the board does not have', { root: 'a', elements: { a: { type: 'Script', props: { code: 'alert(1)' }, children: [] } } }],
    ['a part with the wrong kind of value', { root: 'a', elements: { a: { type: 'Heading', props: { text: 42 }, children: [] } } }],
    ['a child that is not there', { root: 'a', elements: { a: { type: 'Stack', props: {}, children: ['gone'] } } }],
  ])('refuses an overview with %s, and the board stays as it was', async (_name, spec) => {
    const ctx = await makeCtx();
    await expect(call(addViewToBoard, ctx, { ...bot, heard: 'x', title: 'Kaputt', spec })).rejects.toThrow(/overview/i);
    expect(await wallIds(ctx)).toEqual([]);
  });

  it('notes tasks as task cards with who and by when, in a column, written by itself', async () => {
    const ctx = await makeCtx();
    const result = await call(addTasksToBoard, ctx, {
      ...bot, heard: 'Vivo, notier: Jonas schickt die Zahlen bis 20. November, und wir testen die Aufnahme',
      tasks: [{ text: 'Zahlen schicken', owner: 'Jonas', due: '2026-11-20' }, { text: 'Aufnahme testen' }],
    });

    const wall = (await call(getWall, ctx, guest)).elements;
    expect(wall).toHaveLength(2);
    expect(wall[0]).toMatchObject({ type: 'shape', shapeType: 'task', text: 'Zahlen schicken', owner: 'Jonas', due: '2026-11-20', by: 'Vivo', author: 'assistant' });
    expect(wall[1]).toMatchObject({ shapeType: 'task', text: 'Aufnahme testen' });
    expect(wall[1].y).toBeGreaterThan(wall[0].y + wall[0].height - 1);
    expect((await call(recent, ctx, guest))[0]).toMatchObject({ id: result.editId, action: 'tasks', count: 2 });
    const seen = await call(context, ctx, bot);
    expect(seen.board[0]).toMatchObject({ shapeType: 'task', text: 'Zahlen schicken', owner: 'Jonas', due: '2026-11-20', done: false });
  });

  it('starts a mind map from spoken ideas, hangs more onto a branch, and reads maps and tables back', async () => {
    const ctx = await makeCtx();
    const first = await call(addBranchesToBoard, ctx, { ...bot, heard: 'Vivo, mach eine Mindmap Launch: Presse, Kunden', topic: 'Launch', branches: ['Presse', 'Kunden'] });
    let wall = (await call(getWall, ctx, guest)).elements;
    const [root, press, customers] = wall;
    expect(root).toMatchObject({ shapeType: 'mindmap', text: 'Launch', by: 'Vivo', author: 'assistant' });
    expect(root.parent).toBeUndefined();
    expect(press).toMatchObject({ shapeType: 'mindmap', text: 'Presse', parent: root.id });
    expect(customers).toMatchObject({ parent: root.id });
    // Branches off the root each get their own colour and stand in a column to its right.
    expect(press.strokeColor).not.toBe(customers.strokeColor);
    expect(press.x).toBeGreaterThan(root.x + root.width);
    expect(customers.y).toBeGreaterThan(press.y + press.height - 1);
    expect(first.ids).toEqual([root.id, press.id, customers.id]);

    await call(addBranchesToBoard, ctx, { ...bot, heard: 'häng an Presse noch Blog an', under: press.id, branches: ['Blog'] });
    wall = (await call(getWall, ctx, guest)).elements;
    const blog = wall.find((el: any) => el.text === 'Blog');
    // A deeper branch inherits its parent's colour.
    expect(blog).toMatchObject({ parent: press.id, strokeColor: press.strokeColor });
    expect(blog.x).toBeGreaterThan(press.x + press.width);

    await call(saveWall, ctx, { ...guest, elements: [...wall, { ...rect('t', 0, 900), cells: [['Wer', 'Was'], ['Jonas', 'Zahlen']], shapeType: 'table' }], seenAssistantIds: wall.map((el: any) => el.id) });
    const seen = (await call(context, ctx, bot)).board;
    expect(seen.find((el: any) => el.id === blog.id)).toMatchObject({ shapeType: 'mindmap', text: 'Blog', parent: press.id });
    expect(seen.find((el: any) => el.id === 't')).toMatchObject({ shapeType: 'table', cells: [['Wer', 'Was'], ['Jonas', 'Zahlen']] });

    await expect(call(addBranchesToBoard, ctx, { ...bot, heard: 'x', under: 't', branches: ['Nein'] })).rejects.toThrow(/mind map/i);
    await expect(call(addBranchesToBoard, ctx, { ...bot, heard: 'x', branches: ['Ohne Thema'] })).rejects.toThrow(/mind map/i);
  });

  it('joins elements that are already there', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), rect('r2', 0, 400)], seenAssistantIds: [] });
    await call(connectOnBoard, ctx, { ...bot, heard: 'x', links: [{ from: 'r1', to: 'r2' }] });
    const arrow = (await call(getWall, ctx, guest)).elements[2];
    // One above the other: from the bottom edge to the top edge.
    expect(arrow).toMatchObject({ type: 'line', start: { id: 'r1', fx: 0.5, fy: 1 }, end: { id: 'r2', fx: 0.5, fy: 0 } });
    await expect(call(connectOnBoard, ctx, { ...bot, heard: 'x', links: [{ from: 'r1', to: 'gone' }] })).rejects.toThrow(/gone/);
  });

  it('moves elements as a block next to another, and arrows go with them', async () => {
    const ctx = await makeCtx();
    const arrow = { id: 'l1', type: 'line', points: [{ x: 200, y: 50 }, { x: 400, y: 50 }], strokeColor: '#18181b', strokeWidth: 2, endArrow: true, start: { id: 'r1', fx: 1, fy: 0.5 }, end: { id: 'r2', fx: 0, fy: 0.5 } };
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), rect('r2', 400, 0), rect('r3', 0, 600), arrow], seenAssistantIds: [] });
    await call(arrangeOnBoard, ctx, { ...bot, heard: 'x', ids: ['r2'], near: 'r3', side: 'below' });
    const wall = new Map((await call(getWall, ctx, guest)).elements.map((el: any) => [el.id, el]));
    const r2 = wall.get('r2') as any;
    expect(r2.y).toBeGreaterThanOrEqual(600 + 100);
    const l1 = wall.get('l1') as any;
    expect(l1.end.id).toBe('r2');
    expect(l1.points[1]).toEqual({ x: r2.x + l1.end.fx * r2.width, y: r2.y + l1.end.fy * r2.height });
  });

  it('undoing a move takes an arrow along that someone attached after it', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), rect('r2', 400, 0), rect('r3', 0, 600)], seenAssistantIds: [] });
    const { editId } = await call(arrangeOnBoard, ctx, { ...bot, heard: 'x', ids: ['r2'], near: 'r3', side: 'below' });
    const moved = (await call(getWall, ctx, guest)).elements.find((el: any) => el.id === 'r2');
    const end = { x: moved.x, y: moved.y + 50 };
    const arrow = { id: 'l1', type: 'line', points: [{ x: 200, y: 50 }, end], strokeColor: '#18181b', strokeWidth: 2, endArrow: true, start: { id: 'r1', fx: 1, fy: 0.5 }, end: { id: 'r2', fx: 0, fy: 0.5 } };
    await call(saveWall, ctx, { ...guest, elements: [arrow], edit: { removedIds: [], addedIds: ['l1'] } });
    await call(undo, ctx, { ...guest, editId });
    const wall = new Map((await call(getWall, ctx, guest)).elements.map((el: any) => [el.id, el]));
    expect(wall.get('r2')).toMatchObject({ x: 400, y: 0 });
    expect((wall.get('l1') as any).points[1]).toEqual({ x: 400, y: 50 });
  });

  it('docks arrows anew on the edges that face each other once it has rearranged', async () => {
    const ctx = await makeCtx();
    const arrow = { id: 'l1', type: 'line', points: [{ x: 200, y: 50 }, { x: 400, y: 50 }], strokeColor: '#18181b', strokeWidth: 2, endArrow: true, start: { id: 'r1', fx: 1, fy: 0.5 }, end: { id: 'r2', fx: 0, fy: 0.5 } };
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), rect('r2', 400, 0), arrow], seenAssistantIds: [] });
    await call(arrangeOnBoard, ctx, { ...bot, heard: 'x', ids: ['r1', 'r2'], layout: 'column' });
    const wall = new Map((await call(getWall, ctx, guest)).elements.map((el: any) => [el.id, el]));
    const [r1, l1] = [wall.get('r1'), wall.get('l1')] as any[];
    expect(l1).toMatchObject({ start: { id: 'r1', fx: 0.5, fy: 1 }, end: { id: 'r2', fx: 0.5, fy: 0 } });
    expect(l1.points[0]).toEqual({ x: r1.x + 100, y: r1.y + 100 });
  });

  it('takes an arrow back along a row under the boxes in between, not through them', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('a', 0, 0), rect('b', 300, 0), rect('c', 600, 0)], seenAssistantIds: [] });
    await call(connectOnBoard, ctx, { ...bot, heard: 'x', links: [{ from: 'c', to: 'a' }, { from: 'a', to: 'b' }] });
    const [back, forward] = (await call(getWall, ctx, guest)).elements.slice(3);
    expect(back).toMatchObject({ start: { id: 'c', fx: 0.5, fy: 1 }, end: { id: 'a', fx: 0.5, fy: 1 } });
    // Nothing in the way: straight across.
    expect(forward).toMatchObject({ start: { id: 'a', fx: 1, fy: 0.5 }, end: { id: 'b', fx: 0, fy: 0.5 } });
  });

  it('lines elements up in a column where they were', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), rect('r2', 500, 300)], seenAssistantIds: [] });
    await call(arrangeOnBoard, ctx, { ...bot, heard: 'x', ids: ['r1', 'r2'], layout: 'column' });
    const [r1, r2] = (await call(getWall, ctx, guest)).elements;
    expect(r2.x).toBe(r1.x);
    expect(r2.y).toBeGreaterThan(r1.y + r1.height - 1);
  });

  it('moves the arrow on a text that grew with what the assistant wrote into it', async () => {
    const ctx = await makeCtx();
    const label = { id: 't1', type: 'text', x: 0, y: 0, text: 'Hi', color: '#18181b', fontSize: 20, width: 30, height: 24 };
    await call(saveWall, ctx, { ...guest, elements: [label, rect('r1', 600, 0)], seenAssistantIds: [] });
    await call(connectOnBoard, ctx, { ...bot, heard: 'x', links: [{ from: 'r1', to: 't1' }] });
    const before = (await call(getWall, ctx, guest)).elements.find((el: any) => el.type === 'line');
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: 't1', text: 'A much longer label that needs far more room' }] });
    const after = (await call(getWall, ctx, guest)).elements.find((el: any) => el.type === 'line');
    expect(after.points).not.toEqual(before.points);
  });

  it('measures text it rewrites at the size the text is drawn in', async () => {
    const ctx = await makeCtx();
    const big = { id: 't1', type: 'text', x: 0, y: 0, text: 'Hi', color: '#18181b', fontSize: 80, width: 100, height: 100 };
    await call(saveWall, ctx, { ...guest, elements: [big], seenAssistantIds: [] });
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: 't1', text: 'Erste Zeile\nZweite Zeile' }] });
    // Two lines of 80px text, 100px each, and as wide as the longer line at that size.
    expect((await call(getWall, ctx, guest)).elements[0]).toMatchObject({ fontSize: 80, height: 200, width: Math.ceil(12 * 80 * 0.55) });
  });

  it('gives a mind map node it rewrites room for the new words, and moves its neighbours aside', async () => {
    const ctx = await makeCtx();
    await call(addBranchesToBoard, ctx, { ...bot, heard: 'x', topic: 'Launch', branches: ['Presse', 'Kunden'] });
    const [, press, customers] = (await call(getWall, ctx, guest)).elements;
    const longer = 'Presse: Mitteilung, Interviews mit drei Fachmagazinen und ein Termin für die Vorstellung';
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: press.id, text: longer }] });
    const after = (await call(getWall, ctx, guest)).elements;
    const grown = after.find((el: any) => el.id === press.id);
    expect(grown.text).toBe(longer);
    expect(grown.height).toBeGreaterThan(press.height);
    expect(grown.width).toBeGreaterThan(press.width);
    const below = after.find((el: any) => el.id === customers.id);
    expect(below.y).toBeGreaterThanOrEqual(grown.y + grown.height);

    // At the size the node is drawn in, and never without words.
    await call(saveWall, ctx, { ...guest, elements: after.map((el: any) => (el.id === customers.id ? { ...el, fontSize: 40 } : el)), seenAssistantIds: after.map((el: any) => el.id) });
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: customers.id, text: 'Kunden' }] });
    expect((await call(getWall, ctx, guest)).elements.find((el: any) => el.id === customers.id).height).toBe(Math.round(40 * 1.25) + 16);
    await expect(call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: customers.id, text: ' ' }] })).rejects.toThrow(/needs words/);

    // A branch hung under it takes on its size, and is measured at that size.
    const { ids: [blog] } = await call(addBranchesToBoard, ctx, { ...bot, heard: 'x', under: customers.id, branches: ['Blog'] });
    expect((await call(getWall, ctx, guest)).elements.find((el: any) => el.id === blog)).toMatchObject({ fontSize: 40, height: Math.round(40 * 1.25) + 16 });
  });

  it('puts what it deleted back where it lay, under what was on top of it', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), rect('r2', 0, 0), rect('r3', 300, 0)], seenAssistantIds: [] });
    const { editId } = await call(deleteFromBoard, ctx, { ...bot, heard: 'x', ids: ['r1', 'r2'] });
    await call(undo, ctx, { ...guest, editId });
    expect(await wallIds(ctx)).toEqual(['r1', 'r2', 'r3']);
  });

  it('changes text and colour, and undo puts back what was there', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    const { editId } = await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: 'r1', text: 'Neu', color: 'green' }] });
    expect((await call(getWall, ctx, guest)).elements[0]).toMatchObject({ text: 'Neu', strokeColor: '#16a34a' });
    await call(undo, ctx, { ...guest, editId });
    expect((await call(getWall, ctx, guest)).elements[0]).toEqual(rect('r1', 0, 0));
  });

  it('does not undo over what a person changed afterwards', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    const { editId } = await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: 'r1', text: 'Vivo' }] });
    const mine = { ...rect('r1', 0, 0), text: 'Von Lena' };
    await call(saveWall, ctx, { ...guest, elements: [mine], seenAssistantIds: [] });
    await call(undo, ctx, { ...guest, editId });
    expect((await call(getWall, ctx, guest)).elements[0]).toEqual(mine);
  });

  it('a board that had not caught up with a change cannot reverse it', async () => {
    const ctx = await makeCtx();
    const before = [rect('r1', 0, 0), rect('r2', 400, 0), rect('r3', 0, 400)];
    await call(saveWall, ctx, { ...guest, elements: before, seenAssistantIds: [] });
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: 'r1', text: 'Vivo' }] });
    await call(arrangeOnBoard, ctx, { ...bot, heard: 'x', ids: ['r2'], near: 'r3', side: 'right' });
    await call(deleteFromBoard, ctx, { ...bot, heard: 'x', ids: ['r3'] });
    const moved = (await call(getWall, ctx, guest)).elements.find((el: any) => el.id === 'r2');

    // A client still showing the old board saves it with one stroke of its own.
    await call(saveWall, ctx, { ...guest, elements: [...before, stroke('s1')], seenAssistantIds: [] });
    const wall = (await call(getWall, ctx, guest)).elements;
    expect(wall.map((el: any) => el.id)).toEqual(['r1', 'r2', 's1']);
    expect(wall[0].text).toBe('Vivo');
    expect(wall[1]).toEqual(moved);
  });

  it('keeps a change a person made back to how it was before the assistant', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', changes: [{ id: 'r1', color: 'green' }] });
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], edit: { removedIds: [], addedIds: [] } });
    expect((await call(getWall, ctx, guest)).elements).toEqual([rect('r1', 0, 0)]);
  });

  it('does not undo into a board that has replaced the one it changed', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    const { editId } = await call(deleteFromBoard, ctx, { ...bot, heard: 'x', ids: ['r1'] });
    await call(saveWall, ctx, { ...guest, elements: [stroke('s1')], seenAssistantIds: [] });
    await call(startNew, ctx, guest);
    await expect(call(undo, ctx, { ...guest, editId })).rejects.toThrow(/cannot be undone/);
    await expect(call(undoLast, ctx, { ...bot, heard: 'zurück' })).rejects.toThrow(/Nothing to undo/);
    expect(await wallIds(ctx)).toEqual([]);
    expect((await call(recent, ctx, guest))[0].canUndo).toBe(false);
  });

  it('does not take back half a command whose board change sits on a replaced board', async () => {
    const ctx = await makeCtx();
    const { editId } = await call(addToBoard, ctx, { ...bot, heard: 'x', commandId: 'c1', items: [{ kind: 'sticky', text: 'A' }] });
    await call(appendToNotes, ctx, { ...bot, heard: 'x', commandId: 'c1', bullets: ['Protokoll'] });
    await call(startNew, ctx, guest);
    await expect(call(undo, ctx, { ...guest, editId })).rejects.toThrow(/cannot be undone/);
    expect((await call(getNotes, ctx, guest)).contentHtml).toContain('Protokoll');
    expect((await call(recent, ctx, guest)).map((e: any) => e.canUndo)).toEqual([false, false]);
  });

  it('takes back everything one command did, from the toast and when asked', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    const first = await call(addToBoard, ctx, { ...bot, heard: 'eins', commandId: 'c1', items: [{ kind: 'sticky', text: 'A' }] });
    await call(changeOnBoard, ctx, { ...bot, heard: 'eins', commandId: 'c1', changes: [{ id: 'r1', text: 'B' }] });
    await call(undo, ctx, { ...guest, editId: first.editId });
    expect((await call(getWall, ctx, guest)).elements).toEqual([rect('r1', 0, 0)]);

    await call(addToBoard, ctx, { ...bot, heard: 'zwei', commandId: 'c2', items: [{ kind: 'sticky', text: 'C' }, { kind: 'sticky', text: 'D' }] });
    await call(deleteFromBoard, ctx, { ...bot, heard: 'zwei', commandId: 'c2', ids: ['r1'] });
    await call(undoLast, ctx, { ...bot, heard: 'mach das rückgängig' });
    expect((await call(getWall, ctx, guest)).elements).toEqual([rect('r1', 0, 0)]);
  });

  it('shows things on everyone\'s board without changing the board', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    await call(showOnBoard, ctx, { ...bot, heard: 'zeig alles', mode: 'fit' });
    await call(showOnBoard, ctx, { ...bot, heard: 'zeig den Kasten', ids: ['r1'], mode: 'fit' });
    const edits = await call(recent, ctx, guest);
    expect(edits[0]).toMatchObject({ kind: 'view', view: 'fit', focusIds: ['r1'] });
    expect(edits[1]).toMatchObject({ kind: 'view', view: 'fit', focusIds: [] });
    await expect(call(undoLast, ctx, { ...bot, heard: 'zurück' })).rejects.toThrow(/Nothing to undo/);
  });

  it('tells the toast what changed and where, so boards can show it', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0)], seenAssistantIds: [] });
    const added = await call(addToBoard, ctx, { ...bot, heard: 'x', commandId: 'c1', items: [{ kind: 'sticky', text: 'A' }] });
    await call(changeOnBoard, ctx, { ...bot, heard: 'x', commandId: 'c1', changes: [{ id: 'r1', color: 'blue' }] });
    const [change, add] = await call(recent, ctx, guest);
    expect(add).toMatchObject({ commandId: 'c1', action: 'add', count: 1, focusIds: [added.ids['0']] });
    expect(change).toMatchObject({ commandId: 'c1', action: 'change', count: 1, focusIds: ['r1'] });
  });

  it('sees the board and the notes, but only with its own grant', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [rect('r1', 0, 0), { ...stroke('s1') }], seenAssistantIds: [] });
    await call(saveNotes, ctx, { ...guest, contentHtml: '<p>Agenda</p>' });
    const seen = await call(context, ctx, bot);
    expect(seen.board.map((el: any) => el.id)).toEqual(['r1', 's1']);
    // Pen strokes come as boxes, without their points.
    expect(seen.board[1]).toEqual({ id: 's1', type: 'stroke', x: 1, y: 1, width: 4, height: 4, color: '#18181b' });
    expect(seen.notesHtml).toContain('Agenda');
    await expect(call(context, ctx, guest)).rejects.toThrow();
  });

  it('takes the stamps on a note away with it, and brings them back on undo', async () => {
    const ctx = await makeCtx();
    const note = { ...rect('n', 0, 0), shapeType: 'note', text: 'Kunden fragen' };
    const stamp = { id: 'st', type: 'stamp', stamp: 'heart', x: 178, y: -22, width: 44, height: 44, on: { id: 'n', fx: 1, fy: 0 } };
    const other = rect('r', 400, 0);
    await call(saveWall, ctx, { ...guest, elements: [note, stamp, other], seenAssistantIds: [] });

    await call(deleteFromBoard, ctx, { ...bot, heard: 'x', ids: ['n'] });
    expect(await wallIds(ctx)).toEqual(['r']);
    const [edit] = await call(recent, ctx, guest);
    expect(edit).toMatchObject({ action: 'delete', count: 1 });

    await call(undoLast, ctx, { ...bot, heard: 'zurück' });
    const wall = (await call(getWall, ctx, guest)).elements;
    expect(wall.map((el: any) => el.id).sort()).toEqual(['n', 'r', 'st']);
    expect(wall.find((el: any) => el.id === 'st')).toMatchObject({ on: { id: 'n' } });
  });

  it('sees who wrote a note and which element a stamp sits on', async () => {
    const ctx = await makeCtx();
    const note = { ...rect('n', 0, 0), shapeType: 'note', text: 'Kunden fragen', by: 'Sara' };
    const stamp = { id: 'st', type: 'stamp', stamp: 'heart', x: 180, y: -20, width: 44, height: 44, by: 'Jonas', on: { id: 'n', fx: 1, fy: 0 } };
    await call(saveWall, ctx, { ...guest, elements: [note, stamp], seenAssistantIds: [] });
    const seen = await call(context, ctx, bot);
    expect(seen.board[0]).toMatchObject({ shapeType: 'note', text: 'Kunden fragen', by: 'Sara' });
    expect(seen.board[1]).toEqual({ id: 'st', type: 'stamp', x: 180, y: -20, width: 44, height: 44, stamp: 'heart', on: 'n', by: 'Jonas' });
  });

  it('only acts with the grant the dispatch gave it', async () => {
    const ctx = await makeCtx();
    await expect(call(addToBoard, ctx, { ...guest, heard: 'x', items: [{ kind: 'sticky', text: 'Fake' }] })).rejects.toThrow();
    await expect(call(appendToNotes, ctx, { ...guest, heard: 'x', bullets: ['Fake'] })).rejects.toThrow();
  });

  it('keeps a note that arrived while someone was drawing', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [stroke('s1')], seenAssistantIds: [] });
    await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'Neu' }] });
    const [noteId] = (await wallIds(ctx)).slice(1);

    // The drawing client finishes its stroke on the board it had before the note came.
    await call(saveWall, ctx, { ...guest, elements: [stroke('s1'), stroke('s2')], seenAssistantIds: [] });

    expect(await wallIds(ctx)).toEqual(['s1', 's2', noteId]);
  });

  it('lets a person delete a note they had on their board', async () => {
    const ctx = await makeCtx();
    await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'Weg damit' }] });
    const [noteId] = await wallIds(ctx);

    await call(saveWall, ctx, { ...guest, elements: [], seenAssistantIds: [noteId] });

    expect(await wallIds(ctx)).toEqual([]);
  });

  it('takes notes back on undo, and a stale board cannot bring them back', async () => {
    const ctx = await makeCtx();
    await call(saveWall, ctx, { ...guest, elements: [stroke('s1')], seenAssistantIds: [] });
    const { editId } = await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'A' }, { kind: 'circle', text: 'B' }] });
    const stale = (await call(getWall, ctx, guest)).elements;

    await call(undo, ctx, { ...guest, editId });
    expect(await wallIds(ctx)).toEqual(['s1']);
    expect((await call(recent, ctx, guest))[0].undoneAt).toBeTypeOf('number');

    await call(saveWall, ctx, { ...guest, elements: stale, seenAssistantIds: stale.slice(1).map((el: any) => el.id) });
    expect(await wallIds(ctx)).toEqual(['s1']);
  });

  it('keeps what it added on a filed board that is put back on the wall after the addition was undone', async () => {
    const ctx = await makeCtx();
    const { editId } = await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'A' }] });
    const filed = (await call(getWall, ctx, guest)).elements;
    const archiveId = await ctx.db.insert('whiteboardArchive', { roomId: ROOM, elements: filed, filedAt: Date.now(), reason: 'session' });
    await call(undo, ctx, { ...guest, editId });

    const { generation } = await call(restore, ctx, { ...guest, archiveId });
    const ids = filed.map((el: any) => el.id);
    await call(saveWall, ctx, { ...guest, generation, elements: [...filed, stroke('s1')], seenAssistantIds: ids });
    expect(await wallIds(ctx)).toEqual([...ids, 's1']);
  });

  it('undoes its own last change when asked to', async () => {
    const ctx = await makeCtx();
    await call(addToBoard, ctx, { ...bot, heard: 'x', items: [{ kind: 'sticky', text: 'A' }] });
    await call(addToBoard, ctx, { ...bot, heard: 'y', items: [{ kind: 'sticky', text: 'B' }] });

    await call(undoLast, ctx, { ...bot, heard: 'Tavio, mach das rückgängig' });

    const wall = await call(getWall, ctx, guest);
    expect(wall.elements.map((el: any) => el.text)).toEqual(['A']);
  });

  it('rejects text on the board that is too long', async () => {
    const ctx = await makeCtx();
    await expect(
      call(saveWall, ctx, { ...guest, elements: [{ id: 'r', type: 'shape', shapeType: 'rectangle', x: 0, y: 0, width: 10, height: 10, strokeColor: '#000', fillColor: 'transparent', strokeWidth: 1, text: 'x'.repeat(501) }] }),
    ).rejects.toThrow(/text/i);
  });
});

describe('assistant in the notes', () => {
  const notesHtml = async (ctx: any) => (await call(getNotes, ctx, guest)).contentHtml as string;

  it('appends a marked block built from plain text', async () => {
    const ctx = await makeCtx({ meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Agenda</p>', locked: false }] });
    const { editId } = await call(appendToNotes, ctx, { ...bot, heard: 'x', heading: 'Aufgaben', bullets: ['Jonas <b>schickt</b> die Zahlen'] });

    const html = await notesHtml(ctx);
    const { blockId } = (await call(recent, ctx, guest)).find((edit: any) => edit.id === editId);
    expect(html.startsWith('<p>Agenda</p>')).toBe(true);
    expect(html).toContain(`<h3 data-assistant="${blockId}">Aufgaben</h3>`);
    expect(html).toContain(`<ul data-assistant="${blockId}"><li><p>Jonas &lt;b&gt;schickt&lt;/b&gt; die Zahlen</p></li></ul>`);
  });

  it('starts the notes when there were none', async () => {
    const ctx = await makeCtx();
    await call(appendToNotes, ctx, { ...bot, heard: 'x', paragraphs: ['Erste Zeile'] });
    expect(await notesHtml(ctx)).toMatch(/^<p data-assistant="[a-z0-9-]+">Erste Zeile<\/p>$/);
  });

  it('does not write into locked notes', async () => {
    const ctx = await makeCtx({ meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Agenda</p>', locked: true }] });
    await expect(call(appendToNotes, ctx, { ...bot, heard: 'x', paragraphs: ['Nein'] })).rejects.toThrow(/locked/i);
  });

  it('keeps a block that an editor saved over without having seen it', async () => {
    const ctx = await makeCtx({ meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Agenda</p>', locked: false }] });
    await call(appendToNotes, ctx, { ...bot, heard: 'x', bullets: ['Neu'] });

    await call(saveNotes, ctx, { ...guest, contentHtml: '<p>Agenda und mehr</p>', seenAssistantIds: [] });

    const html = await notesHtml(ctx);
    expect(html.startsWith('<p>Agenda und mehr</p>')).toBe(true);
    expect(html).toContain('<li><p>Neu</p></li>');
  });

  it('lets a person delete a block they had in their editor', async () => {
    const ctx = await makeCtx({ meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Agenda</p>', locked: false }] });
    const { editId } = await call(appendToNotes, ctx, { ...bot, heard: 'x', bullets: ['Neu'] });
    const { blockId } = (await call(recent, ctx, guest)).find((edit: any) => edit.id === editId);

    await call(saveNotes, ctx, { ...guest, contentHtml: '<p>Agenda</p>', seenAssistantIds: [blockId] });

    expect(await notesHtml(ctx)).toBe('<p>Agenda</p>');
  });

  it('takes a block back on undo, and a stale editor cannot bring it back', async () => {
    const ctx = await makeCtx({ meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Agenda</p>', locked: false }] });
    const { editId } = await call(appendToNotes, ctx, { ...bot, heard: 'x', heading: 'Aufgaben', bullets: ['Neu'] });
    const stale = await notesHtml(ctx);
    const { blockId } = (await call(recent, ctx, guest)).find((edit: any) => edit.id === editId);

    await call(undo, ctx, { ...guest, editId });
    expect(await notesHtml(ctx)).toBe('<p>Agenda</p>');

    await call(saveNotes, ctx, { ...guest, contentHtml: `${stale}<p>Weiter</p>`, seenAssistantIds: [blockId] });
    expect(await notesHtml(ctx)).toBe('<p>Agenda</p><p>Weiter</p>');
  });
});

describe('assistant removes its own blocks from the notes', () => {
  it('removes a block it wrote, but nothing a person wrote', async () => {
    const ctx = await makeCtx();
    await call(saveNotes, ctx, { ...guest, contentHtml: '<p>Lena</p>' });
    await call(appendToNotes, ctx, { ...bot, heard: 'x', bullets: ['Alt'] });
    const [{ blockId }] = await call(recent, ctx, guest);
    await call(removeFromNotes, ctx, { ...bot, heard: 'x', blockIds: [blockId] });
    const notes = await call(getNotes, ctx, guest);
    expect(notes.contentHtml).toBe('<p>Lena</p>');
    // Open editors take a removed block out the same way as an undone one.
    expect((await call(recent, ctx, guest)).find((e: any) => e.blockId === blockId).undoneAt).not.toBeNull();
    await expect(call(removeFromNotes, ctx, { ...bot, heard: 'x', blockIds: ['blk-not-mine'] })).rejects.toThrow();
  });

  it('open editors also learn about the removal of a block older than the last twenty changes', async () => {
    const ctx = await makeCtx();
    await call(appendToNotes, ctx, { ...bot, heard: 'x', bullets: ['Alt'] });
    const [{ blockId }] = await call(recent, ctx, guest);
    for (let i = 0; i < 20; i++) await call(reply, ctx, { ...bot, heard: 'x', text: `Antwort ${i}` });
    await call(removeFromNotes, ctx, { ...bot, heard: 'x', blockIds: [blockId] });
    const block = (await call(recent, ctx, guest)).find((e: any) => e.blockId === blockId);
    expect(block).toBeDefined();
    expect(block.undoneAt).not.toBeNull();
  });
});

describe('assistant replies and history', () => {
  it('records a spoken answer without changing anything', async () => {
    const ctx = await makeCtx();
    await call(reply, ctx, { ...bot, heard: 'Tavio, wie spät ist es?', text: 'Dafür habe ich kein Werkzeug.' });
    const [edit] = await call(recent, ctx, guest);
    expect(edit).toMatchObject({ kind: 'reply', text: 'Dafür habe ich kein Werkzeug.' });
    await expect(call(undo, ctx, { ...guest, editId: edit.id })).rejects.toThrow();
  });

  it('shows its history only to people in the room', async () => {
    const ctx = await makeCtx();
    await call(reply, ctx, { ...bot, heard: 'x', text: 'y' });
    await expect(call(recent, ctx, { roomId: ROOM })).rejects.toThrow();
  });

  it('takes out a whole block even when someone nested a list inside it', () => {
    const html = '<p>Lena</p><ul data-assistant="blk-1"><li><p>A</p><ul><li><p>A1</p></li></ul></li><li><p>B</p></li></ul><p>Ende</p>';
    expect(removeBlock(html, 'blk-1')).toBe('<p>Lena</p><p>Ende</p>');
  });
});

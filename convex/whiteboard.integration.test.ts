import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rateLimitSpy } = vi.hoisted(() => ({
  rateLimitSpy: vi.fn(async () => {}),
}));

vi.mock('./lib/rateLimit', () => ({
  checkWhiteboardRateLimit: rateLimitSpy,
}));

import { addHtml, get, html, save } from './whiteboard';
import { createFakeCtx } from '../tests/fakeConvexDb';
import { ConvexError } from 'convex/values';

type Snapshot = { _id: string; roomId: string; elements: any[] };

const createCtx = (opts?: { room?: any; snapshots?: Snapshot[] }) => {
  const room = opts?.room ?? { _id: 'room-1' };
  const snapshots = opts?.snapshots ?? [];

  return {
    auth: { getUserIdentity: async () => ({ subject: 'member-1' }) },
    db: {
      get: async (id: string) => {
        if (id === 'room-1') return room;
        return snapshots.find((s) => s._id === id) ?? null;
      },
      query: (table: string) => ({
        withIndex: (_index: string, cb: (q: any) => any) => {
          const condition = cb({ eq: (_field: string, value: string) => ({ value, gte() { return this } }) });
          return {
            first: async () => {
              if (table === 'whiteboardSnapshots') {
                return snapshots.find((s) => s.roomId === condition.value) ?? null;
              }
              return null;
            },
            collect: async () => [],
          };
        },
      }),
      patch: async (id: string, patch: Partial<Snapshot>) => {
        const idx = snapshots.findIndex((s) => s._id === id);
        if (idx >= 0) snapshots[idx] = { ...snapshots[idx], ...patch } as Snapshot;
      },
      insert: async (_table: string, value: Omit<Snapshot, '_id'>) => {
        const id = `snap-${snapshots.length + 1}`;
        snapshots.push({ _id: id, ...value });
        return id;
      },
    },
    snapshots,
  };
};

const validRect = {
  id: 'shape-1',
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  strokeColor: '#000000',
  fillColor: '#ffffff',
  strokeWidth: 2,
};

describe('whiteboard integration', () => {
  beforeEach(() => {
    rateLimitSpy.mockClear();
  });

  it('get returns empty elements when no snapshot exists', async () => {
    const ctx = createCtx({ snapshots: [] });

    const result = await (get as any)._handler(ctx, { roomId: 'room-1' });

    expect(result).toEqual({ roomId: 'room-1', elements: [] });
  });

  it('save rejects payloads with more than 10,000 elements', async () => {
    const ctx = createCtx({ snapshots: [] });
    const elements = Array.from({ length: 10001 }, (_, i) => ({ ...validRect, id: `shape-${i}` }));

    await expect((save as any)._handler(ctx, { roomId: 'room-1', elements })).rejects.toThrow(
      /Too many whiteboard elements/
    );
  });

  it('save rejects invalid element types as final, so the board does not send them again', async () => {
    const ctx = createCtx({ snapshots: [] });

    const saving = (save as any)._handler(ctx, {
      roomId: 'room-1',
      elements: [{ id: 'bad-1', type: 'triangle' }],
    });
    await expect(saving).rejects.toThrow(/Invalid element type/);
    await expect(saving).rejects.toBeInstanceOf(ConvexError);
  });

  it('save keeps data images and drops blob images, which exist only in the browser that pasted them', async () => {
    const ctx = createCtx({ snapshots: [] });
    const elements = [
      {
        id: 'img-1',
        type: 'image',
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
      },
      {
        id: 'img-2',
        type: 'image',
        src: 'blob:https://app.local/1234-5678',
        x: 10,
        y: 10,
        width: 120,
        height: 90,
      },
    ];

    const result = await (save as any)._handler(ctx, { roomId: 'room-1', elements });

    expect(rateLimitSpy).toHaveBeenCalledTimes(1);
    expect(ctx.snapshots).toHaveLength(1);
    expect(result.elements.map((el: any) => el.id)).toEqual(['img-1']);
  });

  it('save accepts the drawing kinds and styles of the board: diamond, arrow, text, dashes, hachure, groups', async () => {
    const ctx = createCtx({ snapshots: [] });
    const elements = [
      { ...validRect, type: 'shape', id: 'd', shapeType: 'diamond', fillStyle: 'hachure', roundness: 'round', strokeStyle: 'dashed', opacity: 0.6, groupId: 'g1' },
      {
        id: 'a', type: 'line', points: [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 120, y: 40 }], strokeColor: '#2563eb', strokeWidth: 2,
        startArrow: false, endArrow: true, start: { id: 'd', fx: 1, fy: 0.5 }, strokeStyle: 'dotted', groupId: 'g1', locked: true,
      },
      { id: 't', type: 'text', x: 5, y: 5, width: 120, height: 30, text: 'Release\nam 3.', color: '#18181b', fontSize: 24, textAlign: 'center' },
    ];

    const result = await (save as any)._handler(ctx, { roomId: 'room-1', elements });

    expect(result.elements).toHaveLength(3);
  });

  it('save accepts the shared board kinds: notes with a writer, sections, elbow connectors with a label, stamps on an element', async () => {
    const ctx = createCtx({ snapshots: [] });
    const elements = [
      { ...validRect, type: 'shape', id: 's', shapeType: 'section', text: 'Ideen', x: -40, y: -40, width: 600, height: 400, fillColor: '#f4f1ec', strokeWidth: 0 },
      { ...validRect, type: 'shape', id: 'n', shapeType: 'note', text: 'Neues Onboarding', by: 'Sara', fillColor: '#fbe7b0', strokeWidth: 0 },
      { id: 'c', type: 'line', points: [{ x: 0, y: 0 }, { x: 200, y: 80 }], strokeColor: '#18181b', strokeWidth: 2, endArrow: true, elbow: true, label: 'ja' },
      { id: 'st', type: 'stamp', stamp: 'heart', x: 80, y: 0, width: 44, height: 44, by: 'Jonas', on: { id: 'n', fx: 1, fy: 0 } },
      { id: 'h', type: 'html', page: 'boardPages:1', title: 'Quartal', x: 700, y: 0, width: 640, height: 480 },
      { ...validRect, type: 'shape', id: 't', shapeType: 'task', text: 'Zahlen schicken', done: false, owner: 'Jonas', due: '2026-11-20' },
      ...['speech', 'cylinder', 'hexagon', 'star', 'parallelogram', 'block-arrow', 'triangle', 'cloud'].map(shapeType => ({ ...validRect, type: 'shape', id: shapeType, shapeType })),
    ];

    const result = await (save as any)._handler(ctx, { roomId: 'room-1', elements });

    expect(result.elements).toHaveLength(14);
  });

  it('save accepts the later kinds: a marker stroke, tape on a note, a table with its cells, a mind map with a branch', async () => {
    const ctx = createCtx({ snapshots: [] });
    const elements = [
      { id: 'm', type: 'stroke', tool: 'marker', color: '#fde047', size: 20, points: [{ x: 0, y: 0 }, { x: 80, y: 0 }] },
      { ...validRect, type: 'shape', id: 'n', shapeType: 'note', fillColor: '#fbe7b0', strokeWidth: 0 },
      { id: 'tape', type: 'stamp', stamp: 'tape', x: 0, y: -12, width: 96, height: 26, on: { id: 'n', fx: 0.5, fy: 0 } },
      { ...validRect, type: 'shape', id: 'tbl', shapeType: 'table', cells: [['Option', 'Preis'], ['A', '10 €']], fontSize: 14 },
      { ...validRect, type: 'shape', id: 'root', shapeType: 'mindmap', text: 'Launch', fontSize: 16, textAlign: 'center' },
      { ...validRect, type: 'shape', id: 'kid', shapeType: 'mindmap', text: 'Presse', parent: 'root' },
    ];

    const result = await (save as any)._handler(ctx, { roomId: 'room-1', elements });

    expect(result.elements).toHaveLength(6);
  });

  it('keeps what someone else added meanwhile when a board that never showed it saves; a board that showed it and left it out deletes it', async () => {
    const ctx = createCtx({ snapshots: [] });
    const el = (id: string) => ({ ...validRect, type: 'shape', shapeType: 'note', id });
    await (save as any)._handler(ctx, { roomId: 'room-1', elements: [el('a')], seenIds: [] });
    // Jonas adds b while Lena is still writing in her note.
    await (save as any)._handler(ctx, { roomId: 'room-1', elements: [el('a'), el('b')], seenIds: [] });
    // Lena's board never got b: her save keeps it, after the element it followed.
    const lena = await (save as any)._handler(ctx, { roomId: 'room-1', elements: [el('a'), el('c')], seenIds: [] });
    expect(lena.elements.map((e: any) => e.id)).toEqual(['a', 'b', 'c']);
    // Once a board showed b and c, leaving them out deletes them.
    const cleared = await (save as any)._handler(ctx, { roomId: 'room-1', elements: [el('a')], seenIds: ['b', 'c'] });
    expect(cleared.elements.map((e: any) => e.id)).toEqual(['a']);
    // A board from before this rule sends no list; what it sends is the board.
    await (save as any)._handler(ctx, { roomId: 'room-1', elements: [el('a'), el('d')], seenIds: [] });
    const old = await (save as any)._handler(ctx, { roomId: 'room-1', elements: [el('a')] });
    expect(old.elements.map((e: any) => e.id)).toEqual(['a']);
  });

  it.each([
    ['a line with one point', { id: 'x', type: 'line', points: [{ x: 0, y: 0 }], strokeColor: '#000', strokeWidth: 2 }, /points/],
    ['a line with a point outside the board', { id: 'x', type: 'line', points: [{ x: 0, y: 0 }, { x: 90000, y: 0 }], strokeColor: '#000', strokeWidth: 2 }, /coordinates/],
    ['an arrow bound outside its target', { id: 'x', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], strokeColor: '#000', strokeWidth: 2, end: { id: 'r', fx: 3, fy: 0 } }, /binding/i],
    ['empty text', { id: 'x', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '', color: '#000', fontSize: 20 }, /Text must/],
    ['text far too long', { id: 'x', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x'.repeat(5001), color: '#000', fontSize: 20 }, /Text must/],
    ['a huge font', { id: 'x', type: 'text', x: 0, y: 0, width: 10, height: 10, text: 'x', color: '#000', fontSize: 900 }, /font/i],
    ['an unknown stroke style', { ...validRect, id: 'x', strokeStyle: 'wavy' }, /stroke style/i],
    ['an unknown fill style', { ...validRect, id: 'x', fillStyle: 'zigzag' }, /fill style/i],
    ['an opacity above one', { ...validRect, id: 'x', opacity: 2 }, /opacity/i],
    ['a colour that is not a short string', { ...validRect, id: 'x', strokeColor: 'x'.repeat(200) }, /colou?r/i],
    ['an unknown shape', { ...validRect, type: 'shape', id: 'x', shapeType: 'blob' }, /shape type/i],
    ['a writer name far too long', { ...validRect, type: 'shape', id: 'x', shapeType: 'note', by: 'x'.repeat(200) }, /writer/i],
    ['a connector label far too long', { id: 'x', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], strokeColor: '#000', strokeWidth: 2, label: 'x'.repeat(300) }, /label/i],
    ['an elbow flag that is not a flag', { id: 'x', type: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], strokeColor: '#000', strokeWidth: 2, elbow: 'yes' }, /elbow/i],
    ['an unknown stamp', { id: 'x', type: 'stamp', stamp: 'skull', x: 0, y: 0, width: 44, height: 44 }, /stamp/i],
    ['a task due on a day that is not a date', { ...validRect, type: 'shape', id: 'x', shapeType: 'task', text: 'x', due: 'Freitag' }, /due/i],
    ['a task with a person far too long', { ...validRect, type: 'shape', id: 'x', shapeType: 'task', text: 'x', owner: 'x'.repeat(200) }, /person/i],
    ['a task ticked with something that is not a tick', { ...validRect, type: 'shape', id: 'x', shapeType: 'task', text: 'x', done: 'yes' }, /done/i],
    ['a page of HTML that names no page', { id: 'x', type: 'html', title: 'Quartal', x: 0, y: 0, width: 640, height: 480 }, /page/i],
    ['a page of HTML with a title far too long', { id: 'x', type: 'html', page: 'boardPages:1', title: 'x'.repeat(200), x: 0, y: 0, width: 640, height: 480 }, /title/i],
    ['a table whose rows differ in length', { ...validRect, type: 'shape', id: 'x', shapeType: 'table', cells: [['a', 'b'], ['c']] }, /table/i],
    ['a table far too large', { ...validRect, type: 'shape', id: 'x', shapeType: 'table', cells: Array.from({ length: 60 }, () => ['a']) }, /table/i],
    ['a table cell far too long', { ...validRect, type: 'shape', id: 'x', shapeType: 'table', cells: [['x'.repeat(2000)]] }, /table/i],
    ['a mind map node whose parent is not a name', { ...validRect, type: 'shape', id: 'x', shapeType: 'mindmap', parent: 42 }, /parent/i],
    ['a shape text in a huge font', { ...validRect, type: 'shape', id: 'x', shapeType: 'rectangle', text: 'x', fontSize: 900 }, /font/i],
    ['an unknown stroke tool', { id: 'x', type: 'stroke', tool: 'spray', color: '#000', size: 4, points: [{ x: 0, y: 0 }] }, /tool/i],
    ['a stamp stuck outside its element', { id: 'x', type: 'stamp', stamp: 'star', x: 0, y: 0, width: 44, height: 44, on: { id: 'r', fx: 2, fy: 0 } }, /binding/i],
  ])('save rejects %s', async (_name, element, error) => {
    const ctx = createCtx({ snapshots: [] });
    await expect((save as any)._handler(ctx, { roomId: 'room-1', elements: [element] })).rejects.toThrow(error);
  });
});

describe('a page of HTML on the board', () => {
  const rooms = [{ _id: 'room-1', access: 'OPEN', name: 'Weekly', slug: 'weekly' }, { _id: 'room-2', access: 'OPEN', name: 'Other', slug: 'other' }];

  it('is kept for its room and read back only there; a page that is too big is refused', async () => {
    const ctx = createFakeCtx({ rooms });
    const page = await (addHtml as any)._handler(ctx, { roomId: 'room-1', title: 'Übersicht', html: '<h1>Q3</h1>' });

    expect(await (html as any)._handler(ctx, { roomId: 'room-1', page })).toEqual({ title: 'Übersicht', html: '<h1>Q3</h1>' });
    expect(await (html as any)._handler(ctx, { roomId: 'room-2', page })).toBeNull();
    await expect((addHtml as any)._handler(ctx, { roomId: 'room-1', title: 'Groß', html: 'x'.repeat(300_001) })).rejects.toThrow(/too large/i);
  });
  it('a room holds at most 50 pages, so nobody can fill the storage with them', async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ _creationTime: Date.now(), roomId: 'room-1', title: `P${i}`, html: '<p>x</p>' }));
    const ctx = createFakeCtx({ rooms, boardPages: full });
    await expect((addHtml as any)._handler(ctx, { roomId: 'room-1', title: 'One more', html: '<p>y</p>' })).rejects.toThrow(/pages/i);
    expect(await (addHtml as any)._handler(ctx, { roomId: 'room-2', title: 'Elsewhere', html: '<p>y</p>' })).toBeTruthy();
  });
  it('makes room by dropping pages nobody put on a board within the hour', async () => {
    const old = Date.now() - 2 * 60 * 60 * 1000;
    const full = Array.from({ length: 50 }, (_, i) => ({
      _id: `page-${i}`, roomId: 'room-1', title: `P${i}`, html: '<p>x</p>',
      // P0 was stored before pages had to be put up; P49 was stored a moment ago.
      _creationTime: i === 49 ? Date.now() : old, ...(i === 0 ? {} : { provisional: true }),
    }));
    const ctx = createFakeCtx({ rooms, boardPages: full });
    const onBoard = { id: 'el-1', type: 'html', page: 'page-1', title: 'P1', x: 0, y: 0, width: 400, height: 300 };
    await (save as any)._handler(ctx, { roomId: 'room-1', elements: [onBoard], edit: { removedIds: [], addedIds: ['el-1'] } });

    expect(await (addHtml as any)._handler(ctx, { roomId: 'room-1', title: 'One more', html: '<p>y</p>' })).toBeTruthy();
    expect(ctx.rows('boardPages').filter((page: any) => page.roomId === 'room-1').map((page: any) => page.title)).toEqual(['P0', 'P1', 'P49', 'One more']);
  });
});

describe('images pasted onto the board', () => {
  const rooms = [{ _id: 'room-1', access: 'OPEN', name: 'Weekly', slug: 'weekly' }];
  const upload = (storageId: string, roomId = 'room-1') => ({ roomId, uploaderId: 'member-1', storageId, contentType: 'image/png', size: 5, createdAt: Date.now() });
  const image = (id: string, src: string) => ({ id, type: 'image', src, x: 0, y: 0, width: 10, height: 10 });

  it('are kept only once a board saved with them, so an upload no board took is cleaned up like any other', async () => {
    const ctx = createFakeCtx({ rooms, chatUploads: [upload('st-pasted'), upload('st-never'), upload('st-other', 'room-2')] });
    await (save as any)._handler(ctx, {
      roomId: 'room-1',
      elements: [image('i1', 'https://files.test/st-pasted'), image('i2', 'https://files.test/st-other')],
      edit: { removedIds: [], addedIds: ['i1', 'i2'] },
    });
    const rows = await (ctx as any).db.query('chatUploads').collect();
    const kept = Object.fromEntries(rows.map((u: any) => [u.storageId, u.keptFor]));
    expect(kept).toEqual({ 'st-pasted': 'board', 'st-never': undefined, 'st-other': undefined });
  });

  it('keep nothing for an image the save did not put on the board', async () => {
    const ctx = createFakeCtx({ rooms, chatUploads: [upload('st-sneaked')] });
    // Sent as a change to an element the board does not have, so the merge leaves it out.
    await (save as any)._handler(ctx, { roomId: 'room-1', elements: [image('i9', 'https://files.test/st-sneaked')], edit: { removedIds: [], addedIds: [] } });
    const [row] = await (ctx as any).db.query('chatUploads').collect();
    expect(row.keptFor).toBeUndefined();
  });
});

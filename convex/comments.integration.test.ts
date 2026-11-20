import { describe, expect, it, vi } from 'vitest';

vi.mock('./lib/rateLimit', () => ({ checkChatRateLimit: vi.fn(async () => {}) }));

import { createFakeCtx } from '../tests/fakeConvexDb';
import { add, list, resolve } from './comments';
import { hashRoomAccessToken } from './lib/roomAccess';

const HOUR = 60 * 60 * 1000;
const call = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);

const makeCtx = async () =>
  createFakeCtx({
    rooms: [
      { _id: 'room-1', access: 'OPEN', name: 'Open', slug: 'open' },
      { _id: 'room-2', access: 'OPEN', name: 'Other', slug: 'other' },
    ],
    roomAccessGrants: [
      { roomId: 'room-1', identity: 'lena', tokenHash: await hashRoomAccessToken('lena-token'), expiresAt: Date.now() + HOUR },
      { roomId: 'room-1', identity: 'jonas', tokenHash: await hashRoomAccessToken('jonas-token'), expiresAt: Date.now() + HOUR },
      { roomId: 'room-2', identity: 'lena', tokenHash: await hashRoomAccessToken('other-token'), expiresAt: Date.now() + HOUR },
    ],
    whiteboardSnapshots: [{ _id: 'wall-1', roomId: 'room-1', elements: [{ id: 'note-1' }, { id: 'note-2' }] }],
  }, null);
const lena = { roomId: 'room-1', accessToken: 'lena-token' };
const jonas = { roomId: 'room-1', accessToken: 'jonas-token' };

describe('comment pins on board elements', () => {
  it('a comment pins a thread to the element; more comments on it are replies; it can be ticked done and opened again', async () => {
    const ctx = await makeCtx();
    await call(add, ctx, { ...lena, elementId: 'note-1', name: 'Lena', text: '  Can this be bigger?  ' });
    await call(add, ctx, { ...jonas, elementId: 'note-1', name: 'Jonas', text: 'Yes' });
    await call(add, ctx, { ...jonas, elementId: 'note-2', name: 'Jonas', text: 'Second pin' });

    const threads = await call(list, ctx, lena);
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({
      elementId: 'note-1',
      resolved: false,
      replies: [{ name: 'Lena', text: 'Can this be bigger?', mine: true }, { name: 'Jonas', text: 'Yes', mine: false }],
    });
    expect(JSON.stringify(threads)).not.toContain('jonas');

    await call(resolve, ctx, { ...jonas, threadId: threads[0].id, resolved: true });
    expect((await call(list, ctx, lena))[0].resolved).toBe(true);
    // Writing on a done thread opens it again.
    await call(add, ctx, { ...lena, elementId: 'note-1', name: 'Lena', text: 'One more thing' });
    expect((await call(list, ctx, lena))[0]).toMatchObject({ resolved: false, replies: { length: 3 } });
  });

  it('stays in its room and takes only people in the call and real words', async () => {
    const ctx = await makeCtx();
    await call(add, ctx, { ...lena, elementId: 'note-1', name: 'Lena', text: 'Here' });
    expect(await call(list, ctx, { roomId: 'room-2', accessToken: 'other-token' })).toEqual([]);
    const [thread] = await call(list, ctx, lena);
    await expect(call(resolve, ctx, { roomId: 'room-2', accessToken: 'other-token', threadId: thread.id, resolved: true })).rejects.toThrow(/not found/);

    await expect(call(add, ctx, { roomId: 'room-1', accessToken: 'wrong', elementId: 'note-1', name: 'X', text: 'Hi' })).rejects.toThrow();
    await expect(call(add, ctx, { ...lena, elementId: 'note-1', name: 'Lena', text: '   ' })).rejects.toThrow(/empty/);
    await expect(call(add, ctx, { ...lena, elementId: 'note-1', name: 'Lena', text: 'x'.repeat(2001) })).rejects.toThrow(/long/);
  });

  it('hangs only on elements on the board, and the meeting sees only threads on the board, not those of earlier boards', async () => {
    const ctx = await makeCtx();
    await expect(call(add, ctx, { ...lena, elementId: 'made-up', name: 'Lena', text: 'Hi' })).rejects.toThrow(/not on the board/);
    ctx.rows('boardComments').push({ _id: 'old', roomId: 'room-1', elementId: 'filed-away', resolved: false, replies: [{ author: 'x', name: 'Ex', text: 'Private', at: 1 }] });
    await call(add, ctx, { ...lena, elementId: 'note-1', name: 'Lena', text: 'Here' });
    expect((await call(list, ctx, jonas)).map((t: any) => t.elementId)).toEqual(['note-1']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeCtx } from '../tests/fakeConvexDb';
import { control, get } from './timer';
import { canManage } from './rooms';
import { hashRoomAccessToken } from './lib/roomAccess';

const HOUR = 60 * 60 * 1000;
const call = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);

/** A room without a workspace, where everyone in the call may moderate, and one in a workspace, where a plain member may not. */
const makeCtx = async (identity: { subject: string } | null) =>
  createFakeCtx({
    rooms: [
      { _id: 'open-room', access: 'OPEN', name: 'Open', slug: 'open' },
      { _id: 'team-room', access: 'OPEN', name: 'Team', slug: 'team', orgId: 'org-1' },
    ],
    roomAccessGrants: [
      { roomId: 'open-room', identity: 'guest-1', tokenHash: await hashRoomAccessToken('guest-token'), expiresAt: Date.now() + HOUR },
      { roomId: 'team-room', identity: 'member-1', tokenHash: await hashRoomAccessToken('member-token'), expiresAt: Date.now() + HOUR },
    ],
  }, identity);

describe('the room timer', () => {
  afterEach(() => vi.useRealTimers());

  it('runs from an end time everyone reads, pauses with what is left, takes a minute more, and stops', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const ctx = await makeCtx(null);
    const room = { roomId: 'open-room', accessToken: 'guest-token' };

    expect(await call(canManage, ctx, room)).toBe(true);
    await call(control, ctx, { ...room, action: 'start', minutes: 5 });
    expect(await call(get, ctx, room)).toEqual({ endsAt: 1_000_000 + 5 * 60_000, totalMs: 5 * 60_000 });

    vi.setSystemTime(1_000_000 + 60_000);
    await call(control, ctx, { ...room, action: 'pause' });
    expect(await call(get, ctx, room)).toEqual({ leftMs: 4 * 60_000, totalMs: 5 * 60_000 });
    await call(control, ctx, { ...room, action: 'add' });
    expect(await call(get, ctx, room)).toEqual({ leftMs: 5 * 60_000, totalMs: 6 * 60_000 });

    vi.setSystemTime(1_000_000 + 10 * 60_000);
    await call(control, ctx, { ...room, action: 'resume' });
    expect(await call(get, ctx, room)).toEqual({ endsAt: 1_000_000 + 15 * 60_000, totalMs: 6 * 60_000 });

    await call(control, ctx, { ...room, action: 'stop' });
    expect(await call(get, ctx, room)).toBeNull();
  });

  it('is only started and changed by those who moderate the room; everyone in it sees it', async () => {
    const ctx = await makeCtx({ subject: 'member-1' });
    const room = { roomId: 'team-room', accessToken: 'member-token' };

    expect(await call(canManage, ctx, room)).toBe(false);
    await expect(call(control, ctx, { ...room, action: 'start', minutes: 5 })).rejects.toThrow(/not allowed/);
    expect(await call(get, ctx, room)).toBeNull();
  });

  it('takes between 1 and 60 minutes', async () => {
    const ctx = await makeCtx(null);
    await expect(call(control, ctx, { roomId: 'open-room', action: 'start', minutes: 0 })).rejects.toThrow(/minutes/);
    await expect(call(control, ctx, { roomId: 'open-room', action: 'start', minutes: 90 })).rejects.toThrow(/minutes/);
  });
});

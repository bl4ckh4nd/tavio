import { describe, expect, it } from 'vitest';
import { createFakeCtx } from '../tests/fakeConvexDb';
import { cast, control, state, take } from './voting';
import { hashRoomAccessToken } from './lib/roomAccess';

const HOUR = 60 * 60 * 1000;
const call = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);

/** An open room without a workspace, where everyone in the call may moderate, and a workspace room, where a plain member may not. */
const makeCtx = async () => {
  const data = {
    rooms: [
      { _id: 'open-room', access: 'OPEN', name: 'Open', slug: 'open' },
      { _id: 'team-room', access: 'OPEN', name: 'Team', slug: 'team', orgId: 'org-1' },
    ],
    roomAccessGrants: [
      { roomId: 'open-room', identity: 'lena', tokenHash: await hashRoomAccessToken('lena-token'), expiresAt: Date.now() + HOUR },
      { roomId: 'open-room', identity: 'jonas', tokenHash: await hashRoomAccessToken('jonas-token'), expiresAt: Date.now() + HOUR },
      { roomId: 'team-room', identity: 'member-1', tokenHash: await hashRoomAccessToken('member-token'), expiresAt: Date.now() + HOUR },
      { roomId: 'open-room', identity: 'drifter', tokenHash: await hashRoomAccessToken('drifter-token'), expiresAt: Date.now() + HOUR },
    ],
    // Lena and Jonas are in the call; the drifter only fetched a token.
    roomPresence: ['lena', 'jonas'].map(userId => ({ roomId: 'open-room', userId, userName: userId, handRaised: false, lastSeen: Date.now() })),
  };
  return createFakeCtx(data, null);
};
const lena = { roomId: 'open-room', accessToken: 'lena-token' };
const jonas = { roomId: 'open-room', accessToken: 'jonas-token' };

describe('dot voting', () => {
  it('keeps the dots hidden until the result is shown, then sorts by votes', async () => {
    const ctx = await makeCtx();
    expect(await call(state, ctx, lena)).toBeNull();
    await call(control, ctx, { ...lena, action: 'start' });

    await call(cast, ctx, { ...lena, elementId: 'idea-a' });
    await call(cast, ctx, { ...lena, elementId: 'idea-b' });
    await call(cast, ctx, { ...jonas, elementId: 'idea-b' });
    await call(cast, ctx, { ...jonas, elementId: 'idea-b' });

    expect(await call(state, ctx, jonas)).toEqual({ revealed: false, dots: 3, mine: ['idea-b', 'idea-b'], voters: 2 });
    expect(await call(state, ctx, lena)).toEqual({ revealed: false, dots: 3, mine: ['idea-a', 'idea-b'], voters: 2 });

    await call(control, ctx, { ...lena, action: 'reveal' });
    expect(await call(state, ctx, jonas)).toEqual({
      revealed: true, dots: 3, mine: ['idea-b', 'idea-b'], voters: 2,
      results: [{ elementId: 'idea-b', votes: 3 }, { elementId: 'idea-a', votes: 1 }],
    });
    await expect(call(cast, ctx, { ...jonas, elementId: 'idea-a' })).rejects.toThrow(/closed/);

    await call(control, ctx, { ...lena, action: 'end' });
    expect(await call(state, ctx, jonas)).toBeNull();
  });

  it('gives each person three dots, which they can take back', async () => {
    const ctx = await makeCtx();
    await call(control, ctx, { ...lena, action: 'start' });
    for (const id of ['a', 'b', 'c']) await call(cast, ctx, { ...jonas, elementId: id });
    await expect(call(cast, ctx, { ...jonas, elementId: 'd' })).rejects.toThrow(/three dots/);

    await call(take, ctx, { ...jonas, elementId: 'b' });
    await call(cast, ctx, { ...jonas, elementId: 'd' });
    expect((await call(state, ctx, jonas)).mine).toEqual(['a', 'c', 'd']);
  });

  it('a new round starts empty', async () => {
    const ctx = await makeCtx();
    await call(control, ctx, { ...lena, action: 'start' });
    await call(cast, ctx, { ...jonas, elementId: 'a' });
    await call(control, ctx, { ...lena, action: 'start' });
    expect(await call(state, ctx, jonas)).toEqual({ revealed: false, dots: 3, mine: [], voters: 0 });
  });

  it('is only started and shown by those who moderate the room, and only people in the call vote', async () => {
    const ctx = await makeCtx();
    const member = { roomId: 'team-room', accessToken: 'member-token' };
    await expect(call(control, ctx, { ...member, action: 'start' })).rejects.toThrow(/signed in|not allowed/);
    await expect(call(cast, ctx, { roomId: 'open-room', accessToken: 'wrong', elementId: 'a' })).rejects.toThrow();
    await expect(call(cast, ctx, { ...jonas, elementId: 'a' })).rejects.toThrow(/no vote/i);
  });

  it('only people present in the call vote: a fresh token alone does not bring three more dots', async () => {
    const ctx = await makeCtx();
    await call(control, ctx, { ...lena, action: 'start' });
    await expect(call(cast, ctx, { roomId: 'open-room', accessToken: 'drifter-token', elementId: 'a' })).rejects.toThrow(/in the call/);
  });
});

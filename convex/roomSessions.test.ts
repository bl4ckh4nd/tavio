import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/rateLimit', () => ({
  checkWhiteboardRateLimit: vi.fn(async () => {}),
  checkChatRateLimit: vi.fn(async () => {}),
  checkChatUploadRateLimit: vi.fn(async () => {}),
}));

import { createFakeCtx } from '../tests/fakeConvexDb';
import { list as listChat } from './chat';
import { restore, startNew, undoStartNew, list as listBoards, get as getBoard, rename } from './boards';
import { hashRoomAccessToken } from './lib/roomAccess';
import {
  SESSION_IDLE_CLOSE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  deleteRoomHistory,
  finalizeSession,
  touchRoomSession,
} from './lib/sessions';
import { closeIdle, current, get as getSession, listForRoom, remove } from './roomSessions';
import { get as getWall, save } from './whiteboard';

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 5, 9, 0);
const ROOM = 'room-1';
const ORG = 'org-1';

const rect = (id: string) => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  strokeColor: '#18181b',
  fillColor: 'transparent',
  strokeWidth: 2,
});

const person = (userId: string, lastSeen: number) => ({ roomId: ROOM, userId, userName: userId, handRaised: false, lastSeen });

const call = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);

/** A workspace room; "member-1" belongs to the workspace, a guest only holds a join grant. */
const makeCtx = async (seed: Record<string, any[]> = {}, identity: { subject: string } | null = { subject: 'member-1' }) =>
  createFakeCtx(
    {
      rooms: [{ _id: ROOM, orgId: ORG, access: 'OPEN', name: 'Design Crit', slug: 'design-crit', recording: false }],
      orgMemberships: [{ orgId: ORG, userId: 'member-1', role: 'ADMIN' }],
      roomAccessGrants: [
        { roomId: ROOM, identity: 'guest-1', tokenHash: await hashRoomAccessToken('guest-token'), expiresAt: Date.now() + 60 * MIN },
      ],
      ...seed,
    },
    identity,
  );

const guest = { accessToken: 'guest-token' };

describe('sessions follow who is in the room', () => {
  it('does not count one person preparing alone', async () => {
    const ctx = await makeCtx({ roomPresence: [person('a', T0)] });
    expect(await touchRoomSession(ctx, ROOM, T0)).toBeNull();
    expect(ctx.rows('roomSessions')).toHaveLength(0);
  });

  it('opens once two people are there, and for one person while a recording runs', async () => {
    const ctx = await makeCtx({ roomPresence: [person('a', T0), person('b', T0)] });
    await touchRoomSession(ctx, ROOM, T0);
    expect(ctx.rows('roomSessions')).toMatchObject([{ status: 'open', startedAt: T0, participants: [{ userId: 'a' }, { userId: 'b' }] }]);

    const recording = await makeCtx({ roomPresence: [person('a', T0)] });
    recording.rows('rooms')[0].recording = true;
    await touchRoomSession(recording, ROOM, T0);
    expect(recording.rows('roomSessions')).toHaveLength(1);
  });

  it('ignores people whose heartbeat went stale', async () => {
    const ctx = await makeCtx({ roomPresence: [person('a', T0), person('b', T0 - 5 * MIN)] });
    await touchRoomSession(ctx, ROOM, T0);
    expect(ctx.rows('roomSessions')).toHaveLength(0);
  });

  it('touches the row at most once a minute, but adds a newcomer at once', async () => {
    const ctx = await makeCtx({ roomPresence: [person('a', T0), person('b', T0)] });
    await touchRoomSession(ctx, ROOM, T0);
    await touchRoomSession(ctx, ROOM, T0 + 30 * 1000);
    expect(ctx.rows('roomSessions')[0].lastActiveAt).toBe(T0);

    ctx.rows('roomPresence').push({ _id: 'p-c', ...person('c', T0 + 40 * 1000) });
    await touchRoomSession(ctx, ROOM, T0 + 40 * 1000);
    expect(ctx.rows('roomSessions')[0]).toMatchObject({ lastActiveAt: T0 + 40 * 1000 });
    expect(ctx.rows('roomSessions')[0].participants.map((p: any) => p.userId)).toEqual(['a', 'b', 'c']);

    await touchRoomSession(ctx, ROOM, T0 + 40 * 1000 + SESSION_TOUCH_INTERVAL_MS);
    expect(ctx.rows('roomSessions')[0].lastActiveAt).toBe(T0 + 40 * 1000 + SESSION_TOUCH_INTERVAL_MS);
  });

  it('lists a guest who joins again under a new id only once', async () => {
    const guestRow = (id: string, userName: string) => ({ ...person(id, T0), userId: id, userName });
    const ctx = await makeCtx({ roomPresence: [person('a', T0), guestRow('guest-1', 'Bob')] });
    await touchRoomSession(ctx, ROOM, T0);
    ctx.rows('roomPresence').push({ _id: 'p-g2', ...guestRow('guest-2', 'Bob') }, { _id: 'p-g3', ...guestRow('guest-3', 'Cleo') });
    await touchRoomSession(ctx, ROOM, T0 + 1000);
    expect(ctx.rows('roomSessions')[0].participants.map((p: any) => p.userId)).toEqual(['a', 'guest-1', 'guest-3']);
  });

  it('keeps a session alive while one person stays, and keeps who was there', async () => {
    const ctx = await makeCtx({ roomPresence: [person('a', T0), person('b', T0)] });
    await touchRoomSession(ctx, ROOM, T0);
    ctx.rows('roomPresence').splice(1, 1);
    ctx.rows('roomPresence')[0].lastSeen = T0 + 5 * MIN;
    await touchRoomSession(ctx, ROOM, T0 + 5 * MIN);
    expect(ctx.rows('roomSessions')).toMatchObject([{ status: 'open', lastActiveAt: T0 + 5 * MIN }]);
    expect(ctx.rows('roomSessions')[0].participants).toHaveLength(2);
  });

  it('closes a session that went stale and opens the next one', async () => {
    const ctx = await makeCtx({ roomPresence: [person('a', T0), person('b', T0)] });
    await touchRoomSession(ctx, ROOM, T0);
    const later = T0 + SESSION_IDLE_CLOSE_MS + 5 * MIN;
    for (const row of ctx.rows('roomPresence')) row.lastSeen = later;
    await touchRoomSession(ctx, ROOM, later);
    expect(ctx.rows('roomSessions')).toMatchObject([
      { status: 'closed', startedAt: T0, endedAt: T0 },
      { status: 'open', startedAt: later },
    ]);
  });

  it('the cron closes only sessions whose room stayed empty for ten minutes', async () => {
    const now = Date.now();
    const ctx = await makeCtx({
      roomSessions: [
        { _id: 's-old', roomId: ROOM, status: 'open', startedAt: now - 60 * MIN, lastActiveAt: now - 11 * MIN, participants: [] },
        { _id: 's-live', roomId: ROOM, status: 'open', startedAt: now - 20 * MIN, lastActiveAt: now - MIN, participants: [] },
      ],
    });
    expect(await call(closeIdle, ctx, {})).toEqual({ closed: 1 });
    expect(ctx.rows('roomSessions').map((s) => s.status)).toEqual(['closed', 'open']);
  });
});

describe('what a closing session files', () => {
  const session = { _id: 's-1', orgId: ORG, roomId: ROOM, status: 'open', startedAt: T0, lastActiveAt: T0 + 40 * MIN, participants: [] };

  it('files the board, the notes and the message count when they changed during the session', async () => {
    const ctx = await makeCtx({
      roomSessions: [session],
      whiteboardSnapshots: [{ _id: 'wall', roomId: ROOM, elements: [rect('a')], name: 'Flow', boardStartedAt: T0 + MIN, changedAt: T0 + 2 * MIN }],
      meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Notes</p>', locked: false, changedAt: T0 + 3 * MIN }],
      chatMessages: [
        { roomId: ROOM, userId: 'a', userName: 'a', text: 'before', timestamp: T0 - MIN },
        { roomId: ROOM, userId: 'a', userName: 'a', text: 'during', timestamp: T0 + MIN },
        { roomId: ROOM, userId: 'a', userName: 'a', text: 'just after', timestamp: T0 + 45 * MIN },
        { roomId: ROOM, userId: 'a', userName: 'a', text: 'next day', timestamp: T0 + 24 * 60 * MIN },
      ],
    });
    await finalizeSession(ctx, ctx.rows('roomSessions')[0]);

    expect(ctx.rows('roomSessions')[0]).toMatchObject({ status: 'closed', endedAt: T0 + 40 * MIN, messageCount: 2, hasBoard: true, notesHtml: '<p>Notes</p>' });
    expect(ctx.rows('whiteboardArchive')).toMatchObject([{ reason: 'session', sessionId: 's-1', name: 'Flow', boardStartedAt: T0 + MIN, filedAt: T0 + 40 * MIN }]);
    // The wall keeps the board; it only remembers that this exact state is filed.
    expect(ctx.rows('whiteboardSnapshots')[0]).toMatchObject({ elements: [rect('a')], sameAsArchiveId: ctx.rows('whiteboardArchive')[0]._id });
  });

  it('files nothing that the session did not touch', async () => {
    const ctx = await makeCtx({
      roomSessions: [session],
      whiteboardSnapshots: [{ _id: 'wall', roomId: ROOM, elements: [rect('a')], changedAt: T0 - 60 * MIN }],
      meetingDocs: [{ roomId: ROOM, contentHtml: '<p>Old</p>', locked: false, changedAt: T0 - 60 * MIN }],
    });
    await finalizeSession(ctx, ctx.rows('roomSessions')[0]);
    expect(ctx.rows('whiteboardArchive')).toHaveLength(0);
    expect(ctx.rows('roomSessions')[0]).toMatchObject({ hasBoard: false, messageCount: 0 });
    expect(ctx.rows('roomSessions')[0].notesHtml).toBeUndefined();
  });
});

describe('boards', () => {
  const wall = (extra: Record<string, any> = {}) => ({ _id: 'wall', roomId: ROOM, elements: [rect('a'), rect('b')], boardStartedAt: T0, changedAt: T0 + MIN, generation: 3, ...extra });

  it('"new board" files the old one and leaves an empty wall', async () => {
    const ctx = await makeCtx({ whiteboardSnapshots: [wall({ name: 'Flow' })] });
    const result = await call(startNew, ctx, { roomId: ROOM });

    expect(ctx.rows('whiteboardArchive')).toMatchObject([{ _id: result.archiveId, reason: 'replaced', name: 'Flow', elements: [rect('a'), rect('b')], boardStartedAt: T0 }]);
    expect(ctx.rows('whiteboardSnapshots')[0]).toMatchObject({ elements: [], generation: 4 });
    expect(ctx.rows('whiteboardSnapshots')[0].name).toBeUndefined();
    expect(result.generation).toBe(4);
  });

  it('keeps the selected elements on the new board', async () => {
    const ctx = await makeCtx({ whiteboardSnapshots: [wall()] });
    await call(startNew, ctx, { roomId: ROOM, keepElementIds: ['b'] });
    expect(ctx.rows('whiteboardSnapshots')[0].elements).toEqual([rect('b')]);
    expect(ctx.rows('whiteboardArchive')[0].elements).toHaveLength(2);
  });

  it('does nothing on an empty wall or when everything would be kept', async () => {
    const empty = await makeCtx({ whiteboardSnapshots: [wall({ elements: [] })] });
    expect(await call(startNew, empty, { roomId: ROOM })).toEqual({ archiveId: null, generation: 3 });

    const all = await makeCtx({ whiteboardSnapshots: [wall()] });
    expect(await call(startNew, all, { roomId: ROOM, keepElementIds: ['a', 'b'] })).toEqual({ archiveId: null, generation: 3 });
    expect(all.rows('whiteboardArchive')).toHaveLength(0);
  });

  it('links the filed board to the running session', async () => {
    const ctx = await makeCtx({
      whiteboardSnapshots: [wall()],
      roomSessions: [{ _id: 's-1', roomId: ROOM, status: 'open', startedAt: T0, lastActiveAt: T0, participants: [] }],
    });
    await call(startNew, ctx, { roomId: ROOM });
    expect(ctx.rows('whiteboardArchive')[0].sessionId).toBe('s-1');
  });

  it('does not file a board twice that a closed session already filed', async () => {
    const ctx = await makeCtx({
      whiteboardArchive: [{ _id: 'filed', roomId: ROOM, elements: [rect('a'), rect('b')], boardStartedAt: T0, filedAt: T0 + 5 * MIN, reason: 'session' }],
      whiteboardSnapshots: [wall({ sameAsArchiveId: 'filed' })],
    });
    const result = await call(startNew, ctx, { roomId: ROOM });
    expect(result.archiveId).toBe('filed');
    expect(ctx.rows('whiteboardArchive')).toHaveLength(1);
  });

  it('undo brings the board back, keeps what was drawn since, and takes it out of the history', async () => {
    const ctx = await makeCtx({ whiteboardSnapshots: [wall({ name: 'Flow' })] });
    const { archiveId } = await call(startNew, ctx, { roomId: ROOM });
    await call(save, ctx, { roomId: ROOM, elements: [rect('c')], generation: 4 });
    await call(undoStartNew, ctx, { roomId: ROOM, archiveId });

    expect(ctx.rows('whiteboardSnapshots')[0]).toMatchObject({ name: 'Flow', boardStartedAt: T0, generation: 5 });
    expect(ctx.rows('whiteboardSnapshots')[0].elements.map((e: any) => e.id)).toEqual(['a', 'b', 'c']);
    expect(ctx.rows('whiteboardArchive')).toHaveLength(0);
  });

  it('undo leaves a session record in the history', async () => {
    const ctx = await makeCtx({
      whiteboardArchive: [{ _id: 'filed', roomId: ROOM, elements: [rect('a'), rect('b')], boardStartedAt: T0, filedAt: T0 + 5 * MIN, reason: 'session' }],
      whiteboardSnapshots: [wall({ sameAsArchiveId: 'filed' })],
    });
    const { archiveId } = await call(startNew, ctx, { roomId: ROOM });
    await call(undoStartNew, ctx, { roomId: ROOM, archiveId });
    expect(ctx.rows('whiteboardArchive')).toHaveLength(1);
    expect(ctx.rows('whiteboardSnapshots')[0]).toMatchObject({ sameAsArchiveId: 'filed' });
    expect(ctx.rows('whiteboardSnapshots')[0].elements).toHaveLength(2);
  });

  it('taking a filed board back files the board it replaces, but not an untouched copy', async () => {
    const ctx = await makeCtx({
      whiteboardArchive: [{ _id: 'old', roomId: ROOM, elements: [rect('x')], name: 'Old', boardStartedAt: T0 - 60 * MIN, filedAt: T0 - 30 * MIN, reason: 'replaced' }],
      whiteboardSnapshots: [wall()],
    });
    await call(restore, ctx, { roomId: ROOM, archiveId: 'old' });
    expect(ctx.rows('whiteboardSnapshots')[0]).toMatchObject({ elements: [rect('x')], name: 'Old', sameAsArchiveId: 'old', generation: 4 });
    expect(ctx.rows('whiteboardArchive')).toHaveLength(2);

    // Looking at another filed board next must not file the untouched copy of "old" again.
    const second = ctx.rows('whiteboardArchive')[1]._id;
    await call(restore, ctx, { roomId: ROOM, archiveId: second });
    expect(ctx.rows('whiteboardArchive')).toHaveLength(2);
    expect(ctx.rows('whiteboardSnapshots')[0].elements.map((e: any) => e.id)).toEqual(['a', 'b']);
  });

  it('a stroke on a restored board makes it a board of its own again', async () => {
    const ctx = await makeCtx({
      whiteboardArchive: [{ _id: 'old', roomId: ROOM, elements: [rect('x')], boardStartedAt: T0, filedAt: T0, reason: 'replaced' }],
      whiteboardSnapshots: [wall({ elements: [] })],
    });
    await call(restore, ctx, { roomId: ROOM, archiveId: 'old' });
    await call(save, ctx, { roomId: ROOM, elements: [rect('x'), rect('y')], generation: 4 });
    expect(ctx.rows('whiteboardSnapshots')[0].sameAsArchiveId).toBeUndefined();
    await call(startNew, ctx, { roomId: ROOM });
    expect(ctx.rows('whiteboardArchive')).toHaveLength(2);
  });

  it('drops a save that was meant for a board no longer on the wall', async () => {
    const ctx = await makeCtx({ whiteboardSnapshots: [wall()] });
    await call(startNew, ctx, { roomId: ROOM });
    const result = await call(save, ctx, { roomId: ROOM, elements: [rect('a'), rect('b'), rect('late')], generation: 3 });
    expect(result).toMatchObject({ stale: true, generation: 4, elements: [] });
    expect(ctx.rows('whiteboardSnapshots')[0].elements).toEqual([]);
  });

  it('names the board on the wall and rejects names that are too long', async () => {
    const ctx = await makeCtx({ whiteboardSnapshots: [wall()] });
    await call(rename, ctx, { roomId: ROOM, name: '  Lobby   flow ' });
    expect(ctx.rows('whiteboardSnapshots')[0].name).toBe('Lobby flow');
    await call(rename, ctx, { roomId: ROOM, name: ' ' });
    expect(ctx.rows('whiteboardSnapshots')[0].name).toBeUndefined();
    await expect(call(rename, ctx, { roomId: ROOM, name: 'x'.repeat(61) })).rejects.toThrow(/too long/);
  });

  it('shows guests only boards filed since the last session closed', async () => {
    const seed = {
      roomSessions: [{ _id: 's-0', roomId: ROOM, status: 'closed', startedAt: T0, lastActiveAt: T0 + 30 * MIN, endedAt: T0 + 30 * MIN, participants: [] }],
      whiteboardArchive: [
        { _id: 'past', roomId: ROOM, elements: [rect('a')], boardStartedAt: T0, filedAt: T0 + 30 * MIN, reason: 'session', sessionId: 's-0' },
        { _id: 'today', roomId: ROOM, elements: [rect('b')], boardStartedAt: T0 + 120 * MIN, filedAt: T0 + 130 * MIN, reason: 'replaced' },
      ],
    };
    const asGuest = await makeCtx(seed, null);
    expect((await call(listBoards, asGuest, { roomId: ROOM, ...guest })).map((b: any) => b.id)).toEqual(['today']);
    expect(await call(getBoard, asGuest, { roomId: ROOM, archiveId: 'past', ...guest })).toBeNull();
    await expect(call(restore, asGuest, { roomId: ROOM, archiveId: 'past', ...guest })).rejects.toThrow(/not found/);

    const asMember = await makeCtx(seed);
    expect((await call(listBoards, asMember, { roomId: ROOM })).map((b: any) => b.id)).toEqual(['today', 'past']);
    expect(await call(getBoard, asMember, { roomId: ROOM, archiveId: 'past' })).toMatchObject({ elements: [rect('a')] });
  });
});

describe('the board a session finds on the wall', () => {
  const openSession = { _id: 's-2', roomId: ROOM, status: 'open', startedAt: T0 + 24 * 60 * MIN, lastActiveAt: T0 + 24 * 60 * MIN, participants: [] };
  const closed = { _id: 's-1', roomId: ROOM, status: 'closed', startedAt: T0, lastActiveAt: T0 + 30 * MIN, endedAt: T0 + 30 * MIN, participants: [] };

  it('is marked as carried over until someone draws on it', async () => {
    const ctx = await makeCtx({
      roomSessions: [closed, openSession],
      whiteboardSnapshots: [{ _id: 'wall', roomId: ROOM, elements: [rect('a')], changedAt: T0 + 10 * MIN, generation: 0 }],
    });
    expect((await call(getWall, ctx, { roomId: ROOM })).carriedOver).toEqual({ sessionId: 's-2', from: T0 });

    await call(save, ctx, { roomId: ROOM, elements: [rect('a'), rect('b')] });
    expect((await call(getWall, ctx, { roomId: ROOM })).carriedOver).toBeNull();
  });

  it('is not marked without a running session, on an empty wall, or right after it was put there', async () => {
    const solo = await makeCtx({ roomSessions: [closed], whiteboardSnapshots: [{ roomId: ROOM, elements: [rect('a')], changedAt: T0 }] });
    expect((await call(getWall, solo, { roomId: ROOM })).carriedOver).toBeNull();

    const empty = await makeCtx({ roomSessions: [closed, openSession], whiteboardSnapshots: [{ roomId: ROOM, elements: [], changedAt: T0 }] });
    expect((await call(getWall, empty, { roomId: ROOM })).carriedOver).toBeNull();

    const placed = await makeCtx({
      roomSessions: [closed, openSession],
      whiteboardSnapshots: [{ roomId: ROOM, elements: [rect('a')], changedAt: T0, placedAt: openSession.startedAt + MIN }],
    });
    expect((await call(getWall, placed, { roomId: ROOM })).carriedOver).toBeNull();
  });
});

describe('the room history', () => {
  const closed = (id: string, startedAt: number) => ({
    _id: id,
    orgId: ORG,
    roomId: ROOM,
    status: 'closed',
    startedAt,
    lastActiveAt: startedAt + 30 * MIN,
    endedAt: startedAt + 30 * MIN,
    participants: [{ userId: 'a', userName: 'Ada' }, { userId: 'b', userName: 'Ben' }],
    messageCount: 1,
    hasBoard: true,
    notesHtml: '<p>Notes</p>',
  });
  const seed = () => ({
    roomSessions: [closed('s-1', T0), closed('s-2', T0 + 24 * 60 * MIN)],
    whiteboardArchive: [{ _id: 'b-1', roomId: ROOM, elements: [rect('a')], boardStartedAt: T0, filedAt: T0 + 30 * MIN, reason: 'session', sessionId: 's-1' }],
    chatMessages: [
      { _id: 'm-1', roomId: ROOM, userId: 'a', userName: 'Ada', text: 'in s-1', timestamp: T0 + MIN },
      { _id: 'm-2', roomId: ROOM, userId: 'a', userName: 'Ada', text: 'in s-2', timestamp: T0 + 24 * 60 * MIN + MIN },
    ],
    recordings: [{ _id: 'r-1', roomId: ROOM, status: 'failed', startedAt: T0 + 2 * MIN, startedByUserId: 'a' }],
    boardComments: [
      { _id: 'c-1', roomId: ROOM, elementId: 'a', resolved: true, replies: [{ author: 'a', name: 'Ada', text: 'Bigger?', at: T0 + 2 * MIN }] },
      { _id: 'c-2', roomId: ROOM, elementId: 'z', resolved: false, replies: [{ author: 'b', name: 'Ben', text: 'Elsewhere', at: T0 + 3 * MIN }] },
    ],
  });

  it('lists sessions newest first for members and refuses guests', async () => {
    const ctx = await makeCtx(seed());
    const listed = await call(listForRoom, ctx, { roomId: ROOM });
    expect(listed.map((s: any) => s.id)).toEqual(['s-2', 's-1']);
    expect(listed[1]).toMatchObject({ participantNames: ['Ada', 'Ben'], hasBoard: true, hasNotes: true, recordingStatus: 'failed' });
    expect(listed[0].recordingStatus).toBeNull();

    await expect(call(listForRoom, await makeCtx(seed(), null), { roomId: ROOM })).rejects.toThrow(/signed in/);
    await expect(call(listForRoom, await makeCtx(seed(), { subject: 'stranger' }), { roomId: ROOM })).rejects.toThrow(/access/);
  });

  it('a signed-in guest who once joined does not get the history', async () => {
    const ctx = await makeCtx({ ...seed(), memberships: [{ roomId: ROOM, userId: 'visitor', role: 'Participant' }] }, { subject: 'visitor' });
    await expect(call(listForRoom, ctx, { roomId: ROOM })).rejects.toThrow(/access/);
    const host = await makeCtx({ ...seed(), memberships: [{ roomId: ROOM, userId: 'host', role: 'Host' }] }, { subject: 'host' });
    expect(await call(listForRoom, host, { roomId: ROOM })).toHaveLength(2);
  });

  it('opens one session with its board, notes, chat and recording', async () => {
    const ctx = await makeCtx(seed());
    const session = await call(getSession, ctx, { sessionId: 's-1' });
    expect(session).toMatchObject({
      roomName: 'Design Crit',
      notesHtml: '<p>Notes</p>',
      messageTotal: 1,
      messages: [{ text: 'in s-1' }],
      boards: [{ id: 'b-1', reason: 'session' }],
      recordings: [{ id: 'r-1', status: 'failed' }],
    });
    // The comments pinned to the board's elements stay with it, without who wrote them by id.
    expect(session.boards[0].comments).toEqual([{ elementId: 'a', resolved: true, replies: [{ name: 'Ada', text: 'Bigger?', at: T0 + 2 * MIN }] }]);
  });

  it('tells a meeting where "now" begins, and gives the past only to members', async () => {
    const asMember = await call(current, await makeCtx(seed()), { roomId: ROOM });
    expect(asMember).toMatchObject({ current: null, canSeeEarlier: true, currentFrom: T0 + 24 * 60 * MIN + 30 * MIN + SESSION_IDLE_CLOSE_MS });
    expect(asMember.earlier.map((s: any) => s.id)).toEqual(['s-1', 's-2']);

    const asGuest = await call(current, await makeCtx(seed(), null), { roomId: ROOM, ...guest });
    expect(asGuest).toMatchObject({ canSeeEarlier: false, earlier: [], currentFrom: asMember.currentFrom });
  });

  it('gives guests the chat of the meeting they are in, and members all of it', async () => {
    const withToday = () => {
      const data = seed();
      data.chatMessages.push({ _id: 'm-3', roomId: ROOM, userId: 'a', userName: 'Ada', text: 'today', timestamp: T0 + 72 * 60 * MIN });
      return data;
    };
    const asGuest = await call(listChat, await makeCtx(withToday(), null), { roomId: ROOM, ...guest });
    expect(asGuest.map((m: any) => m.text)).toEqual(['today']);
    const asMember = await call(listChat, await makeCtx(withToday()), { roomId: ROOM });
    expect(asMember.map((m: any) => m.text)).toEqual(['in s-1', 'in s-2', 'today']);
  });

  it('deleting a session removes its boards and chat and nothing else', async () => {
    const ctx = await makeCtx({
      ...seed(),
      chatReactions: [{ roomId: ROOM, messageId: 'm-1', userId: 'a', emoji: '👍' }, { roomId: ROOM, messageId: 'm-2', userId: 'a', emoji: '👍' }],
      chatUploads: [{ roomId: ROOM, uploaderId: 'a', storageId: 'file-1', contentType: 'image/png', size: 10, createdAt: T0, messageId: 'm-1' }],
    });
    ctx.rows('chatMessages')[0].attachment = { kind: 'image', storageId: 'file-1', width: 10, height: 10 };
    await call(remove, ctx, { sessionId: 's-1' });
    expect(ctx.deletedFiles).toEqual(['file-1']);
    expect(ctx.rows('chatUploads')).toHaveLength(0);
    expect(ctx.rows('chatReactions').map((r) => r.messageId)).toEqual(['m-2']);
    expect(ctx.rows('roomSessions').map((s) => s._id)).toEqual(['s-2']);
    expect(ctx.rows('whiteboardArchive')).toHaveLength(0);
    expect(ctx.rows('chatMessages').map((m) => m._id)).toEqual(['m-2']);
    expect(ctx.rows('recordings')).toHaveLength(1);
    expect(ctx.rows('boardComments').map((c) => c._id)).toEqual(['c-2']);
  });

  it('deleting a session keeps comments on elements another filed board still shows', async () => {
    const data = seed();
    data.whiteboardArchive.push({ _id: 'b-2', roomId: ROOM, elements: [rect('a')], boardStartedAt: T0, filedAt: T0 + 24 * 60 * MIN + 30 * MIN, reason: 'session', sessionId: 's-2' });
    const ctx = await makeCtx(data);
    await call(remove, ctx, { sessionId: 's-1' });
    expect(ctx.rows('boardComments').map((c) => c._id)).toEqual(['c-1', 'c-2']);
  });

  it('deleting a session takes the pages only its boards showed', async () => {
    const data = seed();
    data.whiteboardArchive[0].elements.push({ id: 'h', type: 'html', page: 'p-1' } as any, { id: 'h2', type: 'html', page: 'p-2' } as any);
    const ctx = await makeCtx({
      ...data,
      whiteboardSnapshots: [{ _id: 'wall', roomId: ROOM, elements: [{ id: 'h2', type: 'html', page: 'p-2' }] }],
      boardPages: [{ _id: 'p-1', roomId: ROOM, title: 'Gone', html: '<p>1</p>' }, { _id: 'p-2', roomId: ROOM, title: 'Still on the wall', html: '<p>2</p>' }],
    });
    await call(remove, ctx, { sessionId: 's-1' });
    expect(ctx.rows('boardPages').map((p) => p._id)).toEqual(['p-2']);
  });

  it('deleting a room takes its history, comments, vote, timer and board pages along', async () => {
    const ctx = await makeCtx({
      ...seed(),
      voteRounds: [{ roomId: ROOM, revealed: false, votes: [] }, { roomId: 'other', revealed: false, votes: [] }],
      roomTimers: [{ roomId: ROOM, endsAt: T0, totalMs: MIN }],
      boardPages: [{ roomId: ROOM, title: 'Page', html: '<p>x</p>' }, { roomId: 'other', title: 'Kept', html: '<p>y</p>' }],
      chatUploads: [
        { roomId: ROOM, uploaderId: 'a', storageId: 'board-img', contentType: 'image/png', size: 10, createdAt: T0, keptFor: 'board' },
        { roomId: 'other', uploaderId: 'a', storageId: 'other-img', contentType: 'image/png', size: 10, createdAt: T0, keptFor: 'board' },
      ],
    });
    await deleteRoomHistory(ctx, ROOM);
    // Images pasted onto the room's boards go too, files included.
    expect(ctx.deletedFiles).toEqual(['board-img']);
    expect(ctx.rows('chatUploads').map((u) => u.storageId)).toEqual(['other-img']);
    for (const table of ['roomSessions', 'whiteboardArchive', 'boardComments', 'roomTimers']) expect(ctx.rows(table)).toHaveLength(0);
    expect(ctx.rows('voteRounds').map((r) => r.roomId)).toEqual(['other']);
    expect(ctx.rows('boardPages').map((r) => r.title)).toEqual(['Kept']);
  });

  it('only managers delete, and never a running session', async () => {
    const ctx = await makeCtx(seed(), { subject: 'stranger' });
    await expect(call(remove, ctx, { sessionId: 's-1' })).rejects.toThrow(/not allowed/);

    const running = await makeCtx({ roomSessions: [{ _id: 's-live', roomId: ROOM, status: 'open', startedAt: T0, lastActiveAt: T0, participants: [] }] });
    await expect(call(remove, running, { sessionId: 's-live' })).rejects.toThrow(/running/);
  });
});

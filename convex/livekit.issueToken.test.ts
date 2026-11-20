import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessTokenOptions: any[] = [];
const grants: any[] = [];

vi.mock('./lib/rateLimit', () => ({
  checkTokenRateLimit: vi.fn(async () => {}),
}));

vi.mock('./lib/envValidation', () => ({
  requireEnvForLiveKit: vi.fn(() => ({
    apiKey: 'lk_key',
    apiSecret: 'lk_secret',
    host: 'wss://livekit.test',
  })),
}));

vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    constructor(_apiKey: string, _apiSecret: string, options: any) {
      accessTokenOptions.push(options);
    }
    addGrant = vi.fn((grant: any) => grants.push(grant));
    async toJwt() {
      return 'jwt-token';
    }
  },
}));

import { issueToken } from './livekit';

const makeCtx = (options: {
  identity?: { subject: string; name?: string } | null;
  room: any;
  membership?: any;
  orgRole?: string;
  outsideWorkspace?: boolean;
}) => {
  const runQuery = vi.fn(async (_fnRef: any, args: any) => {
    if ('slug' in args) return options.room;
    if ('roomId' in args && 'userId' in args) return options.membership ?? null;
    if (Object.keys(args).length === 0) {
      return options.outsideWorkspace ? [] : [{ id: options.room.orgId, role: options.orgRole ?? 'MEMBER' }];
    }
    throw new Error('Unexpected query invocation');
  });

  const runMutation = vi.fn(async (_fnRef: any, args: any) => {
    if ('externalId' in args) return { role: 'Participant' };
    if ('password' in args && 'roomSlug' in args) return true;
    if ('tokenHash' in args) return null;
    if ('roomId' in args && Object.keys(args).length === 1) return null;
    if ('roomId' in args && 'userId' in args) return true;
    throw new Error('Unexpected mutation invocation');
  });

  return {
    auth: {
      getUserIdentity: async () => options.identity ?? null,
    },
    runQuery,
    runMutation,
  };
};

describe('livekit.issueToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    accessTokenOptions.length = 0;
    grants.length = 0;
  });

  it('counts guests and accounts from outside the workspace against the allowance of the room, members only against their own', async () => {
    const { checkTokenRateLimit } = await import('./lib/rateLimit');
    const room = { id: 'room-1', orgId: 'org-1', slug: 'secret', access: 'PASSWORD', activeHosts: 1 };
    const keys = () => vi.mocked(checkTokenRateLimit).mock.calls.map(call => call[1]);
    await (issueToken as any)._handler(makeCtx({ identity: null, room }), { roomSlug: 'secret', name: 'Guest', password: 'pw' });
    expect(keys()).toEqual(['guests:room-1']);
    vi.mocked(checkTokenRateLimit).mockClear();
    await (issueToken as any)._handler(makeCtx({ identity: { subject: 'outsider' }, room, outsideWorkspace: true }), { roomSlug: 'secret', password: 'pw' });
    expect(keys()).toEqual(['outsider', 'guests:room-1']);
    vi.mocked(checkTokenRateLimit).mockClear();
    await (issueToken as any)._handler(makeCtx({ identity: { subject: 'member' }, room }), { roomSlug: 'secret', password: 'pw' });
    expect(keys()).toEqual(['member']);
    vi.mocked(checkTokenRateLimit).mockClear();
    // A room guests cannot enter: turning them away uses up nothing of it.
    const closed = { id: 'room-2', slug: 'team', access: 'MEMBERS', activeHosts: 1 };
    await expect((issueToken as any)._handler(makeCtx({ identity: null, room: closed }), { roomSlug: 'team', name: 'Guest' })).rejects.toThrow(/signed in/);
    expect(keys()).toEqual([]);
  });

  it('rejects password rooms without password', async () => {
    const ctx = makeCtx({
      identity: null,
      room: { id: 'room-1', slug: 'secret', access: 'PASSWORD', activeHosts: 1 },
    });

    await expect((issueToken as any)._handler(ctx, { roomSlug: 'secret', name: 'Guest' }))
      .rejects.toThrow('Password required');
  });

  it('blocks anonymous users from open room when no active hosts exist', async () => {
    const ctx = makeCtx({
      identity: null,
      room: { id: 'room-1', slug: 'open-room', access: 'OPEN', activeHosts: 0 },
    });

    await expect((issueToken as any)._handler(ctx, { roomSlug: 'open-room', name: 'Guest' }))
      .rejects.toThrow(/host or member must be present/i);
  });

  it('makes workspace owners and admins the host of their password rooms, but not plain members', async () => {
    const room = { id: 'room-2', slug: 'board', access: 'PASSWORD', orgId: 'org-1', activeHosts: 0 };
    const owner = await (issueToken as any)._handler(
      makeCtx({ identity: { subject: 'owner-1', name: 'Olga' }, room, orgRole: 'OWNER' }),
      { roomSlug: 'board', name: 'Olga', password: 'pw' },
    );
    const member = await (issueToken as any)._handler(
      makeCtx({ identity: { subject: 'member-1', name: 'Max' }, room, orgRole: 'MEMBER' }),
      { roomSlug: 'board', name: 'Max', password: 'pw' },
    );

    expect(owner.role).toBe('Host');
    expect(member.role).toBe('Participant');
  });

  it('lets a workspace admin start an open room whose original host is away', async () => {
    const room = { id: 'room-2', slug: 'workshop', access: 'OPEN', orgId: 'org-1', activeHosts: 0 };
    const ctx = makeCtx({ identity: { subject: 'admin-1' }, room, orgRole: 'ADMIN' });
    const result = await (issueToken as any)._handler(ctx, { roomSlug: room.slug, name: 'Alex' });

    expect(result.role).toBe('Host');
  });

  describe('signed-in users outside the room workspace', () => {
    const outsider = { subject: 'outsider-1', name: 'Olli' };

    it('joins password rooms as a guest', async () => {
      const room = { id: 'room-3', slug: 'client', access: 'PASSWORD', orgId: 'org-1', activeHosts: 0 };
      const ctx = makeCtx({ identity: outsider, room, outsideWorkspace: true });

      const result = await (issueToken as any)._handler(ctx, { roomSlug: 'client', name: 'Olli', password: 'pw' });

      expect(result.role).toBe('Participant');
      expect(result.identity).toBe('outsider-1');
    });

    it('waits for a host in open rooms and never bootstraps themselves as host', async () => {
      const room = { id: 'room-3', slug: 'client', access: 'OPEN', orgId: 'org-1', activeHosts: 0 };
      const ctx = makeCtx({ identity: outsider, room, outsideWorkspace: true });

      await expect((issueToken as any)._handler(ctx, { roomSlug: 'client', name: 'Olli' }))
        .rejects.toThrow(/host or member must be present/i);
      const bootstrapped = ctx.runMutation.mock.calls.some(([, args]: any[]) => 'roomId' in args && 'userId' in args);
      expect(bootstrapped).toBe(false);
    });

    it('stays locked out of members rooms', async () => {
      const room = { id: 'room-3', slug: 'client', access: 'MEMBERS', orgId: 'org-1', activeHosts: 1 };
      const ctx = makeCtx({ identity: outsider, room, outsideWorkspace: true });

      await expect((issueToken as any)._handler(ctx, { roomSlug: 'client', name: 'Olli' }))
        .rejects.toThrow(/do not have access to this workspace/i);
    });
  });

  describe('after the meeting was ended for all', () => {
    const endedRoom = (overrides = {}) => ({
      id: 'room-4',
      slug: 'ended',
      access: 'PASSWORD',
      orgId: 'org-1',
      activeHosts: 0,
      meetingEndedAt: Date.now() - 1000,
      ...overrides,
    });

    it('keeps guests out until a host reopens the room', async () => {
      const ctx = makeCtx({ identity: null, room: endedRoom() });

      await expect((issueToken as any)._handler(ctx, { roomSlug: 'ended', name: 'Guest', password: 'pw' }))
        .rejects.toThrow(/meeting has ended/i);
    });

    it('lets a host back in and reopens the room', async () => {
      const ctx = makeCtx({ identity: { subject: 'owner-1' }, room: endedRoom(), orgRole: 'OWNER' });

      const result = await (issueToken as any)._handler(ctx, { roomSlug: 'ended', name: 'Olga', password: 'pw' });

      expect(result.role).toBe('Host');
      expect(ctx.runMutation).toHaveBeenCalledWith(expect.anything(), { roomId: 'room-4' });
    });

    it('lets guests in again once a host reopened the room', async () => {
      const room = endedRoom({ meetingReopenedAt: Date.now() });

      const result = await (issueToken as any)._handler(makeCtx({ identity: null, room }), {
        roomSlug: 'ended', name: 'Guest', password: 'pw',
      });

      expect(result.role).toBe('Participant');
    });

    it('does not stall a reusable room once pre-end tokens have expired', async () => {
      const room = endedRoom({ meetingEndedAt: Date.now() - 16 * 60 * 1000 });

      const result = await (issueToken as any)._handler(makeCtx({ identity: null, room }), {
        roomSlug: 'ended', name: 'Guest', password: 'pw',
      });

      expect(result.role).toBe('Participant');
    });
  });

  it('grants the current session room, so tokens from before an end cannot reach it', async () => {
    const room = { id: 'room-6', slug: 'daily', access: 'PASSWORD', activeHosts: 0, meetingGeneration: 2 };

    const result = await (issueToken as any)._handler(makeCtx({ identity: null, room }), {
      roomSlug: 'daily', name: 'Guest', password: 'pw',
    });

    expect(result.livekitRoomName).toBe('daily__session__2');
    expect(grants[0]).toMatchObject({ roomJoin: true, room: 'daily__session__2' });
    expect(accessTokenOptions[1].attributes.mainRoom).toBe('daily');
  });

  it('stores only the hash of the room access token', async () => {
    const ctx = makeCtx({
      identity: null,
      room: { id: 'room-5', slug: 'secret', access: 'PASSWORD', activeHosts: 0 },
    });

    const result = await (issueToken as any)._handler(ctx, { roomSlug: 'secret', name: 'Guest', password: 'pw' });

    const grantCall = ctx.runMutation.mock.calls.find(([, args]: any[]) => 'tokenHash' in args);
    expect(result.roomAccessToken).toMatch(/^[0-9a-f]{64}$/);
    expect(grantCall?.[1]).toMatchObject({ roomId: 'room-5', identity: result.identity });
    expect(grantCall?.[1].tokenHash).not.toBe(result.roomAccessToken);
  });

  it('issues token for authenticated members room user and returns role + identity', async () => {
    const ctx = makeCtx({
      identity: { subject: 'user-123', name: 'Ada' },
      room: { id: 'room-1', slug: 'team-room', access: 'MEMBERS', activeHosts: 1 },
      membership: { role: 'Host' },
    });

    const result = await (issueToken as any)._handler(ctx, {
      roomSlug: 'team-room',
      name: 'Ada',
    });

    expect(result.token).toBe('jwt-token');
    expect(result.url).toBe('wss://livekit.test');
    expect(result.role).toBe('Host');
    expect(result.identity).toBe('user-123');
    expect(result.roomId).toBe('room-1');
    expect(result.livekitRoomName).toBe('team-room');
    expect(result.sessionCredential).toBe('jwt-token');
    expect(result.breakoutMode).toBe('reconnect');
    expect(accessTokenOptions[0].attributes).toEqual({ role: 'Host' });
    expect(accessTokenOptions[1].attributes).toMatchObject({
      breakoutCredential: '1',
      mainRoom: 'team-room',
      name: 'Ada',
      role: 'Host',
    });
  });
});

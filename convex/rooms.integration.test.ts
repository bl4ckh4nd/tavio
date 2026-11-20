import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/rateLimit', () => ({
  checkRoomCreateRateLimit: vi.fn(async () => {}),
}));

vi.mock('./organizations', () => ({
  ensureDefaultOrgForUser: vi.fn(async () => null),
}));

import { create, getBySlug, isSlugAvailable, requestLogoDiscovery, updatePresence } from './rooms';
import { createFakeCtx } from '../tests/fakeConvexDb';

type RoomDoc = {
  _id: string;
  _creationTime: number;
  slug: string;
  name: string;
  access: string;
  passwordHash?: string;
  activeParticipants: number;
  activeHosts?: number;
  maxParticipants: number;
  locked: boolean;
  recording: boolean;
  type: string;
  createdAt: string;
  orgId?: string;
  branding?: {
    partnerWebsiteUrl?: string;
    logoUrl?: string;
    logoFetchStatus?: string;
    logoFetchError?: string;
  };
};

const makeCreateCtx = (rooms: RoomDoc[], identity: { subject: string } | null = { subject: 'user-1' }) => {
  const schedulerRunAfter = vi.fn(async () => 'scheduled-function-id');
  return {
    scheduler: {
      runAfter: schedulerRunAfter,
    },
    auth: {
      getUserIdentity: async () => identity,
    },
    db: {
      query: (table: string) => ({
        withIndex: (index: string, cb: (q: any) => any) => {
          const condition = cb({
            eq: (field: string, value: string) => ({ field, value }),
          });

          return {
            first: async () => {
              if (table === 'rooms' && index === 'by_slug') {
                return rooms.find((r) => r.slug === condition.value) ?? null;
              }
              if (table === 'subscriptions' && index === 'by_org') {
                return null;
              }
              return null;
            },
            collect: async () => {
              if (table === 'rooms' && index === 'by_org') {
                return rooms.filter((r) => r.orgId === condition.value);
              }
              if (table === 'orgMemberships') {
                return [];
              }
              return [];
            },
          };
        },
      }),
      insert: async (_table: string, value: Omit<RoomDoc, '_id' | '_creationTime'>) => {
        const _id = `room-${rooms.length + 1}`;
        rooms.push({ _id, _creationTime: Date.now(), ...value });
        return _id;
      },
      get: async (id: string) => rooms.find((r) => r._id === id) ?? null,
      patch: async (id: string, patch: Partial<RoomDoc>) => {
        const idx = rooms.findIndex((r) => r._id === id);
        if (idx >= 0) rooms[idx] = { ...rooms[idx], ...patch };
      },
      delete: async () => {},
    },
    schedulerRunAfter,
  };
};

describe('rooms integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognizes the workspace admin’s current presence after joining from another device', async () => {
    const ctx = createFakeCtx({
      rooms: [{ _id: 'room-1', slug: 'workshop', access: 'OPEN', orgId: 'workspace-1', activeHosts: 0 }],
      roomPresence: [
        { roomId: 'room-1', userId: 'admin-1', lastSeen: Date.now() },
        { roomId: 'room-1', userId: 'guest-1', lastSeen: Date.now() },
      ],
      orgMemberships: [{ orgId: 'workspace-1', userId: 'admin-1', role: 'ADMIN' }],
    }, null);

    await expect((getBySlug as any)._handler(ctx, { slug: 'workshop' }))
      .resolves.toMatchObject({ activeHosts: 1, activeParticipants: 2 });
  });

  it('does not count a room host who has left the workspace', async () => {
    const ctx = createFakeCtx({
      rooms: [{ _id: 'room-1', slug: 'workshop', access: 'OPEN', orgId: 'workspace-1', activeHosts: 0 }],
      roomPresence: [
        { roomId: 'room-1', userId: 'former-1', lastSeen: Date.now() },
        { roomId: 'room-1', userId: 'host-1', lastSeen: Date.now() },
      ],
      memberships: [
        { roomId: 'room-1', userId: 'former-1', role: 'Host' },
        { roomId: 'room-1', userId: 'host-1', role: 'Host' },
      ],
      orgMemberships: [{ orgId: 'workspace-1', userId: 'host-1', role: 'MEMBER' }],
    }, null);

    await expect((getBySlug as any)._handler(ctx, { slug: 'workshop' }))
      .resolves.toMatchObject({ activeHosts: 1, activeParticipants: 2 });
  });

  it('creates room with hashed password and never returns passwordHash', async () => {
    const rooms: RoomDoc[] = [];
    const ctx = makeCreateCtx(rooms);

    const result = await (create as any)._handler(ctx, {
      name: 'Engineering',
      slug: 'engineering',
      type: 'WORKSPACE',
      access: 'PASSWORD',
      password: 'SuperSecret123',
      maxParticipants: 50,
      activeParticipants: 0,
      locked: false,
      recording: false,
    });

    expect(result).toBeTruthy();
    expect(result.passwordHash).toBeUndefined();
    expect(rooms[0].passwordHash).toBeTruthy();
    expect(rooms[0].passwordHash).not.toBe('SuperSecret123');
  });

  it('rejects a password-protected room without a password, since nobody could ever join it', async () => {
    const rooms: RoomDoc[] = [];
    const ctx = makeCreateCtx(rooms);

    await expect((create as any)._handler(ctx, {
      name: 'Locked out',
      slug: 'locked-out',
      type: 'WORKSPACE',
      access: 'PASSWORD',
    })).rejects.toThrow(/password is required/i);
    expect(rooms).toHaveLength(0);
  });

  it('rejects duplicate room slug', async () => {
    const rooms: RoomDoc[] = [
      {
        _id: 'room-1',
        _creationTime: Date.now(),
        name: 'Existing',
        slug: 'existing-room',
        type: 'WORKSPACE',
        access: 'OPEN',
        activeParticipants: 0,
        activeHosts: 0,
        maxParticipants: 50,
        locked: false,
        recording: false,
        createdAt: '2026-02-13',
      },
    ];

    const ctx = makeCreateCtx(rooms);

    await expect((create as any)._handler(ctx, {
      name: 'Duplicate',
      slug: 'existing-room',
      type: 'WORKSPACE',
      access: 'OPEN',
    })).rejects.toThrow(/already exists/i);
  });

  it('reports global slug availability, including rooms outside the current workspace', async () => {
    const rooms: RoomDoc[] = [
      {
        _id: 'room-1',
        _creationTime: Date.now(),
        name: 'Public seed room',
        slug: 'meeting',
        type: 'WORKSPACE',
        access: 'OPEN',
        activeParticipants: 0,
        activeHosts: 0,
        maxParticipants: 50,
        locked: false,
        recording: false,
        createdAt: '2026-02-13',
      },
    ];
    const ctx = makeCreateCtx(rooms);

    await expect((isSlugAvailable as any)._handler(ctx, { slug: 'meeting' })).resolves.toBe(false);
    await expect((isSlugAvailable as any)._handler(ctx, { slug: 'new-room' })).resolves.toBe(true);
    await expect((isSlugAvailable as any)._handler(ctx, {
      slug: 'meeting',
      excludeRoomId: 'room-1',
    })).resolves.toBe(true);
  });

  it('queues automatic logo discovery when a partner website is present without a manual logo', async () => {
    const rooms: RoomDoc[] = [];
    const ctx = makeCreateCtx(rooms);

    const result = await (create as any)._handler(ctx, {
      name: 'Partner Room',
      slug: 'partner-room',
      type: 'WORKSPACE',
      access: 'OPEN',
      branding: {
        partnerWebsiteUrl: 'example.com',
      },
    });

    expect(result?.branding?.partnerWebsiteUrl).toBe('https://example.com/');
    expect(result?.branding?.logoFetchStatus).toBe('pending');
    expect(ctx.schedulerRunAfter).toHaveBeenCalledTimes(1);
  });

  it('requeues automatic logo discovery for existing rooms', async () => {
    const rooms: RoomDoc[] = [
      {
        _id: 'room-1',
        _creationTime: Date.now(),
        name: 'Partner Room',
        slug: 'partner-room',
        type: 'WORKSPACE',
        access: 'OPEN',
        activeParticipants: 0,
        activeHosts: 0,
        maxParticipants: 50,
        locked: false,
        recording: false,
        createdAt: '2026-02-13',
        branding: {
          partnerWebsiteUrl: 'https://example.com/',
          logoFetchStatus: 'failed',
          logoFetchError: 'No logo found',
        },
      },
    ];

    const ctx = makeCreateCtx(rooms);

    const result = await (requestLogoDiscovery as any)._handler(ctx, {
      roomId: 'room-1',
    });

    expect(result).toEqual({ queued: true });
    expect(rooms[0].branding?.logoFetchStatus).toBe('pending');
    expect(rooms[0].branding?.logoFetchError).toBeUndefined();
    expect(ctx.schedulerRunAfter).toHaveBeenCalledTimes(1);
  });

  it('updatePresence never allows negative counters', async () => {
    const rooms: RoomDoc[] = [
      {
        _id: 'room-1',
        _creationTime: Date.now(),
        name: 'Room',
        slug: 'room',
        type: 'WORKSPACE',
        access: 'OPEN',
        activeParticipants: 0,
        activeHosts: 0,
        maxParticipants: 50,
        locked: false,
        recording: false,
        createdAt: '2026-02-13',
      },
    ];

    const ctx = makeCreateCtx(rooms);

    await (updatePresence as any)._handler(ctx, {
      roomId: 'room-1',
      deltaParticipants: -1,
      deltaHosts: 0,
    });

    expect(rooms[0].activeParticipants).toBe(0);
    expect(rooms[0].activeHosts).toBe(0);
  });

  it('updatePresence only lets room managers move the host count', async () => {
    const rooms: RoomDoc[] = [
      {
        _id: 'room-1',
        _creationTime: Date.now(),
        name: 'Room',
        slug: 'room',
        type: 'WORKSPACE',
        access: 'OPEN',
        orgId: 'org-1',
        activeParticipants: 0,
        activeHosts: 0,
        maxParticipants: 50,
        locked: false,
        recording: false,
        createdAt: '2026-02-13',
      } as RoomDoc,
    ];
    const ctx: any = makeCreateCtx(rooms);
    ctx.auth = { getUserIdentity: async () => ({ subject: 'outsider' }) };

    await expect((updatePresence as any)._handler(ctx, {
      roomId: 'room-1',
      deltaParticipants: 1,
      deltaHosts: 1,
    })).rejects.toThrow();
    expect(rooms[0].activeHosts).toBe(0);
  });
});

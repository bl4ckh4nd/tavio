import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hashRoomAccessToken } from './lib/roomAccess';
import { heartbeat, leave, listForRoom, setHandRaised } from './presence';

type PresenceDoc = {
  _id: string;
  _creationTime: number;
  roomId: string;
  userId: string;
  userName: string;
  handRaised: boolean;
  lastSeen: number;
};

const GUEST_TOKEN = 'guest-token';

const makeGrant = async (identity: string, overrides: Record<string, unknown> = {}) => ({
  _id: `grant-${identity}`,
  roomId: 'room-1',
  identity,
  tokenHash: await hashRoomAccessToken(GUEST_TOKEN),
  expiresAt: Date.now() + 60_000,
  ...overrides,
});

const makeCtx = (
  presence: PresenceDoc[],
  identity: { subject: string } | null = null,
  options: { grants?: any[]; room?: any; memberships?: any[] } = {},
) => ({
  auth: {
    getUserIdentity: async () => identity,
  },
  db: {
    get: async (_id: string) => options.room ?? { _id: 'room-1', access: 'OPEN' },
    query: (table: string) => ({
      withIndex: (_index: string, cb: (q: any) => any) => {
        if (table === 'roomAccessGrants') {
          const hash = cb({ eq: (_field: string, value: any) => value });
          return { first: async () => (options.grants ?? []).find((g) => g.tokenHash === hash) ?? null };
        }
        if (table === 'orgMemberships' || table === 'memberships') {
          return { first: async () => null, collect: async () => options.memberships ?? [] };
        }
        const q = {
          eq: (_field: string, value: any) => ({
            eq: (_field2: string, value2: any) => ({ primary: value, secondary: value2 }),
            value,
          }),
        };
        const condition = cb(q);

        return {
          first: async () => {
            if (condition?.primary !== undefined && condition?.secondary !== undefined) {
              return (
                presence.find(
                  (p) => p.roomId === condition.primary && p.userId === condition.secondary,
                ) ?? null
              );
            }
            const val = condition?.value ?? condition?.primary;
            return presence.find((p) => p.roomId === val || p.userId === val) ?? null;
          },
          collect: async () => {
            const roomId = condition?.value ?? condition?.primary;
            return presence.filter((p) => p.roomId === roomId);
          },
        };
      },
    }),
    insert: async (_table: string, value: Omit<PresenceDoc, '_id' | '_creationTime'>) => {
      const _id = `presence-${presence.length + 1}`;
      presence.push({ _id, _creationTime: Date.now(), ...value });
      return _id;
    },
    delete: async (id: string) => {
      const idx = presence.findIndex((p) => p._id === id);
      if (idx >= 0) presence.splice(idx, 1);
    },
    patch: async (id: string, patch: any) => {
      const grant = (options.grants ?? []).find((g) => g._id === id);
      if (grant) Object.assign(grant, patch);
      const idx = presence.findIndex((p) => p._id === id);
      if (idx >= 0) presence[idx] = { ...presence[idx], ...patch };
    },
  },
});

describe('presence integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('heartbeat', () => {
    it('creates a new presence entry on first call', async () => {
      const presence: PresenceDoc[] = [];
      const ctx = makeCtx(presence, { subject: 'alice' });

      await (heartbeat as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
        userName: 'Alice',
      });

      expect(presence).toHaveLength(1);
      expect(presence[0].userId).toBe('alice');
      expect(presence[0].handRaised).toBe(false);
      expect(presence[0].lastSeen).toBeGreaterThan(0);
    });

    it('updates lastSeen on subsequent call without creating duplicate', async () => {
      const earlier = Date.now() - 10_000;
      const presence: PresenceDoc[] = [
        {
          _id: 'presence-1',
          _creationTime: earlier,
          roomId: 'room-1',
          userId: 'alice',
          userName: 'Alice',
          handRaised: false,
          lastSeen: earlier,
        },
      ];
      const ctx = makeCtx(presence, { subject: 'alice' });

      await (heartbeat as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
        userName: 'Alice',
      });

      expect(presence).toHaveLength(1);
      expect(presence[0].lastSeen).toBeGreaterThan(earlier);
    });

    it('throws if authenticated identity.subject does not match userId', async () => {
      const ctx = makeCtx([], { subject: 'user-A' });

      await expect(
        (heartbeat as any)._handler(ctx, {
          roomId: 'room-1',
          userId: 'user-B',
          userName: 'B',
        }),
      ).rejects.toThrow(/own presence/i);
    });

    it('lets a guest heartbeat only for the identity of their join grant', async () => {
      const presence: PresenceDoc[] = [];
      const ctx = makeCtx(presence, null, { grants: [await makeGrant('guest-xyz')] });

      await (heartbeat as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'guest-xyz',
        userName: 'Guest',
        accessToken: GUEST_TOKEN,
      });

      expect(presence).toHaveLength(1);
      expect(presence[0].userId).toBe('guest-xyz');

      await expect(
        (heartbeat as any)._handler(ctx, {
          roomId: 'room-1',
          userId: 'someone-else',
          userName: 'Spoof',
          accessToken: GUEST_TOKEN,
        }),
      ).rejects.toThrow(/valid room session/i);
    });

    it('rejects anonymous heartbeats without a grant, also in open rooms', async () => {
      const presence: PresenceDoc[] = [];

      await expect(
        (heartbeat as any)._handler(makeCtx(presence), {
          roomId: 'room-1',
          userId: 'guest-xyz',
          userName: 'Guest',
        }),
      ).rejects.toThrow(/join this room/i);
      expect(presence).toHaveLength(0);
    });

    it('rejects grants of another room and expired grants', async () => {
      for (const overrides of [{ roomId: 'room-2' }, { expiresAt: Date.now() - 1 }]) {
        const ctx = makeCtx([], null, { grants: [await makeGrant('guest-xyz', overrides)] });
        await expect(
          (heartbeat as any)._handler(ctx, {
            roomId: 'room-1',
            userId: 'guest-xyz',
            userName: 'Guest',
            accessToken: GUEST_TOKEN,
          }),
        ).rejects.toThrow(/join this room/i);
      }
    });

    it('renews a grant that is past half of its lifetime, and leaves a fresh one alone', async () => {
      const aging = await makeGrant('guest-xyz');
      const args = { roomId: 'room-1', userId: 'guest-xyz', userName: 'Guest', accessToken: GUEST_TOKEN };

      await (heartbeat as any)._handler(makeCtx([], null, { grants: [aging] }), args);
      expect(aging.expiresAt).toBeGreaterThan(Date.now() + 60 * 60 * 1000);

      const fresh = await makeGrant('guest-xyz', { expiresAt: Date.now() + 5 * 60 * 60 * 1000 });
      const before = fresh.expiresAt;
      await (heartbeat as any)._handler(makeCtx([], null, { grants: [fresh] }), args);
      expect(fresh.expiresAt).toBe(before);
    });

    it('requires the join grant in password rooms', async () => {
      const room = { _id: 'room-1', orgId: 'org-1', access: 'PASSWORD' };

      await expect(
        (heartbeat as any)._handler(makeCtx([], null, { room }), {
          roomId: 'room-1',
          userId: 'guest-xyz',
          userName: 'Guest',
        }),
      ).rejects.toThrow(/password/i);
    });
  });

  describe('leave', () => {
    const row = (): PresenceDoc => ({
      _id: 'presence-1',
      _creationTime: Date.now(),
      roomId: 'room-1',
      userId: 'victim',
      userName: 'Victim',
      handRaised: false,
      lastSeen: Date.now(),
    });

    it('does not let an anonymous caller delete someone else presence', async () => {
      const presence = [row()];
      const ctx = makeCtx(presence, null, { grants: [await makeGrant('attacker')] });

      await expect(
        (leave as any)._handler(ctx, { roomId: 'room-1', userId: 'victim', accessToken: GUEST_TOKEN }),
      ).rejects.toThrow(/valid room session/i);
      expect(presence).toHaveLength(1);
    });

    it('removes the presence of the grant holder', async () => {
      const presence = [row()];
      const ctx = makeCtx(presence, null, { grants: [await makeGrant('victim')] });

      await (leave as any)._handler(ctx, { roomId: 'room-1', userId: 'victim', accessToken: GUEST_TOKEN });

      expect(presence).toHaveLength(0);
    });
  });

  describe('setHandRaised', () => {
    it('creates presence with handRaised: true when no entry exists', async () => {
      const presence: PresenceDoc[] = [];
      const ctx = makeCtx(presence, { subject: 'alice' });

      await (setHandRaised as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
        userName: 'Alice',
        raised: true,
      });

      expect(presence).toHaveLength(1);
      expect(presence[0].handRaised).toBe(true);
    });

    it('updates handRaised on existing presence entry', async () => {
      const presence: PresenceDoc[] = [
        {
          _id: 'presence-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'alice',
          userName: 'Alice',
          handRaised: false,
          lastSeen: Date.now(),
        },
      ];
      const ctx = makeCtx(presence, { subject: 'alice' });

      await (setHandRaised as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
        userName: 'Alice',
        raised: true,
      });

      expect(presence).toHaveLength(1);
      expect(presence[0].handRaised).toBe(true);
    });

    it('throws if authenticated identity does not match userId', async () => {
      const ctx = makeCtx([], { subject: 'user-A' });

      await expect(
        (setHandRaised as any)._handler(ctx, {
          roomId: 'room-1',
          userId: 'user-B',
          userName: 'B',
          raised: true,
        }),
      ).rejects.toThrow(/own hand raise/i);
    });

    it('lets a guest raise only their own hand', async () => {
      const presence: PresenceDoc[] = [];
      const ctx = makeCtx(presence, null, { grants: [await makeGrant('guest-xyz')] });

      await (setHandRaised as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'guest-xyz',
        userName: 'Guest',
        raised: true,
        accessToken: GUEST_TOKEN,
      });
      expect(presence[0].handRaised).toBe(true);

      await expect(
        (setHandRaised as any)._handler(ctx, {
          roomId: 'room-1',
          userId: 'someone-else',
          userName: 'Spoof',
          raised: true,
          accessToken: GUEST_TOKEN,
        }),
      ).rejects.toThrow(/valid room session/i);
    });
  });

  describe('listForRoom', () => {
    it('returns only entries seen within the last 90 seconds', async () => {
      const now = Date.now();
      const presence: PresenceDoc[] = [
        {
          _id: 'presence-1',
          _creationTime: now,
          roomId: 'room-1',
          userId: 'active-user',
          userName: 'Active',
          handRaised: false,
          lastSeen: now - 60_000, // 1 min ago, two heartbeats missed at most
        },
        {
          _id: 'presence-2',
          _creationTime: now,
          roomId: 'room-1',
          userId: 'stale-user',
          userName: 'Stale',
          handRaised: false,
          lastSeen: now - 100_000, // past the cutoff
        },
      ];
      const ctx = makeCtx(presence, { subject: 'alice' });

      const result = await (listForRoom as any)._handler(ctx, { roomId: 'room-1' });

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('active-user');
    });

    it('returns empty array when all entries are stale', async () => {
      const now = Date.now();
      const presence: PresenceDoc[] = [
        {
          _id: 'presence-1',
          _creationTime: now,
          roomId: 'room-1',
          userId: 'old-user',
          userName: 'Old',
          handRaised: false,
          lastSeen: now - 600_000, // 10 min ago
        },
      ];
      const ctx = makeCtx(presence, { subject: 'alice' });

      const result = await (listForRoom as any)._handler(ctx, { roomId: 'room-1' });

      expect(result).toHaveLength(0);
    });

    it('returns mapped shape without internal fields', async () => {
      const now = Date.now();
      const presence: PresenceDoc[] = [
        {
          _id: 'presence-1',
          _creationTime: now,
          roomId: 'room-1',
          userId: 'alice',
          userName: 'Alice',
          handRaised: true,
          lastSeen: now,
        },
      ];
      const ctx = makeCtx(presence, { subject: 'alice' });

      const result = await (listForRoom as any)._handler(ctx, { roomId: 'room-1' });

      expect(result[0]).toEqual({
        userId: 'alice',
        userName: 'Alice',
        handRaised: true,
        lastSeen: now,
      });
      expect(result[0]._id).toBeUndefined();
      expect(result[0]._creationTime).toBeUndefined();
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { add, ensureHostForFirstMemberAtomic, getForRoom, listForRoom, remove } from './memberships';

type MembershipDoc = {
  _id: string;
  _creationTime: number;
  roomId: string;
  userId: string;
  role: string;
  orgId?: string;
  createdAt: number;
};

type RoomDoc = {
  _id: string;
  orgId?: string;
};

type OrgMembershipDoc = {
  _id: string;
  userId: string;
  orgId: string;
  role: string;
};

const makeCtx = (
  memberships: MembershipDoc[],
  rooms: RoomDoc[],
  orgMemberships: OrgMembershipDoc[],
  identity: { subject: string } | null = { subject: 'caller-1' },
) => ({
  auth: {
    getUserIdentity: async () => identity,
  },
  db: {
    query: (table: string) => ({
      withIndex: (_index: string, cb: (q: any) => any) => {
        const q = {
          eq: (_field: string, value: any) => {
            return {
              eq: (_field2: string, value2: any) => ({ primary: value, secondary: value2 }),
              value,
            };
          },
          value: undefined as any,
        };
        const condition = cb(q);

        return {
          first: async () => {
            if (table === 'memberships') {
              if (condition?.primary !== undefined && condition?.secondary !== undefined) {
                return (
                  memberships.find(
                    (m) => m.roomId === condition.primary && m.userId === condition.secondary,
                  ) ?? null
                );
              }
              // by_room_user with only roomId — any membership for the room
              if (condition?.value !== undefined) {
                return memberships.find((m) => m.roomId === condition.value) ?? null;
              }
              return null;
            }
            if (table === 'orgMemberships') {
              const userId = condition?.value ?? condition?.primary;
              return orgMemberships.find((m) => m.userId === userId) ?? null;
            }
            return null;
          },
          collect: async () => {
            if (table === 'memberships') {
              const roomId = condition?.value ?? condition?.primary;
              return memberships.filter((m) => m.roomId === roomId);
            }
            if (table === 'orgMemberships') {
              const userId = condition?.value ?? condition?.primary;
              return orgMemberships.filter((m) => m.userId === userId);
            }
            return [];
          },
        };
      },
    }),
    get: async (id: string) => {
      return (
        (memberships.find((m) => m._id === id) as any) ??
        (rooms.find((r) => r._id === id) as any) ??
        null
      );
    },
    insert: async (table: string, value: any) => {
      if (table === 'memberships') {
        const _id = `membership-${memberships.length + 1}`;
        memberships.push({ _id, _creationTime: Date.now(), ...value });
        return _id;
      }
      return `generic-id`;
    },
    patch: async (id: string, patch: Partial<MembershipDoc>) => {
      const idx = memberships.findIndex((m) => m._id === id);
      if (idx >= 0) memberships[idx] = { ...memberships[idx], ...patch };
    },
    delete: async (id: string) => {
      const idx = memberships.findIndex((m) => m._id === id);
      if (idx >= 0) memberships.splice(idx, 1);
    },
  },
});

describe('memberships integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureHostForFirstMemberAtomic', () => {
    it('assigns Host role to first member joining empty room', async () => {
      const memberships: MembershipDoc[] = [];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'alice' });

      await (ensureHostForFirstMemberAtomic as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
      });

      expect(memberships).toHaveLength(1);
      expect(memberships[0].role).toBe('Host');
    });

    it('assigns Participant role to second member joining', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'alice',
          role: 'Host',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'bob' });

      await (ensureHostForFirstMemberAtomic as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'bob',
      });

      expect(memberships).toHaveLength(2);
      expect(memberships[1].role).toBe('Participant');
    });

    it('returns existing membership if user already has one', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'alice',
          role: 'Host',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'alice' });

      const result = await (ensureHostForFirstMemberAtomic as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
      });

      expect(memberships).toHaveLength(1);
      expect(result._id).toBe('membership-1');
    });

    it('throws if room does not exist', async () => {
      const ctx = makeCtx([], [], [], { subject: 'alice' });

      await expect(
        (ensureHostForFirstMemberAtomic as any)._handler(ctx, {
          roomId: 'nonexistent',
          userId: 'alice',
        }),
      ).rejects.toThrow(/room not found/i);
    });
  });

  describe('add', () => {
    it('inserts new membership when user is room host', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'caller-1',
          role: 'Host',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'caller-1' });

      await (add as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'new-user',
        role: 'Participant',
      });

      const newMembership = memberships.find((m) => m.userId === 'new-user');
      expect(newMembership).toBeTruthy();
      expect(newMembership?.role).toBe('Participant');
    });

    it('updates role when membership already exists', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'caller-1',
          role: 'Host',
          createdAt: Date.now(),
        },
        {
          _id: 'membership-2',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'existing-user',
          role: 'Participant',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'caller-1' });

      await (add as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'existing-user',
        role: 'Admin',
      });

      expect(memberships.find((m) => m.userId === 'existing-user')?.role).toBe('Admin');
      // Should not insert a duplicate
      expect(memberships.filter((m) => m.userId === 'existing-user')).toHaveLength(1);
    });

    it('allows org admin to add members even without room membership', async () => {
      const memberships: MembershipDoc[] = [];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const orgMemberships: OrgMembershipDoc[] = [
        { _id: 'om-1', userId: 'caller-1', orgId: 'org-1', role: 'OWNER' },
      ];
      const ctx = makeCtx(memberships, rooms, orgMemberships, { subject: 'caller-1' });

      await (add as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'someone',
        role: 'Participant',
      });

      expect(memberships).toHaveLength(1);
    });

    it('throws if caller is neither org admin nor room host/admin', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'caller-1',
          role: 'Participant',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'caller-1' });

      await expect(
        (add as any)._handler(ctx, { roomId: 'room-1', userId: 'new-user', role: 'Participant' }),
      ).rejects.toThrow(/not allowed/i);
    });

    it('throws when unauthenticated', async () => {
      const rooms: RoomDoc[] = [{ _id: 'room-1' }];
      const ctx = makeCtx([], rooms, [], null);

      await expect(
        (add as any)._handler(ctx, { roomId: 'room-1', userId: 'someone', role: 'Participant' }),
      ).rejects.toThrow(/signed in/i);
    });
  });

  describe('remove', () => {
    it('removes membership when caller is room host', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'caller-1',
          role: 'Host',
          createdAt: Date.now(),
        },
        {
          _id: 'membership-2',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'target-user',
          role: 'Participant',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'caller-1' });

      await (remove as any)._handler(ctx, { id: 'membership-2' });

      expect(memberships).toHaveLength(1);
      expect(memberships[0].userId).toBe('caller-1');
    });

    it('throws if caller is a Participant trying to remove someone', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'caller-1',
          role: 'Participant',
          createdAt: Date.now(),
        },
        {
          _id: 'membership-2',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'target-user',
          role: 'Participant',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1', orgId: 'org-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'caller-1' });

      await expect((remove as any)._handler(ctx, { id: 'membership-2' })).rejects.toThrow(
        /not allowed/i,
      );
    });
  });

  describe('listForRoom', () => {
    it('returns all memberships for the given room', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'alice',
          role: 'Host',
          createdAt: Date.now(),
        },
        {
          _id: 'membership-2',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'bob',
          role: 'Participant',
          createdAt: Date.now(),
        },
        {
          _id: 'membership-3',
          _creationTime: Date.now(),
          roomId: 'room-2',
          userId: 'carol',
          role: 'Host',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'alice' });

      const result = await (listForRoom as any)._handler(ctx, { roomId: 'room-1' });

      expect(result).toHaveLength(2);
      expect(result.map((m: any) => m.userId)).toEqual(expect.arrayContaining(['alice', 'bob']));
    });
  });

  describe('getForRoom', () => {
    it('returns membership for user in room', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'alice',
          role: 'Host',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'alice' });

      const result = await (getForRoom as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'alice',
      });

      expect(result).toBeTruthy();
      expect(result.role).toBe('Host');
    });

    it('returns null when user is not a member', async () => {
      const memberships: MembershipDoc[] = [
        {
          _id: 'membership-1',
          _creationTime: Date.now(),
          roomId: 'room-1',
          userId: 'alice',
          role: 'Host',
          createdAt: Date.now(),
        },
      ];
      const rooms: RoomDoc[] = [{ _id: 'room-1' }];
      const ctx = makeCtx(memberships, rooms, [], { subject: 'alice' });

      const result = await (getForRoom as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'nonexistent',
      });

      expect(result).toBeNull();
    });
  });
});

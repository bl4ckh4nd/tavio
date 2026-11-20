import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./organizations', () => ({
  ensureDefaultOrgForUser: vi.fn(async () => null),
}));

vi.mock('./auth', () => ({
  authComponent: {
    getAuthUser: vi.fn(async () => null),
  },
}));

import { authComponent } from './auth';
import { ensureCurrentUser, ensureForIdentity, invite, list, me, remove, updateMe, updateRole } from './users';

type UserDoc = {
  _id: string;
  _creationTime: number;
  externalId: string;
  name: string;
  role: string;
  email?: string;
  avatarUrl?: string;
};

const makeCtx = (
  users: UserDoc[],
  identity: { subject: string } | null = { subject: 'user-1' },
) => ({
  auth: {
    getUserIdentity: async () => identity,
  },
  db: {
    query: (table: string) => ({
      withIndex: (_index: string, cb: (q: any) => any) => {
        const condition = cb({ eq: (_field: string, value: string) => ({ value }) });
        return {
          first: async () => {
            if (table === 'users') return users.find((u) => u.externalId === condition.value || u._id === condition.value) ?? null;
            return null;
          },
          collect: async () => {
            if (table === 'users') return [...users];
            return [];
          },
          filter: () => ({ first: async () => null, collect: async () => [] }),
        };
      },
      collect: async () => (table === 'users' ? [...users] : []),
      filter: () => ({ first: async () => null, collect: async () => [] }),
    }),
    get: async (id: string) => users.find((u) => u._id === id) ?? null,
    insert: async (_table: string, value: Omit<UserDoc, '_id' | '_creationTime'>) => {
      const _id = `user-${users.length + 1}`;
      users.push({ _id, _creationTime: Date.now(), ...value } as UserDoc);
      return _id;
    },
    patch: async (id: string, patch: Partial<UserDoc>) => {
      const idx = users.findIndex((u) => u._id === id);
      if (idx >= 0) users[idx] = { ...users[idx], ...patch };
    },
    delete: async (id: string) => {
      const idx = users.findIndex((u) => u._id === id);
      if (idx >= 0) users.splice(idx, 1);
    },
  },
});

describe('users integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureCurrentUser', () => {
    it('creates a new user from auth identity when none exists', async () => {
      const users: UserDoc[] = [];
      vi.mocked(authComponent.getAuthUser).mockResolvedValueOnce({
        name: 'Alice',
        email: 'alice@example.com',
        image: null,
      } as any);
      const ctx = makeCtx(users, { subject: 'ext-alice' });

      const result = await (ensureCurrentUser as any)._handler(ctx, {});

      expect(result).toBeTruthy();
      expect(users).toHaveLength(1);
      expect(users[0].externalId).toBe('ext-alice');
      expect(users[0].name).toBe('Alice');
      expect(users[0].email).toBe('alice@example.com');
    });

    it('returns null when unauthenticated', async () => {
      const ctx = makeCtx([], null);
      const result = await (ensureCurrentUser as any)._handler(ctx, {});
      expect(result).toBeNull();
    });

    it('updates name/email if changed for existing user', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'ext-alice',
          name: 'Old Name',
          email: 'old@example.com',
          role: 'Participant',
        },
      ];
      vi.mocked(authComponent.getAuthUser).mockResolvedValueOnce({
        name: 'New Name',
        email: 'new@example.com',
        image: null,
      } as any);
      const ctx = makeCtx(users, { subject: 'ext-alice' });

      const result = await (ensureCurrentUser as any)._handler(ctx, {});

      expect(result).toBeTruthy();
      expect(users[0].name).toBe('New Name');
      expect(users[0].email).toBe('new@example.com');
    });
  });

  describe('ensureForIdentity', () => {
    it('creates user with "Anonymous" name if no name provided', async () => {
      const users: UserDoc[] = [];
      const ctx = makeCtx(users, null);

      await (ensureForIdentity as any)._handler(ctx, { externalId: 'guest-xyz' });

      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Anonymous');
      expect(users[0].externalId).toBe('guest-xyz');
    });

    it('returns existing user and updates name if provided', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'guest-abc',
          name: 'Old Guest',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, null);

      await (ensureForIdentity as any)._handler(ctx, {
        externalId: 'guest-abc',
        name: 'New Guest',
      });

      expect(users[0].name).toBe('New Guest');
    });
  });

  describe('me', () => {
    it('returns current user when authenticated', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Test',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      const result = await (me as any)._handler(ctx, {});

      expect(result).toBeTruthy();
      expect(result.name).toBe('Test');
    });

    it('returns null when unauthenticated', async () => {
      const ctx = makeCtx([], null);
      const result = await (me as any)._handler(ctx, {});
      expect(result).toBeNull();
    });
  });

  describe('updateMe', () => {
    it('trims whitespace from name before saving', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Old',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await (updateMe as any)._handler(ctx, { name: '  New Name  ' });

      expect(users[0].name).toBe('New Name');
    });

    it('keeps existing name when blank string is provided', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Existing',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await (updateMe as any)._handler(ctx, { name: '   ' });

      expect(users[0].name).toBe('Existing');
    });

    it('throws when unauthenticated', async () => {
      const ctx = makeCtx([], null);
      await expect((updateMe as any)._handler(ctx, { name: 'Alice' })).rejects.toThrow(
        /signed in/i,
      );
    });
  });

  describe('list', () => {
    it('throws if caller is not Admin', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Regular',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await expect((list as any)._handler(ctx, {})).rejects.toThrow(/admin/i);
    });

    it('returns all users when caller is Admin', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Admin User',
          role: 'Admin',
        },
        {
          _id: 'user-2',
          _creationTime: Date.now(),
          externalId: 'user-2',
          name: 'Other',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      const result = await (list as any)._handler(ctx, {});

      expect(result).toHaveLength(2);
    });

    it('throws when unauthenticated', async () => {
      const ctx = makeCtx([], null);
      await expect((list as any)._handler(ctx, {})).rejects.toThrow(/signed in/i);
    });
  });

  describe('invite', () => {
    it('throws if caller is not Admin', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Regular',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await expect(
        (invite as any)._handler(ctx, { email: 'new@example.com' }),
      ).rejects.toThrow(/admin/i);
    });

    it('creates a new user record for the invited email', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Admin',
          role: 'Admin',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await (invite as any)._handler(ctx, { email: 'newperson@example.com', name: 'New Person' });

      const invited = users.find((u) => u.externalId === 'newperson@example.com');
      expect(invited).toBeTruthy();
      expect(invited?.name).toBe('New Person');
    });
  });

  describe('remove', () => {
    it('deletes user when called by Admin', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Admin',
          role: 'Admin',
        },
        {
          _id: 'user-2',
          _creationTime: Date.now(),
          externalId: 'user-2',
          name: 'Target',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await (remove as any)._handler(ctx, { id: 'user-2' });

      expect(users).toHaveLength(1);
      expect(users[0]._id).toBe('user-1');
    });

    it('throws if caller is not Admin', async () => {
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'user-1',
          name: 'Regular',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(users, { subject: 'user-1' });

      await expect((remove as any)._handler(ctx, { id: 'user-1' })).rejects.toThrow(/admin/i);
    });
  });
});

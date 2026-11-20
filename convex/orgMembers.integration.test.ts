import { beforeEach, describe, expect, it, vi } from 'vitest';

// orgMembers.ts imports api from _generated but only uses it for type inference
vi.mock('./_generated/api', () => ({ api: {} }));

import { invite, list, remove, updateRole } from './orgMembers';

type OrgMembershipDoc = {
  _id: string;
  _creationTime: number;
  orgId: string;
  userId: string;
  role: string;
  createdAt: number;
};

type UserDoc = {
  _id: string;
  _creationTime: number;
  externalId: string;
  name: string;
  email?: string;
  role: string;
  avatarUrl?: string;
};

const makeCtx = (
  orgMemberships: OrgMembershipDoc[],
  users: UserDoc[],
  identity: { subject: string } | null = { subject: 'caller-1' },
) => ({
  auth: {
    getUserIdentity: async () => identity,
  },
  db: {
    query: (table: string) => ({
      withIndex: (_index: string, cb: (q: any) => any) => {
        const q = {
          eq: (_field: string, value: any) => ({ value }),
        };
        const condition = cb(q);
        const filterVal = condition?.value;

        return {
          first: async () => {
            if (table === 'orgMemberships') {
              return orgMemberships.find((m) => m.userId === filterVal || m.orgId === filterVal) ?? null;
            }
            if (table === 'users') {
              return users.find((u) => u.externalId === filterVal) ?? null;
            }
            return null;
          },
          collect: async () => {
            if (table === 'orgMemberships') {
              return orgMemberships.filter((m) => m.orgId === filterVal || m.userId === filterVal);
            }
            return [];
          },
          filter: (filterFn: (q: any) => any) => {
            // Resolve what field/value the filter is checking via q.field() + q.eq()
            let filterField: string | null = null;
            let filterValue: any = null;
            filterFn({
              field: (f: string) => ({ __field: f }),
              eq: (ref: any, val: any) => {
                if (ref?.__field) { filterField = ref.__field; filterValue = val; }
                return true;
              },
            });

            const applyFilter = (rows: OrgMembershipDoc[]) => {
              const base = rows.filter((m) => !filterVal || m.orgId === filterVal);
              if (filterField && filterValue !== null) {
                return base.filter((m: any) => m[filterField!] === filterValue);
              }
              return base;
            };

            return {
              first: async () => applyFilter(orgMemberships)[0] ?? null,
              collect: async () => applyFilter(orgMemberships),
            };
          },
        };
      },
    }),
    get: async (id: string) => {
      return (
        (orgMemberships.find((m) => m._id === id) as any) ??
        (users.find((u) => u._id === id) as any) ??
        null
      );
    },
    insert: async (table: string, value: any) => {
      if (table === 'orgMemberships') {
        const _id = `om-${orgMemberships.length + 1}`;
        orgMemberships.push({ _id, _creationTime: Date.now(), ...value });
        return _id;
      }
      if (table === 'users') {
        const _id = `user-${users.length + 1}`;
        users.push({ _id, _creationTime: Date.now(), ...value });
        return _id;
      }
      return 'generic-id';
    },
    patch: async (id: string, patch: any) => {
      const omIdx = orgMemberships.findIndex((m) => m._id === id);
      if (omIdx >= 0) {
        orgMemberships[omIdx] = { ...orgMemberships[omIdx], ...patch };
        return;
      }
      const uIdx = users.findIndex((u) => u._id === id);
      if (uIdx >= 0) {
        users[uIdx] = { ...users[uIdx], ...patch };
      }
    },
    delete: async (id: string) => {
      const idx = orgMemberships.findIndex((m) => m._id === id);
      if (idx >= 0) orgMemberships.splice(idx, 1);
    },
  },
});

describe('orgMembers integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('returns empty array when caller is not in any org', async () => {
      const ctx = makeCtx([], [], null);
      const result = await (list as any)._handler(ctx, {});
      expect(result).toEqual([]);
    });

    it('returns empty array when unauthenticated', async () => {
      const ctx = makeCtx([], [], null);
      const result = await (list as any)._handler(ctx, {});
      expect(result).toEqual([]);
    });

    it('returns enriched member list with name and email from users table', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
        {
          _id: 'om-2',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'member@example.com',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const users: UserDoc[] = [
        {
          _id: 'user-1',
          _creationTime: Date.now(),
          externalId: 'caller-1',
          name: 'Owner User',
          email: 'owner@example.com',
          role: 'Admin',
        },
        {
          _id: 'user-2',
          _creationTime: Date.now(),
          externalId: 'member@example.com',
          name: 'Member User',
          email: 'member@example.com',
          role: 'Participant',
        },
      ];
      const ctx = makeCtx(orgMemberships, users, { subject: 'caller-1' });

      const result = await (list as any)._handler(ctx, {});

      expect(result.length).toBeGreaterThan(0);
      const owner = result.find((m: any) => m.userId === 'caller-1');
      expect(owner?.name).toBe('Owner User');
    });
  });

  describe('invite', () => {
    it('throws if caller is not org admin', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await expect(
        (invite as any)._handler(ctx, { email: 'new@example.com' }),
      ).rejects.toThrow(/admin/i);
    });

    it('throws when unauthenticated', async () => {
      const ctx = makeCtx([], [], null);

      await expect(
        (invite as any)._handler(ctx, { email: 'new@example.com' }),
      ).rejects.toThrow(/member of any organization/i);
    });

    it('normalizes email to lowercase and trimmed', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
      ];
      const users: UserDoc[] = [];
      const ctx = makeCtx(orgMemberships, users, { subject: 'caller-1' });

      await (invite as any)._handler(ctx, { email: '  UPPER@Example.COM  ' });

      const created = users.find((u) => u.externalId === 'upper@example.com');
      expect(created).toBeTruthy();
    });

    it('creates a new user when email does not exist', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
      ];
      const users: UserDoc[] = [];
      const ctx = makeCtx(orgMemberships, users, { subject: 'caller-1' });

      await (invite as any)._handler(ctx, { email: 'new@example.com', name: 'New Person' });

      expect(users.find((u) => u.externalId === 'new@example.com')).toBeTruthy();
    });

    it('creates org membership with default MEMBER role', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
      ];
      const users: UserDoc[] = [];
      const ctx = makeCtx(orgMemberships, users, { subject: 'caller-1' });

      await (invite as any)._handler(ctx, { email: 'new@example.com' });

      const newMembership = orgMemberships.find((m) => m.userId === 'new@example.com');
      expect(newMembership?.role).toBe('MEMBER');
    });
  });

  describe('updateRole', () => {
    it('updates membership role when called by org admin', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
        {
          _id: 'om-2',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'target-user',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await (updateRole as any)._handler(ctx, { membershipId: 'om-2', role: 'ADMIN' });

      expect(orgMemberships.find((m) => m._id === 'om-2')?.role).toBe('ADMIN');
    });

    it('throws if caller is not org admin', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await expect(
        (updateRole as any)._handler(ctx, { membershipId: 'om-1', role: 'ADMIN' }),
      ).rejects.toThrow(/admin/i);
    });

    it('rejects changing a membership from another organization', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
        {
          _id: 'om-2',
          _creationTime: Date.now(),
          orgId: 'org-2',
          userId: 'target-user',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await expect(
        (updateRole as any)._handler(ctx, { membershipId: 'om-2', role: 'ADMIN' }),
      ).rejects.toThrow(/outside your organization/i);
    });
  });

  describe('remove', () => {
    it('removes org membership when called by org admin', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
        {
          _id: 'om-2',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'target-member',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await (remove as any)._handler(ctx, { membershipId: 'om-2' });

      expect(orgMemberships).toHaveLength(1);
      expect(orgMemberships[0]._id).toBe('om-1');
    });

    it('throws if caller is not org admin', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await expect((remove as any)._handler(ctx, { membershipId: 'om-1' })).rejects.toThrow(
        /admin/i,
      );
    });

    it('rejects removing a membership from another organization', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
        {
          _id: 'om-2',
          _creationTime: Date.now(),
          orgId: 'org-2',
          userId: 'target-user',
          role: 'MEMBER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await expect((remove as any)._handler(ctx, { membershipId: 'om-2' })).rejects.toThrow(
        /outside your organization/i,
      );
    });

    it('prevents removing the last OWNER', async () => {
      const orgMemberships: OrgMembershipDoc[] = [
        {
          _id: 'om-1',
          _creationTime: Date.now(),
          orgId: 'org-1',
          userId: 'caller-1',
          role: 'OWNER',
          createdAt: Date.now(),
        },
      ];
      const ctx = makeCtx(orgMemberships, [], { subject: 'caller-1' });

      await expect((remove as any)._handler(ctx, { membershipId: 'om-1' })).rejects.toThrow(
        /owner must remain/i,
      );
    });
  });
});

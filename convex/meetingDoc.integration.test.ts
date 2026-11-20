import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rateLimitSpy } = vi.hoisted(() => ({
  rateLimitSpy: vi.fn(async () => {}),
}));

vi.mock('./lib/rateLimit', () => ({
  checkMeetingDocRateLimit: rateLimitSpy,
}));

import { get, save, setLocked } from './meetingDoc';

type RoomDoc = { _id: string; orgId?: string; access?: string };
type MeetingDocRow = { _id: string; roomId: string; contentHtml: string; locked: boolean };

const createCtx = (opts?: {
  rooms?: RoomDoc[];
  docs?: MeetingDocRow[];
  identity?: { subject: string } | null;
  orgMemberships?: Array<{ orgId: string; userId: string }>;
  roomRole?: string;
}) => {
  const rooms = opts?.rooms ?? [{ _id: 'room-1' }];
  const docs = opts?.docs ?? [];
  const orgMemberships = opts?.orgMemberships ?? [];

  const db = {
    get: async (id: string) => rooms.find((r) => r._id === id) ?? docs.find((d) => d._id === id) ?? null,
    query: (table: string) => ({
      withIndex: (_index: string, cb: (q: any) => any) => {
        const condition = cb({ eq: (field: string, value: string) => ({ field, value, eq: () => ({ field, value }), gte() { return this } }) });
        return {
          first: async () => {
            if (table === 'meetingDocs') {
              return docs.find((d) => d.roomId === condition.value) ?? null;
            }
            if (table === 'memberships' && opts?.roomRole) {
              return { role: opts.roomRole };
            }
            return null;
          },
          collect: async () => {
            if (table === 'orgMemberships') {
              return orgMemberships.filter((m) => m.userId === condition.value);
            }
            return [];
          },
        };
      },
    }),
    patch: async (id: string, patch: Partial<MeetingDocRow>) => {
      const idx = docs.findIndex((d) => d._id === id);
      if (idx >= 0) docs[idx] = { ...docs[idx], ...patch };
    },
    insert: async (_table: string, value: Omit<MeetingDocRow, '_id'>) => {
      const id = `doc-${docs.length + 1}`;
      docs.push({ _id: id, ...value });
      return id;
    },
  };

  return {
    auth: { getUserIdentity: async () => (opts?.identity === undefined ? { subject: 'member-1' } : opts.identity) },
    db,
    docs,
  };
};

describe('meetingDoc integration', () => {
  beforeEach(() => {
    rateLimitSpy.mockClear();
  });

  it('get returns default content when no room doc exists', async () => {
    const ctx = createCtx({ docs: [] });

    const result = await (get as any)._handler(ctx, { roomId: 'room-1' });

    expect(result.locked).toBe(false);
    expect(result.contentHtml).toContain('Meeting Notes');
  });

  it('save sanitizes unsafe html before persistence', async () => {
    const ctx = createCtx({ docs: [] });

    const result = await (save as any)._handler(ctx, {
      roomId: 'room-1',
      contentHtml: '<p>safe</p><script>alert(1)</script><a href="javascript:bad">x</a>',
    });

    expect(rateLimitSpy).toHaveBeenCalledTimes(1);
    expect(result.contentHtml).toContain('<p>safe</p>');
    expect(result.contentHtml).not.toContain('<script>');
    expect(result.contentHtml).not.toContain('javascript:');
  });

  it('save rejects oversized content', async () => {
    const ctx = createCtx({ docs: [] });

    await expect(
      (save as any)._handler(ctx, {
        roomId: 'room-1',
        contentHtml: 'x'.repeat(500001),
      })
    ).rejects.toThrow(/maximum length/i);
  });

  it('save updates existing room doc instead of inserting a new one', async () => {
    const ctx = createCtx({
      docs: [{ _id: 'doc-1', roomId: 'room-1', contentHtml: '<p>old</p>', locked: true }],
      roomRole: 'Host',
    });

    const result = await (save as any)._handler(ctx, {
      roomId: 'room-1',
      contentHtml: '<p>new</p>',
    });

    expect(ctx.docs).toHaveLength(1);
    expect(ctx.docs[0].contentHtml).toContain('<p>new</p>');
    expect(result.locked).toBe(true);
  });

  it('does not overwrite notes saved by another editor after the draft was opened', async () => {
    const ctx = createCtx();
    const initial = { roomId: 'room-1', accessToken: undefined };
    await (save as any)._handler(ctx, {
      ...initial, contentHtml: '<p>First editor saved this</p>',
      edit: { base: null, revision: 'first-edit' },
    });
    await expect((save as any)._handler(ctx, {
      ...initial, contentHtml: '<p>Second editor did not see it</p>',
      edit: { base: null, revision: 'stale-edit' },
    })).rejects.toThrow('NOTES_CONFLICT');
    expect(ctx.docs[0].contentHtml).toBe('<p>First editor saved this</p>');
  });

  it('setLocked creates doc when missing and applies lock state', async () => {
    const ctx = createCtx({ docs: [], roomRole: 'Host' });

    const result = await (setLocked as any)._handler(ctx, { roomId: 'room-1', locked: true });

    expect(ctx.docs).toHaveLength(1);
    expect(result.locked).toBe(true);
    expect(result.contentHtml).toContain('Meeting Notes');
  });
});

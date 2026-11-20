import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rateLimitSpy, uploadLimitSpy } = vi.hoisted(() => ({
  rateLimitSpy: vi.fn(async (_ctx: any, _key: string, _roomId: string) => {}),
  uploadLimitSpy: vi.fn(async (_ctx: any, _key: string) => {}),
}));

vi.mock('./lib/rateLimit', () => ({
  checkChatRateLimit: rateLimitSpy,
  checkChatUploadRateLimit: uploadLimitSpy,
}));

import { cleanupOrphanUploads, list, prepareUpload, recordUpload, send, toggleReaction } from './chat';
import { hashRoomAccessToken } from './lib/roomAccess';
import { CHAT_UPLOAD_MAX_BYTES, isAllowedGifUrl, isReactionEmoji, sniffImageType } from './lib/chatMedia';

// An in-memory stand-in for ctx.db: rows live per table, ids are unique across tables,
// and withIndex filters on every field the index callback names.
const createCtx = (opts?: { room?: any; rows?: any[]; grants?: any[]; identity?: any; files?: any[] }) => {
  const tables: Record<string, any[]> = {
    rooms: [opts?.room ?? { _id: 'room-1' }],
    chatMessages: opts?.rows ?? [],
    roomAccessGrants: opts?.grants ?? [],
    chatUploads: [],
    chatReactions: [],
    memberships: [],
    orgMemberships: [],
  };
  const files: any[] = opts?.files ?? [];
  const deletedFiles: string[] = [];
  let nextId = 1;

  const query = (table: string) => {
    const rowsOf = () => (tables[table] ??= []);
    const chain = (rows: any[]) => ({
      order: (direction: 'asc' | 'desc') => chain(direction === 'desc' ? [...rows].reverse() : rows),
      take: async (n: number) => rows.slice(0, n),
      collect: async () => rows,
      first: async () => rows[0] ?? null,
      unique: async () => rows[0] ?? null,
    });
    return {
      withIndex: (_index: string, cb?: (q: any) => any) => {
        const conditions: Array<[string, unknown]> = [];
        const q: any = {
          eq: (field: string, value: unknown) => { conditions.push([field, value]); return q; },
          lt: (field: string, value: any) => { conditions.push([field, (v: any) => v < value]); return q; },
        };
        cb?.(q);
        return chain(rowsOf().filter((row) => conditions.every(([field, value]) =>
          typeof value === 'function' ? (value as any)(row[field]) : row[field] === value)));
      },
      ...chain(rowsOf()),
    };
  };

  const findRow = (id: string) => {
    for (const rows of Object.values(tables)) {
      const row = rows.find((r) => r._id === id);
      if (row) return { row, rows };
    }
    return null;
  };

  return {
    auth: { getUserIdentity: async () => (opts?.identity === undefined ? { subject: 'member-1' } : opts.identity) },
    db: {
      get: async (id: string) => findRow(id)?.row ?? null,
      query,
      insert: async (table: string, value: any) => {
        const _id = `${table}-${nextId++}`;
        (tables[table] ??= []).push({ _id, _creationTime: Date.now(), ...value });
        return _id;
      },
      patch: async (id: string, value: any) => {
        const found = findRow(id);
        if (found) Object.assign(found.row, value);
      },
      delete: async (id: string) => {
        const found = findRow(id);
        if (found) found.rows.splice(found.rows.indexOf(found.row), 1);
      },
      system: { get: async (id: string) => files.find((f) => f._id === id) ?? null },
    },
    storage: {
      getUrl: async (id: string) => `https://files.example/${id}`,
      delete: async (id: string) => { deletedFiles.push(id); },
    },
    tables,
    rows: tables.chatMessages,
    deletedFiles,
  };
};

const grantFor = async (identity: string, token = 'token', roomId = 'room-1') => ({
  roomId,
  identity,
  tokenHash: await hashRoomAccessToken(token),
  expiresAt: Date.now() + 60_000,
});

describe('chat integration', () => {
  beforeEach(() => {
    rateLimitSpy.mockClear();
    uploadLimitSpy.mockClear();
  });

  it('send rejects empty/whitespace chat messages', async () => {
    const ctx = createCtx();

    await expect(
      (send as any)._handler(ctx, {
        roomId: 'room-1',
        userId: 'u-1',
        userName: 'Jane',
        text: '   ',
      })
    ).rejects.toThrow(/cannot be empty/i);
  });

  it('send sanitizes username and message text before insert', async () => {
    const ctx = createCtx();

    await (send as any)._handler(ctx, {
      roomId: 'room-1',
      userId: 'u-1',
      userName: '<b>Jane</b>',
      text: '<img src=x onerror=alert(1)>hello',
    });

    expect(rateLimitSpy).toHaveBeenCalledTimes(1);
    expect(ctx.rows).toHaveLength(1);
    expect(ctx.rows[0].userName).toBe('&lt;b&gt;Jane&lt;/b&gt;');
    expect(ctx.rows[0].text).toContain('&lt;img');
  });

  it('keeps anonymous visitors out of open rooms until they joined', async () => {
    const ctx = createCtx({ room: { _id: 'room-1', orgId: 'org-1', access: 'OPEN' }, identity: null });

    await expect((list as any)._handler(ctx, { roomId: 'room-1' })).rejects.toThrow(/join this room/i);
    await expect(
      (send as any)._handler(ctx, { roomId: 'room-1', userName: 'Guest', text: 'hello' }),
    ).rejects.toThrow(/join this room/i);
  });

  describe('password rooms', () => {
    const room = { _id: 'room-1', orgId: 'org-1', access: 'PASSWORD' };

    it('rejects anonymous reads and writes without the join grant', async () => {
      const ctx = createCtx({ room, identity: null });

      await expect((list as any)._handler(ctx, { roomId: 'room-1' })).rejects.toThrow(/password/i);
      await expect(
        (send as any)._handler(ctx, { roomId: 'room-1', userId: 'guest-1', userName: 'Guest', text: 'hello' }),
      ).rejects.toThrow(/password/i);
      expect(ctx.rows).toHaveLength(0);
    });

    it('rejects signed-in users from outside the workspace without the join grant', async () => {
      const ctx = createCtx({ room, identity: { subject: 'outsider' } });

      await expect((list as any)._handler(ctx, { roomId: 'room-1' })).rejects.toThrow(/password/i);
    });

    it('takes the sender from the join grant, not from the client', async () => {
      const ctx = createCtx({ room, identity: null, grants: [await grantFor('guest-1')] });

      await (send as any)._handler(ctx, {
        roomId: 'room-1',
        userName: 'Guest',
        text: 'hello',
        accessToken: 'token',
      });

      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].userId).toBe('guest-1');
    });
  });

  it('list returns messages sorted ascending by timestamp', async () => {
    const ctx = createCtx({
      rows: [
        { _id: 'm3', roomId: 'room-1', userId: 'u', userName: 'A', text: 'late', timestamp: 300 },
        { _id: 'm1', roomId: 'room-1', userId: 'u', userName: 'A', text: 'early', timestamp: 100 },
        { _id: 'm2', roomId: 'room-1', userId: 'u', userName: 'A', text: 'mid', timestamp: 200 },
      ],
    });

    const result = await (list as any)._handler(ctx, { roomId: 'room-1' });

    expect(result.map((r: any) => r.timestamp)).toEqual([100, 200, 300]);
    expect(result.map((r: any) => r.text)).toEqual(['early', 'mid', 'late']);
  });

  it('rate-limits each guest on their own, and within their room', async () => {
    const ctx = createCtx({ identity: null, grants: [await grantFor('guest-7')] });

    await (send as any)._handler(ctx, { roomId: 'room-1', userName: 'Guest', text: 'hi', accessToken: 'token' });

    expect(rateLimitSpy).toHaveBeenCalledWith(expect.anything(), 'guest-7', 'room-1');
  });

  describe('images', () => {
    const upload = (over: Partial<any> = {}) => ({
      _id: 'up-1', roomId: 'room-1', uploaderId: 'member-1', storageId: 'st-1',
      contentType: 'image/png', size: 1000, createdAt: Date.now(), ...over,
    });

    it('sends an image the sender uploaded to this room, without text', async () => {
      const ctx = createCtx();
      ctx.tables.chatUploads.push(upload());

      await (send as any)._handler(ctx, {
        roomId: 'room-1', userName: 'Jane', text: '',
        attachment: { kind: 'image', uploadId: 'up-1', width: 640, height: 480 },
      });

      expect(ctx.rows).toHaveLength(1);
      expect(ctx.rows[0].attachment).toEqual({ kind: 'image', storageId: 'st-1', width: 640, height: 480 });
      expect(ctx.tables.chatUploads[0].messageId).toBe(ctx.rows[0]._id);
    });

    it.each([
      ['another room', { roomId: 'room-2' }],
      ['another person', { uploaderId: 'someone-else' }],
      ['an earlier message', { messageId: 'chatMessages-99' }],
    ])('refuses an upload that belongs to %s', async (_label, over) => {
      const ctx = createCtx();
      ctx.tables.chatUploads.push(upload(over));

      await expect((send as any)._handler(ctx, {
        roomId: 'room-1', userName: 'Jane', text: '',
        attachment: { kind: 'image', uploadId: 'up-1', width: 10, height: 10 },
      })).rejects.toThrow(/image/i);
      expect(ctx.rows).toHaveLength(0);
    });

    it('lists an image with a URL to show it', async () => {
      const ctx = createCtx({
        rows: [{ _id: 'm1', roomId: 'room-1', userId: 'u', userName: 'A', text: '', timestamp: 1,
          attachment: { kind: 'image', storageId: 'st-1', width: 4, height: 3 } }],
      });

      const [message] = await (list as any)._handler(ctx, { roomId: 'room-1' });

      expect(message.attachment).toEqual({ kind: 'image', url: 'https://files.example/st-1', width: 4, height: 3 });
    });

    it('lets guests upload only small images, counted per room', async () => {
      const ctx = createCtx({ identity: null, grants: [await grantFor('guest-1')] });

      await expect((prepareUpload as any)._handler(ctx, { roomId: 'room-1', accessToken: 'token', size: CHAT_UPLOAD_MAX_BYTES.guest + 1 }))
        .rejects.toThrow(/too large/i);
      const ok = await (prepareUpload as any)._handler(ctx, { roomId: 'room-1', accessToken: 'token', size: 1000 });

      expect(ok).toEqual({ uploaderId: 'guest-1' });
      expect(uploadLimitSpy).toHaveBeenLastCalledWith(expect.anything(), 'guests:room-1');
    });

    it('gives members a larger limit, counted per person', async () => {
      const ctx = createCtx({ grants: [await grantFor('member-1')] });

      const ok = await (prepareUpload as any)._handler(ctx, { roomId: 'room-1', accessToken: 'token', size: CHAT_UPLOAD_MAX_BYTES.member });

      expect(ok).toEqual({ uploaderId: 'member-1' });
      expect(uploadLimitSpy).toHaveBeenLastCalledWith(expect.anything(), 'member-1');
    });

    it('needs the join grant to upload', async () => {
      const ctx = createCtx({ identity: null });

      await expect((prepareUpload as any)._handler(ctx, { roomId: 'room-1', accessToken: 'wrong', size: 10 }))
        .rejects.toThrow(/join/i);
    });

    it('records an upload and later removes it if no message took it', async () => {
      const ctx = createCtx();
      await (recordUpload as any)._handler(ctx, { roomId: 'room-1', uploaderId: 'guest-1', storageId: 'st-old', contentType: 'image/png', size: 5 });
      ctx.tables.chatUploads[0].createdAt = Date.now() - 2 * 60 * 60 * 1000;
      ctx.tables.chatUploads.push(upload({ _id: 'up-kept', storageId: 'st-sent', messageId: 'm1', createdAt: 0 }));
      ctx.tables.chatUploads.push(upload({ _id: 'up-fresh', storageId: 'st-fresh' }));
      // An image pasted onto a whiteboard has no message, and stays as long as boards may show it.
      ctx.tables.chatUploads.push(upload({ _id: 'up-board', storageId: 'st-board', keptFor: 'board', createdAt: 0 }));

      await (cleanupOrphanUploads as any)._handler(ctx, {});

      expect(ctx.deletedFiles).toEqual(['st-old']);
      expect(ctx.tables.chatUploads.map((u) => u.storageId).sort()).toEqual(['st-board', 'st-fresh', 'st-sent']);
    });
  });

  describe('GIFs', () => {
    it('sends a GIF from the GIF service', async () => {
      const ctx = createCtx();

      await (send as any)._handler(ctx, {
        roomId: 'room-1', userName: 'Jane', text: '',
        attachment: { kind: 'gif', url: 'https://static.klipy.com/ii/abc/1.webp', width: 200, height: 150, title: 'Hello' },
      });

      expect(ctx.rows[0].attachment).toMatchObject({ kind: 'gif', url: 'https://static.klipy.com/ii/abc/1.webp' });
    });

    it('refuses GIF links to anywhere else', async () => {
      const ctx = createCtx();

      await expect((send as any)._handler(ctx, {
        roomId: 'room-1', userName: 'Jane', text: '',
        attachment: { kind: 'gif', url: 'https://evil.example/track.gif', width: 1, height: 1 },
      })).rejects.toThrow(/gif/i);
    });
  });

  describe('reactions', () => {
    const message = { _id: 'm1', roomId: 'room-1', userId: 'u', userName: 'A', text: 'hi', timestamp: 1 };

    it('adds a reaction, counts it in the list, and takes it back on the second press', async () => {
      const ctx = createCtx({ rows: [{ ...message }] });

      await (toggleReaction as any)._handler(ctx, { roomId: 'room-1', messageId: 'm1', emoji: '👍' });
      ctx.tables.chatReactions.push({ _id: 'r-other', roomId: 'room-1', messageId: 'm1', userId: 'u-2', emoji: '👍' });
      let [listed] = await (list as any)._handler(ctx, { roomId: 'room-1' });
      expect(listed.reactions).toEqual([{ emoji: '👍', count: 2, mine: true }]);

      await (toggleReaction as any)._handler(ctx, { roomId: 'room-1', messageId: 'm1', emoji: '👍' });
      [listed] = await (list as any)._handler(ctx, { roomId: 'room-1' });
      expect(listed.reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);
    });

    it('accepts only an emoji', async () => {
      const ctx = createCtx({ rows: [{ ...message }] });

      await expect((toggleReaction as any)._handler(ctx, { roomId: 'room-1', messageId: 'm1', emoji: 'lol' }))
        .rejects.toThrow(/emoji/i);
    });

    it('refuses a message from another room', async () => {
      const ctx = createCtx({ rows: [{ ...message, roomId: 'room-2' }] });

      await expect((toggleReaction as any)._handler(ctx, { roomId: 'room-1', messageId: 'm1', emoji: '👍' }))
        .rejects.toThrow(/message/i);
    });
  });

  describe('media rules', () => {
    const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);

    it('knows images by their first bytes, not by the name or the claimed type', () => {
      expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
      expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
      expect(sniffImageType(new TextEncoder().encode('GIF89a......'))).toBe('image/gif');
      expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
      expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
      expect(sniffImageType(new TextEncoder().encode('<html><script>'))).toBeNull();
    });

    it('takes GIFs only from the GIF service over https', () => {
      expect(isAllowedGifUrl('https://static.klipy.com/ii/x/y.gif')).toBe(true);
      expect(isAllowedGifUrl('https://static2.klipy.com/ii/x/y.webp')).toBe(true);
      expect(isAllowedGifUrl('https://api.klipy.com/x.gif')).toBe(false);
      expect(isAllowedGifUrl('http://static.klipy.com/ii/x/y.gif')).toBe(false);
      expect(isAllowedGifUrl('https://static.klipy.com.evil.example/y.gif')).toBe(false);
      expect(isAllowedGifUrl('javascript:alert(1)')).toBe(false);
    });

    it('takes emoji, including skin tones and joined ones, and nothing else', () => {
      for (const emoji of ['👍', '👍🏽', '❤️', '👩‍💻', '🇩🇪', '🎉']) expect(isReactionEmoji(emoji)).toBe(true);
      for (const text of ['', 'a', '1', 'ok', '👍 ok', '<b>', '👍'.repeat(20)]) expect(isReactionEmoji(text)).toBe(false);
    });
  });
});

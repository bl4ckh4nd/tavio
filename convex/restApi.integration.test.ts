import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { getFunctionName } from 'convex/server';

const { apiLimit } = vi.hoisted(() => ({ apiLimit: vi.fn(async () => {}) }));
vi.mock('./lib/rateLimit', () => ({ checkApiRateLimit: apiLimit }));

import * as apiKeys from './apiKeys';
import * as restApi from './restApi';
import { createFakeCtx } from '../tests/fakeConvexDb';

const BASE = 'https://convex.test/v1';
const ORG_A = 'organizations:a';
const ORG_B = 'organizations:b';

const functions: Record<string, any> = {
  'recordingActions:signedDownloadUrl': {
    _handler: async (_ctx: any, args: { storagePath: string }) => `https://files.test/${args.storagePath}?signed`,
  },
};
for (const [module, exports] of Object.entries({ apiKeys, restApi })) {
  for (const [name, fn] of Object.entries(exports)) functions[`${module}:${name}`] = fn;
}

const room = (fields: Record<string, any>) => ({
  _creationTime: Date.UTC(2026, 10, 1),
  type: 'WORKSPACE',
  access: 'OPEN',
  activeParticipants: 0,
  maxParticipants: 50,
  locked: false,
  recording: false,
  createdAt: '2026-11-01',
  ...fields,
});

const seed = () => ({
  organizations: [
    { _id: ORG_A, name: 'A', slug: 'a' },
    { _id: ORG_B, name: 'B', slug: 'b' },
  ],
  orgMemberships: [
    { orgId: ORG_A, userId: 'admin-a', role: 'OWNER' },
    { orgId: ORG_A, userId: 'member-a', role: 'MEMBER' },
    { orgId: ORG_B, userId: 'admin-b', role: 'OWNER' },
  ],
  rooms: [
    room({ _id: 'rooms:a1', orgId: ORG_A, slug: 'standup', name: 'Standup', passwordHash: 'secret-hash' }),
    room({ _id: 'rooms:b1', orgId: ORG_B, slug: 'b-room', name: 'B room' }),
    room({ _id: 'rooms:loose', slug: 'loose', name: 'No workspace' }),
  ],
  recordings: [
    { _id: 'recordings:a1', orgId: ORG_A, roomId: 'rooms:a1', status: 'completed', startedAt: 1000, stoppedAt: 61000, durationMs: 60000, storagePath: 'rec/a1.mp4', startedByUserId: 'admin-a', egressId: 'EG_a1' },
    { _id: 'recordings:b1', orgId: ORG_B, roomId: 'rooms:b1', status: 'completed', startedAt: 2000, storagePath: 'rec/b1.mp4', startedByUserId: 'admin-b' },
  ],
  transcripts: [
    { recordingId: 'recordings:a1', status: 'completed', text: 'Hello there', segments: [{ startMs: 0, endMs: 900, speaker: 0, text: 'Hello there' }], createdAt: 1, updatedAt: 2 },
  ],
  roomSessions: [
    { roomId: 'rooms:a1', status: 'closed', startedAt: 1000, endedAt: 90000, lastActiveAt: 90000, participants: [{ userName: 'Ada' }, { userName: 'Lin' }], messageCount: 4 },
    { roomId: 'rooms:b1', status: 'closed', startedAt: 1000, endedAt: 90000, lastActiveAt: 90000, participants: [{ userName: 'Eve' }] },
  ],
});

const setup = (identity: string | null = 'admin-a') => {
  const ctx: any = createFakeCtx(seed(), identity ? { subject: identity } : null);
  const run = (ref: any, args: any) => {
    const fn = functions[getFunctionName(ref)];
    if (!fn) throw new Error(`no function ${getFunctionName(ref)}`);
    return fn._handler(ctx, args);
  };
  ctx.runQuery = run;
  ctx.runMutation = run;
  ctx.runAction = run;
  return ctx;
};

const newKey = async (ctx: any, name = 'CRM') => (await (apiKeys.create as any)._handler(ctx, { name })) as { key: string; apiKey: any };

const request = async (ctx: any, key: string | null, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response: Response = await restApi.handleApiRequest(ctx, new Request(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: text ? JSON.parse(text) : null };
};

beforeEach(() => {
  apiLimit.mockReset();
  apiLimit.mockResolvedValue(undefined);
  process.env.SITE_URL = 'https://meet.test';
});

describe('API keys', () => {
  it('shows the key once and stores only its hash', async () => {
    const ctx = setup();
    const { key, apiKey } = await newKey(ctx);

    expect(key).toMatch(/^tavio_[0-9a-f]{64}$/);
    expect(key.startsWith(apiKey.prefix)).toBe(true);
    const stored = ctx.rows('apiKeys');
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).not.toBe(key);
    expect(JSON.stringify(stored)).not.toContain(key);

    const listed = await (apiKeys.list as any)._handler(ctx, {});
    expect(listed).toEqual([expect.objectContaining({ id: apiKey.id, name: 'CRM', prefix: apiKey.prefix, lastUsedAt: null })]);
    expect(JSON.stringify(listed)).not.toContain(stored[0].tokenHash);
  });

  it('lets only workspace owners and admins manage keys', async () => {
    const ctx = setup('admin-a');
    const { apiKey } = await newKey(ctx);
    const as = (subject: string) => {
      ctx.auth = { getUserIdentity: async () => ({ subject }) };
      return ctx;
    };

    await expect(newKey(as('member-a'))).rejects.toThrow();
    expect(await (apiKeys.list as any)._handler(as('member-a'), {})).toBeNull();
    await expect((apiKeys.revoke as any)._handler(as('member-a'), { id: apiKey.id })).rejects.toThrow();
    await expect((apiKeys.revoke as any)._handler(as('admin-b'), { id: apiKey.id })).rejects.toThrow();
    expect(await (apiKeys.list as any)._handler(as('admin-b'), {})).toEqual([]);
    expect(ctx.rows('apiKeys')).toHaveLength(1);
  });

  it('refuses a missing, unknown or revoked key', async () => {
    const ctx = setup();
    const { key, apiKey } = await newKey(ctx);

    expect((await request(ctx, null, 'GET', '/rooms')).status).toBe(401);
    expect((await request(ctx, `tavio_${'0'.repeat(64)}`, 'GET', '/rooms')).status).toBe(401);
    expect((await request(ctx, key, 'GET', '/rooms')).status).toBe(200);

    await (apiKeys.revoke as any)._handler(ctx, { id: apiKey.id });
    const revoked = await request(ctx, key, 'GET', '/rooms');
    expect(revoked.status).toBe(401);
    expect(revoked.body.error.code).toBe('unauthorized');
  });

  it('records when a key was last used', async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);
    await request(ctx, key, 'GET', '/rooms');
    expect(ctx.rows('apiKeys')[0].lastUsedAt).toEqual(expect.any(Number));
  });
});

describe('REST API: rooms', () => {
  it('creates, reads, lists and deletes a room', async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);

    const created = await request(ctx, key, 'POST', '/rooms', { name: 'Weekly sync' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      name: 'Weekly sync',
      slug: expect.stringMatching(/^weekly-sync-[a-z0-9]{6}$/),
      url: `https://meet.test/room/${created.body.slug}`,
      access: 'OPEN',
      activeParticipants: 0,
      createdAt: expect.any(String),
    });

    expect((await request(ctx, key, 'GET', `/rooms/${created.body.id}`)).body.name).toBe('Weekly sync');
    expect((await request(ctx, key, 'GET', `/rooms/${created.body.slug}`)).body.id).toBe(created.body.id);

    const list = await request(ctx, key, 'GET', '/rooms');
    expect(list.body.data.map((r: any) => r.slug).sort()).toEqual([created.body.slug, 'standup'].sort());
    expect(list.text).not.toContain('secret-hash');
    expect(list.text).not.toContain(ORG_A);

    expect((await request(ctx, key, 'DELETE', `/rooms/${created.body.id}`)).status).toBe(204);
    expect((await request(ctx, key, 'GET', `/rooms/${created.body.id}`)).status).toBe(404);
    expect((await request(ctx, key, 'DELETE', `/rooms/${created.body.id}`)).status).toBe(404);
  });

  it('creates a password room with the given slug', async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);

    const created = await request(ctx, key, 'POST', '/rooms', { name: 'Board', slug: 'board-meeting', access: 'PASSWORD', password: 'hunter22' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ slug: 'board-meeting', access: 'PASSWORD' });
    expect(created.text).not.toContain('hunter22');
    expect(ctx.rows('rooms').find((r: any) => r.slug === 'board-meeting').passwordHash).toMatch(/^\$2/);
  });

  it("keeps other workspaces' rooms out of reach", async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);

    for (const ref of ['rooms:b1', 'b-room', 'rooms:loose', 'loose', 'not-an-id!!']) {
      expect((await request(ctx, key, 'GET', `/rooms/${encodeURIComponent(ref)}`)).status).toBe(404);
      expect((await request(ctx, key, 'GET', `/rooms/${encodeURIComponent(ref)}/sessions`)).status).toBe(404);
    }
    expect((await request(ctx, key, 'DELETE', '/rooms/rooms:b1')).status).toBe(404);
    expect(ctx.rows('rooms').some((r: any) => r._id === 'rooms:b1')).toBe(true);
  });

  it('says why a room could not be created', async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);
    const create = async (body: unknown) => {
      const { status, body: answer } = await request(ctx, key, 'POST', '/rooms', body);
      return [status, answer.error.code];
    };

    expect(await create('{not json')).toEqual([400, 'invalid_request']);
    expect(await create({})).toEqual([400, 'invalid_request']);
    expect(await create({ name: 42 })).toEqual([400, 'invalid_request']);
    expect(await create({ name: 'X', access: 'SECRET' })).toEqual([400, 'invalid_request']);
    expect(await create({ name: 'X', access: 'PASSWORD' })).toEqual([400, 'invalid_request']);
    expect(await create({ name: 'X', slug: 'Not A Slug' })).toEqual([400, 'invalid_request']);
    expect(await create({ name: 'X', slug: 'b-room' })).toEqual([409, 'conflict']);

    await request(ctx, key, 'POST', '/rooms', { name: 'Two' });
    await request(ctx, key, 'POST', '/rooms', { name: 'Three' });
    expect(await create({ name: 'Four' })).toEqual([403, 'plan_limit']);
  });

  it('answers 429 with Retry-After when the key is over its limit', async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);
    apiLimit.mockRejectedValueOnce(new ConvexError({ kind: 'RateLimited', name: 'apiRequest', retryAfter: 1500 }));

    const answer = await request(ctx, key, 'GET', '/rooms');

    expect(answer.status).toBe(429);
    expect(answer.headers.get('Retry-After')).toBe('2');
    expect(answer.body.error.code).toBe('rate_limited');
  });

  it('answers 404 for unknown paths and 405 for unknown methods', async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);

    expect((await request(ctx, key, 'GET', '/meetings')).status).toBe(404);
    expect((await request(ctx, key, 'GET', '/rooms/standup/whatever')).status).toBe(404);
    expect((await request(ctx, key, 'DELETE', '/rooms')).status).toBe(405);
    expect((await request(ctx, key, 'POST', '/rooms/standup')).status).toBe(405);
  });
});

describe('REST API: sessions and recordings', () => {
  it("lists a room's sessions", async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);

    const answer = await request(ctx, key, 'GET', '/rooms/standup/sessions');

    expect(answer.body.data).toEqual([expect.objectContaining({
      status: 'closed',
      startedAt: new Date(1000).toISOString(),
      endedAt: new Date(90000).toISOString(),
      participantNames: ['Ada', 'Lin'],
      messageCount: 4,
    })]);
  });

  it("lists and opens only the workspace's recordings", async () => {
    const ctx = setup();
    const { key } = await newKey(ctx);

    const list = await request(ctx, key, 'GET', '/recordings');
    expect(list.body.data).toEqual([{
      id: 'recordings:a1',
      roomId: 'rooms:a1',
      status: 'completed',
      startedAt: new Date(1000).toISOString(),
      endedAt: new Date(61000).toISOString(),
      durationMs: 60000,
      transcriptStatus: 'completed',
    }]);
    expect(list.text).not.toContain('rec/a1.mp4');
    expect((await request(ctx, key, 'GET', '/recordings?room=rooms:b1')).body.data).toEqual([]);

    const one = await request(ctx, key, 'GET', '/recordings/recordings:a1');
    expect(one.body.downloadUrl).toBe('https://files.test/rec/a1.mp4?signed');

    const transcript = await request(ctx, key, 'GET', '/recordings/recordings:a1/transcript');
    expect(transcript.body).toEqual({ status: 'completed', text: 'Hello there', segments: [{ startMs: 0, endMs: 900, speaker: 0, text: 'Hello there' }] });

    for (const path of ['/recordings/recordings:b1', '/recordings/recordings:b1/transcript', '/recordings/nope']) {
      expect((await request(ctx, key, 'GET', path)).status).toBe(404);
    }
  });
});

describe('REST API: routing', () => {
  it('sends every method under /v1/ to the API, so unsupported ones get its 405', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(32));
    vi.stubEnv('SITE_URL', 'http://localhost:3333');
    vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211');
    const { default: http } = await import('./http');
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      expect(http.lookup('/v1/rooms/x', method)?.[0], method).toBe(restApi.restApi);
    }
  });
});

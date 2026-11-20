import { beforeEach, describe, expect, it, vi } from 'vitest';

const { limitMock } = vi.hoisted(() => ({
  limitMock: vi.fn(async () => {}),
}));

vi.mock('@convex-dev/rate-limiter', () => ({
  MINUTE: 60,
  HOUR: 3600,
  RateLimiter: class {
    constructor(_component: unknown, _config: unknown) {}
    limit = limitMock;
  },
}));

vi.mock('../_generated/api', () => ({
  components: {
    rateLimiter: {},
  },
}));

import {
  checkChatRateLimit,
  checkChatUploadRateLimit,
  checkRoomCreateRateLimit,
  checkUploadRateLimit,
} from './rateLimit';

const makeCtx = (identity: { subject: string } | null) => ({
  auth: {
    getUserIdentity: async () => identity,
  },
});

describe('rateLimit helpers', () => {
  beforeEach(() => {
    limitMock.mockClear();
  });

  it('limits chat per participant, and everyone outside the workspace in a room together', async () => {
    const memberships = [{ orgId: 'org-1', userId: 'member-1' }, { orgId: 'org-2', userId: 'outsider-1' }];
    const ctx = {
      db: {
        get: async (id: string) => (id === 'room-1' ? { orgId: 'org-1' } : null),
        query: () => ({
          withIndex: (_name: string, range: (q: any) => any) => {
            let userId = '';
            range({ eq: (_field: string, value: string) => { userId = value; } });
            return { collect: async () => memberships.filter(m => m.userId === userId) };
          },
        }),
      },
    };
    await checkChatRateLimit(ctx, 'guest-1', 'room-1');
    // Signed in, but a member of another workspace only: a guest here.
    await checkChatRateLimit(ctx, 'outsider-1', 'room-1');
    await checkChatRateLimit(ctx, 'member-1', 'room-1');

    expect(limitMock.mock.calls.map(([, name, { key }]: any) => [name, key])).toEqual([
      ['chatSend', 'guest-1'],
      ['chatSendGuests', 'guests:room-1'],
      ['chatSend', 'outsider-1'],
      ['chatSendGuests', 'guests:room-1'],
      ['chatSend', 'member-1'],
    ]);
  });

  it('counts guest uploads per room and member uploads per person', async () => {
    await checkChatUploadRateLimit(makeCtx(null), 'guests:room-1');
    await checkChatUploadRateLimit(makeCtx(null), 'member-1');

    expect(limitMock).toHaveBeenNthCalledWith(1, expect.anything(), 'chatUploadGuests', { key: 'guests:room-1', throws: true });
    expect(limitMock).toHaveBeenNthCalledWith(2, expect.anything(), 'chatUploadMember', { key: 'member-1', throws: true });
  });

  it('requires auth for room creation rate limit', async () => {
    await expect(checkRoomCreateRateLimit(makeCtx(null))).rejects.toThrow(/Must be signed in/);
  });

  it('requires auth for upload rate limit', async () => {
    await expect(checkUploadRateLimit(makeCtx(null))).rejects.toThrow(/Must be signed in/);
  });
});
